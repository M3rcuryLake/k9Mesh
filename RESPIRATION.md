# Wi-Fi CSI Respiration Sensing Pipeline

Single-antenna Wi-Fi CSI respiration detection/rate-estimation pipeline, built for a SAR rover carrying an ESP32-S3 as the CSI source. This README covers only the sensing pipeline itself — capture-to-confidence-output — assuming the ESP32-S3 is already streaming raw CSI to a host machine.

Nothing here is validated end-to-end. It's a synthesis of four papers, each of which validated one piece of it under narrower conditions than the deployment target (rubble, unknown range, unknown material, possibly abnormal respiration). Treat the accuracy numbers as hypotheses, not specs.

---

## Pipeline Overview

```
raw CSI (per-packet, timestamped)
   │
   ▼
[1] Dropout-aware interpolation & windowing
   │
   ▼
[2] Motion gate (discard non-stationary subframes)
   │
   ▼
[3] Static-path removal (mean-subtraction, optional OR-PCA pre-filter)
   │
   ▼
[4] GASS — GA-optimized multi-pair CSCR bank
   │
   ▼
[5] Complex-domain SSNR projection → Hampel → Savitzky-Golay → bandpass
   │
   ▼
[6] Dual estimator (FFT + breath-onset ACF) w/ adaptive window extension
   │
   ▼
[7] Signal quality gate (SNR × agreement × spectral purity × cycle count)
   │
   ▼
[8] Two-level fusion (RaliSense-style within-window alignment → temporal fusion)
   │
   ▼
[9] Rate estimate + confidence score + attenuation-regime flag
```

---

## Stage-by-Stage

### 1. Capture & Dropout Handling
Interpolate onto a uniform time grid to correct sample-rate jitter. Before using a window, check what fraction of it was interpolated across gaps wider than ~0.5s. If that exceeds ~10–15%, **drop the window** — a filled gap landing inside one breath cycle silently corrupts the exact FFT bin you're about to trust, and it's undetectable after the fact.

> These thresholds are defaults, not derived constants. Calibrate against a known-good capture before trusting them.

### 2. Motion Gate
Segment into 1s subframes. If phase change within a subframe exceeds **2 rad**, discard it. Maintain a rolling 10s window of subframes that pass (10s ≈ 1.67–5 respiratory cycles at 10–30 brpm — enough to estimate from). Capture only while fully stationary, motors off: chest displacement is 5–12mm, and any residual chassis vibration or motor EMI will dominate a signal that small.

### 3. Static-Path Removal
Default: per-subcarrier mean subtraction over the window, removing the wall/furniture/LOS static term.

Under heavy attenuation, OR-PCA (low-rank + sparse decomposition) can be layered underneath as a coarse pre-filter — but it was only ever validated for classifying *gross* motion (walking, sitting) through walls, a signal orders of magnitude larger than chest displacement. Don't trust it as your primary respiration path until you've confirmed the sparse component still shows a clean respiration-band peak on a known target behind your actual wall/rubble material. If it doesn't survive that check, skip it and run CSCR directly on mean-subtracted CSI.

### 4. GASS + Multi-Pair CSCR Bank
Core primitive: ratio two subcarriers on the single antenna (CSCR). This cancels the random phase offset (which is linear in subcarrier index) and correlated amplitude impulse noise, without needing a second antenna.

One fixed pair is not enough — signal strength at a given pair depends on the unknown target-to-LOS distance and can null out entirely (a 76× difference between pair choices at the same geometry is not a hypothetical, it's a worked example in the source model). Run a GA to select a weighted bank of subcarrier pairs per window, maximizing in-band/out-of-band energy ratio (SSNR). Since the rig is stationary during a capture window, warm-start each window's GA from the previous window's converged solution at the same position.

### 5. Complex-Domain Projection & Filtering
Don't take `|CSCR|` or `Re(CSCR)` alone — amplitude and phase are each individually still blind-spot-susceptible. Project the complex CSCR onto the angle that maximizes SSNR; that's what actually restores full coverage.

Then: Hampel filter (kill residual impulse noise) → Savitzky-Golay (smooth without eating waveform shape) → bandpass **6–33 brpm**.

### 6. Dual Estimator + Adaptive Windowing
Two independent estimates per surviving CSCR stream:
- **FFT peak** (Hann-windowed; resolution = 1/T — a 10s window only gets ~6 brpm resolution)
- **Breath-onset counting** (box-slope-sum-function; not bin-limited, better at low RR where a window has only 2–3 cycles)

If the two disagree by more than a threshold, flag that stream's estimate as untrustworthy for that window. **Re-derive the disagreement threshold from your actual noise floor** — don't reuse a number that was really an artifact of someone else's experimental protocol.

**Adaptive extension:** if the initial estimate lands under ~10 brpm, automatically extend the window (10s → 20–30s, same stationary position) before finalizing. Low respiratory rate is both the hardest case to estimate accurately and the most clinically relevant one for a shocked or injured casualty — this is the single highest-stakes failure mode in the pipeline, so it gets a dedicated fallback rather than just a lower confidence score.

### 7. Signal Quality Gate
Per stream, combine:
- SNR (energy in-band vs. out-of-band)
- Estimation agreement (from Stage 6)
- Spectral purity (energy concentrated at one dominant frequency vs. spread like noise)
- **Cycle count** — a 10s window at 5 brpm contains under one full breath. This can look clean on every other metric while still being fundamentally under-sampled. Down-weight or exclude streams below ~2–3 observed cycles.

Streams that fail the gate get **dropped before fusion, not averaged in.**

### 8. Two-Level Fusion
**Within-window**, across surviving CSCR-pair candidates: align via change-direction vector (largest-eigenvalue direction of the I/Q covariance) + CSI-ratio-sum polarity to resolve the sign ambiguity — not scale-and-rotate. Scaling amplifies noise along with signal; rotation-by-traversal is expensive. The eigenvector approach avoids both, at roughly a quarter of the compute.

> This alignment method was validated for inter-antenna CSI ratios, not inter-subcarrier CSCR streams. It's mathematically plausible it transfers — the geometry doesn't care *why* two streams differ in phase — but bench-validate it against a known target before trusting it operationally.

**Across-window**, over time: feed the already-fused per-window estimate into a temporal filter (Kalman-ND, weighting each window inversely by its residual/quality score). Feeding raw single-pair candidates directly into temporal smoothing — skipping the within-window fusion — is a likely existing weak point if you're seeing noisy long-term traces; fix the ordering first.

### 9. Confidence & Output
Never emit a bare number. Output rate **and**:
- fraction of streams that passed the quality gate
- spread of estimates across surviving streams
- cycles observed
- an attenuation-regime flag (is the current range/material combination near or past the point where the underlying SSNR model predicts the signal should be unreliable at all?)

That last flag matters specifically for triage: it's the difference between "no breath detected" and "insufficient signal to say anything." Those are not the same message to send a rescuer.

---

## Degraded-Mode Fallback

If full rate estimation isn't converging (heavy attenuation, bad geometry, rubble multipath), fall back to a coarser presence/gross-motion classifier rather than forcing a rate number the physics doesn't support. This is a materially easier task and the only one with any through-heavy-concrete validation in the source material — treat it as the honest floor of what this system can promise in the worst-case scenario, not as a downgrade to avoid.

---

## Expected Accuracy (planning estimates, not measurements)

| Scenario | Est. MAE | Est. usable-window rate |
|---|---|---|
| LOS, 1–3m, stationary, normal RR | 1.5–2.5 brpm | 85–95% |
| LOS, 4–8m, stationary, normal RR | 2–4 brpm | 70–90% |
| Thin partition, 1–3m, normal RR | 2–4 brpm | 60–80% |
| Thick masonry/rubble, any range | unknown, plausibly 5+ brpm or no estimate | plausibly <50% |
| Any of the above, RR < 10 brpm | add 0.5–1.5 brpm, wider bias | reduced further |
| Degraded mode (presence/motion only) | n/a | ~93–97% classification accuracy in the closest validated analog (through-concrete gross-motion classification — not directly the same task) |

No combination of range + material + single-antenna operation matching this exact deployment has been measured in any source paper. Field-validate before relying on these numbers for a go/no-go call.

---

## Known Unvalidated Interfaces

- OR-PCA's sparse component retaining respiration-band signal (only shown for gross motion)
- RaliSense-style alignment transferring from antenna-pair ratios to subcarrier-pair ratios
- Any of the above in true rubble/irregular-multipath geometry (all source data is flat walls or open rooms)
- Behavior on irregular/abnormal (non-healthy-volunteer) respiration patterns

---

## References

1. Liu, G. et al. *SA-WiSense: A Blind-Spot-Free Respiration Sensing Framework for Single-Antenna Wi-Fi Devices.* arXiv:2507.17623v2 [eess.SP], 2025.
2. Michaelis, T.; Jorge, J.; Bijlani, N.; Villarroel, M. *VitalCSI: Contactless Respiratory Rate Estimation Using Consumer-Grade Wi-Fi Channel State Information.* Sensors 2026, 26, 225.
3. Gui, L. et al. *RaliSense: Extending WiFi Respiratory Detection Range by Rapid Alignment of Dynamic Components.* IEEE Trans. Mobile Computing, Vol. 24, No. 9, 2025, pp. 8119–8135.
4. Zhang, Z.; Hao, Z.; Dang, X.; Han, K. *TwSense: Highly Robust Through-the-Wall Human Detection Method Based on COTS Wi-Fi Device.* Applied Sciences 2023, 13, 9668.

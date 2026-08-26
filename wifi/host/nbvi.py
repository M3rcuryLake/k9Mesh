"""
NBVI (Normalized Baseline Variability Index) Calibrator - laptop port.

Ported from the ESP32-S3 firmware version. That version streamed magnitudes
to a flash file (uint8-quantized) because the device can't hold ~750x64
floats in RAM, and validated candidate bands with a hand-rolled
SegmentationContext to avoid depending on the "real" detector class.
Neither constraint applies here:

  - Baseline packets are buffered in a plain numpy array (n_packets x 64).
  - Candidate-band validation runs the actual MVSDetector class instead of
    a parallel reimplementation of its turbulence pipeline, so this can't
    drift out of sync with what the live detector does at inference time
    (see mvs_detector.py's gain_locked default, which WAS out of sync).

Algorithm (unchanged from upstream):
  1. Collect baseline CSI packets (quiet room).
  2. Find candidate baseline windows via percentile-based detection.
  3. For each candidate window, score all subcarriers with 4 NBVI
     strategies (Entropy Spaced, MAD Clustered, Classic Spaced,
     Classic Clustered) and validate each resulting band's false-positive
     rate by running it through MVSDetector.
  4. Keep the best-scoring (band, mv_values) pair; optionally compare
     against a caller-supplied hint band.

Output: (selected_band, mv_values)
  - selected_band: list of 12 subcarrier indices
  - mv_values: moving-variance samples from the winning band's validation
    pass (NOT the same as the live detector's calibrate() threshold -
    caller should still run mvs.calibrate() on the same baseline data
    with the winning band to get the live, sensitivity-tuned threshold).

Author: Francesco Pace <francesco.pace@gmail.com> (original ESP32-S3 version)
License: GPLv3
"""

import math
import numpy as np
from csi_dsp import GUARD_BAND_LOW, GUARD_BAND_HIGH, DC_SUBCARRIER, percentile
from mvs_detector import MVSDetector

NUM_SUBCARRIERS = 64
BAND_SIZE = 12

# Threshold for null subcarrier detection (mean amplitude below this = null)
NULL_SUBCARRIER_THRESHOLD = 1.0

# Adaptive validation threshold parameters (independent of the live
# detector's factor=0.7 sensitivity lever - this is just for comparing
# candidate bands against each other, not for setting the runtime
# threshold).
VALIDATION_ADAPTIVE_PERCENTILE = 95
VALIDATION_ADAPTIVE_FACTOR = 1.1


class NBVICalibrator:
    """
    Multi-strategy NBVI calibrator with percentile-based baseline detection.

    Usage:
        cal = NBVICalibrator(buffer_capacity=1300, mvs_window_size=75)
        while collecting baseline:
            cal.add_packet(packet.amplitudes)
        band, mv_values = cal.calibrate()
        # then calibrate the live detector's threshold on the same data:
        mvs = MVSDetector(band=band, window_size=75, gain_locked=True)
        threshold = mvs.calibrate(cal.get_baseline_frames())
    """

    def __init__(self, buffer_capacity, mvs_window_size=75,
                 percentile_pct=5, alpha=0.75, min_spacing=1,
                 noise_gate_percentile=15, gain_locked=True):
        """
        Args:
            buffer_capacity: max packets the baseline buffer can hold.
                Size generously (e.g. duration_s * expected_pps * 1.2) -
                add_packet() just stops accepting once full, no crash.
            mvs_window_size: window size for FP-rate validation. Should
                match the window_size the live MVSDetector will run with,
                since validation is only meaningful if it matches runtime.
            percentile_pct: percentile for baseline window detection.
            alpha: NBVI weighting factor (energy vs CV).
            min_spacing: minimum index spacing between selected subcarriers.
            noise_gate_percentile: percentile for the weak-subcarrier gate.
            gain_locked: True = raw std (gain lock active, matches this
                project's GAIN_LOCK_MODE="auto" hardware default).
                False = CV normalization (std/mean), for gain-unlocked runs.
        """
        self.buffer_capacity = buffer_capacity
        self._buffer = np.zeros((buffer_capacity, NUM_SUBCARRIERS), dtype=np.float64)
        self._packet_count = 0
        self._filtered_count = 0

        self.mvs_window_size = mvs_window_size
        self.percentile_pct = percentile_pct
        self.alpha = alpha
        self.min_spacing = min_spacing
        self.noise_gate_percentile = noise_gate_percentile
        self.gain_locked = gain_locked
        self.hint_fp_tolerance = 0.0
        self.prefer_hint_on_tie = False

    # ========================================================================
    # Packet collection
    # ========================================================================

    def add_packet(self, amplitudes):
        """
        Add one packet's amplitude array to the baseline buffer.

        Args:
            amplitudes: length-64 iterable of per-subcarrier amplitudes
                (e.g. packet.amplitudes from receiver.CSIReceiver).

        Returns:
            int: current buffer size (progress indicator).
        """
        if self._packet_count >= self.buffer_capacity:
            return self.buffer_capacity

        if len(amplitudes) != NUM_SUBCARRIERS:
            self._filtered_count += 1
            if self._filtered_count % 50 == 1:
                print(f'[WARN] NBVI: filtered {self._filtered_count} packets '
                      f'with wrong SC count (got {len(amplitudes)})')
            return self._packet_count

        self._buffer[self._packet_count] = amplitudes
        self._packet_count += 1
        return self._packet_count

    def get_packet_count(self):
        return self._packet_count

    def is_buffer_full(self):
        return self._packet_count >= self.buffer_capacity

    def get_baseline_frames(self):
        """Baseline packets collected so far, as an (n, 64) numpy array -
        pass this to MVSDetector.calibrate() to set the live threshold
        with the band this class selects."""
        return self._buffer[:self._packet_count]

    # ========================================================================
    # Calibration algorithm
    # ========================================================================

    def _band_turbulence_series(self, band):
        """Vectorized per-packet turbulence for one band, over the whole
        buffer collected so far. Returns a 1D numpy array, length n_packets."""
        band_idx = np.asarray(band, dtype=np.intp)
        band_data = self._buffer[:self._packet_count][:, band_idx]  # (n, k)
        std = band_data.std(axis=1)
        if self.gain_locked:
            return std
        mean = band_data.mean(axis=1)
        return np.divide(std, mean, out=np.zeros_like(std), where=mean > 1e-6)

    def _find_candidate_windows(self, current_band, window_size=200, step=50):
        """Find candidate baseline windows using percentile-based detection.
        NO absolute threshold - adapts automatically to environment."""
        n = self._packet_count
        if n < window_size:
            return []

        turb = self._band_turbulence_series(current_band)

        window_results = []
        for i in range(0, n - window_size + 1, step):
            window = turb[i:i + window_size]
            window_results.append((i, float(window.var())))

        if not window_results:
            return []

        variances = [w[1] for w in window_results]
        p_threshold = percentile(variances, self.percentile_pct)

        candidates = [w for w in window_results if w[1] <= p_threshold]
        candidates.sort(key=lambda x: x[1])
        return candidates

    def _calculate_nbvi_from_stats(self, mean, std, mad=0.0, entropy=0.0):
        """Calculate multiple NBVI scores to evaluate different candidate bands."""
        if mean < 1e-6:
            return {
                'nbvi_classic': float('inf'), 'nbvi_entropy': float('inf'),
                'nbvi_mad': float('inf'),
                'mean': mean, 'std': std,
            }

        cv = std / mean
        nbvi_energy = std / (mean * mean)
        base_score = self.alpha * nbvi_energy + (1 - self.alpha) * cv

        entropy_factor = max(0.5, entropy)
        entropy_score = base_score / entropy_factor

        robust_std = mad * 1.4826 if mad > 1e-6 else std
        cv_mad = robust_std / mean
        energy_mad = robust_std / (mean * mean)
        mad_score = self.alpha * energy_mad + (1 - self.alpha) * cv_mad

        return {
            'nbvi_classic': base_score,
            'nbvi_entropy': entropy_score,
            'nbvi_mad': mad_score,
            'mean': mean,
            'std': std,
            'mad': mad,
            'entropy': entropy,
        }

    def _apply_noise_gate(self, subcarrier_metrics):
        """Exclude weak subcarriers and those with infinite NBVI."""
        valid_means = [m['mean'] for m in subcarrier_metrics
                       if m['mean'] > 1.0 and m['nbvi'] != float('inf')]

        if not valid_means:
            print("NBVI: Noise Gate - no valid subcarriers found")
            return []

        threshold = percentile(valid_means, self.noise_gate_percentile)
        return [m for m in subcarrier_metrics
                if m['mean'] >= threshold and m['nbvi'] != float('inf')]

    def _select_with_spacing_strict(self, sorted_metrics, k=BAND_SIZE):
        valid_candidates = [c for c in sorted_metrics if c['nbvi'] != float('inf')]
        for current_spacing in range(self.min_spacing, -1, -1):
            selected = []
            for candidate in valid_candidates:
                if len(selected) >= k:
                    break
                sc = candidate['subcarrier']
                if selected and min(abs(sc - s) for s in selected) < current_spacing:
                    continue
                selected.append(sc)
            if len(selected) >= k:
                selected.sort()
                return selected
        selected = [c['subcarrier'] for c in valid_candidates[:k]]
        selected.sort()
        return selected

    def _select_with_spacing(self, sorted_metrics, k=BAND_SIZE):
        """Original clustered strategy."""
        selected = []
        for m in sorted_metrics:
            if len(selected) >= 5:
                break
            if m['nbvi'] != float('inf'):
                selected.append(m['subcarrier'])

        for candidate in sorted_metrics[5:]:
            if len(selected) >= k:
                break
            sc = candidate['subcarrier']
            if min(abs(sc - s) for s in selected) >= self.min_spacing:
                selected.append(sc)

        if len(selected) < k:
            for candidate in sorted_metrics:
                if len(selected) >= k:
                    break
                sc = candidate['subcarrier']
                if sc not in selected:
                    selected.append(sc)

        selected.sort()
        return selected

    def _validate_subcarriers(self, band):
        """
        Validate a candidate band by running the REAL MVSDetector over the
        whole baseline buffer and measuring how often it would have fired
        on quiet-room data.

        Returns:
            tuple: (fp_rate, mv_values)
        """
        if self._packet_count < self.mvs_window_size:
            return 0.0, []

        detector = MVSDetector(
            band=band,
            window_size=self.mvs_window_size,
            gain_locked=self.gain_locked,
        )

        mv_values = []
        for i in range(self._packet_count):
            _state, variance = detector.process(self._buffer[i])
            if len(detector.turbulence_buffer) < detector.window_size:
                continue  # window not full yet - variance not meaningful
            mv_values.append(variance)

        if not mv_values:
            return 0.0, []

        adaptive_thr = percentile(mv_values, VALIDATION_ADAPTIVE_PERCENTILE) * VALIDATION_ADAPTIVE_FACTOR
        motion_count = sum(1 for mv in mv_values if mv > adaptive_thr)
        fp_rate = motion_count / len(mv_values)
        return fp_rate, mv_values

    def calibrate(self, hint_band=None):
        """
        Calibrate using NBVI Weighted with percentile-based detection.

        Args:
            hint_band: optional band used both to search for candidate
                windows and as a fallback comparison point.

        Returns:
            tuple: (selected_band, mv_values) or (None, []) if failed.
        """
        window_size = 200
        step = 50

        if self._packet_count < self.mvs_window_size + 10:
            print("NBVI: Not enough packets for calibration")
            return None, []

        if hint_band is not None:
            search_band = hint_band
        else:
            search_band = list(range(GUARD_BAND_LOW, GUARD_BAND_LOW + BAND_SIZE))

        candidates = self._find_candidate_windows(search_band, window_size, step)

        if not candidates:
            print("NBVI: Failed to find candidate windows")
            return None, []

        print(f"NBVI: Found {len(candidates)} candidate windows")

        best_fp_rate = 1.0
        best_band = None
        best_mv_values = []
        best_avg_nbvi = 0.0
        best_avg_mean = 0.0
        best_window_idx = 0

        for idx, (start_idx, _window_variance) in enumerate(candidates):
            window_data = self._buffer[start_idx:start_idx + window_size]
            count = window_data.shape[0]
            if count == 0:
                continue

            all_metrics = []
            for sc in range(NUM_SUBCARRIERS):
                vals = window_data[:, sc]

                mean = float(vals.mean())
                std = float(vals.std())

                min_v = float(vals.min())
                max_v = float(vals.max())
                range_v = max_v - min_v
                entropy = 0.0
                if range_v > 0:
                    bins = [0] * 10
                    bin_w = range_v / 10
                    for v in vals:
                        b = int((v - min_v) / bin_w)
                        if b == 10:
                            b = 9
                        bins[b] += 1
                    for b in bins:
                        if b > 0:
                            p = b / count
                            entropy -= p * math.log2(p)

                sorted_vals = np.sort(vals)
                median = float(sorted_vals[count // 2])
                mad = float(np.sort(np.abs(vals - median))[count // 2])

                metrics = self._calculate_nbvi_from_stats(mean, std, mad=mad, entropy=entropy)
                metrics['subcarrier'] = sc

                _INF = float('inf')
                if sc < GUARD_BAND_LOW or sc > GUARD_BAND_HIGH or sc == DC_SUBCARRIER:
                    metrics['nbvi_classic'] = _INF
                    metrics['nbvi_entropy'] = _INF
                    metrics['nbvi_mad'] = _INF
                elif metrics['mean'] < NULL_SUBCARRIER_THRESHOLD:
                    metrics['nbvi_classic'] = _INF
                    metrics['nbvi_entropy'] = _INF
                    metrics['nbvi_mad'] = _INF

                metrics['nbvi'] = metrics['nbvi_classic']
                all_metrics.append(metrics)

            filtered_metrics = self._apply_noise_gate(all_metrics)

            # Candidate 1: Entropy Spaced
            sorted_entropy = sorted(filtered_metrics, key=lambda x: x['nbvi_entropy'])
            for m in sorted_entropy:
                m['nbvi'] = m['nbvi_entropy']
            band_entropy = self._select_with_spacing_strict(sorted_entropy, k=BAND_SIZE)

            # Candidate 2: MAD Clustered
            sorted_mad = sorted(filtered_metrics, key=lambda x: x['nbvi_mad'])
            for m in sorted_mad:
                m['nbvi'] = m['nbvi_mad']
            band_mad = self._select_with_spacing(sorted_mad, k=BAND_SIZE)

            # Candidate 3: Classic Spaced
            sorted_classic = sorted(filtered_metrics, key=lambda x: x['nbvi_classic'])
            for m in sorted_classic:
                m['nbvi'] = m['nbvi_classic']
            band_classic_spaced = self._select_with_spacing_strict(sorted_classic, k=BAND_SIZE)

            # Candidate 4: Classic Clustered
            band_classic = self._select_with_spacing(sorted_classic, k=BAND_SIZE)

            candidates_to_eval = []
            if len(band_entropy) == BAND_SIZE:
                candidates_to_eval.append(band_entropy)
            if len(band_mad) == BAND_SIZE and band_mad not in candidates_to_eval:
                candidates_to_eval.append(band_mad)
            if len(band_classic_spaced) == BAND_SIZE and band_classic_spaced not in candidates_to_eval:
                candidates_to_eval.append(band_classic_spaced)
            if len(band_classic) == BAND_SIZE and band_classic not in candidates_to_eval:
                candidates_to_eval.append(band_classic)

            for candidate_band in candidates_to_eval:
                if len(candidate_band) != BAND_SIZE:
                    continue

                selected_metrics = [m for m in all_metrics if m['subcarrier'] in candidate_band]
                avg_nbvi = sum(m['nbvi'] for m in selected_metrics) / len(selected_metrics)
                avg_mean = sum(m['mean'] for m in selected_metrics) / len(selected_metrics)

                fp_rate, mv_values = self._validate_subcarriers(candidate_band)

                override = False
                if best_band is None:
                    override = True
                elif fp_rate <= 0.05:
                    if best_fp_rate > 0.05:
                        override = True
                else:
                    if fp_rate < best_fp_rate:
                        override = True

                if override:
                    best_fp_rate = fp_rate
                    best_band = candidate_band
                    best_mv_values = mv_values
                    best_window_idx = idx
                    best_avg_nbvi = avg_nbvi
                    best_avg_mean = avg_mean

        if best_band is None:
            print("NBVI: All candidate windows failed - using default subcarriers")
            _, mv_values = self._validate_subcarriers(search_band)
            print("NBVI: Fallback to default band")
            if self._filtered_count > 0:
                print(f"  Filtered: {self._filtered_count} packets (wrong SC count)")
            return search_band, mv_values

        HINT_FP_TOLERANCE = self.hint_fp_tolerance
        FP_COMPARE_EPSILON = 1e-6
        use_hint_band = False
        hint_fp_rate = 1.0
        hint_mv_values = []
        if hint_band is not None and len(hint_band) == BAND_SIZE:
            hint_fp_rate, hint_mv_values = self._validate_subcarriers(hint_band)

            best_fp_acceptable = best_fp_rate <= 0.05
            hint_fp_acceptable = hint_fp_rate <= 0.05
            acceptable_best_cmp = best_fp_rate + HINT_FP_TOLERANCE + FP_COMPARE_EPSILON
            strict_best_cmp = best_fp_rate + HINT_FP_TOLERANCE
            if best_fp_acceptable and hint_fp_acceptable:
                if hint_fp_rate <= acceptable_best_cmp:
                    use_hint_band = True
                else:
                    print(f"NBVI: Keeping candidate band with FP {best_fp_rate*100:.1f}% "
                          f"vs hint {hint_fp_rate*100:.1f}% (acceptable target <5.0%)")
            elif not best_fp_acceptable:
                if self.prefer_hint_on_tie:
                    hint_fp_ok = hint_fp_rate <= acceptable_best_cmp
                else:
                    hint_fp_ok = (hint_fp_rate + FP_COMPARE_EPSILON) < strict_best_cmp

                if hint_fp_ok:
                    use_hint_band = True
                else:
                    print(f"NBVI: Hint FP ({hint_fp_rate*100:.1f}%) not better than "
                          f"candidate ({best_fp_rate*100:.1f}%) - keeping NBVI band")
            else:
                print(f"NBVI: Keeping candidate band with FP {best_fp_rate*100:.1f}% "
                      f"(target <5.0%, hint {hint_fp_rate*100:.1f}% not acceptable)")

        if use_hint_band:
            best_band = list(hint_band)
            best_mv_values = hint_mv_values
            print(
                f"NBVI: Using hint band (FP {hint_fp_rate * 100:.1f}% "
                f"vs best {best_fp_rate * 100:.1f}%, tol {HINT_FP_TOLERANCE * 100:.1f}%, "
                f"tie={'prefer' if self.prefer_hint_on_tie else 'strict'})"
            )

        print(f"NBVI: Selected window {best_window_idx + 1}/{len(candidates)} with FP rate {best_fp_rate * 100:.1f}%")
        print("NBVI: Band selection successful")
        print(f"  Band: {best_band}")
        print(f"  Avg NBVI: {best_avg_nbvi:.6f}")
        print(f"  Avg magnitude: {best_avg_mean:.2f}")
        print(f"  Est. FP rate: {best_fp_rate * 100:.1f}%")
        if self._filtered_count > 0:
            print(f"  Filtered: {self._filtered_count} packets (wrong SC count)")

        return best_band, best_mv_values

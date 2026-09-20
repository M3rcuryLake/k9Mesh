"""
pipeline_config.py

Central configuration for the respiration pipeline. Every threshold the
plan marks as engineering-default / calibration-dependent / experimental
lives here as a single source of truth.

Class codes (from the implementation plan):
    S  source-derived          -- measured from this exact system
    E  engineering default     -- reasonable starting point, not science
    C  calibration-dependent   -- must be tuned against recordings
    X  experimental            -- unvalidated, flag-gated
"""

from dataclasses import dataclass, field


@dataclass
class PipelineConfig:
    # --- Stage 1: timestamps / windowing ----------------------------------
    # nominal_sample_rate_hz is NOT assumed: the firmware currently caps
    # at ~50 Hz (time.sleep_ms(20)) with the traffic generator defaulting
    # to 20 Hz. The pipeline measures the effective rate from timestamps
    # at runtime; this value is only used as a sanity reference / grid
    # hint until the first estimate arrives.  S (measured at runtime)
    nominal_sample_rate_hz: float = 100.0
    large_gap_threshold_s: float = 0.5                    # E
    interp_rejection_fraction: float = 0.12               # E (allowed 0.10-0.15)

    # --- Stage 2: motion gate ---------------------------------------------
    motion_phase_threshold_rad: float = 2.0               # C
    subframe_duration_s: float = 1.0                      # E
    max_invalid_subframe_fraction: float = 0.2            # E

    # --- Adaptive windowing ------------------------------------------------
    min_window_s: float = 10.0                            # E
    max_window_s: float = 30.0                            # E
    window_extension_trigger_brpm: float = 10.0           # E

    # --- Bands (Hz) --------------------------------------------------------
    # Estimator search band: 10-30 brpm.                     C
    estimator_band_hz: tuple = (10.0 / 60.0, 30.0 / 60.0)
    # Final physiological validity band: 6-33 brpm.          E
    physiological_band_hz: tuple = (6.0 / 60.0, 33.0 / 60.0)
    # GASS optimization band; out-of-band is everything above high edge.  C
    gass_band_hz: tuple = (10.0 / 60.0, 30.0 / 60.0)
    gass_out_of_band_hz: tuple = (30.0 / 60.0, 1.5)       # C upper edge: below resampling Nyquist

    # --- Stage 4: CSCR ------------------------------------------------------
    cscr_denominator_floor_frac: float = 1e-3             # E (fraction of mean subcarrier magnitude)
    cscr_max_candidates: int = 32                         # E (pre-GASS candidate cap)
    cscr_pair_stride: int = 1                             # E (1 = all pairs, higher = strided)

    # --- Stage 5: projection ------------------------------------------------
    projection_angle_step_deg: float = 1.0                # E

    # --- Stage 5b: filtering ------------------------------------------------
    hampel_window: int = 7                                # E (matches csi_dsp.HampelFilter)
    hampel_threshold: float = 5.0                         # E
    sg_window_s: float = 0.5                              # E
    sg_poly_order: int = 2                                # E
    bandpass_order: int = 4                               # E (Butterworth, zero-phase filtfilt)

    # --- Stage 6: estimators / agreement ------------------------------------
    # PLACEHOLDER, NOT a universal truth. Calibrate against noise
    # characteristics in validation stage 1.                 C
    estimator_agreement_threshold_brpm: float = 4.0
    fft_noise_bins: int = 10                              # E (local noise window, from detect_breath)
    fft_guard_bins: int = 2                               # E
    fft_snr_min_db: float = 3.0                           # E (legacy BREATH_SNR_MIN)

    # --- Stage 7: quality gate ----------------------------------------------
    # Cycle-count minimum: strong reject below this.         C
    min_cycles: float = 2.0
    quality_min_total: float = 0.45                       # C
    quality_snr_score_min: float = 0.2                    # C
    quality_purity_min: float = 0.05                      # C (legacy detect_breath floor)

    # --- Stage 8: fusion ------------------------------------------------------
    fusion_method: str = "change_direction"               # E | "mean_baseline"
    max_fused_candidates: int = 16                        # E

    # --- Temporal fusion -------------------------------------------------------
    temporal_process_noise_brpm2: float = 0.05            # C (brpm^2/s)
    temporal_min_confidence: float = 0.2                  # E (below: measurement rejected)

    # --- GASS -------------------------------------------------------------------
    gass_population: int = 64                             # E
    gass_generations: int = 40                            # E
    gass_crossover_rate: float = 0.7                      # E
    gass_mutation_rate: float = 0.05                      # E
    gass_elite_count: int = 1                             # E (elitism: best never lost)
    gass_warm_start: bool = True                          # E (rover stationary between windows)
    gass_seed: int | None = None                          # E (determinism for tests)

    # --- Experimental flags -------------------------------------------------------
    enable_orpca: bool = False                            # X (never on the required path)
    enable_gass: bool = False                             # E (False = fixed heuristic for bring-up)

    def __post_init__(self):
        for name in ("estimator_band_hz", "physiological_band_hz",
                     "gass_band_hz", "gass_out_of_band_hz"):
            v = getattr(self, name)
            setattr(self, name, (float(v[0]), float(v[1])))
        assert self.estimator_band_hz[0] < self.estimator_band_hz[1]
        assert self.physiological_band_hz[0] < self.physiological_band_hz[1]

"""
pipeline.py

RespirationPipeline: orchestrates the full stage chain.

Windowing -> MotionGate -> StaticRemoval -> CSCR -> (GASS) -> Projection
-> FilterChain -> FFTEstimator + BSSFEstimator -> QualityGate
-> Fusion -> TemporalFusion -> RespirationResult

Adaptive windowing: 10s -> 20s -> 30s when estimate < 10 brpm or disagreement.
"""

from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from breath.pipeline_config import PipelineConfig
from breath.windowing import TimestampNormalizer, WindowManager, CSIWindow
from breath.motion_gate import MotionGate, MotionGateResult
from breath.static_removal import make_remover, StaticRemovalResult
from breath.cscr import CSCRBank
from breath.projection import ComplexProjector, ProjectionResult
from breath.filters import FilterChain
from breath.estimators import FFTEstimator, BSSFEstimator, EstimatorResult, estimator_agreement
from breath.quality import QualityGate, QualityResult, RejectionReason
from breath.fusion import fuse_candidates, FusionResult
from breath.temporal import TemporalFusion, TemporalState
from breath.result import RespirationResult, BreathingStatus
from breath.csi_complex import build_complex_csi, IQ_ORDER
from breath.gass import heuristic_select, gass_optimize


@dataclass
class PipelineResult:
    """Internal result per window attempt."""
    respiration: RespirationResult
    window: CSIWindow | None
    motion_gate: MotionGateResult | None
    static: StaticRemovalResult | None
    cscr_bank: CSCRBank | None
    projection_results: list[ProjectionResult] = field(default_factory=list)
    quality_results: list[QualityResult] = field(default_factory=list)
    fusion: FusionResult | None = None
    temporal: TemporalState | None = None
    status: BreathingStatus = BreathingStatus.INSUFFICIENT_DATA


class RespirationPipeline:
    def __init__(self, cfg: PipelineConfig):
        self.cfg = cfg
        self.normalizer = TimestampNormalizer(cfg)
        self.wm = WindowManager(cfg)
        self.motion_gate = MotionGate(cfg)
        self.static_remover = make_remover(cfg)
        self.projector = ComplexProjector(cfg)
        self.filter_chain = FilterChain(cfg)
        self.fft_estimator = FFTEstimator(cfg)
        self.bssf_estimator = BSSFEstimator(cfg)
        self.quality_gate = QualityGate(cfg)
        self.temporal = TemporalFusion(cfg)

    def push_packet(self, seq: int, ts_us: int, H: np.ndarray, remap_tag: str | None) -> None:
        """Feed a raw CSI packet into the pipeline's normalizer."""
        self.normalizer.add(ts_us, H)

    def _drain_normalizer(self) -> None:
        """Drain normalizer and push resulting windows to WindowManager."""
        window = self.normalizer.drain()
        if window is not None:
            self.wm.push(window)

    def process_window(self, window_s: float) -> PipelineResult:
        """Run full pipeline on a window of given length."""
        # Drain normalizer to get fresh windows into WindowManager
        self._drain_normalizer()

        window = self.wm.cut(window_s)
        if window is None:
            return PipelineResult(
                respiration=RespirationResult(
                    rate_bpm=None,
                    confidence=0.0,
                    status=BreathingStatus.INSUFFICIENT_DATA,
                    usable_window_s=0.0,
                ),
                window=None,
                motion_gate=None,
                static=None,
                cscr_bank=None,
                status=BreathingStatus.INSUFFICIENT_DATA,
            )

        # Motion gate
        motion_res = self.motion_gate.process(window)
        if not motion_res.window_valid:
            return PipelineResult(
                respiration=RespirationResult(
                    rate_bpm=None,
                    confidence=0.0,
                    status=BreathingStatus.MOTION_REJECTED,
                    usable_window_s=window_s,
                    rejection_reason=RejectionReason.MOTION_SUBFRAMES,
                ),
                window=window,
                motion_gate=motion_res,
                static=None,
                cscr_bank=None,
                status=BreathingStatus.MOTION_REJECTED,
            )

        # Static removal
        static_res = self.static_remover.remove(window)

        # CSCR bank
        physical_index = np.arange(64)  # identity map (array idx = physical idx for now)
        fs = 1.0 / np.median(np.diff(window.t)) if len(window.t) > 1 else 20.0
        cscr_bank = CSCRBank.build(static_res, self.cfg, physical_index, fs_hz=fs)

        # GASS / heuristic candidate selection
        if self.cfg.enable_gass:
            _ = gass_optimize(cscr_bank, self.cfg)
        else:
            _ = heuristic_select(cscr_bank, self.cfg)

        if not cscr_bank.candidates:
            return PipelineResult(
                respiration=RespirationResult(
                    rate_bpm=None,
                    confidence=0.0,
                    status=BreathingStatus.NO_BREATHING_DETECTED,
                    usable_window_s=window_s,
                    rejection_reason=RejectionReason.NO_VALID_CANDIDATES,
                ),
                window=window,
                motion_gate=motion_res,
                static=static_res,
                cscr_bank=cscr_bank,
                status=BreathingStatus.NO_BREATHING_DETECTED,
            )

        # Projection
        fs = 1.0 / np.median(np.diff(window.t))
        proj_results = self.projector.project_batch(cscr_bank.candidates, fs)
        for c, pr in zip(cscr_bank.candidates, proj_results):
            c.projected = pr.projected
            c.projected_angle_deg = pr.angle_deg

        # Filtering
        for c in cscr_bank.candidates:
            if c.projected is not None:
                fc_res = self.filter_chain.process(c.projected, fs)
                c.filtered = fc_res.filtered

        # Estimators
        for c in cscr_bank.candidates:
            if c.filtered is not None:
                c.fft_res = self.fft_estimator.estimate(c.filtered, fs)
                c.bssf_res = self.bssf_estimator.estimate(c.filtered, fs)
                if c.fft_res and c.bssf_res:
                    c.fft_brpm = c.fft_res.brpm
                    c.bssf_brpm = c.bssf_res.brpm
                    c.agreement_brpm, c.agreement_score, c.agreement_pass = estimator_agreement(
                        c.fft_res, c.bssf_res, self.cfg
                    )

        # Quality gate
        for c in cscr_bank.candidates:
            if c.filtered is not None:
                c.quality = self.quality_gate.evaluate(c, fs)

        # Fusion
        fusion_res = fuse_candidates(cscr_bank.candidates, self.cfg)

        # Temporal fusion
        temporal_state = self.temporal.update(fusion_res)

        # Final result
        resp = self._build_result(
            fusion_res, temporal_state, window_s, motion_res,
            cscr_bank, proj_results
        )

        return PipelineResult(
            respiration=resp,
            window=window,
            motion_gate=motion_res,
            static=static_res,
            cscr_bank=cscr_bank,
            projection_results=proj_results,
            quality_results=[c.quality for c in cscr_bank.candidates if c.quality],
            fusion=fusion_res,
            temporal=temporal_state,
            status=resp.status,
        )

    def try_adaptive(self) -> PipelineResult:
        """Try 10s, then 20s, then 30s with extension logic."""
        # Start with min window
        result = self.process_window(self.cfg.min_window_s)

        # Check if we should extend
        needs_extension = False
        if result.respiration and result.respiration.rate_bpm is not None:
            if result.respiration.rate_bpm < self.cfg.window_extension_trigger_brpm:
                needs_extension = True
        if result.fusion and not result.fusion.contributions:
            needs_extension = True

        if needs_extension and self.cfg.max_window_s > self.cfg.min_window_s:
            # Try 20s
            result2 = self.process_window(self.cfg.max_window_s * 2 / 3)  # 20s if max=30
            if result2.respiration and result2.respiration.rate_bpm is not None:
                return result2
            # Try max
            result3 = self.process_window(self.cfg.max_window_s)
            return result3

        return result
        if result.fusion and not result.fusion.contributions:
            needs_extension = True

        if needs_extension and self.cfg.max_window_s > self.cfg.min_window_s:
            # Try 20s
            result2 = self.process_window(self.cfg.max_window_s * 2 / 3)  # 20s if max=30
            if result2.respiration and result2.respiration.rate_bpm is not None:
                return result2
            # Try max
            result3 = self.process_window(self.cfg.max_window_s)
            return result3

        return result

    def _build_result(self, fusion: FusionResult, temporal: TemporalState,
                      window_s: float, motion: MotionGateResult,
                      cscr_bank: CSCRBank, proj_results) -> RespirationResult:
        # Collect per-candidate diagnostics
        fft_estimates = [c.fft_brpm for c in cscr_bank.candidates if c.fft_brpm is not None]
        bssf_estimates = [c.bssf_brpm for c in cscr_bank.candidates if c.bssf_brpm is not None]

        fft_median = float(np.median(fft_estimates)) if fft_estimates else None
        bssf_median = float(np.median(bssf_estimates)) if bssf_estimates else None

        # Overall status
        if fusion.brpm is not None:
            status = BreathingStatus.BREATHING_DETECTED
        elif cscr_bank and not cscr_bank.candidates:
            status = BreathingStatus.NO_BREATHING_DETECTED
        elif motion and not motion.window_valid:
            status = BreathingStatus.MOTION_REJECTED
        elif fusion.pass_fraction == 0:
            status = BreathingStatus.INSUFFICIENT_SIGNAL
        else:
            status = BreathingStatus.INSUFFICIENT_DATA

        # Confidence components
        conf_components = {
            "pass_fraction": fusion.pass_fraction,
            "spread": 1.0 / (1.0 + fusion.estimate_spread_brpm) if fusion.estimate_spread_brpm > 0 else 1.0,
            "cycles": 1.0,  # filled by quality
            "regime": 1.0,  # placeholder for attenuation flag
        }

        return RespirationResult(
            rate_bpm=fusion.brpm,
            snr=None,  # not computed at this level
            confidence=fusion.confidence * 100.0,  # 0-100 scale for frontend
            status=status.value if hasattr(status, 'value') else status,
            usable_window_s=window_s,
            fft_estimate_brpm=fft_median,
            bssf_estimate_brpm=bssf_median,
            estimator_agreement=abs(fft_median - bssf_median) if (fft_median and bssf_median) else None,
            quality={"n_passing": fusion.n_passing, "n_total": fusion.n_candidates, "pass_fraction": fusion.pass_fraction},
            temporal={"state": temporal.status, "variance": temporal.var, "n_accepted": temporal.n_accepted},
            regime_flag="normal",
            confidence_components=conf_components,
        )
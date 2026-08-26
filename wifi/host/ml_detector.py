"""
ML motion detector - laptop-side MLP classifier over 9 turbulence-window
features (see ml_features.py). Uses the fixed DEFAULT_BAND, raw std (no CV),
same Hampel-filtered turbulence stream as MVS but its own window buffer
since ML and MVS can run with different window sizes / bands.

No model ships with this - train one with train_model.py after collecting
baseline/movement data with collect_data.py. Until then MLDetector.enabled
is False and .process() returns None scores.
"""

from collections import deque
from pathlib import Path
import pickle

from csi_dsp import DEFAULT_BAND, HampelFilter, LowPassFilter, spatial_turbulence
from ml_features import extract_features


class MLDetector:
    def __init__(
        self,
        model_path="model.pkl",
        band=None,
        window_size=10,
        hampel_enabled=True,
        hampel_window=7,
        hampel_threshold=8.0,
        lowpass_enabled=True,
        lowpass_cutoff_hz=11.0,
        sample_rate_hz=100.0,
        threshold=0.5,
    ):
        self.band = band or list(DEFAULT_BAND)
        self.window_size = window_size
        self.threshold = threshold

        self.hampel = HampelFilter(hampel_window, hampel_threshold) if hampel_enabled else None
        self.lowpass = LowPassFilter(lowpass_cutoff_hz, sample_rate_hz) if lowpass_enabled else None
        self.turbulence_window = deque(maxlen=window_size)

        self.model = None
        self.scaler = None
        self.enabled = False

        path = Path(model_path)
        if path.exists():
            with open(path, "rb") as f:
                bundle = pickle.load(f)
            self.model = bundle["model"]
            self.scaler = bundle.get("scaler")
            self.enabled = True
            print(f"[MLDetector] Loaded model from {path}")
        else:
            print(f"[MLDetector] No model at {path} - ML detection disabled "
                  f"until you run collect_data.py + train_model.py")

    def _band_amplitudes(self, amplitudes):
        n = len(amplitudes)
        return [amplitudes[i] for i in self.band if i < n]

    def _turbulence_for_packet(self, amplitudes):
        # raw std, gain-locked / no CV normalization, per upstream ML mode
        t = spatial_turbulence(self._band_amplitudes(amplitudes), gain_locked=True)
        if self.hampel is not None:
            t = self.hampel.filter(t)
        if self.lowpass is not None:
            t = self.lowpass.filter(t)
        return t

    def process(self, amplitudes):
        """
        Feed one packet's amplitude array.

        Returns:
            dict(score=float|None, motion=bool|None, ready=bool)
            score/motion are None until enough packets have accumulated
            (window_size) AND a model is loaded.
        """
        t = self._turbulence_for_packet(amplitudes)
        self.turbulence_window.append(t)

        ready = len(self.turbulence_window) == self.window_size
        if not ready or not self.enabled:
            return {"score": None, "motion": None, "ready": ready}

        feats = extract_features(self.turbulence_window)
        x = [feats]
        if self.scaler is not None:
            x = self.scaler.transform(x)

        proba = self.model.predict_proba(x)[0]
        score = float(proba[1]) if len(proba) > 1 else float(proba[0])
        motion = score >= self.threshold

        return {"score": score, "motion": motion, "ready": True}

import colorsys


def _colormap(t: float) -> list[int]:
    t = max(0.0, min(1.0, t))
    hue = (240.0 * (1.0 - t)) / 360.0

    saturation = 1.0

    # Brightness increases with amplitude.
    value = 0.15 + (0.85 * t)

    r, g, b = colorsys.hsv_to_rgb(hue, saturation, value)

    return [
        int(round(r * 255)),
        int(round(g * 255)),
        int(round(b * 255)),
    ]


class SpectrogramProcessor:
    """
    Extracts raw amplitude values for the calibrated band, normalizes
    them relative to each other, and dynamically converts them to RGB.
    """

    def __init__(self):
        pass

    def push(
        self,
        packet_amplitudes: list[float],
        band: list[int],
    ) -> list[list[int]]:

        raw = [packet_amplitudes[i] for i in band]

        lo = min(raw)
        hi = max(raw)

        span = hi - lo

        if span == 0:
            normalized = [0.0] * len(raw)
        else:
            normalized = [
                (value - lo) / span
                for value in raw
            ]

        return [
            _colormap(value)
            for value in normalized
        ]

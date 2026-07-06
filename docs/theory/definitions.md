# ModeForge Definitions

## Beam Widths

- `radiusMm` means the 1/e^2 intensity radius unless a field says otherwise.
- `diameterMm` is `2 * radiusMm`.
- `FWHM` is a full width at half maximum quantity.
- `rms_radius` is the square root of the second central moment.
- `D4sigma diameter` is `4 * sigma`, where `sigma` is the second-moment rms radius.
- In Moment Mode, the propagated envelope radius used for plotting is `D4sigma / 2 = 2 * sigma`.

## M^2

M^2 is a propagation-quality factor, not an intensity profile. For the initial Fast/Moment implementation:

```text
theta = M^2 * lambda / (pi * w0)
zR_M2 = pi * w0^2 / (M^2 * lambda)
w(z) = w0 * sqrt(1 + (z / zR_M2)^2)
```

Here `theta` is the far-field half-angle divergence in radians. Full-angle divergence is `2 * theta`. All quantities are evaluated with compatible length units.

## Surface Radius Sign

Light propagates left to right. A surface radius is positive when its center of curvature is to the right of the surface and negative when it is to the left. Plane surfaces use `"Infinity"`.

## UI Boundary

UI code must not reimplement these equations. It renders result fields produced by the core.

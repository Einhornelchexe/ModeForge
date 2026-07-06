# ModeForge Measured Beam Notes

**Status:** S10 draft, headless only.
**Datum:** 2026-07-02.

## Cylindrical Optics

`cylindrical-lens` applies a thin-lens ABCD matrix only to the selected axis. A circular Gaussian is promoted to x/y propagation when the first cylindrical lens appears.

## Beam Fit

The first measured-beam fit assumes Gaussian/M2 radius data and fits:

```text
w(z)^2 = a z^2 + b z + c
```

Then:

```text
z0 = -b / (2a)
w0^2 = c - a z0^2
theta = sqrt(a)
M2 = pi * w0 * theta / lambda
```

The fit requires at least three radius measurements with finite z positions.

`parseBeamWidthMeasurementsCsv` imports a simple two-column text/CSV measurement format. The width column can be declared as `one_over_e2_radius`, `fwhm_diameter`, `rms_radius`, or `d4sigma_diameter`; values are converted to the internal 1/e^2 radius basis before fitting.

Fit results include `residualRmsMm` and `maxRelativeResidual`. A `MEASUREMENT_FIT_RESIDUAL_HIGH` warning is emitted when the max relative residual exceeds 2%.

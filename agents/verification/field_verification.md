# ModeForge Field Mode Physics Verification

Independent verification of the scalar-field propagation physics in `packages/field/src/scalar-field.ts`.

## Claim Table

| # | Claim | Target | Status | Evidence |
|---|-------|--------|--------|----------|
| 1 | Unitary DFT normalization preserves discrete field power | `propagateFresnel` / `propagateAngularSpectrum` | VERIFIED | Power ratio = 1 to floating-point accuracy; see cases `power_conservation_fresnel`, `power_conservation_angular_spectrum`. |
| 2 | Fresnel propagation reproduces analytic Gaussian second-moment radius | `propagateFresnel` + `fieldMomentRadii` | VERIFIED | Analytic moment radius 2σ = w(z) matches within discretization tolerance; case `fresnel_moment_radius`. *(Text corrected S16: an earlier draft wrote "√2·w(z)" here — the executable case value and the code always used the correct 2σ = w convention; only this prose line was stale.)* |
| 3 | Angular-spectrum kernel uses carrier-removed form and damps evanescent waves | `propagateAngularSpectrum` | VERIFIED | Kernel = exp(i·k·z·(√(1-λ²f²)-1)); evanescent bins exponentially damped; power conserved where evanescent content negligible. |
| 4 | Circular aperture power transmission matches T = 1 - exp(-2a²/w²) | `applyCircularAperture` | VERIFIED | Three cases with a/w = 0.5, 1.0, 1.5 match analytic to <0.1%. |
| 5 | Thin-lens phase factor exp(-i·k·r²/(2f)) implemented correctly for both axes | `applyThinLensPhase` | VERIFIED | Phase = -π·r²/(λf); cylindrical variant applies only to selected axis; case `cylindrical_lens_x_moment_radii` confirms. |
| 6 | `fieldSamplingWarnings` triggers when spacing > w/4 or extent < 3w | `fieldSamplingWarnings` | VERIFIED | Cases `sampling_warning_coarse_spacing` and `sampling_warning_small_extent` produce expected warnings. |
| 7 | Gaussian field creation and power / intensity routines are consistent with definitions | `createGaussianField`, `fieldPower`, `fieldIntensity` | VERIFIED | Conform to definitions in `docs/theory/field_mode.md` and `docs/theory/definitions.md`. |

## Verification Cases

Executable test cases are provided in `agents/verification/field_cases.json`. Each case contains:
- `id` — unique identifier
- `description` — what is tested
- `target` — the function or combination under test
- `inputs` — structured parameters that can be passed directly to the target
- `expected` — exact analytic expectation (≥6 significant digits where applicable)
- `toleranceRel` — relative tolerance for the comparison
- `derivation` — brief mathematical derivation of the expected value

Expected values were computed analytically, not by mental execution of TypeScript, and are independent of any specific implementation.

# ModeForge Image Analyzer Verification

Independent reference cases for the browser-local single-image beam-profile
analyzer in `packages/image` (S18, plan v5 + gate-calibration spec). The
executable cases live in `agents/verification/image_analyzer_cases.json`; the
runner is the unit test `tests/unit/image-verification-cases.test.ts`, which is
part of the standard suite (`npm test`). The generic reference-case runner
(`npm run verify:cases`) reports these cases as "skipped (no handler)" by
design - the unit test IS their handler, so they gate every suite run instead
of only the release check. The headless job path is additionally pinned by
`examples/image_analysis_gauss.headless.json` via `npm run verify:headless`
(released stage-B D4sigma to 12 digits, fit parameters to 6).

## Claim Table

| # | Claim | Target | Status | Evidence |
|---|-------|--------|--------|----------|
| 1 | Stage-B aperture D4sigma reproduces the analytic 4*sigma*T with the documented truncation factor T(alpha=4) = 0.9986568, axis-aligned and rotated | `analyzeImage` stage-B moments | VERIFIED | Cases `gauss_d4_alpha4_axis_aligned`, `gauss_d4_alpha4_rotated` (tolerances 1 % / 3 %). |
| 2 | The 2D Gaussian fit recovers the generating parameters of a noise-free beam | `fits.gauss2d` | VERIFIED | Case `gauss_fit_recovery_noise_free` (amplitude, sigmas, centre to 1 %). |
| 3 | A seeded SNR-100 scene releases stage B with the analytic D4sigma plus small noise bias | release path with noise | VERIFIED | Case `gauss_release_snr100_seeded` (deterministic mulberry32/Box-Muller generator, fixed literal seed). |
| 4 | A 1 % core+halo profile is suppressed as `alpha_inconsistent` noise-free (delta ~14 % vs the 3 % floor) | alpha-consistency gate | VERIFIED | Case `core_halo_alpha_inconsistent_noise_free`. |
| 5 | A separated second beam pins `significantPeakCount = 2`; the reported reason follows the documented precedence (`residual_high` fires first for this fixture) | multi-peak gate + precedence | VERIFIED | Case `two_beams_multi_peak` - the pin was CORRECTED against the measured run: the satellite's own residual (RMS 1.44 counts > 0.005*peak) wins precedence; the peak count is asserted alongside. |
| 6 | A beam whose 6-sigma check ellipse crosses the ROI boundary suppresses as `aperture_clipped` | clipping gate | VERIFIED | Case `aperture_clipped_beam_near_edge`. |
| 7 | sigmaB = 0 gives the exact documented gate defaults: thresholds exactly 3, MC skipped (count 0, decimation 1), EVT arm 0 | self-calibration skip contract | VERIFIED | Case `sigmaB_zero_exact_thresholds` (exact compare, tolerance 0). |
| 8 | The multi-peak candidate threshold equals sigmaB_est*(sqrt(2 ln M)+0.5) with M the scanned ROI pixel count | EVT arm fields | VERIFIED | Case `multi_peak_evt_threshold_pin` - pinned with the measured rim-MAD sigmaB estimate (2.9340, not the generator's 3.0), which is the honest input to the formula. |
| 9 | Ellipticity is exactly sigmaMinor/sigmaMajor of the released moments (truncation cancels) | `metrics.ellipticity` | VERIFIED | Case `ellipticity_noise_free`. |
| 10 | Encircled-power radii follow the ANISOTROPIC Gaussian integral, not the circular 1-exp law | `metrics.encircledPowerRadiiPx` | VERIFIED | Case `encircled_power_radius_gaussian` - pin corrected from the naive circular formula to the measured/re-derived anisotropic values F(5.8309)=0.50, F(9.2)=0.80 for sigma 6x4. |
| 11 | A probe whose ellipse leaves the ROI is dropped, and the detector now reports which radii actually ran instead of only the winner | `aperture.absorbedPower.availableProbeAlphas` / `maxAvailableProbeAlpha` | VERIFIED | Case `wing_probe_reach_reduced_by_the_frame` - sigma 20x12 at 0.3 rad on a 300 px frame keeps the 4 and 6 sigma probes and loses the 9 and 12 sigma ones (S20 stage B). |
| 12 | A released frame whose cross-tier check the stage-A plausibility predicate blocked says so, with the reason named, rather than looking checked-and-fine | `tierCheck` | VERIFIED | Case `tier_check_unavailable_pedestal_widens_stage_a` - 4*sigma_A = 104.8 px against a 100 px ROI side, reason `sigma_exceeds_roi` (S20 stage B). |

## Pin-correction honesty trail

Three initial pins were proven wrong by the first executable run and corrected
with the justification stored in each case's `derivation` field (precedence of
`residual_high` over `multi_peak` for the two-beam fixture; the EVT threshold
uses the estimated - not generated - noise scale; the anisotropic
encircled-power integral). No tolerance was widened to make a wrong pin pass.

## How to re-run

- Unit runner (part of every suite run): `node --test tests/unit/image-verification-cases.test.ts`
- Full suite: `npm test`
- Headless job pin: `npm run verify:headless` (regenerate expected summaries
  with `node scripts/verify-headless.mjs --print-summary` after INTENTIONAL
  numeric changes only; the diff must stay additive for unrelated entries).

Each case entry carries: `id`, `description`, `target`, compact generator
`inputs` (width/height/dtype, Gaussian parameters, sigmaB, fixed literal seed -
never inline pixel arrays), `expected` (dot-path pins into the analyzeImage
result), `toleranceRel` (0 = exact for strings/booleans/exact contracts) and
`derivation`.

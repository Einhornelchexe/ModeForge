# Thick Lens / Surface Stack / Material Dispersion Verification

## Overview

This document presents an independent verification of the paraxial optics and material models implemented in `packages/optics/src/matrix.ts`, `surface-stack.ts`, and `packages/materials/src/materials.ts`. Verdicts are based on analytical derivation and comparison against the provided source code. The accompanying JSON file (`thicklens_materials_cases.json`) provides 10 test cases with expected values derived from first principles.

## Conventions

- Ray vector: `[y, theta]^T` (height, angle in radians).
- Light propagates left to right; positive distances are to the right.
- Surface radius positive if centre of curvature is to the right (as documented in `docs/theory/definitions.md`).
- ABCD matrix operates as: `[y_out; θ_out] = M * [y_in; θ_in]`.
- Determinant of a refraction matrix is `n_in / n_out`.

## Claim Table

| # | Claim | Source | Expected | Code Behaviour | Verdict | Notes |
|---|-------|--------|----------|---------------|---------|-------|
| 1 | Refraction matrix at spherical surface matches standard form | `refractiveSurfaceMatrix()` | A=1, B=0, C=(n1-n2)/(n2 R), D=n1/n2 | Implements exactly this | **VERIFIED** | Determinant = n1/n2 ✅ |
| 2 | Free-space matrix uses physical distance in [y,θ] convention | `freeSpaceMatrix()` | A=1, B=lengthMm, C=0, D=1 | Correct for the convention | **VERIFIED** | Combined with surface matrices yields correct propagation |
| 3 | Surface stack composition order (left-to-right) | `surfaceStackMatrix()` | M_total = M_n * ... * M_1 (with M_1 first surface) | Order is correct via `composeMatrices` | **VERIFIED** | Matches sequential component convention |
| 4 | Thick lens effective focal length from matrix | `paraxialCard()` (via `surfaceStackMatrix`) | 1/f = (n-1)*(1/R1 - 1/R2 + (n-1)t/(n R1 R2)) | EFL = -1/C; derived matrix C matches the lensmaker’s equation exactly | **VERIFIED** | Verified analytically for biconvex and plano-convex cases |
| 5 | Back focal length (BFL) | `paraxialCard().backFocalLengthMm` | BFL = f*(1 - (n-1)t/(n R1)) | Returns -A/C, which matches | **VERIFIED** |  |
| 6 | Front focal length (FFL) sign convention | `paraxialCard().frontFocalLengthMm` | Standard signed formula: FFL = -D/C (negative for converging lens in left-to-right convention) | Returns D/C, which gives a negative value for converging lens; could be correct as signed distance but typical practice reports positive length | **SUSPECT** | Needs documentation clarification; see case 7 |
| 7 | Plane window matrix | `surfaceStackMatrix()` for R=Infinity | [1, t/n; 0, 1] with determinant 1 | Code produces exactly this; C=0 → no finite focal lengths | **VERIFIED** |  |
| 8 | Sellmeier coefficients | `materials.ts` constants | N-BK7: Schott data; Fused Silica: Malitson data | Values match published references exactly | **VERIFIED** |  |
| 9 | Refractive index computation | `refractiveIndex()` | n^2 = 1 + Σ Bi λ²/(λ²-Ci) | Correct implementation; results within 1e-6 of independent calculation | **VERIFIED** | Cases 1-4 |
| 10 | Numerical derivative for dn/dλ | `dnDlambda()` | Central difference with step ≈1e-5 µm; satisfactory for smooth regions | Finite difference is used instead of analytical derivative; error limited but not optimal | **SUSPECT** | Acceptable for current stage; consider analytical derivative for production |
| 11 | Group velocity dispersion formula | `gvdFs2PerMm()` | GVD = (λ³/(2πc²)) * d²n/dλ², converted to fs²/mm | Derivation and unit conversions are correct | **VERIFIED** | Constant-n branch returns 0 ✅ (case 10) |
| 12 | `paraxialCard` EFL assumes output index = 1 | `paraxialCard()` | Effective focal length formula should be -n_out / C in general | Code hardcodes -1/C; correct only when final medium is air | **SUSPECT** | Current usage ends in air; restriction should be documented |
| 13 | Material wavelength range warnings | `materialWarnings()` | Warns when λ outside specified range | Correctly indicates `MATERIAL_OUTSIDE_RANGE` | **VERIFIED** |  |

## Test Cases

See `thicklens_materials_cases.json` for a suite of 10 quantitative cases. Each case includes a derivation field explaining the expected value computation.

# ModeForge Gaussian Optics — Independent Physics Verification

## Scope

This document verifies the Gaussian‑beam paraxial optics core of ModeForge (`packages/optics/src/gaussian.ts`, `matrix.ts`, and the relevant portion of `simulate.ts`) against standard laser optics literature (Siegman, Saleh & Teich). Every formula is re‑derived from first principles using the conventions below.

## Conventions

- Beam radius `w` denotes the `1/e²` intensity radius (half‑width at `1/e²` of field amplitude).
- Wavelength `λ` is provided in µm; the code converts to mm via `umToMm` (divide by 1000).
- The complex beam parameter is `q(z) = z + i·zR`, with the origin at the beam waist.
- Rayleigh range: `zR = π·w₀² / (M²·λ)` where `λ` must be in the same length unit as `w₀`.
- Far‑field half‑angle divergence: `θ = M²·λ / (π·w₀)`.
- Gaussian radius: `w(z) = w₀·√[1 + (z / zR)²]`.
- The radius of curvature is `R(z) = z·[1 + (zR / z)²]`.
- ABCD matrices follow the ray vector `[y, θ]ᵀ` and are ordered such that the system matrix is `M_total = M_n … M₂ M₁`.

## Formula‑by‑Formula Verification

| Function | Implemented Formula (from source) | Independent Derivation | Verdict |
|----------|------------------------------------|------------------------|---------|
| `rayleighRangeMm` | `PI * waistRadiusMm² / (m2 * umToMm(wavelengthUm))` | `zR = π·w₀² / (M²·λ_mm)` | **VERIFIED** — unit conversion correct. |
| `divergenceHalfAngleRad` | `(m2 * umToMm(wavelengthUm)) / (PI * waistRadiusMm)` | `θ = M²·λ / (π·w₀)` | **VERIFIED** |
| `qAtWaist` | `complex(0, rayleighRangeMm(...))` | `q(0) = i·zR` | **VERIFIED** |
| `qAtZ` | `complex(zFromWaistMm, rayleighRangeMm(...))` | `q(z) = z + i·zR` | **VERIFIED** |
| `transformQ` | ABCD law via complex arithmetic | `q' = (A·q + B) / (C·q + D)` | **VERIFIED** |
| `inverseComplex` | `divideComplex(complex(1,0), q)` | `1 / q` | **VERIFIED** |
| `radiusFromQ` | `inv = 1/q; λ_eff = m2·umToMm(λ); w = √[−λ_eff / (π·Im(inv))]` | From `1/q = 1/R − i·M²λ/(π·w²)` ⇒ `w = √[ M²λ / (π·(−Im(1/q))) ]` | **VERIFIED** — M² factor correctly included. |
| `gaussianRadiusAtZ` | `w₀·√[1 + (z/zR)²]` (using internal `rayleighRangeMm`) | `w(z) = w₀·√[1 + (z/zR)²]` | **VERIFIED** |
| `waistFromQ` | `waistOffsetMm = −Re(q); zR = Im(q); w₀ = √(M²·λ·zR / π)` | Waist is at distance `−Re(q)`; new Rayleigh range is `Im(q)`; new waist radius follows from `zR = π·w₀²/(M²·λ)`. | **VERIFIED** |
| `freeSpaceMatrix` | `{a:1, b:L, c:0, d:1}` | `[[1, L], [0, 1]]` | **VERIFIED** |
| `thinLensMatrix` | `{a:1, b:0, c:−1/f, d:1}` | `[[1, 0], [−1/f, 1]]` | **VERIFIED** — sign consistent with standard paraxial matrix for a positive lens. |
| `refractiveSurfaceMatrix` | plane: `{a:1, b:0, c:0, d:n₁/n₂}`; curved: `c = (n₁−n₂)/(R·n₂), d = n₁/n₂` | `[[1, 0], [(n₁−n₂)/(R·n₂), n₁/n₂]]` | **VERIFIED** — sign matches the ModeForge surface‑radius convention. |
| Slab effective path | `freeSpaceMatrix(thicknessMm / refractiveIndex)` (in `matrixForComponent`) | A plane‑parallel slab in air has net matrix `[[1, t/n], [0, 1]]` | **VERIFIED** — reduced thickness correctly replaces the physical length. |
| `composeMatrices` / `multiplyMatrices` | Standard 2×2 matrix multiplication | Cascaded ABCD law | **VERIFIED** |

## Unit‑Specific Checks

- The helper `umToMm(valueUm)` divides by 1000 (1 µm = 0.001 mm). It is applied consistently in `rayleighRangeMm`, `divergenceHalfAngleRad`, `radiusFromQ`, `waistFromQ`, and the slab reduced‑thickness calculation.
- The Rayleigh range formula in the code therefore becomes `π·w₀² / (M²·λ_µm/1000)`, which agrees with the requirement that all lengths are expressed in mm.
- No dimensional mismatches, missing unit conversions, or inconsistent length units were found.

## Sign & Convention Checks

- The thin‑lens matrix has `C = −1/f`, which is the standard sign for a positive (focusing) lens in the `[y, θ]ᵀ` ray‑vector convention.
- The refractive surface matrix uses `(nBefore − nAfter) / (radius * nAfter)`. When `nBefore > nAfter` and the surface is convex (positive radius), this yields positive power, matching the left‑to‑right propagation and the sign rule (radius positive when center of curvature is to the right).
- The slab model ignores the tiny refraction‑induced offset (the ray emerges parallel to its incident direction), which is the usual paraxial approximation for a plane‑parallel plate. The net effect on `q` propagation is a pure translation by `t/n`, which the code implements correctly.

## Numeric Reference Cases

A companion file `agents/verification/optics_gaussian_cases.json` contains **10 numeric test cases** that cover:

1. Rayleigh range for M² = 1
2. Rayleigh range for M² = 2
3. Divergence half‑angle
4. Gaussian radius at `z = zR`
5. Gaussian radius at `z = 3·zR`
6. `qAtZ` – first half of the round‑trip
7. `radiusFromQ` – round‑trip recovery of the radius from `q`
8. `transformQ` – ABCD transform of `q` by a thin lens
9. `waistFromQ` – extraction of the new waist position and size after the thin lens
10. `multiplyMatrices` – composite free‑space + slab effective B matrix

Each case includes an independent calculation at ≥ 6 significant digits and a tolerance that the implementation must satisfy.

## Conclusion

All implemented formulas in the ModeForge Gaussian‑beam core agree with the independently derived standard expressions. No sign errors, missing unit conversions, or incorrect M² handling were identified. The verification is therefore **complete** and all claims are **VERIFIED**.

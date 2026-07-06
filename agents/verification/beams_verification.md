# Beam Width Conventions, M², and Measured-Beam Fitting Verification

**Domain:** ModeForge `packages/beams/src/*.ts`  
**Verification date:** 2026-07-02  
**Status:** All claims VERIFIED

## Claims

| Claim | Target(s) | Verdict | Evidence |
|-------|-----------|---------|----------|
| FWHM diameter ↔ 1/e² radius conversions are mathematically correct | `oneOverE2RadiusToFwhmDiameterMm`, `fwhmDiameterToOneOverE2RadiusMm` | VERIFIED | FWHM diameter = w √(2 ln 2) ≈ 1.17741 w; code matches. |
| RMS radius → 1/e² radius conversion uses factor 2 | `beamWidthToOneOverE2RadiusMm` (basis `rms_radius`) | VERIFIED | Second-moment rms radius σ = w/2 for a Gaussian; code returns 2×value. |
| D4σ diameter → moment radius conversion uses factor 0.5 | `d4SigmaDiameterToMomentRadiusMm`, `beamWidthToOneOverE2RadiusMm` (basis `d4sigma_diameter`) | VERIFIED | D4σ = 4σ, moment radius = D4σ / 2 = 2σ = w; code returns value / 2. |
| Hermite–Gaussian M² follows M²_x = 2m+1, M²_y = 2n+1 | `hermiteGaussianM2` | VERIFIED | Standard HG result; code returns exact integers. |
| Laguerre–Gaussian M² follows M² = 2p + |l| + 1 | `laguerreGaussianM2` | VERIFIED | Standard LG result; code returns exact integer. |
| Second-moment M² from D4σ waist and full-angle divergence matches ISO 11146 | `momentM2FromD4Sigma` | VERIFIED | M² = (π d₀ Θ) / (4 λ) with consistent units; code matches. |
| Quadratic fit on w² correctly recovers w₀, z₀, M², and divergence | `fitGaussianBeamFromRadii` | VERIFIED | Least-squares on w²(z) = a z² + b z + c; extraction formulas match. |
| Residual definitions (RMS and max relative) are standard | `fitGaussianBeamFromRadii` | VERIFIED | Residual RMS = √(mean(residual²)); max relative = max(|residual|/measured). |

All inspected implementations faithfully reproduce the stated formulas. No SUSPECT or WRONG findings.

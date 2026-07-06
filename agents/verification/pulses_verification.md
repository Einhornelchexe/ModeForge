# Pulses Energetics Verification

## Overview
This document provides an independent verification of the pulse energetics functions in ModeForge, including the unit conversion helpers. Each claim is compared against the source code in `packages/pulses/src/pulses.ts` and `packages/core/src/units.ts`.

## Verification Table

| Item | Source Code | Claim | Status | Independent Derivation | Result |
|------|-------------|-------|--------|------------------------|--------|
| Pulse energy from average power | `return input.averagePowerW / input.repetitionRateHz;` (pulses.ts, `pulseEnergyJ`) | `E = P_avg / f_rep` | VERIFIED | Energy per pulse equals average power divided by repetition rate. | Exact match |
| Gaussian temporal peak factor | `return Math.sqrt((4 * Math.log(2)) / Math.PI);` (pulses.ts, `temporalPeakFactor`) | `shapeFactor = sqrt(4 ln2 / π)` ≈ 0.939437 | VERIFIED | For Gaussian intensity I(t)=I0 exp(-t²/τ0²) with FWHM τ: τ_FWHM = 2√(ln2) τ0, E = I0 √(π) τ0 = I0 τ_FWHM √(π/(4 ln2)). Thus P_peak = E/τ_eff, with τ_eff = τ_FWHM / √(4 ln2/π). Factor = √(4 ln2/π). | Numeric: 0.9394372787 |
| sech² temporal peak factor | `return 1.762747174039086 / 2;` (pulses.ts, `temporalPeakFactor`) | `shapeFactor = arcosh(√2)` ≈ 0.881374 | VERIFIED | For I(t)=I0 / cosh²(t/τ0): FWHM = 2 τ0 arcosh(√2), E = 2 I0 τ0 = I0 τ_FWHM / arcosh(√2). Factor = arcosh(√2) = ln(1+√2). Code uses (2·arcosh(√2))/2. | Numeric: 0.8813735870 |
| Rectangular temporal peak factor | `return 1;` (pulses.ts, `temporalPeakFactor`) | 1 | VERIFIED | Constant intensity → factor = 1. | Exact 1 |
| Peak power | `return (energyJ / durationFwhmS) * temporalPeakFactor(shape);` (pulses.ts, `peakPowerW`) | `P_peak = shapeFactor * E / τ_FWHM` | VERIFIED | Derived from energy and FWHM with shape factor. | Consistent with above |
| Gaussian peak fluence (round beam) | `const areaCm2 = mm2ToCm2(PI * radiusXmm * radiusYmm); return (2 * energyJ) / areaCm2;` (pulses.ts, `gaussianPeakFluenceJPerCm2`) | `F_peak = 2E / (π w_x w_y)` (area in cm²) | VERIFIED | For Gaussian spatial profile (1/e² radius), peak fluence = 2 × (total energy) / (π w_x w_y). The factor 2 arises from the integral over the Gaussian. | Correct |
| Gaussian peak intensity | `return (2 * powerW) / areaCm2;` (pulses.ts, `gaussianPeakIntensityWPerCm2`) | `I_peak = 2 P_peak / (π w_x w_y)` | VERIFIED | Same spatial factor applied to peak power. | Consistent |
| Area conversion mm² → cm² | `return valueMm2 / 100;` (units.ts, `mm2ToCm2`) | `1 mm² = 0.01 cm²` | VERIFIED | 1 cm = 10 mm → 1 cm² = 100 mm². | Factor 0.01 |

## Unit Helpers (detailed)
- `mm2ToCm2` (units.ts): Divides by 100, yielding the correct conversion factor.
- `PI` (units.ts): Exported as `Math.PI`, used consistently.
- `assertPositive` (units.ts): Guards inputs, correctly rejecting non-positive values.

The pulse functions import these helpers from `packages/core/src/index.ts` and employ them correctly.

## Conclusion
All pulse-energetics functions and the supporting unit helpers are physically correct and match independent derivations. No discrepancies were found.

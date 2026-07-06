# ModeForge Optimizer Notes

**Status:** S08 draft, headless only.
**Datum:** 2026-07-02.

## Scope

The first optimizer is a deterministic two-lens telescope/focus search. It is a pure TypeScript computation module and does not depend on UI state.

## Algorithm

`optimizeTwoLensTelescope(input)` evaluates every combination of:

- lens candidate 1,
- lens candidate 2,
- first lens position,
- second lens position.

For each valid combination it builds a beamline:

```text
free space -> thin lens 1 -> free space -> thin lens 2 -> free space to target plane
```

The candidate is ranked by relative radius error at the target plane:

```text
score = abs(achievedRadiusMm - targetRadiusMm) / targetRadiusMm
```

Lower score is better.

The target may be supplied as `targetRadiusMm`, `targetDiameterMm`, `targetWaistRadiusMm`, or `targetWaistZmm`. Optional pulse objectives add relative score terms for `targetFluenceJPerCm2` and `targetPeakIntensityWPerCm2`.

## Constraints

The S08 kernel enforces:

- lens positions must be positive,
- lens 2 must be downstream of lens 1,
- optional minimum separation,
- target plane must be downstream of lens 2,
- optional aperture margin minimum.
- optional maximum beamline length,
- optional fluence and peak-intensity maximums when `pulse` is supplied.

Impossible searches return a typed warning and an empty solution list.

## Sensitivity

If requested, the optimizer reruns the solution with plus/minus position shifts, focal-length shifts, and M2 perturbations. It reports per-class target-radius deltas and their maximum.

## Deferred

This first kernel does not yet optimize over thick-lens catalog entries, material substitutions, nonlinear propagation, or worker-parallel sweeps.

# ModeForge Field Mode Notes

**Status:** S11 draft + S13B probe planes + S14 FFT & real-sag surfaces.
**Datum:** 2026-07-05.

## Scope

The first Field Mode kernel is intentionally small and deterministic. It supports scalar fields on rectangular grids, naive unitary DFT Fresnel propagation, angular-spectrum propagation, circular aperture masks, power integration, moment radii, and sampling warnings.

## Field Convention

The scalar field stores complex amplitude arrays:

```text
real[index], imag[index]
```

Power-like normalization is:

```text
sum(|E|^2) * dx * dy
```

## Propagation

`propagateFresnel(field, distanceMm)` uses a unitary 2D DFT and a paraxial transfer function:

```text
H(fx, fy) = exp(-i * pi * lambda * z * (fx^2 + fy^2))
```

This preserves discrete field power for the same grid. It is suitable for small validation grids, not large production FFT workloads.

`propagateAngularSpectrum(field, distanceMm)` uses the scalar angular-spectrum transfer function with the carrier phase removed. In the paraxial region it tracks the Fresnel oracle; evanescent bins are exponentially damped using |z| deliberately, so backward propagation also damps them (physically they would grow; numerically that would explode high frequencies).

## Initial Wavefront Convention (S16)

`createGaussianFieldAtPlane` writes the quadratic phase +k r^2/(2R): with the forward-(-1) DFT and the Fresnel kernel exp(-i pi lambda z f^2), a DIVERGING beam (waist upstream, R > 0) carries positive curvature phase - the same convention that makes the thin-lens mask -k r^2/(2f) focus. Verified against the analytic envelope for waists both upstream and downstream of the start plane (S16 cross-review fix; the sign was previously inverted, invisible to any test that starts at the waist).

Hard apertures clip to exactly zero; the resulting edge produces physical Gibbs ringing in subsequent propagation. That is expected diffraction behavior on a discrete grid, not an artifact to hide - the sampling warnings flag grids too coarse to carry it.

## Sampling Warnings

`fieldSamplingWarnings` warns when grid spacing is coarse or grid extent is too small relative to a supplied beam radius.

## Probe Planes (S13B)

The `field-beamline` headless job accepts `probesZmm`: physical z positions at which the propagated field is read out with an |E|^2 image grid and second-moment radii. Conventions:

1. Probe positions are physical z (mm). Inside a slab or thick lens the propagation uses the reduced optical path `t/n`; a probe at physical fraction `s` of such a span propagates `s * t/n`.
2. A probe exactly at a zero-length element (thin/cylindrical lens phase mask, aperture) samples directly AFTER that element. "Exactly at" is evaluated with a 1e-9 mm tolerance: a probe within 1e-9 mm of the element plane is treated as sitting on it.
3. Probes beyond the last component continue in free space; `finalPlane` and `image` still describe the plane after the last component.
4. Splitting a transfer-function propagation at a probe plane is exact: propagating `a` then `b` equals propagating `a+b` (verified by the probes example reproducing the byte-identical final radius).
5. Each probe plane re-runs `fieldSamplingWarnings` against the field's own moment radius at that plane; warnings carry the probe `zMm`.
6. Non-finite or negative probe positions are skipped and reported as an `INVALID_INPUT` warning.

## Fast Transform (S14)

The 2D transform behind both propagators is separable: one cached-table pass per row, one per column (unitary 1/sqrt(N) per axis, forward sign -1). Power-of-two lengths use an iterative radix-2 Cooley-Tukey FFT; every other length uses a cached-twiddle direct DFT per line (O(N^3) in 2D). Verified against an independently coded naive-DFT reference to < 1e-10 relative (including odd N) with power conserved to 1e-12; all pre-existing 12-digit regression baselines reproduced unchanged. Measured: N=128 propagation ~5 ms, N=256 ~14 ms (previously seconds).

## Real-Sag Surface Phase (S14, Option 1)

`field-beamline` accepts `surfacePhase: "ideal" | "real-sag"` (default `ideal`).

1. In `real-sag` mode every thick-lens surface applies the thin-element phase `phi(r) = k0 * (n_before - n_after) * sag(r)` with the exact signed spherical sag `sag(r) = R - sign(R) * sqrt(R^2 - r^2)` (R > 0: centre of curvature to the right), followed by the internal reduced path `t/n` and the second surface.
2. Paraxially the pair reproduces the true thick-lens ABCD — including the correct principal planes, which the single-EFL `ideal` mask (whole power at the front vertex) only approximates. Verified: at a biconvex test lens the real-sag probe matches the analytic envelope to 0.2 % where the ideal mask deviates by several percent.
3. The 4th-order sag term carries the sag-driven spherical aberration; the mask geometry and its r^4 residual against the ideal quadratic phase are verified analytically in `tests/unit/field-sag.test.ts`.
4. **TEA limits (honest):** incidence-angle aberration contributions are NOT modeled — as thickness goes to zero the sag-phase sum becomes orientation-independent, so the classic plano-convex orientation asymmetry does not appear. Real-sag is a sag-figure model for moderate NA, not a full POP replacement.
5. Sampling guard: the local mask phase step `k0*|dn|*r/sqrt(R^2-r^2)*dx` must stay below pi up to the aperture edge; violations and apertures reaching the hemisphere edge (`r >= |R|`, sag clamped) raise `FIELD_SAMPLING_LOW` warnings tagged with the component id.
6. Thin and cylindrical lenses stay ideal phase masks by definition. Multi-surface stacks are first-class since S15: the `surface-stack` beamline component walks every surface with its sag phase (glass-glass interfaces via the index step), per-surface apertures and reduced paths per medium; ideal mode collapses the stack to its paraxial-card EFL plus one reduced-path span and the tightest aperture.

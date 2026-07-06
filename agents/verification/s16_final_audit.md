# ModeForge S16 Final Release Audit

**Date:** 2026-07-09  
**Scope:** The newest physics code added since the last major verification round:

1. `packages/field/src/scalar-field.ts` – fast 2D transform (radix‑2 FFT for power‑of‑two lengths, cached‑twiddle line DFT otherwise), unitary normalisation, Fresnel and angular‑spectrum propagators.
2. `applySphericalSurfacePhase` + `surfacePhaseSamplingWarnings` – signed sag formula, hemisphere clamping, beam‑aware aliasing guard.
3. `packages/api/src/index.ts` – `componentFieldSteps`, `propagateSpan`, probe splitting and beyond‑end continuation, segment counting for progress, and the surface‑stack real‑sag/ideal branches.
4. `packages/optics` surface‑stack wiring – `stackOpticFromComponent`, `componentLength`, aperture margin, and validation rules.

Each claim is examined against an independent first‑principles expectation derived from the physics/math. Code behaviour is deduced from the source text provided in the bundle.

---

## Claims Table

| ID | Aspect | Independent Expectation | Code Behaviour | Verdict | Reasoning |
|----|--------|-------------------------|---------------|---------|-----------|
| F1 | Radix‑2 bit reversal and in‑place butterfly | Bit reversal swaps each pair once (i < rev[i]) before the stage loops. Cooley‑Tukey butterflies use twiddles W = exp(sign·i·2π·k/len) with stride = N/len. Normalisation 1/√N is applied after the final stage. | `transformLine` does exactly this. Twiddles are precomputed for the largest stage; `k*stride` stays within the table. | VERIFIED | |
| F2 | Cached‑twiddle direct DFT for non‑power‑of‑two lengths | For each output index k, compute Σ_x (aₓ + i bₓ)·exp(sign·i·2π·(k·x)/N), storing result in scratch then normalising by 1/√N. | The loop uses `(k*x)%n` with tables built as cos/sin of `sign·2π·idx/n`. The complex multiply yields exp(sign·i·2π·(k·x)/N) correctly when sign = –1. | VERIFIED | |
| F3 | Frequency order compatibility with propagation kernels | `frequency(index, count, dx)` returns DC at 0, positive freqs up to Nyquist (inclusive for even N), then negative freqs. Both Fresnel and angular‑spectrum transfer functions are even in f, so sign of Nyquist is irrelevant. | `frequency()` maps index ≤ N/2 → index/(N·dx), else (index‑N)/(N·dx). This places the Nyquist bin in the positive half. | VERIFIED | Symmetric kernels tolerate the choice. |
| F4 | Fresnel transfer function sign | H = exp(–i π λ z (fₓ² + f_y²)) | `phase = –PI * lambdaMm * distanceMm * (fx*fx + fy*fy)` | VERIFIED | |
| F5 | Angular‑spectrum evanescent decay factor | For (λ²(fₓ²+f_y²) > 1), amplitude multiplier = exp(–|k_z| z) with |k_z| = √( (2πf)² – k² ). | Code computes `decay = exp(–|k·z| · √(–rootArg))`. Simplification shows λ cancels, leaving exactly exp(–z·√( (2πf)² – k² )). | VERIFIED | |
| F6 | Spherical sag formula | sag(r) = R – sign(R)·√(R² – r²). At r=0 it gives 0; paraxially r²/(2R) for both signs. | `sphericalSagMm` implements exactly this. | VERIFIED | |
| F7 | Hemisphere clamping | Points with r ≥ |R| are clamped so that sag does not produce NaN. | `rc = Math.min(rMm, absR)` – sag evaluated with clamped radius. A separate warning fires when aperture reaches hemisphere. | VERIFIED | |
| F8 | Phase‑step aliasing guard derivative | dφ/dr = k₀·|nB‑nA|·r / √(R² – r²). Step per cell ≈ (dφ/dr)·max(dx,dy). Guard warns when step > π inside the beam region. | `surfacePhaseSamplingWarnings` computes exactly that, clamping r at 0.999999·|R| to avoid /0. | VERIFIED | |
| F9 | Beam‑aware warning severity | Step > π within 2×beam radius → `warning`; step > π only further out → `info`. | Code uses `beamEdge = min(aperture, 2×(beamRadiusMm ?? fieldMomentRadii))` and checks step at beam edge and aperture edge. | VERIFIED | |
| F10 | `componentFieldSteps` for thick‑lens real‑sag | Apply sag phase of surface 1 (air→glass), propagate reduced thickness t/n, apply sag phase of surface 2 (glass→air). | Steps are `applySphericalSurfacePhase(field, R1, 1, n)` → propagate(t, t/n) → applySphericalSurfacePhase(field, R2, n, 1). | VERIFIED | |
| F11 | `componentFieldSteps` for surface‑stack real‑sag | Per‑surface sag with running `nCurrent`, per‑surface aperture, propagation through tᵢ/nᵢ after each surface. | Loop builds exactly those steps; `nCurrent` starts at 1 and is updated after each surface. | VERIFIED | |
| F12 | `componentFieldSteps` for surface‑stack ideal | Collapse to paraxial‑card EFL, summed reduced path, tightest aperture at exit. | EFL obtained via `paraxialCard(stackOpticFromComponent(...))`. | VERIFIED | |
| F13 | Propagation splitting at interior probes | For a span of physical length p and optical length o, split at each probe position z ∈ [z₀, z₀+p] using optical‑per‑physical ratio o/p. Capture the field at the intermediate z without extra propagation. | `propagateSpan` does exactly this; zero‑length splits (probe at start) are handled without propagating. | VERIFIED | |
| F14 | Probe capture at zero‑length elements (thin lens, aperture, surface phase) | Per spec (docs/theory/field_mode.md bullet 2): “A probe exactly at a zero‑length element … samples directly AFTER that element.” Therefore the probe must see the field after the phase mask or aperture has been applied. | In the component loop, transforms are applied, but probes are captured only inside `propagateSpan` (during propagation) or in the final while loop. If a propagation span ends exactly at the position of a following zero‑length element, the probe is captured at the end of the span—**before** the transform of the zero‑length element. This places the probe BEFORE the aperture/lens when the user intended AFTER. | **WRONG** | Violates the documented spec. When the zero‑length element is an aperture, the captured intensity distribution and power will be incorrect (see numeric case `probe-after-aperture-power`). The defect is present for any zero‑length element preceded by a propagation span of non‑zero length. |
| F15 | Segment counting for progress | Total segments must equal the number of times `propagateField` is called. Probe splits that produce a step > 0 increase the count; zero‑step probes do not. | The counting function `totalSegments` mirrors the actual splitting logic, initialises z=0, and counts only steps > 0. | VERIFIED | |
| F16 | Optics `componentLength` for surface‑stack | Σ thicknessAfterMm over all surfaces. | `componentLength` sums `surface.thicknessAfterMm`. | VERIFIED | |
| F17 | Optics aperture margin for surface‑stack | Tightest per‑surface aperture used for the margin check against the envelope radius. | `componentApertureForMargin` returns min of surface apertures. | VERIFIED | |
| F18 | Validation rules for surface‑stack | ≥ 2 surfaces, last refractiveIndexAfter = 1, last thicknessAfterMm = 0, each radius finite/non‑zero or Infinity, each thickness ≥ 0, each refractiveIndex > 0. | `validateComponent` enforces all of these. | VERIFIED | |

## Identified Defects

### 1. Probe sampling order (WRONG – claim F14)

The spec states that a probe exactly at a zero‑length element samples **after** that element. The current code captures probes during propagation steps; if the preceding component ends with a propagation span, the probe is captured before the zero‑length element’s transform is applied. This yields incorrect results when the element is an aperture (clipping not yet applied) and may affect any scenario where the probe is meant to observe the field at the exit of a lens/aperture/surface.

**Recommendation:** Insert a probe‑capture pass after all zero‑length steps have been applied at a given z coordinate, before commencing the next propagation span.

---

## Numeric Cases

Separately provided in `agents/verification/s16_audit_cases.json`. The cases are derived from first principles (algebra, series expansions, analytic integrals) and do not rely on executing the TypeScript.

---

## Manager Triage (2026-07-05)

**F14 CONFIRMED as a real defect — and fixed.** Honest trail: the manager's first
refutation attempt was itself wrong (it compared the probe power against 1, but the
initial field uses the peak-amplitude-1 convention, so total power is pi*w^2/2 —
the "clipped-looking" number was the UNCLIPPED power). A second, instrumented run
showed the probe at an aperture plane reporting the unclipped power while the
downstream plane was clipped: the probe was sampled BEFORE the zero-length
transform, violating the documented sample-after-element convention. Phase-only
masks (lenses) cannot reveal this at the plane itself, which is why the original
S13B tests missed it. Fix: propagation spans no longer consume probes exactly at
the span end; equal-z probes are captured at the start of the next span or in the
beyond-end loop, i.e. after all transforms at that z. Regression test:
"S16 probe at an aperture plane samples AFTER the aperture" (mid + end cases,
transmission matches the analytic 0.5888 within 1%). All existing baselines
unchanged (verify:headless identical).

All 8 numeric reference cases were replayed against the real code and wired into
`npm run verify:cases` as permanent handlers (now 60 cases total). All PASS.

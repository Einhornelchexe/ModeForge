# S18 Gate Self-Calibration — Consolidated Implementation Spec

Status: adjudicated 2026-08-18. Two independent statistics derivations (leg A, leg B)
were run against the measured problem; both reproduced the baseline failure and both
validated their designs with live-code measurements (repo modules imported via file://
into node scripts; no repo writes). Where the legs disagreed, the adjudicated choice
is stated inline with the reason. This spec supersedes the fixed-threshold semantics
of Plan v5 section 4 for the two gates below; everything else in section 4 stands.

## 0. Problem (measured, cross-confirmed by both legs)

At realistic noise the stage-B release gates in `packages/image/src/aperture.ts`
become noise detectors. Perfect-Gaussian release rate on a 300x240 frame
(sigma 11x6 / 10x6, 15-25 seeds): SNR 100 -> 15/15, 50 -> 14/15, 30 -> ~1/15,
20 -> ~1/25. Cause 1: the alpha-consistency deltas of pure noise reach 2.1-4.9 %
against the fixed 3 % ceiling (calibrated noise-free). Cause 2: the multi-peak
candidate floor `4*sigmaB` sits BELOW the expected maximum of ~72000 iid noise
samples (~4.7*sigmaB), so pure noise yields >= 2 "peaks" with ~67 % probability.

Direction (operator-approved): self-calibrating gates per image — the analyzer
knows sigmaB, the fitted model and the ROI, so it computes the null distribution
of each gate statistic for THIS image at analysis time.

## 1. Alpha-consistency gate — self-calibrated per-axis threshold

### 1.1 What stays

The observed statistic is untouched: per axis,
`delta = 100 * |d4(alpha=4) - d4(alpha=6)| / d4(alpha=6)` on the
fit-background-subtracted stage-B field, both passes with the production
predicate in `computeEllipseMoments`. Only the CEILING changes: from the fixed
`ALPHA_CONSISTENCY_MAX_PERCENT` to a per-axis, per-image threshold.
`ALPHA_CONSISTENCY_MAX_PERCENT = 3` remains as a hard floor — the gate is never
stricter than the noise-free design. Precedence and non-substitution unchanged:
`fit_not_converged -> nonpositive_amplitude -> residual_high -> aperture_clipped
-> alpha_inconsistent -> multi_peak`; `moments` stays null on any failure.

### 1.2 Null model (validated by both legs)

Freeze the fitted geometry `(cx, cy, sigmaMajor, sigmaMinor, theta, amplitude)`.
Null realization: `model(x,y) + N(0, sigmaB)` iid per pixel, NO background/plane
term (stage B already subtracted it), evaluated over the alpha=6 ellipse support
(all that both moment passes read). Faithfulness was verified independently
twice against the real pipeline path (real `assessAperture` on a real image with
background present): null-RMS ratio local/real = 0.987-1.00 (leg B), residual
RMS/sigmaB = 1.000 and observed-exceedance p = 0.050-0.075 at the Q95 (leg A).

Because gate 4 (`aperture_clipped`) has already passed when this gate runs, the
6-sigma check ellipse lies fully inside the ROI — the MC can therefore run on a
LOCAL bounding box of the ellipse (pure coordinate translation, exact):

```
a = 6*sigmaMajor'; b6 = 6*sigmaMinor'
ex = sqrt((a*cos(theta))^2 + (b6*sin(theta))^2)
ey = sqrt((a*sin(theta))^2 + (b6*cos(theta))^2)
halfW = ceil(ex) + 2; halfH = ceil(ey) + 2        // margin 2 px
local grid: (2*halfW+1) x (2*halfH+1), centre at (localCx, localCy)
model[x,y] = amplitude * exp(-(u^2/(2*sigmaMajor'^2) + v^2/(2*sigmaMinor'^2)))
             with (u,v) the theta-rotated offsets — evaluated ONCE, reused for
             all realizations
```

### 1.3 Decimation (bounded runtime at any beam scale)

```
b = 1                                   if sigmaMajorPx <= 10
b = 2^ceil(log2(sigmaMajorPx / 10))     otherwise            // power of two
while (b > 1 && sigmaMinorPx / b < 1.5) b /= 2               // minor-axis guard
sigmaMajor' = sigmaMajorPx / b ; sigmaMinor' = sigmaMinorPx / b
cx' = (cx - (b-1)/2) / b ; cy' likewise ; theta unchanged
sigmaB' = sigmaB / b        // EXACT: mean of b^2 iid N(0,s) is N(0, s/b);
                            // no b^2/12 quantization term
```

Adjudication: leg B's power-of-two rule targeting decimated sigma ~10 px
(runtime measured BOUNDED at 40-70 ms for N=64 from sigma 16 to sigma 600,
budget ~150 ms) merged with leg A's minor-axis guard (decimated minor sigma
never below 1.5 px, protects extreme anisotropy). Both legs validated the
decimated null against the full-grid null independently: ratio 0.97-1.02
(leg A, p95) and 0.981-1.003 (leg B, rms).

### 1.4 Threshold construction (adjudicated: moment-based, per axis)

The null delta is half-normal to measured precision (p95/rms = 1.816-1.957
across 5 configs x 2 SNRs vs the theoretical 1.960 — leg B, N=5000 reference).
So estimate the SCALE (rms — the stable low-order statistic) from N samples and
set the quantile analytically, instead of reading a raw order statistic from a
small sample. Measured estimator spread at N=64: rms relStd 10.7 % vs naive-Q95
relStd 13.9 % (and naive-Q99 of N<=64 is essentially the sample max: +42 % bias,
CV 23 % — leg A measured the same defect independently). Per-axis thresholds,
NEVER pooled: on isotropic beams the minor-axis null rms runs up to 1.57x the
major axis (order-statistics inflation of the smaller eigenvalue — same
phenomenon the q<0.05 orientation warning tracks); anisotropic beams are
balanced (0.99-1.03x).

```
for r in 0 .. N-1:                                   // N = ALPHA_MC_REALIZATIONS
    scratch[j] = model[j] + sigmaB' * gauss_r()      // row-major, one draw/cell
    alphaPass = ellipse moments (alpha=4 semi-axes, decimated params)
    checkPass = ellipse moments (alpha=6 semi-axes, decimated params)
    if both valid: collect deltaMajor_r, deltaMinor_r (production formula)
    else: realization invalid
nValid = number of valid realizations
if sigmaB <= 0:            skip MC entirely; thresholds = floor (3); gate behaves exactly as today
else if nValid < ALPHA_MC_MIN_VALID: fail closed — inconsistent = true, thresholds = floor, nullRms = null
else:
    thresholdMajorPercent = max(3, ALPHA_MC_K * rms(deltaMajor_r over valid))
    thresholdMinorPercent = max(3, ALPHA_MC_K * rms(deltaMinor_r over valid))
inconsistent = deltaMajorPercent > thresholdMajorPercent
            || deltaMinorPercent > thresholdMinorPercent
```

`ALPHA_MC_K = 2.2` (leg B, tuned against the end-to-end release oracle, sits
between the half-normal p95/rms ~1.96 and p99/rms ~2.58). Leg A's construction
(1.25 * sample-Q95 ~ 2.45*rms) is ~11 % more permissive; the stricter 2.2 keeps
measurably more wing-heavy detection (production core+halo fixture stays caught
up to SNR ~50 at K=2.2 vs dying at SNR ~40-50 under leg A's threshold) while
still releasing the SNR-20 perfect Gaussian at 90-96 % (>= 13/15 oracle).
K=2.4 is the documented fallback knob if implementation-stage verification ever
measures the release oracle below 13/15; never exceed 2.45, never go below 2.0.

### 1.5 Determinism (adjudicated: per-realization streams)

```
mulberry32(seed): a=(a+0x6D2B79F5)|0; t=Math.imul(a^(a>>>15), 1|a);
                  t=(t+Math.imul(t^(t>>>7), 61|t))^t;
                  return ((t^(t>>>14))>>>0) / 4294967296
seed_r = (ALPHA_MC_SEED + Math.imul(r, ALPHA_MC_SEED_STRIDE)) >>> 0   // r = 0..N-1
```

Box-Muller with `u1 = 1 - rand()` (never ln(0)), `u2 = rand()`; the paired
spare value is cached LOCAL to realization r (never crosses realizations).
Iteration order: realizations ascending, grid row-major (y outer, x inner).
Per-realization streams (leg A) chosen over one continuous stream (leg B):
the first 32 realizations are bit-identical regardless of N — stable prefixes
for debugging and regression. The seed is a FIXED literal constant, never
image-derived: identical `(params, sigmaB, ROI)` give bit-identical thresholds.
Never call Math.random() anywhere in this path.

## 2. Multi-peak gate — analytic extreme-value threshold

Replace ONLY the candidate threshold (aperture.ts line ~259). Greedy separation
(`MULTI_PEAK_SEPARATION_WIDTH_FACTOR * wEst`), the strict 8-neighbour local-max
scan and the relative peak floor are unchanged (calibration on the RAW candidate
count is conservative for the post-separation count). `SUGGESTED_ROI_K` returns
to being a suggested-ROI constant only.

```
M = ROI pixel count scanned (roi.width * roi.height)
evt = sigmaB > 0 ? sigmaB * (sqrt(2 * ln(max(2, M))) + MULTI_PEAK_EVT_MARGIN) : 0
thresholdCounts = max(evt, MULTI_PEAK_MIN_PEAK_FRACTION * peakCorr)
```

`sqrt(2 ln M)` tracks the expected maximum of M iid N(0,1);
`MULTI_PEAK_EVT_MARGIN = 0.5` (adjudicated: leg B's 3000-repeat sweep at
M=72000 measured P(count>=2): margin 0 -> 0.5 %, 0.25 -> 0.03 %, 0.5 -> 0.0 %,
uniform ~0 across M=1e3..1e7; leg A independently confirmed the line
z(1-0.01/M) ~ sqrt(2 ln M)+0.6 and set 0.6 — 0.5 already beats the < 1 % target
with >30x reserve, and every tenth of margin costs genuine-satellite
sensitivity; leg A's own floor "never below +0.3" is respected). This exactly
explains the old failure: `4*sigmaB` is BELOW the zero-margin point at M=72000
(effective margin -0.73, P(count>=2) = 66.6 %).

Honest cost (both legs agree): at SNR 20 / M=72000 a genuine second beam now
needs ~26 % of the main peak to register (was ~20 % via the 0.1 floor); at
SNR 10 satellite detection is essentially gone. Unavoidable — a 4-sigma bump
in a 72k frame is statistically indistinguishable from the noise maximum.

## 3. API / type additions (aperture.ts gates section + analyze.ts mirror)

`gates.alphaConsistency` gains (existing fields unchanged):

```
thresholdMajorPercent: number        // ceiling actually used; 3 when MC skipped/no fit
thresholdMinorPercent: number
nullRmsMajorPercent: number | null   // raw MC rms before K/floor; null when no MC ran
nullRmsMinorPercent: number | null
mcRealizationCount: number           // nValid; 0 when no MC ran
decimationFactor: number             // b; 1 when no MC ran
```

`gates.multiPeak` gains:

```
thresholdCounts: number              // max(evt, floor); 0 when params is null
evtThresholdCounts: number           // the sigmaB-scaled arm (0 when sigmaB=0)
peakFloorCounts: number              // MULTI_PEAK_MIN_PEAK_FRACTION * peakCorr
scannedPixelCount: number            // M
```

`analyze.ts` mirrors these fields wherever it already mirrors the gates
(interface + mapping); JSON/CSV/UI pick them up through the existing envelope.
English, product-neutral wording everywhere.

## 4. Warning recalibration (second task — same statistical footing)

Both statistics are strongly ROI-geometry dependent (leg B measured the
negative-power ratio of a CORRECT scene at 0.18 (tight ROI) to 0.55 (loose
8-sigma ROI) — no single constant can be right), so both warnings move to
adaptive predicates (leg A's derivations, cross-checked against leg B's sweeps):

### 4.1 IMAGE_NEGATIVE_POWER

A correctly corrected scene MUST show negative power (zero-mean background).
Expected ratio for a correct scene (derived; verified to ~3 %: measured/bound
= 0.97 across scenes ranging 0.13-0.77, and leg B's tight-ROI p99 0.197 /
6-sigma 0.394 / 8-sigma 0.550 sweeps are all consistent with the bound):

```
expectedRatio = (roiPixelCount * sigmaB) / (sqrt(2*PI) * totalPositiveCounts)
fire iff negativePowerRatio > max(NEGATIVE_POWER_INFO_RATIO,
                                  NEGATIVE_POWER_NULL_MARGIN * expectedRatio)
```

`totalPositiveCounts` is already on `RadialDistribution`. Guard: if
totalPositiveCounts <= 0 or not finite, the adaptive arm is skipped (floor-only).
The 0.02 floor still catches a systematic pedestal when sigmaB = 0. Honest
limit (documented): under-subtraction REDUCES negatives — this warning cannot
catch it (the pedestal hint covers that side).

### 4.2 IMAGE_ROI_SENSITIVE

Two separately measured pathologies, two rules:

1. `stability.fullFrame === true` -> NEVER emit IMAGE_ROI_SENSITIVE. A
   shrink-only sweep on a noise-filled full frame is ROI-dependent by
   construction; IMAGE_ROI_UNDETERMINABLE already covers that scene.
2. Otherwise warn on the MAJOR axis only (contained-box minor-axis half-spread
   is noise-dominated: p95 = 21 % at SNR 100 — unfixable by any constant;
   consistent with the 1.57x minor-axis inflation of section 1.4):

```
ptbn = aperture.peakToBackgroundNoise          // may be null
noiseFloorPercent = ptbn != null && ptbn > 0 ? ROI_SENSITIVE_NOISE_K * 100 / ptbn : 0
fire iff major.halfSpreadPercent > max(ROI_SENSITIVE_WARNING_PERCENT, noiseFloorPercent)
```

Pins: 8-sigma contained box at SNR 100: major HS 4.2 % < 8 % floor -> silent;
SNR 20 (ptbn 20) -> floor 40 % -> the 11.7 % clean-scene case is silent;
high SNR keeps the sharp 5 % floor.

## 5. Constants (thresholds.ts)

```
ALPHA_MC_REALIZATIONS       = 64          // rms relStd: 16->20 %, 32->16 %, 64->11 %, 128->8 % (diminishing)
ALPHA_MC_K                  = 2.2         // see 1.4
ALPHA_MC_MIN_VALID          = 32          // below: fail closed
ALPHA_MC_SEED               = 0xA1FA5EED  // fixed literal, never image-derived
ALPHA_MC_SEED_STRIDE        = 0x9E3779B1
ALPHA_MC_TARGET_DEC_SIGMA_PX = 10
ALPHA_MC_MIN_DEC_SIGMA_PX   = 1.5         // minor-axis decimation guard (never traded away — see 9.9)
ALPHA_MC_MAX_TOTAL_GRID_PIXELS = 8388608  // 9.9: runtime budget, grid pixels x realizations
MULTI_PEAK_EVT_MARGIN       = 0.5         // see 2; never below 0.3
NEGATIVE_POWER_NULL_MARGIN  = 1.20
ROI_SENSITIVE_NOISE_K       = 8
```

Unchanged: ALPHA_CONSISTENCY_MAX_PERCENT=3 (now the floor),
APERTURE_ALPHA_DEFAULT=4, APERTURE_ALPHA_CHECK=6, MULTI_PEAK_MIN_PEAK_FRACTION=0.1,
MULTI_PEAK_SEPARATION_WIDTH_FACTOR=2, NEGATIVE_POWER_INFO_RATIO=0.02 (now the
floor), ROI_SENSITIVE_WARNING_PERCENT=5 (now the floor), residual arm
max(2*sigmaB, 0.005*peak), SUGGESTED_ROI_K=4 (suggested ROI only again).

The comment block on ALPHA_CONSISTENCY_MAX_PERCENT must be rewritten: the
noise-free discriminant figures it quotes (two-lobe ~37, core+halo ~10,
super-gauss n<1 ~3.6) were re-measured independently by both legs and do not
hold in the fitted-aperture geometry. Measured reality: two-lobe deltas grow
smoothly 0.7 -> ~10 % up to 4-sigma separation, then jump to ~39 % once the
single-Gauss fit locks onto one lobe (~5 sigma; wider separations mostly fail
fit convergence — an earlier suppression path); core+halo at 1 % amplitude /
4x width is ~14 %, scale-invariant; super-gauss n=0.8 is 0.1-1.3 % and is NOT
an alpha discriminant against fitted sigmas (the fit absorbs the width — only
n<=0.6 becomes testable at 3.8-8.2 %).

## 6. Documented behaviour changes (operator-visible, must land in the plan delta)

1. `tests/unit/image-aperture.test.ts` line ~229 (core sigma 4 + halo sigma 16,
   1 % amplitude, 128x128, sigmaB=5 i.e. SNR 20): BOTH legs independently proved
   this fixture statistically unidentifiable under ANY self-calibrating design
   that meets the SNR-20 release oracle (leg B: needs K <= 1.24 which destroys
   the release oracle; measured boundary: suppressed for sigmaB <= 2, released
   for sigmaB >= 3). Change the fixture to sigmaB = 2 (stays suppressed with
   margin) AND add a companion oracle asserting the sigmaB = 5 variant now
   RELEASES — the new behaviour is intentional and pinned.
2. Wing-heavy defects whose noise-free alpha delta sits in the ~4-10 % band are
   suppressed only ~80-92 % of seeds at SNR 20 (leg B, 25 seeds/case; >= 96 %
   from SNR 40 up). Quantified, documented limitation — not to be chased to
   100 %.
3. A genuine second beam at SNR 20 in a 72k-px ROI now needs ~26 % of the main
   peak (was ~20 %).

## 7. Oracle list (implementer MUST add/keep; never weaken others)

1. SNR-20 perfect Gaussian, 300x240, sigma (11,6), A=100, 15 deterministic
   seeds: stage-B released >= 13/15. At sigmaB=1 (SNR 100): 15/15.
2. sigmaB=0: MC skipped, both thresholds exactly 3, mcRealizationCount 0,
   all existing sigmaB=0 fixtures unchanged.
3. Determinism: two identical assessAperture calls -> strictly equal (===)
   thresholdMajorPercent/thresholdMinorPercent.
4. Fixture line ~229 at sigmaB=2: still `alpha_inconsistent`. Companion: same
   fixture at sigmaB=5 releases (documented change). Noise-free variant
   (sigmaB=0): still `alpha_inconsistent` (delta ~14 % > floor 3).
5. NEW 10 %-amplitude halo at 3x width on core sigma ~11, SNR 20 (one fixed
   seed): `alpha_inconsistent` (measured delta ~20 % > self-calibrated
   threshold ~14-16 %).
6. Existing multi-peak fixtures unchanged: separated 20-count spike ->
   `multi_peak` count 2 (floor arm dominates); 5 %-bump -> not counted;
   sigmaB=0 flank noise -> count 1.
7. Pure-noise ROI (no beam term, sigmaB constant, 300x240, >= 10 seeds):
   significantPeakCount <= 1 in every seed.
8. Field pins: thresholdCounts === max(evtThresholdCounts, peakFloorCounts);
   evtThresholdCounts === 0 when sigmaB === 0; scannedPixelCount === ROI pixel
   count; decimationFactor === 4 for sigmaMajorPx = 40 (isotropic-ish minor),
   === 1 for sigmaMajorPx <= 10.
9. Precedence unchanged: existing aperture_clipped-before-alpha oracles stay
   green; moments stays null on any failure (non-substitution untouched).
10. Warnings task: correctly-corrected SNR-20 Gaussian, tight AND loose ROI ->
    no IMAGE_NEGATIVE_POWER; +0.5-1 sigma over-subtraction -> fires. Full-frame
    stability sweep on a clean noisy Gaussian -> no IMAGE_ROI_SENSITIVE;
    contained 8-sigma ROI at SNR 100 -> silent on major axis; sigmaB=0
    pedestal case still fires via the 0.02 floor.
11. Runtime is NOT a unit test (flaky in CI); it is pinned indirectly by
    decimationFactor oracles (#8) and was measured bounded 40-70 ms at N=64
    across sigma 16..600.
12. (revision 9.9 a) Line-degenerate beam, noiseless, sigma (12, 1e-4),
    theta 0, 161x121, matching converged fit: NOT released at sigmaB = 0 AND
    at sigmaB = 1, reason `alpha_inconsistent`, `deltaMinorPercent` null,
    both thresholds on the exact floor 3, `moments` null, and the major-axis
    delta still reported as a finite number.
13. (revision 9.9 b, capped-geometry pin) sigma 80x5 at 45 deg, 691^2:
    `decimationFactor === 2` (the guard's b, not the superseded cap's 4),
    decimated minor sigma >= ALPHA_MC_MIN_DEC_SIGMA_PX, all 64 realizations
    used, minor null rms in 2.0-2.3 percent and `thresholdMinorPercent` in
    4.5-4.9 percent; the seed-0 SNR-20 realization of that scene releases end
    to end (measured 12/12 over seeds mulberry32(90210 + s)).
14. (revision 9.9 b, budget invariant) sigma 118x4 at 45 deg, 1011^2:
    `decimationFactor === 2` with the guard intact and
    `mcRealizationCount === ALPHA_MC_MIN_VALID` - the budget lowers N, never
    b - and the beam still releases.
15. (revision 9.9 b, endgame) sigma 160x5 at 45 deg, 1369^2: gates 1-4 pass,
    the local grid cannot afford the realization floor, so NO MC runs and the
    gate fails closed - `alpha_inconsistent`, `decimationFactor === 2` (the
    guard's b, not the superseded cap's 8), `mcRealizationCount === 0`,
    `nullRms*` null, both thresholds on the floor, `moments` null.

## 8. Out of scope for the implementing tasks

No changes to: residual gate, clipping gate, greedy separator internals,
stage-B field construction, fit engine, moments engine, precedence order,
envelope version. No UI/i18n changes (warning codes unchanged, only their
predicates). No new dependencies.

## 9. Post-landing cross-review revisions (2026-08-18, binding)

An independent cross-review with measurement scripts confirmed the landed MC
engine reproduces this spec to 1-2 ulp, the EVT arm exactly, and that no
existing oracle was dropped. It also proved the following revisions necessary;
they SUPERSEDE the sections they touch.

1. (supersedes the section-4.2 full-frame rationale, which was factually
   wrong: a healthy full-frame sweep yields exactly 3 valid variants, so
   IMAGE_ROI_UNDETERMINABLE never covers it) A full-frame base ROI must not
   silently swallow ROI sensitivity: when stability.fullFrame is true AND the
   major-axis half-spread exceeds the section-4.2 threshold, emit
   IMAGE_ROI_SENSITIVE with severity "info" (not "warning") and a message
   stating the width is ROI-dependent by construction on a full-frame base
   ROI and a beam-tight ROI should be confirmed. Non-full-frame behaviour
   unchanged. Measured hole being closed: HS 6.3-25.5 percent scenes released
   with zero warnings, flipping to a warning at 1 px less ROI.
2. (tightens section 1.4 realization validity) A realization is USABLE only
   if both per-axis deltas are finite; d4=0 passes the moments validity
   predicate and produced NaN deltas (0/0), poisoning the rms so the
   threshold became NaN and the axis gate never fired - measured end-to-end
   false RELEASE of a 1-px line beam (fit sigmaMinor 0.11). Non-finite
   deltas mark the realization invalid (it counts against nValid), so the
   documented fail-closed path handles degenerate geometry honestly.
3. (adds to section 1.3) Guards for hostile/degenerate fit params on the
   public assessAperture surface: non-finite sigmaMajorPx/sigmaMinorPx/theta
   or sigmas <= 0 skip the MC with floor thresholds (the decimation loop must
   not iterate on non-finite input - measured non-termination at Infinity);
   the MC moment passes are exception-contained like ellipseMomentsPass (a
   throwing realization is an invalid realization, never an escaping
   exception - measured RangeError escapes at sigmaB>0).
4. (adds to section 1.3) The MC runs ONLY when gates 1-4 already passed
   (fit converged, amplitude positive, residual ok, check ellipse inside the
   ROI). On earlier-gate suppression the alphaConsistency fields carry the
   observed deltas plus floor thresholds, nullRms null, mcRealizationCount 0,
   decimationFactor 1. This honours the section-1.2 premise (the local box
   assumes an unclipped ellipse) and removes wasted MC cost on already-
   suppressed frames (measured up to 11.9 s).
5. **SUPERSEDED BY 9.9 — do not implement as written.** (added to section
   1.3) Local-grid area cap: after the minor-axis guard, while the local box
   exceeded ALPHA_MC_MAX_GRID_PIXELS = 32768 pixels, b was doubled further,
   and the cap was allowed to OVERRIDE the 1.5 px minor guard. Measured
   unbounded case that motivated it: rotated bounding box grows with the
   major axis in both dimensions, 11.9 s at sigma 600x4 theta 45 deg on a
   4096^2 frame. The rule shipped and was then confirmed defective by two
   independent reviewers: overriding the guard runs the null at a decimated
   minor sigma below the documented floor, so the MC no longer estimates the
   full-resolution statistic it is supposed to calibrate (9.9 (b) carries the
   measured numbers). The runtime problem it solved is real and is solved
   again in 9.9 (b) by budgeting realizations instead of geometry. Note also
   that the 600x4 / 45 deg case it cites became unreachable through the
   public surface with revision 4 above: its 6-sigma check ellipse spans
   5101 px, so gate 4 suppresses the frame as `aperture_clipped` and the MC
   never runs at all.
6. (supersedes the L1 ambiguity in section 1.3) The decimated sub-pixel
   centre phase cx'=(cx-(b-1)/2)/b IS used for the local model/moment centre
   (measured: keeping the phase lands the decimated null at 0.991x of the
   full-res truth vs 0.965x when snapped to the integer box centre).
7. (adds oracles to section 7) fail-closed path (a line-like beam with
   sigmaMinor << 1 px at sigmaB > 0 must NOT release; nValid < 32 semantics);
   nullRms fields are null when the MC is skipped; assessAperture returns
   (no hang, no throw) for sigmaMajorPx Infinity/1e308/NaN and sigma <= 0 at
   sigmaB > 0; 0.5-sigma over-subtraction fires IMAGE_NEGATIVE_POWER
   (measured margin only 11 percent - the thinnest predicate point);
   contained 8-sigma ROI at SNR 100 stays silent on the major axis;
   full-frame + high half-spread emits the info-severity ROI_SENSITIVE and
   the clean full-frame scene emits NO warning-severity ROI_SENSITIVE.
8. (documentation, accepted limitations - no code change) The fixed seed
   makes the N=64 estimator error deterministic per geometry (measured
   -19..+38 percent on the null rms, effective K 1.8-3.0); accepted because
   the end-to-end release oracles hold across independent seed batches, and
   determinism is contractual. The adaptive ROI noise floor reaches ~48
   percent at SNR 20 (ptbn 16.7) - genuine ROI sensitivity below that is
   invisible by design at that noise level. Thresholds depend only on
   (params, sigmaB), never pixel content. The new gate fields reach the JSON
   envelope only (CSV/UI unchanged in v1.1).

9. (supersedes revision 5 above and the section-1.3 grid cap; binding)
   **Two HIGH defects in the landed self-calibrating alpha gate, each
   confirmed independently, plus the design that replaces the defective
   rule.** Both were reproduced on the live tree before the fix and
   re-measured after it; every number below is measured, not estimated.

   ### 9.9 (a) NaN fail-OPEN on the OBSERVED alpha deltas

   `evaluateAlphaConsistencyGate` formed the observed statistic with a raw
   division, `deltaMinorPercent = 100 * |d4a - d4c| / d4c`. A line-degenerate
   aperture pass is VALID with `d4SigmaMinorPx = 0` on both apertures, so the
   quotient is 0/0 = NaN. The release check only tested `=== null` and
   `> threshold`, and `NaN > x` is false, so the axis silently waved the frame
   through. Revision 9.2 had already fixed exactly this hole for the MC
   REALIZATIONS but not for the observed deltas, and with `sigmaB = 0` the MC
   - whose nValid fail-closed path would otherwise have caught it - is skipped
   entirely.

   Measured repro (noiseless Gaussian sigma (12, 1e-4), theta 0, 161 x 121,
   matching converged fit, `sigmaB = 0`): `suppressionReason: null`, i.e.
   RELEASED, with a headline `d4SigmaMinorPx` of exactly 0 and
   `deltaMinorPercent: NaN`. The `sigmaB = 1` variant of the same frame was
   already suppressed through the nValid path, which is why the hole survived
   the 9.2 review.

   Rule: a non-finite OBSERVED delta is not a measurement. It is reported as
   `null` (which is what the envelope sanitizer shows for a non-finite number
   anyway) and makes the gate inconsistent for EITHER axis at ANY `sigmaB`.
   Measured after: both the `sigmaB = 0` and the `sigmaB = 1` frame report
   `alpha_inconsistent`, `deltaMinorPercent: null`, thresholds on the exact
   floor 3, `moments: null`. The major-axis delta of that frame is a genuine
   measurement (0.0456 percent) and keeps being reported - the fix nulls the
   degenerate axis only.

   ### 9.9 (b) The grid cap overrode the minor-axis decimation guard

   Revision 5 above let `ALPHA_MC_MAX_GRID_PIXELS = 32768` double `b` past the
   1.5 px minor guard. The MC null then ran at a decimated minor sigma below
   the documented floor, so it no longer estimated the full-resolution
   statistic it exists to calibrate. Measured null rms against the b = 1
   full-resolution statistic (N = 256, averaged over the four sub-pixel centre
   phases 0/0.25/0.5/0.75 so the fixed-seed estimator spread of 9.8 does not
   dominate):

   | geometry     | b (guard) | minor sigma' | minor rms vs full-res | b (cap) | minor sigma' | minor rms vs full-res |
   |--------------|-----------|--------------|-----------------------|---------|--------------|-----------------------|
   | 80x5 @45 deg | 2         | 2.5 px       | 1.020x                | 4       | 1.25 px      | 0.948x                |
   | 100x4 @45 deg| 2         | 2.0 px       | 1.033x                | 8       | 0.5 px       | 1.229x                |

   The guard's own decimation stays inside the 0.97-1.02 band section 1.3
   validated; the cap-forced one does not, and **the sign of the bias is
   geometry-dependent** - a deficit at 80x5 (threshold too tight, legal beams
   false-suppressed) and an inflation at 100x4 (threshold too loose, defects
   missed). At the frozen 80x5 / 45 deg geometry the live thresholds were
   `thresholdMinorPercent` 4.918 (cap, null rms 2.236) against 4.657 (guard,
   null rms 2.117).

   The degenerate end of the same defect: at sigma 600x4 / 45 deg the cap
   forces b = 32, decimated minor sigma 0.125 px, and the minor null rms
   reaches **100 percent**, i.e. `thresholdMinorPercent` 220 percent - the
   minor-axis arm is effectively OFF while nValid 35 still clears the
   fail-closed floor. Reachability note: that geometry can no longer be
   produced through the public surface at all, because revision 4 runs the MC
   only after gate 4 and its 6-sigma check ellipse spans 5101 px, past the
   4096 px frame limit; the reachable equivalents are sigma 340x4 / 45 deg
   (largest reachable 45 deg needle, cap b = 32, same 100 percent minor null)
   and sigma 160x5 / 45 deg (cap b = 8, decimated minor sigma 0.625 px).

   ### 9.9 (c) Replacement design (binding)

   The runtime problem revision 5 tried to solve is real (the guard-only null
   at sigma 600x4 / 45 deg measured 13.98 s at N = 64 and 7.18 s at N = 32).
   It is solved by budgeting the RIGHT quantity:

   ```
   b = section-1.3 target rule, then the minor guard          // FINAL, never raised again
   gridPixels = local box area at b
   N = min(ALPHA_MC_REALIZATIONS, floor(ALPHA_MC_MAX_TOTAL_GRID_PIXELS / gridPixels))
   if N < ALPHA_MC_MIN_VALID:  run NO MC; fail closed (endgame, see below)
   else:                       run the MC with N realizations
   ```

   1. **The guard outranks the budget.** `b` is fixed by the target rule plus
      the minor guard and nothing downstream may raise it. This is now
      structural: the rule lives in its own function whose return value the
      caller holds as a `const`.
   2. **The budget counts TOTAL EVALUATED PIXELS** (grid pixels x
      realizations), not grid pixels alone, so bounding the runtime can only
      cost estimator precision, never null fidelity. `ALPHA_MC_MAX_TOTAL_GRID_PIXELS
      = 8388608` (2^23). The per-realization streams of section 1.5 make a
      reduced-N run bit-identical to the first N realizations of a full run,
      so lowering N is a clean truncation, not a different experiment.
   3. **Endgame.** A local grid larger than `ALPHA_MC_MAX_TOTAL_GRID_PIXELS /
      ALPHA_MC_MIN_VALID = 262144` px cannot afford even the floor. The gate
      then runs NO MC and fails closed: `mcRealizationCount` 0,
      `decimationFactor` the guard's own b, thresholds on the floor, `nullRms`
      null, `inconsistent` true, `suppressionReason` `alpha_inconsistent`, and
      no oversized model/scratch buffer is ever allocated (the pre-fix code
      allocated before it capped).

      Trade-off, stated explicitly: neither literal endgame offered in the fix
      brief is satisfiable as written. Accepting a bounded runtime instead
      would mean a ceiling around 18 s (the reachable worst case is a grid of
      16.8 M px at N = 32, plus ~270 MB of buffers), which is not a sane
      budget. Marking the axis "uncalibrated" and releasing anyway cannot
      "neither false-suppress nor silently release": with no calibrated null
      there is no information to decide on, so any choice is one of the two.
      The gate is a RELEASE gate for a measurement product, so the honest
      choice is the conservative one - release only what has been verified.
      Fail-closed is also exactly the contract the gate already uses when the
      null cannot be estimated (nValid < ALPHA_MC_MIN_VALID, revision 1.4), so
      the endgame adds no new semantics and no new field, and the operator
      sees the ordinary `alpha_inconsistent` suppression rather than a release
      with an unverified axis.

      Cost of that choice, measured: the null stays calibrated out to a
      45 deg aspect ratio near 40 (sigma 119x3). The binding quantity is the
      guard-limited decimated major sigma, which must stay near or below 60 px
      at 45 deg - the endgame only ever bites rotated needles. Raising the
      budget to 2^24 would extend the reach to aspect ratio 56 at a measured
      547 ms worst case, past the 500 ms budget target; 2^23 keeps the worst
      case at 303 ms, so the 2 s hard ceiling still holds on hardware roughly
      six times slower than the measurement machine.

   ### 9.9 (d) Measured results after the fix

   Runtime is isolated as t(sigmaB > 0) - t(sigmaB = 0) on the same frame
   (a `sigmaB = 0` call skips the MC), best-of-N to strip scheduler noise.

   | scene                          | b   | N   | MC time | outcome                        |
   |--------------------------------|-----|-----|---------|--------------------------------|
   | 80x5 @45, 691^2, SNR 20        | 2   | 64  | 254 ms  | releases; thMin 4.657          |
   | 118x4 @45, 1011^2 (N reduced)  | 2   | 32  | 238 ms  | releases; guard intact at 2 px |
   | 99x3 @45 (worst budgeted)      | 2   | 46  | 303 ms  | releases                       |
   | 160x5 @45, 1369^2 (endgame)    | 2   | 0   | ~0 ms   | fails closed                   |
   | 340x4 @45, 2895^2 (endgame)    | 2   | 0   | 2.4 ms  | fails closed                   |
   | 40x33 @0.2, 480^2 (existing)   | 4   | 64  | 238 ms  | unchanged (never capped)       |

   Cost of the MC measured at 32.6-36.1 ms per million evaluated pixels.

   Release oracle for the defect-2 reference scene (sigma 80x5 / 45 deg,
   A = 400, sigmaB = 20 i.e. SNR 20, 691^2 ROI, 12 seeds mulberry32(90210 + s)
   with the per-seed Box-Muller stream the tests use, full fit + assess
   pipeline): **12/12 released**, against the required >= 11/12. Honest note
   on the brief's figures: on this reproduction the PRE-fix tree also released
   12/12 (observed minor deltas peaked at 4.95 percent against per-seed
   thresholds of 4.96-5.55), so the two false suppressions the brief quotes
   (deltas 5.079 and 5.512) did not reproduce here - the scene construction
   must differ in some detail. What DID reproduce exactly is the structural
   defect and the brief's cap-side number: `decimationFactor` 4 with
   `thresholdMinorPercent` 4.918 at the frozen geometry, against the guard's
   b = 2. The gate now runs at b = 2 with a decimated minor sigma of 2.5 px.

   ### 9.9 (e) Regression evidence for the unchanged geometries

   Every geometry the old grid cap never touched keeps bit-identical
   thresholds, by construction (same b, same N = 64, same seeds, same
   arithmetic) and by direct measurement: 125 non-capped geometries across
   six angles were compared with strict `===` on `decimationFactor`,
   `mcRealizationCount`, `thresholdMajorPercent` and `thresholdMinorPercent`
   against an exact transcription of the pre-fix engine - 0 mismatches. The
   section-7 oracle 8 pin `decimationFactor === 4 for sigmaMajorPx = 40` was
   re-derived rather than assumed: that scene's local grid is 125 x 105 =
   13125 px, well under the old 32768 cap, so the cap never bound it, b is the
   guard's 4 under both rules and N stays 64. The pin holds unchanged and its
   oracle stays green.


## 10. Independent re-check after the fix round (2026-08-19)

A second-stage independent reviewer re-measured all five review fixes against
the live modules (scripts in the manager scratchpad, repo untouched). Verdict:
ALL FIVE CLOSED, overall PASS. Key numbers: needle Gaussian now fails closed at
sigmaB 0 and 1 (deltas null, thresholds exactly 3) while a healthy noiseless
beam still releases; 80x5 at 45 deg releases 12/12 with b=2/N=64 and
threshold 4.657 percent (the cap-era 4.918 reproduced as the defect); the
mid geometry 118x4 lowers N to 32 and still releases; the over-budget
340x4 at 45 deg fails closed with mcRealizationCount 0; K=2.2 still covers the
true-null p95 at N=32 (p95/rms 1.93-1.97); sigma-1/b=2 fit recovery improved
from -5.56 to -1.25 percent; bins beyond 0 bit-identical; compact-ROI warning
fires at 5-sigma sides, stays silent at 7.5, user rects win, never duplicates.

One NEW LOW found and fixed in the same round: when the requested encircled
fraction equals enclosedFraction[0] EXACTLY, a 1-ulp float gap made the walk
fall through to the legacy bin-edge interpolation (measured 3.536 vs ground
truth 3.162); fixed by clamping the walk target to the accumulated bin-0
power, with an exact-boundary oracle.

Documented residuals (accepted, no code change): the default 64-bin radial
grid resolves a sigma-2 beam's 50 percent radius only to the bin-1 width
(12 percent high vs pixel-sorted ground truth) - a bin-resolution limit of the
diagnostic, candidate for an adaptive bin count in a later release; the N=32
threshold estimator has ~15 percent CV (a per-image threshold below the true
p95 in roughly a quarter of images at that budget - the documented cost of
revision 9.9); the compact-ROI noise warning triggers on 6x sigmaMinor only, so
a needle beam whose MAJOR axis contaminates the rim (measured 1.25x at
50x5 in a 100^2 ROI) is not flagged by this arm.


## 11. S18-R2 final adversarial review — core findings, fixes and calibration (2026-08-19)

A final adversarial review of the landed analyzer produced five confirmed
findings with runnable repros. Every repro was reproduced against the live
modules before any code changed, and every fix is pinned by an S18-R2 oracle
that fails on the pre-fix engine. Measurements below come from scripts in the
implementer scratchpad (repo modules imported via `file://` into node; no repo
writes). Design direction from the operator: the released stage-B value KEEPS
its aperture semantics — it is noise-stable by design — but a wrong release
must never be a SILENT one.

New public surface (additive only):

| where | field / code | meaning |
| --- | --- | --- |
| `ApertureAssessment.absorbedPower` | whole block | how much power the fitted flat background holds, and how much the data exceeds the model inside the beam |
| `gates.alphaConsistency` | `d4ScatterMajorPercent`, `d4ScatterMinorPercent` | per-image noise scatter of the RELEASED width |
| `SimulationWarningCode` | `IMAGE_ABSORBED_POWER` | an absorbed wide wing biases the released widths |
| `SimulationWarningCode` | `IMAGE_TIER_DISAGREEMENT` | the diagnostic and released tiers disagree beyond this image's noise |
| `SimulationWarningCode` | `IMAGE_WIDTH_SCATTER` | the released width's own noise scatter is large |

All three warnings speak ONLY about a RELEASED stage-B number: on a suppressed
frame `IMAGE_APERTURE_SUPPRESSED` already names the reason. None of them is a
gate — nothing here suppresses a release, and no existing oracle was weakened.

### 11.1 F1 (HIGH) — faint wide wing released silently

**Repro (pre-fix, confirmed).** 512x512 float32, core sigma 8x6 amplitude
1000, plus a halo of amplitude 0.5 (0.05 percent of the peak) at 8x the core
width (3.2 percent of the power), noise free: released `d4SigmaMajorPx` 32.12
against an in-frame truth of 54.97, i.e. **-41.58 percent, with ZERO
warnings**. The single-Gauss LM absorbs the whole halo into the constant
background term (fitted `backgroundCounts` 0.0347), so the pedestal hint —
which references the PEAK — sits four orders below its fraction, and both alpha
passes see the same uniformly subtracted level, so the alpha statistic is blind
too. Camera-realistic variant (uint16, bias 100, read noise 8, four-corner
rect-median background): **-41.92 percent**, equally silent. Noise-inversion
variant (400x400, core 12x8, halo f = 0.002 at 4x width, truth d4Maj 58.09):
suppressed as `alpha_inconsistent` from SNR infinity down to SNR 25, then
**RELEASED at SNR 20 and 15 at -15.2 / -14.9 percent** with no informative
warning.

#### 11.1 (a) Absorbed-power wing detector — `aperture.absorbedPower`

Two statistics are exported; only the second one triggers.

1. `flatFractionOfBeamPower = fitB * roiPixelCount / beamPower`, with
   `beamPower` the ROI positive-count sum de-biased by the expected positive
   half-sum of zero-mean noise, `roiPixelCount * sigmaB / sqrt(2*pi)` (the same
   null the adaptive `IMAGE_NEGATIVE_POWER` arm uses). This is the operator's
   literal formula and it measures the right thing: on the F1 scene it reads
   2.93 percent (float32) and 3.10 percent (camera). The de-bias is load
   bearing — without it the same scene reads 0.99 percent once read noise
   dominates the positive sum, i.e. the statistic would shrink with noise.
   **It is exported as a measurement but deliberately does NOT trigger.**
   Measured false-positive rate over 74 clean released reference scenes:
   **18/74 = 24.3 percent**. Cause, measured: a genuinely FLAT residual level
   produces exactly the same number as an absorbed wing, and stage B is immune
   to a flat level by construction (B_eff = 0 semantics subtract it from the
   stage-B field). Example: a 64x64 camera frame whose corner median landed one
   count high reads 14 percent absorbed while its released width is accurate to
   1.1 percent.

2. `apertureExcessFraction` — the residual (data minus the FULL fitted model,
   background included) summed over a concentric ellipse probe, as a fraction
   of the fitted Gaussian's analytic power `2*pi*A*sigmaMajor*sigmaMinor`. A
   flat level the fit absorbed is part of the model and cancels here exactly; a
   WING the flat term absorbed does not, because the wing is concentrated on
   the beam while its absorbed compensation is spread over the whole ROI. That
   asymmetry IS the mechanism that biases the released width, so it is the
   honest thing to test.

**Probe radii** `ABSORBED_POWER_PROBE_ALPHAS = [4, 6, 9, 12]` fitted sigmas.
The most informative radius depends on how much wider the wing is than the
core, which is the unknown: measured standardized excess for a wing 8x the core
width **3.0 at 6 sigma against 4.9 at 12 sigma**, and for a wing 4x the core
width **1.9 at 6 sigma against 0.6 at 12 sigma** (the absorbed compensation
grows with the probe area). A probe is used only when its whole ellipse lies
inside the ROI; the clipping gate guarantees the 4 and 6 sigma probes for any
released frame. The reported probe is the one with the largest excess relative
to its own ceiling.

**Ceiling** `max(ABSORBED_POWER_MIN_FRACTION, ABSORBED_POWER_NOISE_K * sigmaB *
sqrt(aperturePixelCount) / modelPower)` with `ABSORBED_POWER_MIN_FRACTION =
0.003` and `ABSORBED_POWER_NOISE_K = 3`. The noise arm is the exact scatter a
residual SUM inherits from iid N(0, sigmaB) data, so the ratio
|statistic| / noise-arm is a standard normal deviate by construction. K = 3
(rather than the usual 2 or 2.5) pays for the multiplicity of up to four nested
probes; the probes are strongly correlated, so the effective number of
independent tests is well below four. The floor covers sigmaB = 0, where the
noise arm is exactly 0: noise-free clean scenes measure 0.000 percent (the fit
is exact at every probe radius).

**Measured performance.**

| scene | excess | ceiling | fires |
| --- | --- | --- | --- |
| F1 float32 noise-free (probe 12) | 1.730 % | 0.300 % | yes |
| F1 camera-realistic, 6 seeds (probe 9/12) | 1.202-1.925 % | 0.816-1.086 % | 6/6 high |
| clean released reference scenes (74) | — | — | **0 false positives (0.0 %)** |
| F1-C noise-inversion, SNR 20/25, 6 seeds | 1.19-2.87 % | 1.71-3.08 % | 0/6 |

The clean reference set is 74 released scenes out of 111: 6 geometries
(sigma 11x6, 8x6, 20x12, 5x3, 3x1.5, 12x8) x SNR 100 / 20 x 4 seeds, in both a
float32 and a camera-realistic (uint16 + bias + rect-median corners) lane, plus
6 noise-free scenes, 6 large-frame 512x512 camera controls matching the attack
geometry, and 3 beam-fills-the-ROI scenes.

**Documented limit (accepted, no code change).** The noise-inversion variant is
NOT caught, and cannot honestly be: at SNR 20 on a 400x400 frame the wing
carries 19 900 counts while zero-mean noise can fake 20 000 counts of flat
background over the same frame — a 1-sigma effect for a flat statistic and a
measured 1.2-1.7 sigma effect for the best probe. Firing there would be firing
on noise. What DOES speak for that scene is F2: its released width carries a
measurable per-image scatter.

#### 11.1 (b) Cross-tier disagreement — `IMAGE_TIER_DISAGREEMENT`

Evaluated in `analyze.ts` (stage A lives there) when stage B RELEASED and the
stage-A moments are valid AND plausible — reusing the exact plausibility
predicate of the moment-refined fit start (`startMomentsIfPlausible`: valid,
centroid inside the ROI, `4 * sigmaMajor` below the shorter ROI side). The
statistic is the per-axis relative gap `100 * |stageA_d4 - released_d4| /
released_d4`.

**Noise model (per axis).** Stage-A rect moments over the confirmed ROI pick up
`sigmaB * sqrt(sum u^4)` of zero-mean noise in the second-moment numerator
against a signal of `beamPower * sigma_axis^2`, and d4 scales as the square
root of the second moment, so

    expected_axis_percent = 50 * sigmaB * sqrt(sum u^4) / (beamPower * sigma_axis^2)

The fourth moments along the beam's own principal axes are separable even after
the rotation and cost O(width + height), not O(pixels) (`roiAxisFourthMoments`).

**Per-axis matters, measured.** A single radial scale
(`sum r^4` against `sigmaMajor^2 + sigmaMinor^2`) understates the minor arm:
a clean 180x120 sigma 12x8 scene at SNR 20 shows a 31.7 percent MINOR-axis gap
that the radial scale calls 15.2 percent expected. With the radial scale the
false-positive rate was **15/74 = 20.3 percent**; per-axis with
`TIER_DISAGREEMENT_NOISE_K = 3` it is **1/74 = 1.4 percent**.

**Floor** `TIER_DISAGREEMENT_MIN_PERCENT = 15` covers sigmaB = 0, where the
expected gap is exactly 0. Measured clean noise-free gaps: **0.11-0.14
percent** (pure 4-sigma truncation), against the noise-free attack scene's
**71.2 percent** — the floor sits two orders above the clean scenes and far
below the attack.

**Measured performance.**

| scene | gap (major/minor) | ceiling | fires |
| --- | --- | --- | --- |
| F1 float32 noise-free | 71.2 % / 71.2 % | 15 % (floor, sigmaB = 0) | yes |
| clean noise-free references | 0.11-0.14 % | 15 % | no |
| clean released reference scenes (74) | — | — | **1 false positive (1.4 %)** |
| F1 camera-realistic | 128.7-237.9 % | 267-276 % expected | **no** |

The single false positive is a camera frame whose corner-median background
stage landed a fraction of a count off. The tiers really DO disagree there (a
flat residual level moves the diagnostic tier while the released tier is immune
to it), and the warning's own message asks for exactly the review that fixes
it, so it is reported rather than suppressed. An explicit flat-offset bias term
in the ceiling was derived and REJECTED: it would predict a 494 percent
explained gap for the attack scene (whose fitted background IS the absorbed
wing) and silence the instrument on the very finding it exists for.

**Honest deviation from the review brief.** The brief asked this instrument to
fire on BOTH F1 scenes. It fires decisively on the float32 scene. On the
camera-realistic scene it stays silent, and that is the correct behaviour: over
a full-frame 512x512 ROI at that SNR the stage-A tier's own noise scale is
267-276 percent while the observed disagreement is 128-238 percent, so the
disagreement is not significant. Lowering the ceiling to fire there would mean
firing below the noise level of a clean control scene measured at a 237.9
percent gap. The camera-realistic scene is made visible by instrument (a)
instead, which fires on it in 6 of 6 seeds.

### 11.2 F2 (HIGH) — per-image noise scatter of the released number

**Repro.** The alpha gate compares a 4-sigma and a 6-sigma pass on the SAME
realization; the two move together, so a released width worth +-20 percent can
pass the gate with a small delta. Nothing in the released output said how far
the number itself moves under this image's noise.

**Fix.** The alpha-MC already evaluates the alpha-pass moments for every
realization. Their `d4` values are collected, mapped back to full resolution by
the decimation factor (`d4_full = b * d4_dec`; the MC EVALUATES the model at
sigma/b rather than mean-pooling, so the discrete Sheppard term of `fit.ts`
does not apply) and exported as the sample standard deviation (n-1) relative to
the observed alpha-pass d4:
`gates.alphaConsistency.d4ScatterMajorPercent` / `d4ScatterMinorPercent`.
Null on every MC-skip path (sigmaB = 0, earlier gate failed, degenerate
geometry, too few valid realizations, no observed pass), mirrored through the
`analyze.ts` fallback gates block.

**Validation of the b mapping** against the TRUE scatter of the released d4
over independent noise realizations of the same scene:

| geometry | b | empirical | exported | ratio |
| --- | --- | --- | --- | --- |
| 200x200 sigma 12x8, sigmaB 30 | 2 | 0.964 % | 0.892 % | 1.081 |
| 200x200 sigma 12x8, sigmaB 60 | 2 | 1.828 % | 1.791 % | 1.021 |
| 280x280 sigma 20x12, sigmaB 40 | 4 | 0.631 % | 0.742 % | 0.851 |
| 100x100 sigma 8x5, sigmaB 30 | 1 | 1.361 % | 1.356 % | 1.004 |
| 96x96 sigma 5x3, sigmaB 50 | 1 | 3.191 % | 3.955 % | 0.807 |

A missing b-correction would show as a factor-b mismatch on the b = 2 and b = 4
rows; the b = 2 row is pinned as an oracle.

**Warning `IMAGE_WIDTH_SCATTER`**, threshold
`WIDTH_SCATTER_WARNING_PERCENT = 5`, fired when the released frame's major OR
minor scatter clears it. Measured families (10 seeds each, released only):

| family | exported scatter | true released error |
| --- | --- | --- |
| sigma 11x6 / 8x6 / 12x8, SNR 100 | 0.34-0.42 % | 0.01-1.05 % |
| the same geometries, SNR 20 | 1.43-2.14 % | 0.08-5.13 % |
| sigma 5x3, SNR 20 | 3.42-4.21 % | 0.00-3.61 % |
| sigma 3x1.5, SNR 20 | 6.43-7.60 % | 1.77-17.95 % |
| sigma 3x1.5, SNR 15 | 8.17-9.80 % | 2.27-10.25 % |

5 percent sits in the measured gap between the mid and the marginal regime
(4.21 -> 6.43) and leaves every well-resolved scene silent.

Over the same 74-scene clean reference set the warning fires on **8 of 74
(10.8 percent)**, every one of them on the single marginal geometry
(sigma 3x1.5 at SNR 20) whose true released errors on those frames run 0.46 to
13.00 percent. These are not false positives: the warning states an uncertainty
that is really there, which is the point of the instrument. On every
well-resolved and mid geometry in the set it is silent.

**Scatter vs true error, 89 released scenes:** Pearson r **0.686**, Spearman
rho **0.741**; `|true released error| <= 2 x exported scatter` on **96
percent** of them and `<= 1 x` on **80 percent**. The exported number is
therefore usable as a one-sigma uncertainty on the released width.

### 11.3 F3 (HIGH) — LM wedge reported a false `max_iterations`

**Repro.** `runLM`'s wedge exit certified stationarity only through the max
absolute SCALED gradient against `WEDGE_GRADIENT_TOLERANCE * max(1, dataSpan)`.
That gradient is a SUM over the samples, so it grows with sqrt(nSamples) while
the limit does not. Measured over 480 noise-free rotated 11x6 scenes
(ROIs 300x80, 80x300, 240x120, 400x100 at 45 and 60 degrees, amplitudes 1000 /
10000 / 20000, 20 sub-pixel phases each): **18 of 480 reported
`max_iterations` after ~10 of 30 iterations while their recovered widths were
exact to 9.5e-13 percent**. Nothing released on those frames
(`fit_not_converged`). The 80x300 amplitude-20000 sweep alone failed 7 of 20
phases. Diagnosis at the wedge: scaled gradient 0.42-7.87 against a limit of
1e-4 to 2e-4; remaining cost 8.5e-24 to 1.9e-22 on the scale
`cost / (dataSpan^2 * nSamples)`, i.e. a per-sample residual rms of 2.9e-12 to
1.4e-11 data spans.

**Rejected alternative, measured.** A Gauss-Newton "predicted decrease" test
(`g^T H^-1 g / cost`) certifies nothing at the rounding floor: on exactly the
stalls this arm must accept it predicted a relative decrease of
**0.9999999999**, because the linearized model can always "explain" a rounding
residual. Scaling the wedge gradient limit by sqrt(nSamples) was also
insufficient (it would still reject the measured 7.87 gradient against a
0.0155 limit).

**Fix.** A third convergence arm on the wedge exit only — the ordinary
top-of-loop `COST_FLOOR` is untouched:

    wedgeRelativeCost = cost / (dataSpan^2 * nSamples) <= WEDGE_COST_RELATIVE_FLOOR

with `WEDGE_COST_RELATIVE_FLOOR = 1e-20` (module-private in `fit.ts`, which
keeps all its numeric constants local). That accepts every measured stall with
at least 50x margin while still demanding a per-sample rms below 1e-10 data
spans — a level no fit with anything left to improve can reach (a residual rms
of one part per million of the span already measures 1e-12 on this scale).

**Status honesty.** `max_iterations` now means exactly one thing: the iteration
budget was exhausted. A wedge stop happens with `iterations < cap`, so an
UNCERTIFIED wedge stop reports `singular_normal_equations` — at `LAMBDA_MAX`
the damped system is diagonal-dominated, its step is numerically inert and the
local quadratic model carries no usable information; that, and not an exhausted
budget, is what happened. No new public status was added.

**Result.** 0 of 480 non-converged after the fix; the `maxIterations: 1 / 2 / 3`
cap fixtures still report `max_iterations` with `converged === false`; the
whole existing fit and aperture suites stay green.

### 11.4 F4 (MEDIUM) — multi-peak gate read the un-subtracted field

**Repro.** `evaluateMultiPeakGate` was the only post-residual gate still
reading the raw `corrected` values while every other one reads the
fit-background-subtracted stage-B field, contradicting the documented stage-B
semantics. With an un-subtracted offset above ~10 percent of the peak the
candidate floor `MULTI_PEAK_MIN_PEAK_FRACTION * peakCorr` sits BELOW
`offset + a few sigmaB`, so ordinary background noise maxima were counted as
beams. Measured, 192x192, sigma 11x6, amplitude 20000, offset 2000, SNR 100:
**16 peaks on the raw field** (suppression `multi_peak`) against **1 peak on
the stage-B field** (releases). At offset 0 both fields agree at 1 peak.

**Fix.** Pass `stageBField`. `peakCorr` keeps its corrected-field definition
(it is the ROI peak the residual and pedestal arms are referenced against).
The oracle carries a reference implementation of the pre-fix scan — same
threshold, same strict 8-neighbour rule, same greedy separation counting, run
on the raw field — so the red state is pinned inside the test. Existing
multi-peak fixtures (zero-background fields) re-verified green.

### 11.5 F5 (MEDIUM) — an exported verdict the gate never reached

**Repro.** Revision 9.4 skips the self-calibrating MC when an earlier gate
already failed, which leaves the alpha gate with nothing but the bare 3 percent
floor. The observed deltas were still compared against that floor and
`inconsistent: true` was exported. Measured on a residual_high frame: deltas
24.265 / 24.265 percent against thresholds 3 / 3, `mcRealizationCount` 0,
`nullRms` null — a JSON consumer read "alpha inconsistent" when the truth was
"alpha not evaluated".

**Fix.** When the earlier gates did not pass, the VERDICT is withheld
(`inconsistent: false`); the observed deltas, the floor thresholds and the
no-data MC fields are still exported, because they are measurements rather than
verdicts. Release precedence is untouched: the earlier gate already vetoes both
`suppressionReason` and the release conjunction, so a false verdict here can
never release anything the old code suppressed. Oracle: the residual_high
fixture exports `inconsistent === false`, both deltas present and above the
floor, and `suppressionReason === "residual_high"`.

### 11.6 Oracles added (all named S18-R2)

| file | oracle |
| --- | --- |
| `tests/unit/image-fit.test.ts` | F3 large clean ROI at its exact minimum reports converged (20 sub-pixel phases, widths pinned to 1e-9 relative) |
| `tests/unit/image-fit.test.ts` | F3 the iteration cap still reports `max_iterations`; a pure-noise fit is never certified through the numerical floor |
| `tests/unit/image-aperture.test.ts` | F4 stage-B field vs an inline reference implementation of the pre-fix raw-field scan |
| `tests/unit/image-aperture.test.ts` | F5 early-suppressed frame withholds the verdict but keeps the measurements |
| `tests/unit/image-aperture.test.ts` | F2 exported scatter against the TRUE scatter over 14 realizations, on a b = 2 geometry |
| `tests/unit/image-aperture.test.ts` | F1a wing fires, clean beam and pure flat offset do not; pedestal hint and alpha gate pinned blind |
| `tests/unit/image-analyze.test.ts` | F1 wing scene releases a -41 percent width AND carries both new warnings; the same beam without the halo carries neither |
| `tests/unit/image-analyze.test.ts` | F1 camera-realistic wing scene raises `IMAGE_ABSORBED_POWER` above its noise ceiling |
| `tests/unit/image-analyze.test.ts` | F2 marginal width carries `IMAGE_WIDTH_SCATTER`, well-resolved width does not |

### 11.7 Constants added (`thresholds.ts`, and one module-private in `fit.ts`)

| constant | value | calibrated against |
| --- | --- | --- |
| `ABSORBED_POWER_PROBE_ALPHAS` | `[4, 6, 9, 12]` | wing-to-core width ratio unknown; measured 3.0 vs 4.9 (8x wing) and 1.9 vs 0.6 (4x wing) at 6 vs 12 sigma |
| `ABSORBED_POWER_MIN_FRACTION` | 0.003 | noise-free clean 0.000 % vs noise-free wing 1.73 % |
| `ABSORBED_POWER_NOISE_K` | 3 | 0/74 clean false positives; pays for up to four correlated probes |
| `TIER_DISAGREEMENT_MIN_PERCENT` | 15 | noise-free clean 0.11-0.14 % vs noise-free wing 71.2 % |
| `TIER_DISAGREEMENT_NOISE_K` | 3 | 1/74 clean false positives (20.3 % with the rejected radial scale) |
| `WIDTH_SCATTER_WARNING_PERCENT` | 5 | measured gap between the mid (4.21 %) and marginal (6.43 %) regimes |
| `WEDGE_COST_RELATIVE_FLOOR` (fit.ts) | 1e-20 | measured stalls at 8.5e-24 to 1.9e-22, >= 50x margin |

## 12. Final joint re-check (2026-08-19) — staffel complete

The independent second-stage reviewer re-measured all seven revision-11
closures against the live modules: absorbed-power probes (wing scene fires at
excess 1.730 percent on probe 12, clean scenes silent, ceiling formula exact,
clipped probes dropped honestly), tier disagreement (71.2 percent vs floor 15
on the wing, 0/49 clean false positives), scatter export (empirical vs
exported ratio 1.06-1.08, warning fires exactly on released frames above 5
percent), wedge cost-floor (20/20 previously-failing phases converge, honest
max_iterations only at the cap), multi-peak on the stage-B field (offset
scene 16 raw peaks -> 1, releases), withheld alpha verdict on early
suppression, and the pinned regressions (SNR curve 15/14/13/13, thrMaj
12.880, 80x5 12/12, pure-noise detected=false). Verdict: PASS, no gate
regression. One accepted LOW leftover for API consumers: absorbedPower.high
can be true on a frame an earlier gate already suppressed - the warning is
correctly withheld because nothing was released; consumers must read
suppressionReason alongside the block (same reading rule as every gates
field).

## 13. v2.0 hardening — measured behaviour changes and re-pinned curves

The v2.0 hardening pass landed eleven implementation stages against the
analyzer this document describes. This section is their measurement record, in
the same form as sections 10-12. Two lanes carry the oracles:

- `npm test` — the standard suite, 507 cases at the time of writing.
- `npm run verify:s20repros` — the v2.0 repro corpus in `tests/repro-s20/`,
  47 cases, deliberately outside the default test glob because several of its
  files run full analyzer campaigns at module level.

**Evidence status.** Not every figure in a measurement record has the same
standing, and a reader should not have to open a test file to find out which is
which. Three markers are used:

| marker | meaning |
| --- | --- |
| **[oracle]** | asserted by a named runnable test in this repository. A change that moves the number fails the suite. |
| **[campaign]** | measured in the stage's calibration campaign and recorded here — usually also in the calibration comment of the constant it justifies, or in the comment of the test whose scene produced it. Re-derivable by re-running the named scene family, but NOT pinned as an assertion: a change that moved it would fail nothing. |
| **[session record]** | measured in a cross-check session against the build of the time. Not re-runnable from this repository at all. |

The markers are applied wherever a figure's class is not already stated by the
text around it. Unmarked figures in a table whose caption names a test are
[oracle]; the blocks that introduce themselves as a calibration campaign
(13.2, 13.4.1, 13.4.3, 13.4.4) are [campaign] throughout, as their own captions
say. No number is softened by carrying a marker — the figures are unchanged;
the marker states only what would happen if one of them drifted.

Every table names the file that backs it. Where a stage changed behaviour, its
backing test carries an inline old -> new ledger at each moved pin, so no
pre-change number was overwritten silently.

### 13.1 The four-cell release curve after hardening

The release curve is the same scene family sections 7 and 12 use: 300x240,
sigma 11x6, amplitude 100, full-frame ROI, 15 deterministic seeds, `sigma_B`
handed to `assessAperture` explicitly so the background estimator never enters.
Two of its four cells had no oracle before this pass; they have one now.

| cell | sigma_B | documented floor | measured | threshold band (major / minor) **[campaign]** | backing test |
| --- | --- | --- | --- | --- | --- |
| SNR 100 | 1 | 15/15 | **15/15** [oracle] | 3.000-3.091 / 3.000 | `tests/unit/image-aperture.test.ts`, "S18 oracle: a perfect Gaussian releases at SNR 20 ... and at SNR 100" |
| SNR 50 | 2 | 14/15 | **15/15** [oracle] | 5.566-6.235 / 5.355-5.742 | `tests/unit/image-aperture.test.ts`, "S20 oracle: the same release curve at SNR 50 and SNR 30" |
| SNR 30 | 10/3 | 13/15 | **15/15** [oracle] | 9.434-10.356 / 8.962-9.706 | same |
| SNR 20 | 5 | 13/15 | **15/15** [campaign] | 14.273-15.578 / 13.450-15.323 | first oracle, which asserts `>= 13` only; the exact count is the re-baseline measurement |

**What the curve tests actually assert.** The release COUNT, and only that:
exactly 15 at SNR 100, exactly 15 at SNR 50 and 30 with the documented figures
`>= 14` / `>= 13` asserted underneath, and `>= 13` at SNR 20. The SNR-20 cell's
exact 15/15 and every threshold band in the fifth column are [campaign] — they
come from re-running the same 15 seeds per cell in the re-baseline run and
reading `gates.alphaConsistency` off each assessment. No test asserts a band, so
a band that shifted would fail nothing; what would fail is the count, once a
shift went far enough to move a release.

Not one of the eleven stages moved a cell. Stage A is entered only when the ROI
carries non-finite pixels, so a clean frame never reaches it: 0 of the 111
clean reference scenes enter the block, and 0 of the 15 seeds in each of the
four cells above. Stage B is additive observability with no gate arm. Stage F
re-anchors both ceilings against the stage-B peak, which on a zero-offset,
spike-free curve frame is the same number the raw maximum gave: the curve is
bit-identical across it. Stage E cannot reach the curve at all, because the
oracle passes `sigma_B` in rather than estimating it.

**Seed sensitivity, and the documentation decision.** The four cells above are
one seed base each (`0x51e5` for SNR 100/50/30, `0xa11ce5` for SNR 20 — the
bases the pre-existing oracle already used, not a base chosen after looking).
Re-measured in the re-baseline run over eight literal bases (`0x51e5`,
`0xa11ce5`, `0xb0a710`, `0xc0ffee`, `0xd15ea5e`, `0xfeed`, `0x1234`, `0xbeef`),
the same four cells read:

| cell | pinned base | over eight bases |
| --- | --- | --- |
| SNR 100 | 15/15 | 14-15/15 |
| SNR 50 | 15/15 | 13-15/15 |
| SNR 30 | 15/15 | 13-15/15 |
| SNR 20 | 15/15 | 13-15/15 |

A count of 15 out of 15 is a point estimate with a two-count spread across
noise realizations; quoting four such point values as "the curve" reads as a
precision the measurement does not have. **Decision: the operator-facing
documentation carries a band.** `docs/theory/image_analysis.md` now states the
curve as 15/15 on the pinned seed base with the measured spread over seed
variation beside it, rather than as four point values. The oracles keep pinning
the exact count on the pinned base (a change that moves it must be looked at)
and asserting the older documented figure as a hard floor underneath (a change
that falls below it fails outright). The band itself is a re-baseline
measurement rather than an oracle — a per-base sweep costs eight times the
oracle's runtime — and the pinned test's comment records it.

### 13.2 A fifth release gate: `coverage_insufficient`

**Position.** The suppression precedence is now
`fit_not_converged -> nonpositive_amplitude -> residual_high -> aperture_clipped
-> coverage_insufficient -> alpha_inconsistent -> multi_peak`
(`packages/image/src/aperture.ts`). The gate is evaluated only when the ROI
carries non-finite pixels AND gates 1-4 passed, so a frame without them is
bit-identical to a build without the block and pays nothing for it.

**What it measures.** Non-finite pixels inside the measurement aperture are
skipped by every moment accumulation, so a released width is taken over
whatever support survived — and the alpha gate is structurally blind to that,
because a central dead column cuts BOTH of its apertures alike and leaves their
ratio almost unchanged. The discriminator is therefore a model-bias estimator,
not a dead-pixel fraction: the fitted model is rasterized over the alpha
aperture — the BEAM TERM ONLY, because stage-B moments are taken on the
fit-background-subtracted field — and its ellipse moments are computed twice,
once over the full aperture and once with exactly the observed non-finite mask
applied. The relative d4 difference is the induced bias.

The construction has an exact identity property that is the reason to trust it:
both passes moment the SAME raster, so model error, discretization and aperture
truncation cancel term by term and only the mask's own effect survives. An
empty mask returns exactly zero, and a mask that thins the support uniformly
returns approximately zero for the same reason — measured -0.008 percent for a
"keep every twelfth pixel" pattern. That blind spot is what the second arm
exists for.

Rasterizing the background term as well was tested and rejected: it would
measure a pedestal the released numbers never see. Verified directly on the
pedestal scene of the calibration campaign, a background-inclusive raster would
have UNDERSTATED the induced bias by up to 42 percent.

**Calibration campaign.** 1920 masked frames: iid random masks over the
6-sigma support at dead fractions 1/5/10/30/50 percent, 12 seeds each, over 32
clean released scenes (6 geometries x SNR 100/20, float32 and camera-realistic
lanes, plus noise-free, 512-px large-frame and beam-fills-ROI controls).

| population | rows | estimator reading |
| --- | --- | --- |
| mandatory RELEASE (evenly spread mask, 1/5/10/30/50 percent dead) | 5 | 0.373 / -0.011 / 0.129 / 0.097 / **0.677** % |
| mandatory SUPPRESS (dead column +-2/+-5/+-10 px, masked flank beyond 1 and 2 sigma) | 5 | **5.924** / 21.031 / 53.645 / -20.583 / -5.778 % |
| benign iid family, worst by geometry class | 1920 | sigma_minor >= 6: 3.639 %; sigma_minor = 3: 7.082 %; sigma_minor = 1.5: 8.975 % |

**The corrected premise (iid versus lattice).** The plan carried the reading
"random masks up to 50 percent are benign". That reading came from a
low-discrepancy, lattice-like mask on ONE well-resolved geometry. Real iid
masks on marginal geometries produce up to 12 percent of GENUINE error, and
93.7 percent of the frames a 2 percent ceiling flags are confirmed off by more
than 2 percent by their own released width. The estimator was right and the
premise was wrong; the premise is retracted here. The consequence is a measured
yield cost of 4.17 percent of the well-resolved benign frames and 3.26 percent
of all benign frames at realistic dead fractions (10 percent or below) — and
every one of those frames is demonstrably corrupted, which is what the gate is
for.

**Constants** (`packages/image/src/thresholds.ts`, calibration comments inline):

| constant | value | calibrated against |
| --- | --- | --- |
| `COVERAGE_BIAS_MAX_PERCENT` | 2.0 | the geometric centre of the measured gap, sqrt(0.677 x 5.778) = 1.98: **2.95x** above the largest mandatory-release row and **2.89x** below the smallest mandatory-suppress row |
| `COVERAGE_MIN_FINITE_FRACTION` | 0.2 | not raw computability (the masked pass still returns a number down to ~20 finite pixels) but the crossing where the estimator's own disagreement with the released truth reaches the ceiling it is compared against: 2.1-2.3 percentage points at finite fraction 0.2-0.4, 3.2-6.3 points below 0.15. The mandatory-release 50-percent row reaches finite fraction 0.4184 at worst over 379 samples, a factor **2.09** above the floor |
| `COVERAGE_LOSS_INFO_PERCENT` | 1.0 | the grey band under the ceiling; the largest mandatory-release row (0.677) stays a factor **1.48** below it, so a released frame only speaks when its gaps moved the widths by more than that family ever does |

**Pinned rows** (`tests/unit/image-aperture.test.ts`, "S20 coverage: ..."; the
before-gate values are in `tests/repro-s20/s20-coverage-masks.test.ts`):

| scene | finite aperture px | finite fraction | bias major | verdict |
| --- | --- | --- | --- | --- |
| dead column +-2 px | 3148 of 3312 | 0.9505 | 5.9666 % | `coverage_insufficient` |
| scattered mask 10 % | 2976 | 0.8983 | -0.04 % | released, d4 43.8323 |
| scattered mask 30 % | 2314 | 0.6987 | -0.0735 % | released, d4 43.8369 |
| scattered mask 50 % | 1648 | 0.4976 | -0.5198 % | released, d4 43.6179 |
| keep every twelfth pixel | 273 of 3322 | 0.0822 | < 0.1 % (blind) | `coverage_insufficient` via the floor arm |

Each mandatory-release row clears the finite-fraction floor by at least a factor
of two, asserted in the same test, so none of them sits on a suppression edge.

**Notice text.** `IMAGE_FLOAT_SPECIALS` used to say that every downstream
statistic "ignores" non-finite pixels, which read as reassurance where it was a
hazard. It now states that the statistics are computed over the pixels that
remain, that widths shift where the gaps fall inside the measurement aperture,
and that the coverage check reports by how much. `IMAGE_COVERAGE_LOSS` (info)
covers the released band (1.0, 2.0] percent; the reason label and its
translations ship with the gate.

**Runtime pin.** One non-finite pixel anywhere in the ROI is enough to enter
the block, so the cost worst case is a large frame with a large aperture and a
single dead pixel. Measured at 1024x1024 with a sigma 50x30 beam (75 377
aperture pixels): 554 ms clean against 612 ms with the one NaN, a 10 percent
difference. The test pins an absolute 2500 ms budget (loose enough not to flake
on a loaded machine) and, load-bearingly, the machine-independent ratio
`dirty < 2 x clean + 100 ms`.

### 13.3 Three honesty notices, and zero gate drift

Three additive INFO instruments were added where the honesty instruments used
to be quietest on the worst inputs. None of them is a gate: not one suppression
decision, released width or curve cell moved (the re-pins in
`tests/repro-s20/s20-honesty-floor.test.ts` are the proof — every released d4
and every `suppressionReason` on those scenes is unchanged to the digit).

Rates are measured on the CANONICAL clean reference set of section 11 — the 74
released scenes of 111, reconstructed and pinned in
`tests/repro-s20/s20-clean-reference-set.test.ts`, whose first test re-derives
the documented 111-scene structure and the documented 74-scene split before any
rate below is allowed to mean anything.

| code | severity | rate on the 74 | what it states |
| --- | --- | --- | --- |
| `IMAGE_ALPHA_GATE_WEAK` | info | **40/74 (54.1 %)** | this image's noise widened the consistency ceiling past 10 percent, so the test had no discriminating power here |
| `IMAGE_WING_PROBE_REDUCED` | info | **12/74 (16.2 %)** | the absorbed-power detector lost its long-reach probes to the ROI size |
| `IMAGE_TIER_CHECK_UNAVAILABLE` | info | **38/74 (51.4 %)** | the cross-tier comparison did not run, and why |

#### 13.3.1 `IMAGE_ALPHA_GATE_WEAK` — how wide the window was

A capped alpha ceiling was measured and rejected: the pathological
core-plus-halo scene reads 11.1 to 31.4 percent, squarely inside the band clean
sigma 8x6 scenes at SNR 20 occupy (19.0 to 23.0 percent), so no threshold on
that number separates the two. What CAN be said honestly is how wide the window
was. `ALPHA_GATE_WEAK_PERCENT = 10` was placed on a high-amplitude population
where the family bands separate:

| family | ceiling band | verdict |
| --- | --- | --- |
| sigma 11x6 SNR 100 (curve oracle) | 3.000 | silent, factor 3.33 |
| sigma 20x12 SNR 20 | 6.704 - 7.742 | silent, factor 1.29 |
| sigma 12x8 SNR 20 | 11.889 - 12.532 | speaks |
| sigma 11x6 SNR 20 (curve oracle) | 15.685 - 17.068 | speaks, factor 1.57 |
| sigma 8x6 SNR 20 | 19.021 - 23.014 | speaks |
| sigma 5x3 SNR 20 | 32.165 - 49.078 | speaks |
| sigma 3x1.5 SNR 20 | 70.027 - 184.339 | speaks |

10 is the only round number between the widest silent family (7.742) and the
narrowest speaking one (11.889).

**Adjudication of the 20x12 flag.** The stage's stop-and-report raised the
sigma 20x12 SNR-20 family, whose plan-recorded band (7.42 - 7.91 percent) sits
just under the constant. On the high-amplitude population this reconstruction
reproduces that band (6.704 - 7.742) and the family is silent 0/8. On the
CANONICAL corpus — marginal amplitude, where the Monte Carlo null is much wider
— the same family reaches 11.383 percent on one seed and the notice speaks
there, 1 of 8. That is not a calibration error: at a ceiling above 10 the
notice's statement is true. **The band is amplitude dependent**, so "20x12 at
SNR 20 stays silent" is a statement about a signal regime, not about a
geometry, and it is recorded as such. A second band edge is recorded with it:
the marginal sigma 3x1.5 geometry at SNR 100 straddles the constant on a
high-amplitude population (8.727 - 10.693, 1 of 5 rows fires). Both are
acceptable HERE and nowhere else, because this constant drives an INFO notice
and never a release decision. The rate of 40/74 is carried by the SNR-20 half
of the corpus, whose ceilings there run 11.9 to 530 percent; every SNR-100
family is silent.

#### 13.3.2 `IMAGE_WING_PROBE_REDUCED` and the absorbed-power floor

The absorbed-power detector drops any probe whose ellipse leaves the ROI, and
it used to drop it silently. Two additive fields (`availableProbeAlphas`,
`maxAvailableProbeAlpha`) now say which radii ran, so a reported `probeAlpha`
can be read as "the most informative radius" rather than "the only radius
left" — a distinction worth a factor 9.7 in measured excess on the wing scene
(1.7296 percent at the 12 sigma probe against 0.1792 percent at the 6 sigma
one).

The same finding moved a constant. `ABSORBED_POWER_MIN_FRACTION` **0.003 ->
0.0005**: the 0.3 percent floor had been set against the wing scene at its
WIDEST probe and silently stopped being the right number the moment the reach
shrank. The floor arm only ever binds where the noise arm cannot — noise-free
and very-low-noise frames, where an exact fit measures 0.000000 percent at
every radius.

| population | measured | evidence for |
| --- | --- | --- |
| canonical clean reference set (74 released) | **X = 0/74** false fires at the new floor (and 0/74 at the old one) | the HARD rollback condition; asserted exactly, not bounded, in `s20-clean-reference-set.test.ts` |
| high-amplitude variant of the same structure | 0/104 | second population |
| noise-free sigma sweep, sigma in {1, 1.5, 2, 3, 6, 11} x sub-pixel phases x round / 2:1 elliptical | 0/192, worst absolute excess 6.9e-7 percent against the 0.05 percent floor — a factor 72 000 | the population the floor arm actually governs |
| the three wing rows the change is FOR (ROI 100 / 120 / 140) | 0.0735 / 0.1265 / 0.1792 percent, clearing the new floor by **1.47x / 2.53x / 3.58x**, all three silent under the old floor | `tests/repro-s20/s20-honesty-floor.test.ts` |

Tightest clean headroom: the worst of the 74 released scenes reaches **0.611**
of its own ceiling **[campaign]** — the test bounds that ratio at `< 0.7`
**[oracle]** rather than pinning the value, so the exact figure may drift inside
that bound without failing anything — and the ceiling it is measured against is
the NOISE arm rather than the floor, so the floor change did not spend that
margin. Exactly 6 of the 74 rows are floor-bound at all (asserted as `<= 6`,
**[oracle]**) — the noise-free controls, whose absolute excess is at most
2.3e-7 percent **[campaign]**. The halo-free control of the wing scene reads
exactly 0.0000 percent excess at every ROI size from 512 down to 100 and stays
silent at both floors **[oracle]**.

#### 13.3.3 `IMAGE_TIER_CHECK_UNAVAILABLE` — a typed refusal

The cross-tier check used to switch itself off silently whenever the stage-A
plausibility predicate refused. It now reports the refusal as a discriminated
union carrying the numbers that produced it (`packages/image/src/analyze.ts`),
and the predicate is the single source of both this reason and the
moment-refined fit start, so the two cannot drift apart.

| branch | condition | payload |
| --- | --- | --- |
| `stage_a_invalid` | stage-A moments invalid, or valid with a missing / non-finite / non-positive geometry field | `invalidReason` |
| `centroid_outside_roi` | the stage-A centroid sits outside the confirmed ROI | `centroidXPx`, `centroidYPx` |
| `sigma_exceeds_roi` | `4 * sigmaMajor` does not fit inside the shorter ROI side | `sigmaMajorPx`, `shorterRoiSidePx` |

All three branches, plus evaluated-below-threshold and genuine disagreement,
are pinned in `tests/unit/image-analyze.test.ts`.

**The centroid branch, and why it never appears on a released frame.** A
positive-weighted centroid always lies inside its own bounding rectangle, so
leaving the ROI needs negative weights; pushing the centroid past an edge the
release gates keep at least 6 fitted sigmas away needs a negative mass within a
few percent of the beam's own power, and that mass leaves a residual orders of
magnitude above the release ceiling. Measured over 180 targeted configurations
of that family (sigma_n 0.5 to 5, mass fraction 0.9 to 0.98, offset factor 1.02
to 4): 12 produce a valid stage A with the centroid outside the ROI, and every
one of the 12 is suppressed before it can release. The branch is genuinely
reachable — the pinned witness is a real scene run end to end, a positive beam
plus a narrow negative sink carrying 97.8 percent of its power about 1.2 px off
centre, which drags the signed-weight centroid past the frame edge while the
covariance stays positive definite — and the notice is correctly absent there,
because it speaks only about a number that WAS released.

### 13.4 Background statistics: what the reference is allowed to claim

#### 13.4.1 The deflation correction `c(n) = n / (n - 2.4)`

The robust plane is fitted on its own reference pixels and the scale is then
taken from the residuals of that same fit, so the reported sigma is deflated.
The naive three-parameter form `sqrt(n/(n-3))` is algebraically empty here —
the hat-matrix trace is exactly 3 for a three-parameter design, so the
"trace-based" and the "n-3" corrections are literally the same formula, and
both are about half the measured deflation.

`BACKGROUND_PLANE_SCALE_EFFECTIVE_DF = 2.4` was measured on the ACTUAL
estimator chain (MAD/IQR on IRLS-Huber residuals) over three reference layouts
— one compact rectangle, four corner boxes, an edge ring — at 9 <= n <= 960,
20 000 realizations per row:

    nu_eff = (1 - E[sigma_hat]/sigma) * n = 2.4 +/- 0.15

with **no resolvable layout term** (spread across the three families at fixed n
is at most 0.09, i.e. at most 0.6 percent in `c` at n = 16). It decomposes as
1.5 (the linearization of `sqrt(n/(n-3))` — the three plane parameters) + 0.85
(the finite-sample bias of MAD itself, measured separately on unfitted samples)
+ a small remainder for the Huber-psi inlier concentration. Raw deflation before
the correction: -27.4 percent at n = 9, -14.8 (single) / -14.3 (four corners) at
n = 16, -1.2 at n = 192, -0.25 at n = 960. Worst residual error over the whole
admissible grid after correction: -4.2 percent (a nine-sample block-plus-outlier
layout); over the three mandated families, -1.0 percent.

Acceptance on a properly mixed ensemble, 4000 realizations per row
(`tests/repro-s20/s20-background-stats.test.ts`): residuals -0.74 percent
(n = 9), +1.18 (n = 16 compact), -0.22 (n = 16 four corners), +0.12 (n = 192) —
all inside the 5 percent acceptance.

**The -24.5 percent anchor was an artifact, and is pinned as one.** The plan
required the correction to land within 5 percent of two verified fixtures, one
of which was a four-corner layout reading -24.5 percent deflation. It does not,
and the reason is the ensemble rather than the estimator. The repro generator
seeds its LCG with the realization index and reads the FIRST Gaussian draw
straight out of that seed; over seeds 1..400 that first draw has a standard
deviation of 0.617 instead of 1 and a mean absolute value of 0.553 instead of
0.798. A reference rectangle containing pixel (0, 0) therefore sees a
systematically small first sample and a rectangle at (30, 30) does not — which
is what made the four-corner geometry look 11 points more deflated than a
compact block of the same n. On the same 400 seeds the compact 4x4 sits at
-13.4 percent and the four corners at -24.5; on a mixed ensemble both sit at
-14.3. The anchor is therefore **pinned with its provenance rather than
calibrated to**, and the generator was deliberately left untouched: it is the
0b corpus's own deterministic scene source, and changing it would move every
other pin that rests on it. This is a documented limitation of that corpus, not
of the estimator.

Old -> new on that same 400-seed ensemble (true sigma 10):

| geometry | n | old mean | old deflation | new mean | new deflation |
| --- | --- | --- | --- | --- | --- |
| single 2x2 | 4 | 5.889 | -41.1 % | — | rejected (13.4.3) |
| single 3x3 | 9 | 7.402 | -26.0 % | 10.094 | +0.9 % |
| single 4x4 | 16 | 8.656 | -13.4 % | 10.183 | +1.8 % |
| 2x2 in four corners | 16 | 7.554 | -24.5 % | 8.887 | -11.1 % |
| 8x6 corner boxes | 192 | 9.793 | -2.1 % | 9.917 | -0.8 % |
| 4 px edge ring | 960 | 9.958 | -0.4 % | 9.983 | -0.2 % |

#### 13.4.2 Reference identity is the resolved pixel union

The correction belongs to the samples that carried the fit. Whether a caller
names those samples in the fit's order, in another order, with a rectangle
repeated, or tiled into different rectangles is a spelling difference: all of
them resolve to the same pixel union and therefore to literally the same sample
vector. Comparing rectangle tuples — even sorted — catches the first three and
misses the re-tiling.

This was found by cross-check as a HIGH: on a nine-sample reference the
inherited path reported sigma 15.56994 with `c = 1.3636` while the SAME
reference listed in reverse reported 11.41796 with `c = 1` — the whole
correction silently dropped, a **26.7 percent** error in every downstream
`sigma_B` consumer. The comparison is now the resolved pixel union
(order-, duplication- and tiling-invariant), with degenerate extents rejected
before every shortcut including the alias case. Strict subsets and supersets
stay uncorrected by design: those pixels did not carry that fit.

#### 13.4.3 One minimum-sample regime

`BACKGROUND_MIN_REFERENCE_SAMPLES = 9`. Below it the background METHOD degrades
to `none` — no offset and no plane is applied — with `scaleSource` `floor` or
`zero` and `IMAGE_NOISE_SCALE_SUSPECT`. The earlier design had two competing
rules (degrade the label / reject the geometry); there is now one.

Calibrated in the step-0 campaign (20 000 realizations per row, plane
500 + 0.3x - 0.2y, true sigma 10): single-realization relative scatter is 76
percent at n = 4, 73 at n = 5, 53 at n = 8, 51 at n = 9, 29 at n = 16, and
below nine samples the correction stops being layout-robust (a five-sample L
layout misses by -22 percent, a four-sample block by +47). Nine is the smallest
count that keeps the whole campaign inside 5 percent. The workbench four-corner
preset stays far above it: 16 samples already at 13 x 21 px, 192 on the 64 x 48
reference frame.

The behaviour is pinned as a method-by-count truth table (twelve rows over both
rect-based methods at n = 1, 2, 4, 8, 9, 16, plus the three rect-free methods,
in `tests/repro-s20/s20-background-stats.test.ts`), asserting `method`,
`requestedMethod`, `referenceSampleCount`, `degradedReason`, whether an offset
or plane exists, `scaleSource`, whether the corrected field is the raw field,
and what the analyzer tells the operator. `robust-plane` keeps its geometry
guards and they run FIRST: a reference that cannot span two distinct
coordinates per axis is still a `RangeError` whatever its sample count; only a
fittable-but-tiny reference degrades.

Old -> new on the sharp cases:

| case | before | after |
| --- | --- | --- |
| 1x1 hot reference used as `rect-median` | `offsetCounts` 1000, `corrected[0]` = -900, `negativeFractionAfter` 0.9998 | method `none`, no offset, image returned uncorrected, `negativeFractionAfter` 0 |
| the same reference end to end with a beam | `offsetCounts` 5112.89, `suppressionReason` `residual_high` | reads exactly like the clean-reference run (d4 15.9579 / 11.9706) plus `NOISE_SCALE_SUSPECT` |
| two float32 samples | sigma 29.652, `scaleSource` `mad` | sigma 0, `scaleSource` `zero` (the raw MAD is still reported) |
| the same pair as uint16 | 29.652 `mad` | 0.5 `floor` (a real quantization floor) |
| the S18a five 1x1 sparse-plane oracle | fitted the plane | rejected on sample count (n = 5); the sparse-geometry claim it owned is carried by the same staggered pattern in 2x2 boxes (n = 20) |

#### 13.4.4 Gradient in the background reference

A new INFO/warning arm says when the chosen method is the problem rather than
the beam. For `rect-median` — the method that subtracts ONE number — a linear
trend is fitted through the per-rect medians at their centroids and its
peak-to-peak across the rects is compared against the uncertainty the IN-RECT
scatter allows:

    trendCounts       = max_r T(x_r, y_r) - min_r T(x_r, y_r)
    uncertaintyCounts = 1.2533 * s_within * sqrt(1/n_hi + 1/n_lo)
    fires             iff trendCounts > BACKGROUND_GRADIENT_TREND_K * uncertaintyCounts

`s_within` is the pooled MAD scale of every sample about its OWN rect median,
so a common pedestal, a symmetric beam tail and unequal rect sizes cancel out
of the numerator and only a genuine tilt survives; 1.2533 is sqrt(pi/2), the
standard-error factor of a sample median.

`BACKGROUND_GRADIENT_TREND_K = 10` was calibrated against a false-positive
budget of 0.1 percent per analysis on flat noisy references (20 000
realizations per geometry; sigma 1/10/100; four corner boxes of 2x2, 3x3, 4x4,
8x6 and 1x9; three corners; six and nine spread boxes; deliberately unequal
rect sizes; a flat pedestal; a centred beam tail at four beam widths): **0 of
20 000** for every geometry carrying at least 9 samples per rect (worst 99.9th
percentile of the statistic 5.1), and 0.155 percent for the smallest admissible
geometry, four 2x2 boxes. Sensitivity on a 64 px frame with 8x6 corner boxes
and sigma 10 noise: a 1 count/px ramp always fires, 0.5 counts/px about 65
percent of the time, 0.25 counts/px stays silent. The repository ramp fixture
(8 counts/px) reaches 73.8. Unavailability is typed rather than guessed:
`too-few-rects` (fewer than `BACKGROUND_GRADIENT_MIN_RECTS = 3`),
`collinear-rects`, `no-in-rect-scatter` (fewer than
`BACKGROUND_GRADIENT_MIN_POOLED_DEVIATIONS = 4` deviations, e.g. a reference
made only of single pixels).

On the misuse scene the warning list gains exactly one entry, in second place
(it is emitted from the warnings module in background order, before the moments
block); the other seven codes and their order are unchanged.

#### 13.4.5 `sigma_B` parity between the API and the workbench

A rectangle-based background without an explicit `backgroundSigmaRects` used to
fall back to the ROI rim frame for `sigma_B`, so the API and the workbench
reported different noise for the same picture. Rect-based backgrounds now
supply their own reference on both paths: `sigmaCounts`, `sampleCount`,
`scaleSource`, `scaleCorrection` and the whole warning list are asserted equal
for both `robust-plane` and `rect-median`. An explicit `sigma_B` reference still
wins (and takes no deflation correction — those pixels did not carry the plane
fit); the rim frame remains the fallback for the rect-free methods and is
measurably different on a tilted background.

**Moved `sigma_B` ledger.** Wherever a released number rests on a rect-based
`sigma_B`, the reported noise now carries `c(n)`. The pre-existing oracle at
`tests/unit/image-analyze.test.ts` ("S18a sigma_B is measured on the corrected
field") is re-pinned accordingly: it now asserts `sampleCount = 576` (four 12x12
boxes), `scaleCorrection = 576/(576 - 2.4)` and
`noise.sigmaCounts = onCorrected.sigmaCounts * correction` instead of raw
equality. The release curves are structurally immune (the curve oracle hands
`sigma_B` to `assessAperture` directly), which was verified rather than assumed.

### 13.5 Gate ceilings re-anchored against the stage-B peak

Both ceilings built from a peak — the peak arm of the residual RMS ceiling and
the multi-peak candidate floor — used to read the RAW maximum of the corrected
ROI. They now read a stage-B peak (fitted background removed) through a
sigma-aware robust arm. The change is deliberate and operator-visible; every
moved verdict is pinned with its before/after value in
`tests/repro-s20/s20-gate-interactions.test.ts`.

**Offset-invariance ladder** (260x200, sigma 11x6 amplitude 1000, secondary
lobe 60 px away, `sigma_B` = 1, background method `none` so the offset survives
into the corrected field; offsets 0 / 100 / 250 / 500 / 1000 / 2000):

| quantity | before | after |
| --- | --- | --- |
| candidate floor | 99.93 / 109.93 / 124.93 / 149.93 / 199.93 / 299.93 — tracks the offset one for one | **98.90 at every offset** |
| significant peaks | 2 / 2 / 2 / 1 / 1 / 1 | 2 at every offset |
| verdict | `residual_high` x5, then `alpha_inconsistent` at offset 2000 | `residual_high` x6 |
| verdict flips across offset (5 lobe amplitudes) | 3 of 5 flipped between offset 0 and 1000 | **0 of 5** |
| lobe amplitude 100 at offset 0 | 1 peak, not detected | 2 peaks, detected |

**Hot-pixel ladder** (flat-topped beam, amplitude 1000, `sigma_B` = 1, one hot
pixel far outside the beam at 0 / 4000 / 4500 / 5000 / 100000 counts):

| quantity | before | after |
| --- | --- | --- |
| residual ceiling | 5.007 / 20 / 22.5 / 25 / 500 | **5.011 / 5.010 / 5.010 / 5.010 / 5.002** |
| residual verdict | true / true / false / false / false | true at every level |
| candidate floor | 100.13 / 400 / 450 / 500 / 10000 | 100.21 / 100.21 / 100.21 / 100.21 / 100.05 |
| frame verdict | `residual_high`, `residual_high`, `alpha_inconsistent`, `alpha_inconsistent`, **RELEASED** | `residual_high` at every level |

The outright release at 100 000 counts — a whole frame released on the strength
of one pixel — is gone, and the ceiling is now stable across four orders of
magnitude of spike amplitude instead of moving by a factor 100.

**`MEDIAN_PEAK_MIN_SIGMA = 2.5`.** At or above this fitted minor sigma the
robust peak is the maximum of the 3x3-median-filtered corrected field minus the
fitted background; below it the 3x3 median destroys the peak of the beam itself
rather than an outlier, so the ceilings take the deterministic MODEL peak
(`A + B_fit`, which in stage-B reference is exactly the fitted amplitude). The
fallback is explicit in both directions — there is no silent path back to the
raw maximum — and a window with fewer than `MEDIAN_PEAK_MIN_WINDOW_SAMPLES = 3`
finite samples contributes no candidate, so a lone hot pixel can never carry its
own median.

The closed form for a circular Gaussian of sigma s centred on a pixel makes the
3x3 median exactly `A * exp(-1/(2 s^2))`; a sub-pixel centre roughly doubles the
under-read. Measured (128x128, A = 10 000, noise-free): -39.3 / -19.9 / -11.8 /
-7.7 / -5.4 / -3.1 / -1.4 / -0.4 percent at sigma 1 / 1.5 / 2 / 2.5 / 3 / 4 / 6
/ 11 on an integer centre, and -63.6 / -36.2 / -22.3 / -14.9 / -10.6 / -6.1 /
-2.8 / -0.8 on a (0.37, -0.38) sub-pixel centre.

The admissible window was bracketed by two MEASURED verdict flips rather than by
the size of the under-read (campaign: constant swept over {0, 2, 2.5, 3, 4,
no-median}):

- **lower bound** — a sigma 2.5 beam carrying a genuine residual of 47.3 counts
  against an honest ceiling of 50.0 is FALSELY suppressed as `residual_high` at
  constant 2 (median arm, ceiling 42.5) and releases at 2.5 (model arm, ceiling
  50.0). At constant 0 the same false suppression reaches sigma 1 (ceiling 18.2
  against an honest 50.0): an always-median rule suppresses narrow beams for
  model error they are entitled to carry.
- **upper bound** — the flat-top scene at half width 6 (fitted minor sigma
  3.042) carries a genuine residual rms of 5.217 against the honest median-arm
  ceiling of 4.897 and is correctly suppressed at every constant up to 3. At 4
  it takes the model arm, the ceiling rises to 5.873 and the frame RELEASES: a
  real model failure goes out unflagged.

The window is therefore **(2, 3.04]**, and the value sits at its lower end
because that side's failure mode is a conservative suppression (measured not to
occur anywhere in the campaign) while the other side's is a missed release. 2.5
keeps roughly 20 percent margin to the upper bound; 3 would keep 1.4 percent.
Deliberately accepted knife edge: a NOMINAL sigma 2.5 beam fits a minor sigma
either side of 2.5 depending on its sub-pixel phase and can take either arm; the
two ceilings differ by 7.7 percent there and no verdict in the campaign turns on
it.

**Named limit — a spike that captures the FIT.** The arm is chosen from the
FITTED geometry, so a pixel bright enough to capture the fit itself drives the
fitted minor sigma below the constant, and the model arm then inherits that
pixel's amplitude — the robust arm never gets to run. Pinned witness
(`tests/unit/image-aperture.test.ts`, "S20 stage F: a spike that captures the
FIT takes the model arm with it"): 64x64, a sigma 1 Gaussian of amplitude 1000,
a single 3000-count spike at (5, 5), `sigma_B` = 1. The fit converges ON the
spike (centre (5, 5), fitted minor sigma 0.1049, fitted amplitude 2998.5), so
the residual ceiling reads 14.9923 where the beam's own honest ceiling is 5.0 —
three times too high, on one pixel. The frame is still SUPPRESSED
(`residual_high`, rms 27.65), and a spike sweep found no defect-driven release
anywhere in this regime, so the limit costs an inflated ceiling NUMBER, not a
wrong release. The earlier flat-top scene does not witness it: at a 100 000-count
hot pixel it keeps a fitted minor sigma of 15.208 and stays on the median arm,
which is why the hot-pixel fix holds there.

**Orientation stability on a calibrated frame (F7).** `IMAGE_ORIENTATION_UNSTABLE`
now tests the PHYSICAL covariance whenever a pixel-pitch calibration exists, and
the message quotes the number it tested. Measured on a 12 x 6 px ellipse: the
pixel contrast is 0.602 — "a perfectly well determined major axis" — while at a
2 / 4 um pitch the same beam is physically round and its physical contrast is
0.00367, so the warning fires and quotes 0.0037. The uncalibrated path is
unchanged (0.602, silent, `orientationContrastQPhysical` undefined). **Square
pitch is the identity check that makes this a pure anisotropy fix**: a square
pitch scales both covariance axes by the same factor, so the physical contrast
equals the pixel one EXACTLY (asserted as strict equality at 5.2 / 5.2 um) and
the verdict is the same as without a calibration; a physically round beam on a
square pitch still fires with the unchanged pixel wording.
`orientationContrastQPhysical` and `fits.gauss2d.geometryReleasable` are
exported additively.

### 13.6 Decoder and suggestion stages

#### 13.6.1 TIFF tag semantics

`PhotometricInterpretation = 0` (WhiteIsZero) and `Orientation` (tag 274) with
any value other than 1 now produce precise decode errors instead of silently
misinterpreted frames. WhiteIsZero needs an inversion this decoder deliberately
does not perform — reading it as BlackIsZero would invert every downstream
reading instead of failing visibly — and a non-identity orientation describes a
rotation or flip the decoder does not apply, which would silently swap the axes.
Tag 274 is type-validated (SHORT) and count-validated (exactly 1). Photometric 1
and an absent orientation tag decode byte-identically; a stop-and-report
pre-check dumped the binary IFDs of every repository fixture and found none
affected. Six additive decoder tests, each with fail-before evidence.

#### 13.6.2 The LM wedge guard, and a corrected reachability verdict

Arm 1 of the wedge exit certified a minimum from the relative COST improvement
of the last accepted step alone, never asking whether that step had also been
SMALL. It now additionally requires the last accepted relative parameter step to
be at most `WEDGE_PARAM_REL_TOLERANCE = 1e-3` — 10x above the largest step
measured on a cost-arm certification anywhere in the adversarial scene sweep
(1.04e-4) and 15x below a step that matters (1.56e-2).

**REACHABILITY CORRECTION.** The plan recorded this defect as unreachable, on
the strength of a 618-scene sweep in which no certification carried a large
parameter step **[campaign]**. That verdict was wrong: the sweep contained no
saturated or clipped plateaus. The witness (`tests/unit/image-fit.test.ts`,
"S20 D2: a wedge reached after a large accepted parameter step is not certified
converged") is 128x128, a circular Gaussian of sigma 22 hard-clipped at 300
counts so that 22.4 percent of the frame sits on the clip.

What that witness ASSERTS **[oracle]**: the fit still lands on the constructed
wedge point (`sigmaMajor` 35.86067578086578 to 1e-9 relative,
`backgroundCounts` -69.59110781661418 to 1e-6), the wedge stop is NOT certified
(`converged === false`, `status !== "converged"`), and the residual rms is a
real fraction of the data span (`> 0.1 * 300`, i.e. above 30 counts).

What it RECORDS in its comment **[campaign]** — the engine-internal quantities
that diagnose WHY, none of which the fit exports: the wedge is reached at
iteration 29; the cost arm was the ONLY arm that fired (last accepted relative
cost improvement 4.578e-13) while the last accepted relative PARAMETER step was
1.982e-2, twenty times the guard and 190 times the corpus maximum; at that point
the residual rms is 31.64 counts against a data span of 300.08, and the fitted
background of -69.6 sits on data whose floor is -0.08. The assertions above are
what a regression would have to break; these are what a reader needs to see that
the certification was not harmless.

So the guard is a real correction, not a free tightening — and the class it
corrects is exactly the one the earlier sweep lacked.

Behaviour elsewhere is unchanged: the parameters at the wedge point are
bit-identical, which is why they are pinned — the non-certification is the guard
speaking and not trajectory drift — and only the verdict moves. The 86-scene
status digest of `tests/repro-s20/s20-fit-wedge.test.ts` is unchanged
(53 converged / 28 `max_iterations` / 5 `singular_normal_equations`)
**[oracle]**, and an independent 2724-case pre/post sweep found 0 differences
**[campaign]**. Which uncertified
status the plateau reports is deliberately NOT pinned: an uncertified wedge stop
reports `singular_normal_equations` (section 11.3) and an exhausted budget
reports `max_iterations`, and either is honest there.

#### 13.6.3 The suggested ROI is no longer a dead end

The suggestion was the bounding box of the 4-`sigma_B` mask plus a FIXED 8 px
border, while the clipping gate requires the whole 6-sigma check ellipse to fit
inside the ROI. A constant border against an aperture that grows with the beam
made the suggestion a fixed point that was not a solution: applying it turned a
releasing frame into `aperture_clipped`, and the suggestion computed inside that
ROI reproduced itself. The padding is now derived from the mask per axis by
inverting the Gaussian profile, using a robust component peak (finite-only 3x3
median, so a hot pixel welded to the beam cannot shrink the pad), with a floor
on the mask extent itself.

| effect | before | after |
| --- | --- | --- |
| noisy apply corpus | 15/15 `aperture_clipped` | **0/15** — all 15 release |
| sigma 3, dynamic range at which the series releases | between 1500 and 3000 | from **100** |
| sigma 10, dynamic range at which the series releases | 1e7 | from **1e3** |
| the suggestion's fixed point | a clipped one | a releasing one (clicking again changes nothing because nothing needs changing) |

`SUGGESTED_ROI_PAD_MASK_FLOOR` (beta) **= 2.0**, calibrated against the
non-Gaussian family at A/sigma_B = 1e4 — the smallest floor at which the 6-sigma
check ellipse fits the suggested rectangle: 0 for a true Gaussian (the aperture
term already serves it), 1.5 for super-Gauss n = 2 and a 6 px tanh-edged flat
top, 2.0 for super-Gauss n = 4 and a 3 px tanh-edged flat top, 2.5 for
super-Gauss n = 8, 3.0 for a discontinuous-edge flat top, and unreachable for a
ring. The plan's candidate of 0.5 is refuted by that column. 2.0 is the smallest
value serving both super-Gauss orders the plan names and a physically realizable
flat top; the three rows below it are profiles whose Gaussian fit is not a
description of the beam at all (they are suppressed as `residual_high` or
`fit_not_converged` at every floor, and the sigma those fits report is a model
artefact — the ring "fits" a sigma larger than its own lit radius). **The ring
stays a documented limit**: no mask-derived padding can serve a criterion built
on such a number, and the instrument for it is the named backlog item that
re-derives the suggestion from the fit.

Cost of the floor on a true Gaussian: it overtakes the aperture term from
A/sigma_B about 91 upwards and lifts the suggested half side to 9.97 sigma at
A/sigma_B 1e3 and 11.87 sigma at 1e4, against the 7.5 sigma the aperture term
aims at. Over-padding is the safe direction, and the widest row of the apply
corpus (sigma 25 at A/sigma_B 1e3) lands at 510 px of a 512 px frame without
clamping. Three guards fall back to the fixed base border instead of inverting
(zero threshold, peak-to-threshold ratio at or below `sqrt(e)`, degenerate
estimate), and a threshold that overflows to infinity yields no suggestion at
all rather than a fallback rectangle — arithmetic rather than a special case,
since a product above the largest representable value is above every
representable pixel value too.

**Adjudication of the one moved released number.** In the sigma-3 series the
row at A/sigma_B = 3000 released before the change as well, and its released d4
moved 11.989 -> 11.991. That is not the suggestion changing a measurement: for
any FIXED ROI every released number is bit-identical, which the rest of the
suite pins. It is the operator being handed a different rectangle, and the
number measured inside the wider one sits CLOSER to this scene's analytic
4*sigma = 12.000, not further from it. Advisory purity is asserted separately.

### 13.7 Residual notes, recorded rather than fixed

| # | note | status |
| --- | --- | --- |
| 1 | **Rank-1 button edge (UI).** `roiFromFitEligible` accepts a released stage-B on validity alone, while the derivation additionally requires finite d4 widths and a finite centroid. A rank-1 released geometry would therefore render the button and derive nothing — present but inert. Pre-existing, unchanged by the guard stage, and not reachable through the real analyzer: revision 9.9 (a) closed the one path that could release a line-degenerate geometry (headline `d4SigmaMinorPx` of exactly 0), so a released stage-B now carries positive finite widths, and the inert state can only be produced by constructing the result object by hand. | recorded, no code change |
| 2 | **Legend overlap (UI).** With the four-corner background preset no canvas corner is empty, so the auto-relocating legend overlaps about 57 percent of the bottom-right rectangle's edge band — that figure, and the three-viewport check it came from, are **[session record]**: measured in the stage cross-check session against the build of the time, and not re-runnable from this repository. What IS runnable is the per-rect edge-band visibility oracle **[oracle]**, which passes because every rectangle keeps saturated marker pixels and which would catch a reintroduction of the invisible-rectangle defect. Backlog candidate: move the legend outside the canvas. | recorded, backlog |
| 3 | **Near-full-frame no-move rule scoped to the ROI.** The rule that refuses a move gesture on a rectangle covering at least 98 percent of the frame is now ROI-only, so near-full-frame BACKGROUND rectangles stay movable. Deliberate: a background rectangle that large is a legitimate reference the operator must still be able to drag. | intentional, documented here |
| 4 | **Structural edit in a shared file.** The dark-frame lane stage made a structural edit to the image view module, which the lane rules reserved for the overlay stage. Formal tension only: the stages sharing that file did not edit it structurally at the same time, and the overlay stage had not started. | recorded, no consequence |
| 5 | **`sigma_B` source change for API callers.** A caller that passes rectangle backgrounds without an explicit `sigma_B` reference now reads the noise scale from those rectangles instead of the ROI rim frame. Same picture, different number than the previous release — deliberate parity with the workbench, listed here because it is operator-visible on the API path. | intentional behaviour change |
| 6 | **Fit fragility on a 51x51 ROI.** A converged-quality fit was observed reporting `singular_normal_equations` on a 51x51 ROI while its recovered parameters were exact. Reproduced independently of the padding change (it is not caused by it). No oracle in this release — it has no pinned witness yet, which is stated here rather than implied. | named backlog |
| 7 | **Release contract unchanged where the alpha ceiling is wide.** The uncapped self-calibrated ceiling still releases the core-plus-halo family at high `sigma_B`; the mitigation shipped is visibility (13.3.1), not a gate. A hard death limit on the ceiling was considered and deferred, because the measured bands (13.3.1) show it cannot separate the pathological scene from a legitimate low-SNR one. | deferred by decision |

### 13.8 Documented-limits register after v2.0

Carried forward UNCHANGED from sections 10-12 (none of them was addressed by
this pass, and none was made worse by it):

| from | limit |
| --- | --- |
| 10 | The default 64-bin radial grid resolves a sigma-2 beam's 50 percent radius only to the bin-1 width (about 12 percent high against pixel-sorted ground truth). Resolution limit of the diagnostic; adaptive bin count is a later candidate. |
| 10 | The N = 32 threshold estimator carries about 15 percent CV, so a per-image threshold sits below the true p95 in roughly a quarter of images at that budget — the documented cost of revision 9.9. |
| 10 | The compact-ROI noise warning triggers on 6x `sigmaMinor` only, so a needle beam whose MAJOR axis contaminates the rim is not flagged by that arm. |
| 11 | The noise-inversion wing scene cannot honestly be caught: at SNR 20 the wing is a 1 to 1.7 sigma effect against the image's own noise, and firing there would be firing on noise. What speaks for it is the width-scatter instrument. |
| 11 | `flatFractionOfBeamPower` is exported as a measurement and deliberately does not trigger (18/74 on clean released scenes — a flat residual level produces the same number as an absorbed wing). |
| 11 | `IMAGE_TIER_DISAGREEMENT` carries 1/74 false positives on the clean reference set, and `IMAGE_WIDTH_SCATTER` speaks on 8/74 — all of the latter on the single marginal geometry, where the uncertainty is real. |
| 12 | `absorbedPower.high` can be true on a frame an earlier gate already suppressed; the warning is correctly withheld because nothing was released, and consumers must read `suppressionReason` alongside the block — the same reading rule as every `gates` field. |

Added by v2.0:

| # | limit |
| --- | --- |
| 1 | The coverage estimator is blind to a mask that thins the support uniformly (measured -0.008 percent on a "keep every twelfth pixel" pattern); the finite-fraction floor is the arm that covers it, and it is a floor rather than a discriminator. |
| 2 | The coverage gate costs 3.26 percent of the benign masked frames at realistic dead fractions their release, and 4.17 percent of the well-resolved ones **[campaign]**; 93.7 percent of the flagged rows are confirmed off by more than 2 percent by their own released width **[campaign]**. Both figures come from the stage-A calibration campaign and are recorded in the `COVERAGE_BIAS_MAX_PERCENT` comment; neither is asserted by a test. The remainder is the price of a ceiling with a documented separation rather than a knife edge. |
| 3 | A pixel bright enough to capture the FIT drives the ceiling arm selection with it, inflating the residual ceiling about threefold on the pinned witness. Costs a ceiling number, not a release (13.5). |
| 4 | Mask-derived ROI padding cannot serve profiles whose Gaussian fit is not a description of the beam (ring, discontinuous-edge flat top). Those frames are suppressed honestly by the gates; the suggestion for them is a named backlog item (13.6.3). |
| 5 | The alpha-consistency ceiling remains uncapped; `IMAGE_ALPHA_GATE_WEAK` states when it was wide, and its family bands are amplitude dependent (13.3.1). |
| 6 | The four-cell release curve is a per-seed-base measurement with a two-count spread; it is documented as a band (13.1). |
| 7 | The repro corpus's scene generator has a first-draw seed band that biases any reference rectangle containing pixel (0, 0). The affected anchor is pinned with its provenance and the generator is deliberately untouched (13.4.1). |
| 8 | The 51x51 fit fragility of 13.7 note 6 has no pinned witness in this release. |

### 13.9 Cross-platform bit determinism (release 2.0.0 follow-up) [session record]

Measured on the identical engine state and bit-identical inputs (input-buffer digests equal), Windows 11 x64 vs Linux x64, same JS runtime version (v24.14.0):

- `Math.pow(x, n)` returns different last bits between the two OSes (200k-sample digest differs), while `exp`, `log`, `sin`, `cos`, `sqrt`, `atan2`, `hypot` and the composition `exp(n*log(x))` are bit-identical on the same sample. The runtime resolves `pow` through the platform math library.
- Consequence in the analyzer: of all result sections only `fits` (iterative 2D fit; `pow` in the super-Gaussian model and its Jacobian) and the fit-derived `metrics` entries move, at relative 1e-12..1e-11 (witness: clean 96x96 case, `backgroundCounts` 1.602851930456622e-8 vs 1.6028519305781742e-8; `relativeRmsReduction` differs from the 12th digit). `raw`, `background`, `noise`, `roi`, `stability`, `momentsRoiDiagnostic`, `moments`, `aperture`, `tierCheck`, `residuals`, `profiles`, `warnings` are bit-identical across the OSes. No released rounded number moves; release decisions are unaffected.
- Consequence for oracles: the five S21 absence-regression digests are platform-scoped and pinned per platform (win32 and linux columns, both measured); the headless/case suites compare platform-robust values and pass on both OSes unchanged.
- Backlog (v2.1): a `pow`-free fit formulation (`exp(n*log(E))`, measured bit-stable across OSes) would make the whole result object cross-platform bit-identical; deferred because it re-times every pinned digest for a last-bit gain.

// Central, documented defaults for the image analyzer (S18a subset).
// Every trigger the analyzer uses lives here so the docs, the UI and the
// reference cases pin the same numbers (Plan v5 §7).

// Metadata passthrough (TIFF ImageDescription / OME-XML): sanitized text is
// capped at this many characters for BOTH display and export.
export const METADATA_CAP_CHARS = 4096;

// Hard pixel cap for decoded images (Plan v5: 4096 x 4096). Larger images are
// blocked honestly at decode time instead of risking allocation failures.
export const MAX_DECODE_PIXELS = 4096 * 4096;

// Suggested-ROI proposal: threshold factor k over the background noise scale
// (mask = corrected > k * sigma) and the padding added around the connected
// peak region's bounding box. Both are documented analyzer defaults.
// Section 2: SUGGESTED_ROI_K is a suggested-ROI constant only again; the
// stage-B multi-peak gate uses its own self-calibrated extreme-value
// threshold (see MULTI_PEAK_EVT_MARGIN).
export const SUGGESTED_ROI_K = 4;
export const SUGGESTED_ROI_PADDING_PX = 8;

// Suggested-ROI noise-suspect hook (S18b): when sigmaCounts is exactly 0 the
// threshold is 0 and noisy corrected data can mask on across most of the
// frame. A mask covering more than this fraction of the image is flagged for
// the UI; it is a warning hook, not a rejection.
export const SUGGESTED_ROI_NOISE_SUSPECT_FRACTION = 0.25;

// ROI stability sweep: window size factors and the relative centre-shift
// fraction (of the window extent per axis) used for the shift variants.
export const ROI_SWEEP_SIZE_FACTORS = [0.8, 0.9, 1.0, 1.1, 1.2] as const;
export const ROI_SWEEP_SHIFT_FRACTION = 0.05;

// Raw-image diagnostics.
export const HISTOGRAM_BIN_COUNT = 256;
// Hot-pixel candidate: value exceeds the max of its 4-neighbours by more than
// HOT_PIXEL_K * robust sigma (1.4826*MAD). Spikes only — a smooth beam never
// clears the neighbour comparison.
export const HOT_PIXEL_K = 8;
// Local maxima are counted when they exceed median + LOCAL_MAX_K * robust sigma.
export const LOCAL_MAX_K = 5;
// The border ring "touches" the profile when its maximum rises above this
// fraction of the finite dynamic range over the minimum.
export const EDGE_TOUCH_FRACTION = 0.1;
// Exact median/MAD up to this many finite samples; above, a deterministic
// stride subsample of at most this size is used (documented approximation).
export const ROBUST_STATS_MAX_EXACT = 1 << 20;

// Stage-B aperture-moments pipeline (S18d-B, Plan v5 section 4).
// The stage-B ellipse-moment aperture has semi axes alpha * sigmaMajorPx and
// alpha * sigmaMinorPx around the 2D-Gauss fit centre. At the default alpha
// the second-moment truncation factor of a pure Gaussian is the 0.9986568
// factor pinned by the moments oracle (aperture radius 4 sigma).
export const APERTURE_ALPHA_DEFAULT = 4;
// Fixed second aperture pass of the alpha-consistency gate: the d4 sigma of
// the alpha pass is compared against the d4 sigma of a 6-sigma pass.
export const APERTURE_ALPHA_CHECK = 6;
// Per-axis FLOOR of the alpha-consistency gate. With the S18 self-
// calibrating gate the per-image ceiling is max(3, ALPHA_MC_K * null rms);
// this constant is the hard floor, so the gate is never stricter than the
// noise-free design. The noise-free discriminant figures previously quoted
// here (two-lobe ~37, core+halo ~10, super-gauss n<1 ~3.6) were re-measured
// and do NOT hold in the fitted-aperture geometry. Measured reality:
// two-lobe deltas grow smoothly 0.7 -> ~10 % up to 4-sigma separation, then
// jump to ~39 % once the single-Gauss fit locks onto one lobe (~5 sigma;
// wider separations mostly fail fit convergence, an earlier suppression
// path); core+halo at 1 % amplitude / 4x width is ~14 %, scale-invariant;
// super-gauss n=0.8 is 0.1-1.3 % and is NOT an alpha discriminant against
// fitted sigmas (the fit absorbs the width, only n <= 0.6 becomes testable
// at 3.8-8.2 %).
export const ALPHA_CONSISTENCY_MAX_PERCENT = 3;

// --- S18 gate self-calibration constants (S18_GATE_CALIBRATION_SPEC) ------

// Alpha-consistency Monte Carlo null: N realizations of the frozen fitted
// geometry plus N(0, sigmaB) noise show what a perfect-Gauss image of this
// size would do; the per-axis threshold is then
// max(3, ALPHA_MC_K * null rms). 64 realizations give rms relStd ~11 %
// (16 -> 20 %, 32 -> 16 %, 64 -> 11 %, 128 -> 8 %, diminishing returns).
export const ALPHA_MC_REALIZATIONS = 64;
// Scale factor between the null rms and the per-axis threshold; sits between
// the half-normal p95/rms ~1.96 and p99/rms ~2.58.
export const ALPHA_MC_K = 2.2;
// Below this many valid realizations the gate fails closed: inconsistent.
export const ALPHA_MC_MIN_VALID = 32;
// Fixed literal seeds for the per-realization mulberry32 streams. Never
// image-derived: identical (params, sigmaB, ROI) give bit-identical
// thresholds.
export const ALPHA_MC_SEED = 0xa1fa5eed;
export const ALPHA_MC_SEED_STRIDE = 0x9e3779b1;
// Power-of-two decimation targets a decimated major sigma near this value.
export const ALPHA_MC_TARGET_DEC_SIGMA_PX = 10;
// Minor-axis decimation guard: the decimated minor sigma never drops below
// this many pixels.
export const ALPHA_MC_MIN_DEC_SIGMA_PX = 1.5;
// Runtime budget of the alpha-MC null (revision 9.9), counted in TOTAL
// EVALUATED PIXELS: local grid pixels x realizations. The realization count
// is reduced adaptively from ALPHA_MC_REALIZATIONS down to the
// ALPHA_MC_MIN_VALID floor to fit this budget; the decimation factor - and
// with it the 1.5 px minor-axis guard - is NEVER touched to buy runtime.
// The superseded revision-9.5 rule budgeted grid pixels alone and doubled b
// past the guard, which decimated the minor axis below the documented floor
// and detuned the minor-axis threshold by a geometry-dependent factor
// (measured 0.948x at sigma 80x5 / 45 deg, 1.229x at 100x4 / 45 deg, and
// ~40x at 600x4 / 45 deg, where the minor null rms reached 100 percent and
// the minor arm was effectively off).
// 2^23 = 8388608 holds the whole MC to a measured 303 ms worst case (32.6-
// 36.1 ms per million evaluated pixels, worst budgeted geometry sigma 99x3 at
// 45 deg), keeps every geometry the old grid cap never touched bit-identical
// (any grid <= 32768 px still affords the full 64 realizations), and still
// calibrates rotated needles up to an aspect ratio near 40. Doubling it to
// 2^24 buys aspect ratio 56 for a measured 547 ms, past the 500 ms budget
// target. A local grid larger than ALPHA_MC_MAX_TOTAL_GRID_PIXELS /
// ALPHA_MC_MIN_VALID = 262144 px cannot afford the minimum realization count
// and fails the gate closed instead of silently running a miscalibrated null
// (revision 9.9 endgame).
export const ALPHA_MC_MAX_TOTAL_GRID_PIXELS = 8388608;
// Multi-peak extreme-value margin, added to sqrt(2 ln M) where M is the
// scanned ROI pixel count. Keeps the pure-noise false-peak rate below the
// 1 % target with wide reserve while preserving genuine-satellite
// sensitivity; never tune below 0.3.
export const MULTI_PEAK_EVT_MARGIN = 0.5;
// Negative-power adaptive warning: the firing ratio is backed by this margin
// over the expected zero-mean null ratio (S18 section 4.1).
export const NEGATIVE_POWER_NULL_MARGIN = 1.2;
// ROI-sensitivity adaptive noise floor: the major-axis half-spread threshold
// is raised to this many percent per unit peakToBackgroundNoise when the
// noise scale is finite (S18 section 4.2).
export const ROI_SENSITIVE_NOISE_K = 8;

// Model-residual RMS ceiling, noise arm: the full-resolution Gaussian-model
// RMS over the ROI is high above 2 * sigmaB. The peak-relative arm below
// replaces the v4 5-percent-of-peak rule (R4/P4-H2): a pure-noise beam at
// SNR 20 has rms ~ peak/20, which the old threshold would have flagged.
export const RESIDUAL_RMS_SIGMA_FACTOR = 2;
export const RESIDUAL_RMS_PEAK_FRACTION = 0.005;
// Multi-peak gate (M-4 wiring): significant strict 8-neighbour local maxima
// must be pairwise separated by this factor times w_est = 2 * sigmaMajorPx
// before they count as two genuinely distinct beams.
export const MULTI_PEAK_SEPARATION_WIDTH_FACTOR = 2;
// Candidate threshold of the multi-peak gate (S18 self-calibrated): a local
// maximum counts above max(sigmaB * (sqrt(2 ln M) + MULTI_PEAK_EVT_MARGIN),
// MULTI_PEAK_MIN_PEAK_FRACTION * peakCorr) with M the scanned ROI pixel
// count. The sigmaB arm tracks the expected maximum of M iid N(0, sigmaB)
// samples; the peak-relative floor keeps the gate alive when sigmaB = 0 so
// benign flank noise on a single beam cannot saturate the count.
export const MULTI_PEAK_MIN_PEAK_FRACTION = 0.1;
// Pedestal hint (operator-tunable default): the mean corrected intensity
// outside the aperture ellipse relative to the corrected peak raises the hint
// above this fraction (R4 series: a 1 percent pedestal biases D4sigma by
// +10.4 percent).
export const PEDESTAL_HINT_FRACTION = 0.005;

// --- S18-R2 final-review honesty instruments (spec section 11) ------------

// F1 (a) ABSORBED-POWER wing detector. The triggering statistic is the
// APERTURE EXCESS: the residual (data minus the full fitted model) summed over
// a concentric ellipse probe, as a fraction of the fitted Gaussian's analytic
// power. Ceiling: max(MIN_FRACTION, NOISE_K * sigmaB *
// sqrt(aperturePixelCount) / modelPower).
//
// Calibration (measured, spec section 11):
// - The noise arm is the exact scatter a residual SUM inherits from the data
//   (sigmaB * sqrt(n) over n pixels), so the ratio |statistic| / noise-arm is
//   a standard normal deviate by construction.
// - The plain flat-background variant of this statistic (fitB * roiPixelCount
//   / beamPower) was measured first and REJECTED as a trigger: it fires on
//   24 percent of clean released reference scenes, because a background stage
//   that lands one count off produces the same number as an absorbed wing
//   while stage B is immune to the flat part by construction. It stays
//   exported as a measurement.
// - The 0.3 percent floor covers the sigmaB = 0 case where the noise arm is
//   exactly 0: noise-free clean scenes measure 0.000 percent (the fit is
//   exact, at any probe radius) against the noise-free wing scene's 0.54
//   percent at the 6 sigma probe and 1.73 percent at the 12 sigma one.
// - Probe radii, in fitted sigmas: the most informative radius depends on how
//   much wider the wing is than the core, which is the unknown. Measured
//   standardized excess for a wing 8x the core width: 3.0 at 6 sigma, 4.9 at
//   12 sigma; for a wing 4x the core width: 1.9 at 6 sigma, 0.6 at 12 sigma.
//   The 4 and 6 sigma probes are the release and check apertures themselves,
//   so any released frame always has at least two probes.
// - K = 3 (not the usual 2 or 2.5) pays for the multiplicity of up to four
//   nested probes; the probes are strongly correlated (nested sums), so the
//   effective number of independent tests is well below four. Measured false
//   positives over 74 clean released reference scenes: 0.
//
// S20 stage B (honesty floor), MEASURED REVISION of the floor: 0.003 -> 0.0005.
// The 0.3 percent floor was set against the wing scene AT ITS WIDEST PROBE
// (1.73 percent at 12 sigma). It silently stopped being the right number the
// moment the probe reach shrank: the same wing scene measures 0.1792 /
// 0.1265 / 0.0735 percent at ROI 140 / 120 / 100, where only the 6 sigma probe
// still fits, and all three sat UNDER the floor - the tightest of them with an
// entirely empty warning list. The floor arm only ever binds where the noise
// arm cannot: NOISE-FREE and very-low-noise frames, on which an exact fit
// measures exactly 0.000000 percent at every probe radius.
//
// False-positive budget, measured on the CANONICAL clean reference set of the
// gate-calibration spec section 11 - the 74 released scenes of 111, rebuilt
// and pinned in tests/repro-s20/s20-clean-reference-set.test.ts:
//   X = 0/74 false fires at the lowered floor (and 0/74 at the old 0.003 one)
//   worst clean row reaches 0.611 of its own ceiling, and that ceiling is the
//     NOISE arm, so the floor change did not spend that margin
//   exactly 6 of the 74 rows are floor-bound at all - the noise-free controls,
//     where an exact fit measures |excess| <= 2.3e-7 percent
// Two further populations agree: 0/104 on a high-amplitude variant of the same
// structure, and 0/192 on the noise-free sigma sweep sigma in
// {1, 1.5, 2, 3, 6, 11} x sub-pixel phases x round/2:1 elliptical, whose worst
// |excess| is 6.9e-7 percent against the 0.05 percent floor - a factor 72 000.
// The wing rows the change is FOR clear the new floor by 1.47x / 2.53x / 3.58x
// (0.0735 / 0.1265 / 0.1792 percent measured at ROI 100 / 120 / 140, all three
// silent under the old floor).
export const ABSORBED_POWER_PROBE_ALPHAS = [4, 6, 9, 12] as const;
export const ABSORBED_POWER_MIN_FRACTION = 0.0005;
export const ABSORBED_POWER_NOISE_K = 3;

// F1 (b) CROSS-TIER disagreement. The statistic is the per-axis relative gap
// between the stage-A diagnostic d4 and the released stage-B d4, in percent.
// Ceiling per axis: max(MIN_PERCENT, NOISE_K * expected), with the expected
// gap the analytic noise scatter stage-A rect moments inherit from the ROI,
//   50 * sigmaB * sqrt(sum u^4) / (beamPower * sigma_axis^2)
// (the second-moment numerator noise is sigmaB * sqrt(sum u^4) along that
// axis, and d4 scales as the square root of the second moment, hence the
// factor 50 rather than 100).
//
// Calibration (measured, spec section 11): the ratio gap / expected is a
// standard normal deviate by construction and the measurement confirms it, so
// the K is a sigma level and the false-positive rate follows from it over the
// two axes tested. K = 3 leaves all 74 clean released reference scenes silent.
// The floor covers the sigmaB = 0 case, where the expected gap is exactly 0:
// noise-free clean scenes measure 0.11-0.14 percent (pure 4-sigma truncation)
// against the noise-free wing scene's 71.2 percent, so 15 percent sits two
// orders above the clean scenes and far below the attack.
export const TIER_DISAGREEMENT_MIN_PERCENT = 15;
export const TIER_DISAGREEMENT_NOISE_K = 3;

// F2 released-width noise scatter. The alpha-consistency Monte Carlo already
// produces one alpha-pass d4 per realization; their relative sample standard
// deviation is the per-image noise scatter of the released width. A released
// number whose own noise scatter exceeds this many percent is reported.
//
// Calibration (measured over 89 released scenes, spec section 11):
//   well-resolved sigma 11x6 / 8x6 / 12x8 at SNR 100  0.34-0.42 percent
//   the same geometries at SNR 20                     1.43-2.14 percent
//   mid sigma 5x3 at SNR 20                           3.42-4.21 percent
//   marginal sigma 3x1.5 at SNR 20                    6.43-7.60 percent
//   marginal sigma 3x1.5 at SNR 15                    8.17-9.80 percent
// and the true released error tracks it: |error| <= 2 x the exported scatter
// on 96 percent of those scenes (<= 1 x on 80 percent), Pearson r 0.686 /
// Spearman rho 0.741 against |true released error|. The marginal families
// reach true errors of 18 percent, the well-resolved ones stay under 5.2.
// 5 percent sits in the measured gap between the mid and marginal regimes
// (4.21 -> 6.43) and leaves every well-resolved scene silent.
export const WIDTH_SCATTER_WARNING_PERCENT = 5;

// Residual display grid (S18d-C, Plan v5 section 6): each side of the
// displayed residual grid is capped at this many cells. The block size is the
// smallest positive integer b with ceil(roiWidth/b) <= this AND
// ceil(roiHeight/b) <= this. b = 1 reproduces the residual field exactly.
export const RESIDUAL_DISPLAY_MAX_SIZE = 256;

// --- S18e analyzer orchestration constants (Plan v5 section 7) ------------

// Sigma_B reference cascade: when the user supplies no background reference
// rectangles, the noise scale is estimated on the ROI rim frame - the four
// border strips of the ROI whose thickness is this fraction of the shorter
// ROI side, at least 1 px (Plan v5 section 4: user rects, else a documented
// ROI rim frame).
export const SIGMA_REFERENCE_RIM_FRACTION = 0.05;

// Hot-pixel fraction thresholds (fraction of finite pixels flagged as
// hot-pixel candidates): info above the lower fraction, warning above the
// higher one.
export const HOT_PIXELS_INFO_FRACTION = 0.0001;
export const HOT_PIXELS_WARNING_FRACTION = 0.001;

// ROI stability: any metric sensitivity whose half-spread exceeds this many
// percent of the baseline value raises IMAGE_ROI_SENSITIVE.
export const ROI_SENSITIVE_WARNING_PERCENT = 5;

// Orientation quality gate (M-5): an orientation whose contrast q =
// (lambdaMajor - lambdaMinor) / (lambdaMajor + lambdaMinor) sits below this
// is numerically unstable; near-circular beams can rotate their major-axis
// angle by radians with a rounding-level covariance change.
export const ORIENTATION_UNSTABLE_Q_MAX = 0.05;

// Axis resolution (M-5): a released minor-axis sigma below this many pixels
// means the minor axis is not resolved on the pixel grid.
export const AXIS_RESOLUTION_MIN_SIGMA_PX = 1;

// Negative-power honesty indicator: a radial negativePowerRatio above this
// fraction raises IMAGE_NEGATIVE_POWER (imperfect background correction);
// with the S18 adaptive arm this is the floor the adaptive ceiling never
// goes below.
export const NEGATIVE_POWER_INFO_RATIO = 0.02;

// --- S18 final-review fixes (G1-G7) ---------------------------------------

// Edge-touch extreme-value margin (G5): added to
// robustSigma * sqrt(2*ln(rimPixelCount)) to form the noise-aware rim
// threshold, mirroring MULTI_PEAK_EVT_MARGIN's role for the multi-peak gate.
// Without a noise term, EDGE_TOUCH_FRACTION alone let the rim ring's own
// noise maximum trip IMAGE_EDGE_TOUCH on 99.5 percent of clean centred beams
// at SNR 20 (measured, beam edge >= 7 sigma from the border).
export const EDGE_TOUCH_EVT_MARGIN = 0.5;

// Clipped-plateau detection (G6): a sensor that clips below its dtype's full
// range (e.g. a 12-bit sensor's 4095 ceiling stored in uint16, limit 65535)
// never trips the plain saturatedFraction/limit check. IMAGE_CLIPPING_SUSPECT
// fires only when the count of finite pixels tied at the exact maximum
// clears BOTH a small absolute floor and a small fraction of finite pixels
// (a smooth beam's unique-pixel maximum, count 1, never trips either), AND
// the maximum sits below this fraction of the dtype saturation limit (a
// maximum at or near the limit is a proper full-range saturation, already
// covered by IMAGE_SATURATION, and is deliberately excluded so the two
// warnings stay disjoint).
export const CLIPPING_MIN_COUNT = 8;
export const CLIPPING_MIN_FRACTION = 0.001;
export const CLIPPING_MAX_LIMIT_FRACTION = 0.9;

// Pixel-integration width-resolution bias (G7): a released minor-axis sigma
// below this many pixels reads systematically high under pixel-area
// integration (measured +1.02 percent at sigma 2, +2.83 percent at sigma
// 1.2, +4 percent at sigma 1.0 px). Distinct from AXIS_RESOLUTION_MIN_SIGMA_PX
// (1 px, "not resolved at all" - a stronger WARNING-severity statement):
// this is a softer, wider INFO-level heads-up about a quantifiable
// systematic bias that starts well above the 1 px hard limit and can
// coexist with it.
export const WIDTH_RESOLUTION_INFO_SIGMA_PX = 3;

// Radial-distribution noise-dominance (G3): the same expected zero-mean null
// ratio IMAGE_NEGATIVE_POWER uses (roiPixelCount * sigmaB /
// (sqrt(2*pi) * totalPositiveCounts)) also predicts when the encircled-power
// radii themselves are noise-dominated (spurious positive noise power far
// from the beam inflates the tail of the radial distribution, pushing r95
// etc. far past their true values). Calibrated between a dominated case (a
// sigma-6 beam on a 121x121 ROI at SNR 20, r95 measured +368 percent high,
// MUST warn) and a healthy case (a well-contained SNR-100 beam, radii
// measured within ~2 percent, MUST stay silent).
export const RADIAL_NOISE_DOMINATED_RATIO = 0.15;

// --- S20 stage A: aperture coverage of non-finite pixels (additive) --------
//
// Non-finite pixels inside the measurement aperture are skipped by every
// moment accumulation, so the released widths are computed over whatever
// support survived. A RANDOM mask is nearly harmless (it thins the support
// evenly), a STRUCTURED mask is not (it removes one side of the beam and
// moves the second moment bodily). A plain dead-fraction rule cannot separate
// the two, so the discriminator is a MODEL-BIAS ESTIMATOR: the fitted model,
// beam term only, is rasterized over the alpha aperture and its ellipse
// moments are taken twice - once over the full aperture, once with exactly
// the observed non-finite mask. The relative d4 difference is the bias the
// coverage pattern induces.
//
// Calibration campaign (S20 stage A, measured against the live modules with
// the gate held inert so every row could be read at its released value; the
// numbers below are the campaign's, not estimates):
//
// - Benign population, 1920 masked frames: iid random masks over the 6-sigma
//   support at dead fractions 1/5/10/30/50 percent, 12 seeds each, over 32
//   clean released scenes (6 geometries x SNR 100/20, float32 and camera-
//   realistic lanes, plus noise-free, 512-px large-frame and beam-fills-ROI
//   controls). Estimator maximum |bias|, by geometry class:
//       sigma_minor >= 6 (well resolved)   3.639 percent
//       sigma_minor  = 3 (mid)             7.082 percent
//       sigma_minor  = 1.5 (marginal)      8.975 percent
//   The estimator is not wrong there: of the rows a 2 percent ceiling flags,
//   93.7 percent are confirmed off by more than 2 percent by their own
//   released width. An iid random mask at 50 percent really does move a
//   marginal beam's width by 8-12 percent - the "random masks are benign"
//   reading came from a lattice-like mask on one well-resolved geometry.
// - The MANDATORY-RELEASE rows (the lattice random family of the S20 repro
//   corpus, 1/5/10/30/50 percent) measure 0.373 / -0.011 / 0.129 / 0.097 /
//   0.677 percent. The MANDATORY-SUPPRESS rows (dead column +-2/+-5/+-10 px,
//   masked flank beyond 1 and 2 sigma) measure 5.924 / 21.031 / 53.645 /
//   -20.583 / -5.778 percent.
// - COVERAGE_BIAS_MAX_PERCENT = 2.0 sits at the geometric centre of that
//   measured gap: sqrt(0.677 x 5.778) = 1.98. It clears the largest
//   mandatory-release row by 2.95x and sits 2.89x below the smallest
//   mandatory-suppress row. Yield cost measured on the benign population:
//   4.17 percent of the well-resolved frames, 3.26 percent of all frames at
//   realistic dead fractions (<= 10 percent).
// - COVERAGE_MIN_FINITE_FRACTION = 0.2, measured rather than assumed. The
//   masked model-moment pass keeps returning a number down to ~20 finite
//   aperture pixels and only fails at 1, so raw computability is not the
//   binding limit; what binds is that the estimator's own disagreement with
//   the released truth grows as the support thins - measured on a sigma 5x3
//   beam it reaches 2.1-2.3 percentage points around finite fraction 0.2-0.4
//   and 3.2-6.3 points below 0.15. An estimator whose uncertainty matches the
//   2 percent ceiling is no longer a discriminator, and that crossing is the
//   floor. The mandatory-release 50-percent row reaches finite fraction 0.4184
//   at worst over 379 samples, a factor 2.09 above this floor.
// - COVERAGE_LOSS_INFO_PERCENT = 1.0: the grey band under the ceiling. Every
//   mandatory-release row stays below it (largest 0.677, a factor 1.48), so a
//   released frame only speaks when its aperture gaps moved the widths by
//   more than the mandatory-release family ever does.
export const COVERAGE_BIAS_MAX_PERCENT = 2.0;
export const COVERAGE_MIN_FINITE_FRACTION = 0.2;
export const COVERAGE_LOSS_INFO_PERCENT = 1.0;

// --- S20 stage B: honesty floor (additive) --------------------------------
//
// The alpha-consistency ceiling is self-calibrated per image as
// max(ALPHA_CONSISTENCY_MAX_PERCENT, ALPHA_MC_K * null rms) and has NO upper
// bound: the noisier the frame, the wider the window a real width defect can
// walk through untouched. A capped ceiling was measured and rejected - the
// pathological core-plus-halo scene reads 11.1 to 31.4 percent, which sits
// squarely inside the band clean sigma 8x6 scenes at SNR 20 occupy (19.0 to
// 23.0 percent measured here), so no threshold on this number can separate the
// two. What CAN be said honestly is how wide the window was, which is what
// ALPHA_GATE_WEAK_PERCENT reports: above it the consistency test had no
// discriminating power at this frame's noise level, and the released widths
// went out unchecked BY THIS TEST rather than checked and found consistent.
//
// Calibration. The reporting level was placed on a high-amplitude population
// of the reference structure, where the family bands separate cleanly:
//   sigma 11x6 SNR 100 (curve oracle)     3.000            silent, factor 3.33
//   sigma 20x12 SNR 20                    6.704 -  7.742   silent, factor 1.29
//   sigma 11x6 SNR 20 (curve oracle)     15.685 - 17.068   speaks, factor 1.57
//   sigma 12x8 SNR 20                    11.889 - 12.532   speaks
//   sigma  8x6 SNR 20                    19.021 - 23.014   speaks
//   sigma  5x3 SNR 20                    32.165 - 49.078   speaks
//   sigma 3x1.5 SNR 20                   70.027 - 184.339  speaks
// 10 is the only round number between the widest silent family (7.742) and the
// narrowest speaking one (11.889).
//
// Firing rate, measured on the CANONICAL clean reference set (74 released of
// 111, spec section 11; pinned in s20-clean-reference-set.test.ts):
// N = 40/74 = 54.1 percent. Every SNR-100 family is silent there; the rate is
// carried by the SNR-20 half, whose ceilings on that marginal-amplitude corpus
// run 11.9 to 530 percent. Two documented notes on the band edges:
//  - the marginal sigma 3x1.5 geometry at SNR 100 has a family band that
//    straddles the constant on a high-amplitude population (8.727 - 10.693,
//    1 of 5 rows fires);
//  - sigma 20x12 at SNR 20 is the near side of the calibration. It is silent
//    0/8 at high amplitude (band 6.704 - 7.742, matching the 7.42 - 7.91 the
//    plan recorded), but on the canonical corpus the same family reaches
//    11.383 percent on one seed and speaks there, 1 of 8. The band is
//    amplitude dependent, so "20x12 at SNR 20 stays silent" is a statement
//    about a signal regime rather than about a geometry.
// Both are acceptable HERE and nowhere else, because this constant drives an
// INFO notice and never a release decision.
export const ALPHA_GATE_WEAK_PERCENT = 10;

// ---------------------------------------------------------------------------
// S20 stage D3: sigma-derived padding for the suggested ROI.
//
// SUGGESTED_ROI_PADDING_PX above is the BASE border. It stays the floor of the
// derived padding and the exact value whenever a caller passes paddingPx
// explicitly, but it is no longer the whole story: a fixed border is a
// constant while the aperture the clipping gate demands grows with the beam,
// so on every realistic amplitude-to-noise ratio the padded mask box fell
// short of the 6-sigma check ellipse (see tests/repro-s20).
//
// The derived padding inverts the mask edge. The mask is corrected > k*sigmaB;
// on the axis through the peak a Gaussian crosses that threshold at
// r = sigma * sqrt(2 * ln(peak / threshold)), so the per-axis half extent of
// the mask bounding box reads back the beam size:
//
//   sigmaEst_a = halfExtent_a / sqrt(2 * ln(peakRobust / thresholdCounts))
//   pad_a      = max(SUGGESTED_ROI_PADDING_PX,
//                    ceil(MARGIN * APERTURE_ALPHA_CHECK * sigmaEst_a - halfExtent_a),
//                    ceil(MASK_FLOOR * halfExtent_a))
//
// The middle term aims the suggested half side at MARGIN * ALPHA_CHECK sigma,
// which is the check-ellipse extent plus a margin for the difference between
// the mask-derived sigma and the sigma the fit will report.
export const SUGGESTED_ROI_PAD_MARGIN = 1.25;

// Floor on the mask extent itself (R-18). The Gaussian inversion reads the
// mask edge, so it only knows about beams whose edge falls off like a
// Gaussian. On a flat-topped or super-Gaussian profile at high dynamic range
// the edge is far steeper than a Gaussian's, the inversion therefore reports a
// sigma much smaller than the one a Gaussian fit puts through the same
// profile, and the derived padding lands short. A padding that is at least
// this fraction of the mask half extent is immune to that: it scales with what
// was actually measured (the lit area) rather than with a shape assumption.
//
// Calibrated in stage D3 against the non-Gaussian family at A/sigma_B = 1e4
// (super-Gauss n=2 and n=4, flat top, ring), sigma 10 or radius 30 on a
// 512x512 frame. The column is the smallest floor at which the 6-sigma check
// ellipse fits the suggested rectangle:
//
//   profile                      half extent  sigma_fit  needs beta
//   Gaussian                        40.0        10.00    0    (aperture term already serves it)
//   super-Gauss n=2                 24.0         8.82    1.5
//   super-Gauss n=4                 18.5         8.78    2.0
//   flat top, tanh edge 6 px        54.5        19.61    1.5
//   flat top, tanh edge 3 px        42.5        19.19    2.0
//   super-Gauss n=8                 16.0         8.74    2.5
//   flat top, discontinuous edge    30.0        20.25    3.0
//   ring, inner 20 outer 30         30.0        26-32    unreachable
//
// 2.0 is the smallest value that serves both super-Gauss orders the plan names
// and a physically realizable flat top. The three rows below it are profiles
// whose Gaussian fit is itself not a description of the beam: they are
// suppressed as residual_high or fit_not_converged at every floor, and the
// sigma_fit those fits report is a model artefact rather than a beam size (the
// ring "fits" a sigma larger than its own lit radius). No mask-derived padding
// can serve a criterion built on such a number; the instrument for those is
// the named backlog item that re-derives the suggestion from the fit.
//
// Cost on a true Gaussian, whose mask half extent grows as
// sigma*sqrt(2*ln(peak/threshold)): the floor overtakes the aperture term from
// A/sigma_B about 91 upwards and lifts the suggested half side to 9.97 sigma at
// A/sigma_B 1e3 and 11.87 sigma at 1e4, against the 7.5 sigma the aperture term
// aims at. Over-padding is the safe direction (the clipping gate is served more
// generously and the background rim moves further from the beam); the widest
// row of the S20 apply corpus, sigma 25 at A/sigma_B 1e3, lands at 510 px of a
// 512 px frame without clamping.
export const SUGGESTED_ROI_PAD_MASK_FLOOR = 2.0;

// Guard on the inversion: below this peak-to-threshold ratio the logarithm is
// too close to zero for the quotient to mean anything (ratio -> 1 sends
// sigmaEst -> infinity and the suggestion to the whole frame). sqrt(e) puts
// 2*ln(ratio) at exactly 1, so the denominator of the inversion is never below
// 1 and the estimate is never an amplification of the measured half extent.
// A component that dim falls back to the fixed base border.
export const SUGGESTED_ROI_MIN_PEAK_RATIO = Math.sqrt(Math.E);

// ---------------------------------------------------------------------------
// S20 stage E: what the background reference is allowed to claim.
//
// (C3/C4) Minimum finite samples in a background reference. Below it the
// background METHOD degrades to "none" - no offset and no plane is applied -
// and the noise scale falls back to the dtype-aware floor, which raises
// IMAGE_NOISE_SCALE_SUSPECT. A one-pixel reference on a hot defect used to
// become the whole-image offset, and a two-sample float32 reference used to
// report a MEASURED "mad" scale (the P10/P90 floor collapses to exactly zero
// below three samples), warning-free.
//
// Calibrated in the stage-E step-0 campaign (20 000 realizations per row,
// mixed-seed Box-Muller, plane 500 + 0.3x - 0.2y, true sigma 10):
//   n     single-realization relative scatter   deflation correction c(n)
//    4                        76 %                    2.50 (residual +47 %)
//    5                        73 %                    1.92 (residual -22 %)
//    8                        53 %                    1.43 (residual  -1.6 %)
//    9                        51 %                    1.36 (residual  -1.0 %)
//   16                        29 %                    1.18 (residual  +0.8 %)
// Below nine samples the correction below stops being layout-robust (a
// five-sample L layout misses by -22 %, a four-sample block by +47 %) and the
// reported scale is a plus-or-minus-70-percent quantity. Nine is the smallest
// count that keeps the whole campaign inside 5 percent.
//
// The workbench four-corner preset (12 percent of each side, four boxes) stays
// far above it: n = 4 * max(1, round(0.12 * width)) * max(1, round(0.12 *
// height)), which is 16 samples already at 13 x 13 px and 192 samples on the
// 64 x 48 reference frame.
export const BACKGROUND_MIN_REFERENCE_SAMPLES = 9;

// (C2) Effective degrees of freedom the robust-plane scale estimate consumes.
// The scale is taken from the residuals of a plane fitted on the SAME samples,
// so it is deflated; the correction is
//
//   c(n) = n / (n - BACKGROUND_PLANE_SCALE_EFFECTIVE_DF)
//
// applied to the reported sigma whenever it rests on a measured robust scale
// ("mad"/"iqr"); a quantization floor is not a fit residual and is left alone.
//
// The naive three-parameter form sqrt(n/(n-3)) is algebraically empty here:
// the hat matrix trace is exactly 3 for a three-parameter design, so the
// "trace-based" and the "n-3" corrections are the same formula, and BOTH are
// about half the size of the measured deflation. The value below was measured
// on the ACTUAL estimator chain (MAD/IQR on IRLS-Huber residuals) over the
// three reference layouts - one compact rect, four corner boxes, an edge ring -
// at 9 <= n <= 960, 20 000 realizations per row:
//
//   nu_eff = (1 - E[sigma_hat]/sigma) * n = 2.4 +/- 0.15, with no resolvable
//   layout term (the spread across the three families at fixed n is <= 0.09,
//   i.e. <= 0.6 percent in c at n = 16).
//
// It decomposes as 1.5 (the linearization of sqrt(n/(n-3)) - the three plane
// parameters) + 0.85 (the finite-sample bias of MAD itself, measured
// separately on unfitted samples: nu_mad = 0.85 +/- 0.1) + a small remainder
// for the Huber-psi inlier concentration (the fit tracks the ~82 percent of
// samples inside delta more closely than a least-squares fit would).
//
// Worst residual error over the whole admissible campaign grid: -4.2 percent
// (a nine-sample block-plus-outlier layout); over the three mandated families
// it is -1.0 percent.
export const BACKGROUND_PLANE_SCALE_EFFECTIVE_DF = 2.4;

// ---------------------------------------------------------------------------
// S20 stage E (C5): gradient in the background reference.
//
// Statistic (only evaluated for method "rect-median", which subtracts ONE
// number): a linear trend is fitted through the per-rect medians at their
// centroids, and the peak-to-peak of that trend across the rects is compared
// against the uncertainty the IN-RECT scatter allows for those two medians:
//
//   trendCounts       = max_r T(x_r, y_r) - min_r T(x_r, y_r)
//   uncertaintyCounts = 1.2533 * s_within * sqrt(1/n_hi + 1/n_lo)
//   fires             iff trendCounts > K * uncertaintyCounts
//
// s_within is the pooled MAD scale of every sample about its OWN rect median,
// so a common pedestal, a symmetric beam tail and unequal rect sizes all
// cancel out of the numerator and only a genuine tilt across the reference
// survives. 1.2533 is sqrt(pi/2), the standard-error factor of a sample median.
//
// K was calibrated against a false-positive budget of 0.1 percent per analysis
// on flat noisy references (20 000 realizations per geometry, sigma 1/10/100,
// four corner boxes of 2x2, 3x3, 4x4, 8x6 and 1x9, three corners, six and nine
// spread boxes, deliberately unequal rect sizes, a flat pedestal and a centred
// beam tail at four beam widths):
//   K = 10 fires on 0 of 20 000 for every geometry carrying >= 9 samples per
//   rect (worst 99.9th percentile of the statistic: 5.1), and on 0.155 percent
//   for the smallest admissible geometry, four 2x2 boxes (four samples per
//   rect, where the pooled scatter itself is a 16-value estimate).
// Sensitivity at K = 10 on a 64 px frame with 8x6 corner boxes and sigma 10
// noise: a 1 count/px ramp always fires, 0.5 counts/px fires about 65 percent
// of the time, 0.25 counts/px stays silent. The repository ramp fixture
// (8 counts/px) reaches 73.8.
export const BACKGROUND_GRADIENT_TREND_K = 10;

// A plane through rect centroids needs three non-collinear rects; fewer than
// that (or a collinear set) leaves the statistic unavailable and silent.
export const BACKGROUND_GRADIENT_MIN_RECTS = 3;

// The pooled in-rect scatter needs samples to be a scatter: rects of a single
// pixel contribute no deviation at all, so a reference made only of pinpricks
// leaves the statistic unavailable rather than dividing by zero.
export const BACKGROUND_GRADIENT_MIN_POOLED_DEVIATIONS = 4;

// ---------------------------------------------------------------------------
// S21 stage A: the side fraction the "auto" background method uses for each of
// its four corner reference boxes (see autoBackgroundCornerRects in
// background.ts).
//
// This is NOT a newly calibrated number. It is the fraction the shipped
// four-corner reference preset has always written, restated engine-side so the
// automatic method resolves to exactly the rectangles a user gets by clicking
// that preset - the equality of the two chains is the whole point of the
// automatic method, and it is pinned as an oracle rather than described.
//
// Its sample budget is the one already recorded above for the preset:
// n = 4 * max(1, round(0.12 * width)) * max(1, round(0.12 * height)).
// Measured on this generator: 192 samples on the 64 x 48 reference frame,
// 16 on a 13 x 13 frame (the smallest SQUARE frame that clears
// BACKGROUND_MIN_REFERENCE_SAMPLES), and 4 on a 12 x 12 frame, which does not
// clear it. Below the threshold the SAME minimum-sample cascade fires that a
// hand-drawn reference of the same size would fire, and a frame small enough
// to collapse the four boxes onto fewer than three distinct pixels throws the
// SAME degenerate-geometry error: the automatic method buys no exemption from
// any guard.
export const AUTO_BACKGROUND_CORNER_FRACTION = 0.12;

// ---------------------------------------------------------------------------
// S20 stage F (F4 + V5b): which peak the GATE CEILINGS are referenced against.
//
// Two ceilings are built from a peak: the peak arm of the residual RMS ceiling
// (RESIDUAL_RMS_PEAK_FRACTION) and the multi-peak candidate floor
// (MULTI_PEAK_MIN_PEAK_FRACTION). Both used to read the RAW maximum of the
// corrected ROI, which made them wrong in two independent ways:
//
//   F4  the raw maximum still carries any un-subtracted additive offset, while
//       the field the multi-peak gate scans has the fitted background removed.
//       Adding a constant to the whole image therefore raised the floor without
//       raising the signal: the same secondary lobe was counted at offset 0 and
//       missed at offset 1000, and the residual verdict flipped with it.
//   V5b one hot pixel does the same thing locally: a single 4500-count pixel on
//       a 1000-count peak lifted the residual ceiling past a residual the gate
//       was right to reject, and lifted the candidate floor above the real
//       beam's own peak.
//
// Both ceilings now reference a STAGE-B peak (the peak above the fitted
// background) that is also robust against a single bright pixel. Which robust
// estimator is admissible depends on the beam's own width, and that is what the
// constant below decides.
//
// MEDIAN_PEAK_MIN_SIGMA: at or above this fitted minor sigma (in px) the robust
// peak is the maximum of the 3x3-MEDIAN-filtered corrected field inside the
// ROI, minus the fitted background. Below it the 3x3 median destroys the peak
// of the beam itself rather than an outlier, so the ceilings use the
// deterministic MODEL peak instead: A + B_fit, which in stage-B reference is
// exactly the fitted amplitude A. The fallback is explicit in both directions -
// there is no silent path back to the raw maximum.
//
// Closed-form motivation. For a circular Gaussian of sigma s centred ON a
// pixel, the nine values of the 3x3 window are A, 4 x A*exp(-1/(2 s^2)) and
// 4 x A*exp(-1/s^2), so the median (the fifth value) is exactly
// A*exp(-1/(2 s^2)): the filter under-reads the peak of a NARROW beam by a
// factor that depends only on s. A sub-pixel centre roughly doubles that,
// because the window is then off-centre with respect to the true peak as well.
//
// Measured (128x128, A = 10 000, noise-free, both an integer and a (0.37,
// -0.38) sub-pixel centre; the integer column reproduces the closed form to the
// printed precision):
//
//   sigma   closed form   integer centre   sub-pixel centre   arm at 2.5
//     1.0       -39.3 %        -39.3 %           -63.6 %        model
//     1.5       -19.9 %        -19.9 %           -36.2 %        model
//     2.0       -11.8 %        -11.8 %           -22.3 %        model
//     2.5        -7.7 %         -7.7 %           -14.9 %        boundary
//     3.0        -5.4 %         -5.4 %           -10.6 %        median
//     4.0        -3.1 %         -3.1 %            -6.1 %        median
//     6.0        -1.4 %         -1.4 %            -2.8 %        median
//    11.0        -0.4 %         -0.4 %            -0.8 %        median
//
// The admissible window was bracketed by two MEASURED verdict flips, not by
// the size of the under-read alone (campaign: constant swept over
// {0, 2, 2.5, 3, 4, no-median}; scenes: narrow Gaussians with a real fixed-
// pattern ripple residual at sigma_B = 0, where the peak arm alone sets the
// ceiling, and a super-Gaussian flat-top family):
//
//   lower bound  a sigma 2.5 beam carrying a genuine residual of 47.3 counts
//                against an honest ceiling of 50.0 is FALSELY suppressed as
//                residual_high at constant 2 (median arm, ceiling 42.5) and
//                releases at 2.5 (model arm, ceiling 50.0). At constant 0 the
//                same false suppression reaches sigma 1 (ceiling 18.2 against
//                an honest 50.0) - i.e. an always-median rule suppresses narrow
//                beams for model error they are entitled to carry.
//   upper bound  the flat-top scene at half width 6 (fitted minor sigma 3.042)
//                carries a genuine residual rms of 5.217 against the honest
//                median-arm ceiling of 4.897 and is correctly suppressed at
//                every constant up to 3. At 4 it takes the model arm, the
//                ceiling rises to 5.873 and the frame RELEASES - a real model
//                failure goes out unflagged.
//
// So the measured window is (2, 3.04]. The value is set at its lower end
// because that is the side whose failure mode is a conservative suppression
// (measured not to occur anywhere in the campaign) while the other side's
// failure mode is a missed release; 2.5 keeps roughly 20 percent margin to the
// upper bound, 3 would keep 1.4 percent.
//
// Knife edge, deliberately accepted: a NOMINAL sigma 2.5 beam fits a minor
// sigma either side of 2.5 depending on its sub-pixel phase, so it can take
// either arm. The two ceilings differ by 7.7 percent there and no verdict in
// the campaign turns on it.
//
// Named limit (not fixed here): the arm is chosen from the FITTED geometry, so
// a pixel bright enough to capture the FIT ITSELF drives the fitted minor sigma
// below this constant, and the model arm then inherits that pixel's amplitude -
// the robust arm never gets to run. Witness, pinned in
// tests/unit/image-aperture.test.ts ("S20 stage F: a spike that captures the FIT
// takes the model arm with it"): 64x64, a sigma 1 Gaussian of amplitude 1000, a
// single 3000-count spike at (5, 5), sigma_B = 1. The LM converges ON the spike
// (centre (5, 5), fitted minor sigma 0.1049, fitted amplitude 2998.5), so the
// model arm returns the spike's amplitude and the residual ceiling reads
// 14.9923 where the beam's own honest ceiling is 5.0 - three times too high, on
// one pixel. The frame is still SUPPRESSED (residual_high, rms 27.65), and a
// spike sweep found no defect-driven release anywhere in this regime, so the
// limit costs an inflated ceiling NUMBER, not a wrong release. The earlier flat-
// top V5b scene does NOT witness this: at a 100 000-count hot pixel it keeps a
// fitted minor sigma of 15.208 and stays on the median arm, which is why the
// hot-pixel fix holds there.
export const MEDIAN_PEAK_MIN_SIGMA = 2.5;

// Minimum number of FINITE samples a 3x3 window must hold before its median is
// allowed to stand for a pixel. The window is clamped at the ROI edges (a
// corner pixel sees 4 cells, an edge pixel 6), and non-finite neighbours are
// dropped from the sample rather than counted as zero, so a pixel next to a
// dead region can end up with a window of one - itself. Requiring three finite
// samples means a lone hot pixel can never carry its own median: it needs at
// least two of its surviving neighbours to be hot too. A pixel below the
// minimum contributes no candidate at all, and a ROI where NO pixel reaches it
// leaves the median arm without a value, which falls to the model peak.
export const MEDIAN_PEAK_MIN_WINDOW_SAMPLES = 3;

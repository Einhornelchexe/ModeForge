// Image analyzer tab (S18e-C) — pure exporter tests, no DOM.
// buildAnalysisCsv / buildAnalysisSummaryJson are UI-facing product-neutral
// exports of apps/web/src/views/image.ts; the input results come from the real
// analyzeImage on tiny synthetic frames (task-mandated constructor).

import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeImage, type ImageAnalysisResult } from "../../packages/api/src/index.ts";
import { buildAnalysisCsv, buildAnalysisSummaryJson } from "../../apps/web/src/views/image.ts";
import { sig } from "../../apps/web/src/format.ts";

const EMPTY_EXPORT_CONTEXT = { bgRects: [] } as const;

// The dtype contract values live behind packages/image internals. The analyzer
// accepts only one of the numeric dtypes; probe in document order and use the
// first value the real validator lets through, so the test never depends on
// the internal enum spelling.
function analyze(pixels: number[], width: number, height: number): ImageAnalysisResult {
  let lastError: Error | null = null;
  for (const dtype of ["float32", "float64"]) {
    try {
      return analyzeImage({ pixels, width, height, dtype: dtype as never });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("analyzeImage rejected every candidate dtype");
}

function gaussianFrame(width: number, height: number, cx: number, cy: number, sigma: number): number[] {
  const values = new Array<number>(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      values[y * width + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    }
  }
  return values;
}

function twoLobeFrame(): { pixels: number[]; width: number; height: number } {
  const width = 24;
  const height = 24;
  const pixels = new Array<number>(width * height).fill(0);
  const addLobe = (cx: number, cy: number, sigma: number, amp: number): void => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        pixels[y * width + x] += amp * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      }
    }
  };
  addLobe(7, 12, 1.2, 1);
  addLobe(17, 12, 1.2, 1);
  return { pixels, width, height };
}

function suppressedVariant(base: ImageAnalysisResult): ImageAnalysisResult {
  // Deterministic suppression branch: a real released result with stage B
  // nulled and the documented suppression reason attached.
  return {
    ...base,
    moments: { ...base.moments, stageB: null, suppressionReason: "fit_not_converged" },
  } as unknown as ImageAnalysisResult;
}

function headlineLine(csv: string): string {
  const line = csv.split("\n").find((row) => row.startsWith("released_d4sigma,"));
  assert.ok(line !== undefined, "CSV must contain a released_d4sigma row");
  return line as string;
}

// The clean scene must release stage B: the alpha=6 check ellipse needs the
// frame to be at least 12*sigma + 1 px wide (for sigma 1.8 that is ~22.6 px,
// so the old 16x16 frame correctly failed the aperture_clipped gate). A
// 32x32 frame with sigma 2.5 gives the check ellipse ample margin without
// weakening any assertion.
const CLEAN = () => analyze(gaussianFrame(32, 32, 16, 16, 2.5), 32, 32);

// Reusable results built lazily so each test is independent.
let cachedClean: ImageAnalysisResult | null = null;
function cleanResult(): ImageAnalysisResult {
  if (cachedClean === null) cachedClean = CLEAN();
  return cachedClean;
}

let cachedTwoLobe: ImageAnalysisResult | null = null;
function twoLobeResult(): ImageAnalysisResult {
  if (cachedTwoLobe === null) {
    const frame = twoLobeFrame();
    cachedTwoLobe = analyze(frame.pixels, frame.width, frame.height);
  }
  return cachedTwoLobe;
}

test("CW-01: CSV carries the released D4sigma line for a clean gaussian", () => {
  const result = cleanResult();
  assert.ok(result.moments.stageB !== null && result.moments.stageB.valid, "precondition: the clean gaussian releases stage B");
  const csv = buildAnalysisCsv(result);
  const line = headlineLine(csv);
  assert.match(line, /px x /);
  assert.ok(!line.includes("suppressed:"));
});

test("CW-02: CSV carries the suppression reason when stage B is suppressed", () => {
  const variant = suppressedVariant(cleanResult());
  const csv = buildAnalysisCsv(variant);
  const line = headlineLine(csv);
  assert.ok(line.includes("suppressed: fit_not_converged"));
});

test("CW-03: two-lobe scene output is consistent with the reported release state", () => {
  const result = twoLobeResult();
  const csv = buildAnalysisCsv(result);
  const line = headlineLine(csv);
  const released = result.moments.stageB !== null && result.moments.stageB.valid;
  if (released) {
    assert.ok(!line.includes("suppressed:"));
  } else {
    assert.ok(line.includes("suppressed:"));
  }
});

test("CW-04: summary JSON round-trips and carries the headline scalars", () => {
  const result = cleanResult();
  const parsed = JSON.parse(buildAnalysisSummaryJson(result, EMPTY_EXPORT_CONTEXT)) as Record<string, unknown>;
  assert.ok(typeof parsed === "object" && parsed !== null);
  assert.ok("releasedD4sigma" in parsed);
  assert.ok("sigmaB" in parsed);
  assert.ok("fitStatus" in parsed);
  const released = result.moments.stageB;
  if (released !== null && released.valid) {
    const entry = parsed.releasedD4sigma as Record<string, unknown>;
    assert.equal(entry.d4SigmaMajorPx, released.d4SigmaMajorPx);
    assert.equal(entry.d4SigmaMinorPx, released.d4SigmaMinorPx);
  }
});

test("CW-04a: summary JSON carries exactly the explicit background-rectangle export context", () => {
  const bgRects = [
    { x0: 0, y0: 0, width: 7, height: 5 },
    { x0: 21, y0: 13, width: 8, height: 9 },
  ];
  const parsed = JSON.parse(buildAnalysisSummaryJson(cleanResult(), { bgRects })) as Record<string, unknown>;
  assert.deepEqual(parsed.bgRects, bgRects);
  // The context, not module state, owns the export data; mutating it after
  // serialization cannot alter the already emitted summary.
  bgRects[0].x0 = 99;
  assert.deepEqual(parsed.bgRects, [
    { x0: 0, y0: 0, width: 7, height: 5 },
    { x0: 21, y0: 13, width: 8, height: 9 },
  ]);
});

test("CW-05: suppression reason round-trips through the summary JSON", () => {
  const variant = suppressedVariant(cleanResult());
  const parsed = JSON.parse(buildAnalysisSummaryJson(variant, EMPTY_EXPORT_CONTEXT)) as Record<string, unknown>;
  const entry = parsed.releasedD4sigma as Record<string, unknown>;
  assert.equal(entry.suppressedReason, "fit_not_converged");
});

test("CW-06: neither exporter ever emits undefined or NaN text", () => {
  for (const result of [cleanResult(), twoLobeResult(), suppressedVariant(cleanResult())]) {
    const csv = buildAnalysisCsv(result);
    const json = buildAnalysisSummaryJson(result, EMPTY_EXPORT_CONTEXT);
    assert.ok(!csv.includes("undefined"), "CSV must not contain the literal undefined");
    assert.ok(!csv.includes("NaN"), "CSV must not contain the literal NaN");
    assert.ok(!json.includes("undefined"), "JSON must not contain the literal undefined");
    assert.ok(!json.includes("NaN"), "JSON must not contain the literal NaN");
  }
});

function physicalEllipticityVariant(base: ImageAnalysisResult): ImageAnalysisResult {
  // Deterministic pin: a released result carrying a synthetic physical
  // ellipticity, the way a genuinely calibrated scene would (S18e-D wiring).
  return {
    ...base,
    metrics: { ...base.metrics, ellipticityPhysical: 1 / 3 },
  } as unknown as ImageAnalysisResult;
}

test("CW-07: both exporters carry the physical ellipticity when the result has it", () => {
  const variant = physicalEllipticityVariant(cleanResult());

  const csv = buildAnalysisCsv(variant);
  const csvLine = csv.split("\n").find((row) => row.startsWith("ellipticity_physical,"));
  assert.ok(csvLine !== undefined, "CSV must contain an ellipticity_physical row");
  assert.equal(csvLine, 'ellipticity_physical,"0.333333"');

  const json = JSON.parse(buildAnalysisSummaryJson(variant, EMPTY_EXPORT_CONTEXT)) as Record<string, unknown>;
  assert.ok("ellipticityPhysical" in json, "JSON summary must carry ellipticityPhysical");
  assert.equal(json.ellipticityPhysical, 1 / 3);
});

// Mirrors the numeric branch of image.ts's private dash() helper exactly
// (null/undefined -> em dash, finite number -> 6 significant figures via the
// same sig() the exporter uses, non-finite -> em dash), so the CSV row
// expectations below track the real exporter formatting instead of guessing it.
function dashNum(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Number.isFinite(value) ? sig(value, 6) : "—";
}

function csvRow(csv: string, key: string): string {
  const line = csv.split("\n").find((row) => row.startsWith(`${key},`));
  assert.ok(line !== undefined, `CSV must contain a ${key} row`);
  return line as string;
}

test("CW-08: both exporters carry the roi rect/source and symmetry scalars consistent with the result", () => {
  const result = cleanResult();
  const symmetry = result.metrics.symmetry;
  if (symmetry === null) {
    throw new Error("precondition: the clean gaussian must produce a released centre so symmetry is computed");
  }
  assert.ok(Number.isFinite(symmetry.rotationAsymmetry), "precondition: rotationAsymmetry is a real number for the clean gaussian");
  assert.ok(Number.isFinite(symmetry.axialAsymmetryX), "precondition: axialAsymmetryX is a real number for the clean gaussian");
  assert.ok(Number.isFinite(symmetry.axialAsymmetryY), "precondition: axialAsymmetryY is a real number for the clean gaussian");

  const csv = buildAnalysisCsv(result);
  assert.equal(csvRow(csv, "roi_source"), `roi_source,"${result.roi.source}"`);
  assert.equal(csvRow(csv, "roi_x0"), `roi_x0,"${dashNum(result.roi.rect.x0)}"`);
  assert.equal(csvRow(csv, "roi_y0"), `roi_y0,"${dashNum(result.roi.rect.y0)}"`);
  assert.equal(csvRow(csv, "roi_w"), `roi_w,"${dashNum(result.roi.rect.width)}"`);
  assert.equal(csvRow(csv, "roi_h"), `roi_h,"${dashNum(result.roi.rect.height)}"`);
  assert.equal(
    csvRow(csv, "symmetry_rotation_asymmetry"),
    `symmetry_rotation_asymmetry,"${dashNum(symmetry.rotationAsymmetry)}"`,
  );
  assert.equal(
    csvRow(csv, "symmetry_axial_asymmetry_x"),
    `symmetry_axial_asymmetry_x,"${dashNum(symmetry.axialAsymmetryX)}"`,
  );
  assert.equal(
    csvRow(csv, "symmetry_axial_asymmetry_y"),
    `symmetry_axial_asymmetry_y,"${dashNum(symmetry.axialAsymmetryY)}"`,
  );

  const parsed = JSON.parse(buildAnalysisSummaryJson(result, EMPTY_EXPORT_CONTEXT)) as Record<string, unknown>;
  assert.ok("roi" in parsed, "JSON summary must carry a roi object");
  const roi = parsed.roi as Record<string, unknown>;
  assert.equal(roi.source, result.roi.source);
  assert.equal(roi.x0, result.roi.rect.x0);
  assert.equal(roi.y0, result.roi.rect.y0);
  assert.equal(roi.width, result.roi.rect.width);
  assert.equal(roi.height, result.roi.rect.height);

  assert.ok("symmetry" in parsed, "JSON summary must carry a symmetry object");
  const jsonSymmetry = parsed.symmetry as Record<string, unknown>;
  assert.equal(jsonSymmetry.rotationAsymmetry, symmetry.rotationAsymmetry);
  assert.equal(jsonSymmetry.axialAsymmetryX, symmetry.axialAsymmetryX);
  assert.equal(jsonSymmetry.axialAsymmetryY, symmetry.axialAsymmetryY);
});

test("CW-09: residual exports name the full-resolution finite-ROI domain and carry both models when available", () => {
  const result = cleanResult();
  const residual = result.residuals;
  assert.ok(residual !== null, "precondition: the clean result emits residual diagnostics");
  const csv = buildAnalysisCsv(result);
  assert.equal(
    csvRow(csv, "residual_full_resolution_finite_roi_gauss_rms_counts"),
    `residual_full_resolution_finite_roi_gauss_rms_counts,"${dashNum(residual.rmsCounts)}"`,
  );
  assert.equal(
    csvRow(csv, "residual_full_resolution_finite_roi_gauss_nrmse"),
    `residual_full_resolution_finite_roi_gauss_nrmse,"${dashNum(residual.nrmse)}"`,
  );
  assert.equal(
    csvRow(csv, "residual_full_resolution_finite_roi_gauss_rms_over_sigma_b"),
    `residual_full_resolution_finite_roi_gauss_rms_over_sigma_b,"${dashNum(residual.rmsOverSigmaB)}"`,
  );

  const parsed = JSON.parse(buildAnalysisSummaryJson(result, EMPTY_EXPORT_CONTEXT)) as Record<string, unknown>;
  const exported = parsed.residualsFullResolutionFiniteRoi as Record<string, unknown>;
  const gaussian = exported.gaussian as Record<string, unknown>;
  assert.equal(gaussian.rmsCounts, residual.rmsCounts);
  assert.equal(gaussian.nrmse, residual.nrmse);
  assert.equal(gaussian.rmsOverSigmaB, residual.rmsOverSigmaB);
  assert.ok(residual.superGauss !== null, "precondition: the clean result emits converged super-Gaussian residual diagnostics");
  assert.equal(
    csvRow(csv, "residual_full_resolution_finite_roi_super_gauss_rms_counts"),
    `residual_full_resolution_finite_roi_super_gauss_rms_counts,"${dashNum(residual.superGauss.rmsCounts)}"`,
  );
  const superGaussian = exported.superGaussian as Record<string, unknown>;
  assert.equal(superGaussian.rmsCounts, residual.superGauss.rmsCounts);
  assert.equal(superGaussian.nAtBoundary, residual.superGauss.nAtBoundary);
});

test("CW-10: super-Gaussian n is omitted consistently when its fit did not converge", () => {
  const result = cleanResult();
  const superFit = result.fits.superGauss2d;
  assert.ok(superFit?.params !== null && superFit?.params !== undefined, "precondition: the clean result supplies super-Gaussian fit parameters");
  const variant = {
    ...result,
    fits: {
      ...result.fits,
      superGauss2d: { ...superFit, status: "max_iterations", converged: false },
    },
  } as ImageAnalysisResult;
  const csv = buildAnalysisCsv(variant);
  const json = JSON.parse(buildAnalysisSummaryJson(variant, EMPTY_EXPORT_CONTEXT)) as Record<string, unknown>;
  assert.equal(csvRow(csv, "super_gauss_n"), 'super_gauss_n,"—"');
  assert.equal(json.superGaussN, null);
});

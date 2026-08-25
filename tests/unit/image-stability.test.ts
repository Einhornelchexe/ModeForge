import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSweepVariants,
  runRoiStabilitySweep,
  type SweepVariant,
} from "../../packages/image/src/stability.ts";

test("S18a interior baseline rect yields 9 unclamped variants in deterministic order", () => {
  const variants = buildSweepVariants({ x0: 20, y0: 30, width: 40, height: 20 }, 100, 100);
  assert.equal(variants.length, 9);
  assert.deepStrictEqual(
    variants.map((variant) => variant.label),
    ["size0.8", "size0.9", "size1.0", "size1.1", "size1.2", "shift+x", "shift-x", "shift+y", "shift-y"],
  );
  assert.deepStrictEqual(
    variants.map((variant) => variant.kind),
    ["size", "size", "size", "size", "size", "shift", "shift", "shift", "shift"],
  );
  assert.ok(variants.every((variant) => !variant.clamped));
  assert.deepStrictEqual(
    variants.map((variant) => variant.sizeFactor),
    [0.8, 0.9, 1, 1.1, 1.2, 1, 1, 1, 1],
  );
  assert.deepStrictEqual(variants[4].rect, { x0: 16, y0: 28, width: 48, height: 24 });
  assert.deepStrictEqual(variants[5], {
    label: "shift+x",
    kind: "shift",
    sizeFactor: 1,
    shiftXPx: 2,
    shiftYPx: 0,
    rect: { x0: 22, y0: 30, width: 40, height: 20 },
    clamped: false,
  } as SweepVariant);
  assert.equal(variants[7].shiftYPx, 1);
  assert.equal(variants[8].shiftYPx, -1);
});

test("S18a edge baseline rect clamps overhanging variants and reports a partial sweep", () => {
  const variants = buildSweepVariants({ x0: 35, y0: 2, width: 15, height: 6 }, 50, 50);
  assert.equal(variants.length, 9);
  // revised: half-to-even rounding (M3) keeps size1.1 at 16x7 inside the frame,
  // so it no longer clamps; size1.2 still clamps onto size1.1's rect.
  assert.deepStrictEqual(
    variants.map((variant) => [variant.label, variant.clamped]),
    [
      ["size0.8", false],
      ["size0.9", false],
      ["size1.0", false],
      ["size1.1", false],
      ["size1.2", true],
      ["shift+x", true],
      ["shift-x", false],
      ["shift+y", false],
      ["shift-y", false],
    ],
  );
  assert.ok(variants.every((variant) => variant.rect.x0 >= 0 && variant.rect.x0 + variant.rect.width <= 50));
  assert.ok(variants.every((variant) => variant.rect.y0 >= 0 && variant.rect.y0 + variant.rect.height <= 50));

  const report = runRoiStabilitySweep({ x0: 35, y0: 2, width: 15, height: 6 }, 50, 50, (rect) => ({
    areaPx: rect.width * rect.height,
  }));
  assert.equal(report.partialSweep, true);
  assert.equal(report.fullFrame, false);
  assert.equal(report.undeterminable, false);
  // revised: size1.2 clamps onto size1.1's identical rect and is a duplicate,
  // so unique valid-variant coverage is 8 instead of 9 (M5 dedup).
  assert.equal(report.validVariantCount, 8);
  const extent = report.variants.find((result) => result.variant.label === "size1.2");
  assert.ok(extent !== undefined);
  assert.equal(extent.duplicateOfLabel, "size1.1");
});

test("S18a full-frame baseline yields only shrinking size variants with fullFrame and partialSweep flags", () => {
  const variants = buildSweepVariants({ x0: 0, y0: 0, width: 80, height: 60 }, 80, 60);
  assert.equal(variants.length, 3);
  assert.deepStrictEqual(
    variants.map((variant) => variant.label),
    ["size0.8", "size0.9", "size1.0"],
  );
  assert.ok(variants.every((variant) => variant.kind === "size" && !variant.clamped));

  const report = runRoiStabilitySweep({ x0: 0, y0: 0, width: 80, height: 60 }, 80, 60, (rect) => ({
    areaPx: rect.width * rect.height,
  }));
  assert.equal(report.fullFrame, true);
  assert.equal(report.partialSweep, true);
  assert.equal(report.variants.length, 3);
});

test("S18a mock evaluator area metric yields exactly recomputable halfSpreadPercent", () => {
  const report = runRoiStabilitySweep(
    { x0: 10, y0: 10, width: 20, height: 20 },
    60,
    60,
    (rect) => ({ areaPx: rect.width * rect.height, zeroMetric: 0, badMetric: Number.NaN }),
  );
  assert.equal(report.validVariantCount, 9);
  assert.equal(report.undeterminable, false);
  assert.equal(report.partialSweep, false);
  assert.ok(report.sensitivities !== null);
  // areas: 16*16=256, 18*18=324, 20*20=400, 22*22=484, 24*24=576, shifts stay 400.
  // halfSpreadPercent = 100 * (576 - 256) / (2 * 400) = 40.
  // revised: SweepSensitivity now carries clampedContributing (M5); this
  // interior sweep has no clamped contributor, so the flag is false.
  assert.deepStrictEqual(report.sensitivities, [
    {
      metric: "areaPx",
      baselineValue: 400,
      minValue: 256,
      maxValue: 576,
      halfSpreadPercent: 40,
      clampedContributing: false,
    },
  ]);
});

test("S18a fewer than three valid variants make the sweep undeterminable with null sensitivities", () => {
  let evaluated = 0;
  const report = runRoiStabilitySweep({ x0: 8, y0: 8, width: 20, height: 20 }, 50, 50, (rect) => {
    evaluated += 1;
    if (evaluated <= 2) return { areaPx: rect.width * rect.height };
    return null;
  });
  assert.equal(report.validVariantCount, 2);
  assert.equal(report.undeterminable, true);
  assert.equal(report.sensitivities, null);
});

test("S18a a throwing evaluator marks one variant invalid instead of aborting the sweep", () => {
  let calls = 0;
  const report = runRoiStabilitySweep({ x0: 5, y0: 5, width: 10, height: 10 }, 40, 40, (rect) => {
    calls += 1;
    if (calls === 3) throw new Error("boom");
    return { areaPx: rect.width * rect.height };
  });
  assert.equal(report.validVariantCount, 8);
  assert.equal(report.variants[2].valid, false);
  assert.equal(report.variants[2].metrics, null);
  // revised: the third call is the baseline variant, and M6 makes an invalid
  // baseline contractual: the report is undeterminable with null sensitivities
  // even though the other eight variants are valid.
  assert.equal(report.undeterminable, true);
  assert.equal(report.sensitivities, null);
});

test("S18a baselineValue 0 or non-finite skips the metric in sensitivities", () => {
  const report = runRoiStabilitySweep({ x0: 10, y0: 10, width: 15, height: 15 }, 50, 50, (rect) => ({
    areaPx: rect.width * rect.height,
    alwaysZero: 0,
    undefinedAtBaseline: rect.width === 15 ? Number.NaN : 1,
  }));
  assert.ok(report.sensitivities !== null);
  assert.deepStrictEqual(
    report.sensitivities.map((sensitivity) => sensitivity.metric),
    ["areaPx"],
  );
});

test("S18a buildSweepVariants rejects a baseline rect that is outside the image", () => {
  assert.throws(() => buildSweepVariants({ x0: 42, y0: 2, width: 12, height: 6 }, 50, 50), /fully inside/);
  assert.throws(() => buildSweepVariants({ x0: -1, y0: 0, width: 5, height: 5 }, 50, 50), /fully inside/);
  assert.throws(() => buildSweepVariants({ x0: 0, y0: 0, width: 0, height: 5 }, 50, 50), /positive integers/);
  assert.throws(() => buildSweepVariants({ x0: 0, y0: 0, width: 5, height: 5 }, 0, 50), /positive integers/);
});

test("S18a the stability sweep is deterministic across repeated runs", () => {
  const baseRect = { x0: 10, y0: 12, width: 24, height: 18 };
  const run = () => runRoiStabilitySweep(baseRect, 80, 80, (rect) => ({ areaPx: rect.width * rect.height }));
  const first = run();
  const second = run();
  assert.deepStrictEqual(first, second);
});

test("S18a M3 oracle: size variants stay within 0.5 px of the baseline centre with zero net drift", () => {
  // Symmetric fixture. The old Math.round(x + 0.5) rule drifted every size
  // variant by +0.5 px on exact ties; half-to-even must balance them to zero.
  const variants = buildSweepVariants({ x0: 10, y0: 10, width: 21, height: 21 }, 64, 64);
  const centerX = 10 + (21 - 1) / 2;
  const centerY = 10 + (21 - 1) / 2;
  const sizeVariants = variants.filter((variant) => variant.kind === "size");
  assert.equal(sizeVariants.length, 5);
  let sumX = 0;
  let sumY = 0;
  for (const variant of sizeVariants) {
    const cx = variant.rect.x0 + (variant.rect.width - 1) / 2;
    const cy = variant.rect.y0 + (variant.rect.height - 1) / 2;
    assert.ok(Math.abs(cx - centerX) <= 0.5, `${variant.label} x centre deviates by ${cx - centerX}`);
    assert.ok(Math.abs(cy - centerY) <= 0.5, `${variant.label} y centre deviates by ${cy - centerY}`);
    sumX += cx - centerX;
    sumY += cy - centerY;
  }
  assert.equal(sumX, 0);
  assert.equal(sumY, 0);
});

test("S18a M4 oracle: shift variants always move at least 1 px even for sub-10 px rects", () => {
  const baseline = { x0: 20, y0: 20, width: 8, height: 6 };
  const report = runRoiStabilitySweep(baseline, 64, 64, (rect) => ({ areaPx: rect.width * rect.height }));
  const shifts = report.variants.filter((result) => result.variant.kind === "shift");
  assert.equal(shifts.length, 4);
  for (const result of shifts) {
    const { variant } = result;
    assert.ok(Math.abs(variant.shiftXPx) + Math.abs(variant.shiftYPx) >= 1);
    // Interior baseline: no clamping, so every shift variant must actually
    // leave the baseline rect.
    assert.notDeepStrictEqual(variant.rect, baseline);
    assert.equal(result.valid, true);
    assert.equal(result.duplicateOfLabel, null);
  }
  assert.equal(report.validVariantCount, 9);
});

test("S18a M5 oracle: a clamped duplicate is excluded from the sensitivity spread and flags clampedContributing", () => {
  // Reviewers' collapse case: the baseline touches the right edge, so the
  // growing size1.2 variant clamps onto exactly size1.1's rect. The dup is
  // excluded from the min/max aggregation, and the clamped-but-unique
  // shift+x still contributes, setting clampedContributing on the metric.
  const report = runRoiStabilitySweep({ x0: 25, y0: 2, width: 15, height: 6 }, 40, 50, (rect) => ({
    m: rect.x0,
  }));

  const original = report.variants.find((result) => result.variant.label === "size1.1");
  const duplicate = report.variants.find((result) => result.variant.label === "size1.2");
  assert.ok(original !== undefined);
  assert.ok(duplicate !== undefined);
  assert.deepStrictEqual(duplicate.variant.rect, original.variant.rect);
  assert.equal(original.duplicateOfLabel, null);
  assert.equal(duplicate.duplicateOfLabel, "size1.1");
  assert.equal(duplicate.variant.clamped, true);

  const shiftPlusX = report.variants.find((result) => result.variant.label === "shift+x");
  assert.ok(shiftPlusX !== undefined);
  assert.equal(shiftPlusX.variant.clamped, true);
  assert.equal(shiftPlusX.duplicateOfLabel, null);

  // Unique valid x0 values: 26, 26, 25 (baseline), 24, 26, 24, 25, 25.
  // Spread over the deduped set: min 24, max 26, baseline 25 -> halfSpread 4.
  // (The dedup itself cannot move min/max — the duplicate's owner carries the
  // identical rect and metrics; it affects counting and the >= 2 gate.)
  assert.equal(report.validVariantCount, 8);
  assert.ok(report.sensitivities !== null);
  assert.deepStrictEqual(report.sensitivities, [
    { metric: "m", baselineValue: 25, minValue: 24, maxValue: 26, halfSpreadPercent: 4, clampedContributing: true },
  ]);
});

test("S18a a tiny base rect collapses size variants into duplicates and marks the sweep partial", () => {
  // 2x2 base: every size factor rounds back to a 2x2 rect, so four of the
  // five size variants are duplicates. The sweep must say so via partialSweep
  // even though nothing is clamped and the rect sits in the interior.
  const report = runRoiStabilitySweep({ x0: 14, y0: 14, width: 2, height: 2 }, 30, 30, (rect) => ({
    areaPx: rect.width * rect.height,
  }));
  const duplicateCount = report.variants.filter((result) => result.duplicateOfLabel !== null).length;
  assert.ok(duplicateCount >= 4);
  assert.ok(report.variants.every((result) => !result.variant.clamped));
  assert.equal(report.fullFrame, false);
  assert.equal(report.partialSweep, true);
});

test("S18a M6 oracle: an invalid baseline is contractual and makes the sweep undeterminable", () => {
  const report = runRoiStabilitySweep({ x0: 20, y0: 30, width: 40, height: 20 }, 100, 100, (rect) => {
    if (rect.x0 === 20 && rect.y0 === 30 && rect.width === 40 && rect.height === 20) return null;
    return { m: rect.x0 };
  });
  // Eight other variants stay valid, but the missing baseline reference means
  // no sensitivity set can be derived.
  assert.equal(report.validVariantCount, 8);
  assert.equal(report.undeterminable, true);
  assert.equal(report.sensitivities, null);
});

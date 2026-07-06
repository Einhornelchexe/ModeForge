import assert from "node:assert/strict";
import test from "node:test";

import { parseProjectJson, serializeProject, validateComponent, type BeamlineComponent, type ModeForgeProject } from "../../packages/core/src/index.ts";
import { paraxialCard, simulateBeamline, stackOpticFromComponent } from "../../packages/optics/src/index.ts";
import { applySphericalSurfacePhase, createGaussianField } from "../../packages/field/src/index.ts";
import { runHeadlessJob, type FieldBeamlineJobResult } from "../../packages/api/src/index.ts";

// cemented doublet from the ZMX sample prescription (glass indices fixed)
const doublet: Extract<BeamlineComponent, { kind: "surface-stack" }> = {
  id: "DBL1",
  kind: "surface-stack",
  surfaces: [
    { radiusMm: 62.75, thicknessAfterMm: 4, refractiveIndexAfter: 1.8, apertureRadiusMm: 12.7, materialAfter: "S-LAH64" },
    { radiusMm: -45.71, thicknessAfterMm: 2.5, refractiveIndexAfter: 1.74, apertureRadiusMm: 12.7, materialAfter: "N-SF11" },
    { radiusMm: -128.23, thicknessAfterMm: 0, refractiveIndexAfter: 1, apertureRadiusMm: 12.7, materialAfter: "AIR" },
  ],
};

test("S15 validation accepts the doublet and rejects malformed stacks", () => {
  assert.equal(validateComponent(doublet).ok, true);
  const reject = (mutate: (c: typeof doublet) => unknown, label: string): void => {
    const clone = JSON.parse(JSON.stringify(doublet)) as typeof doublet;
    mutate(clone);
    assert.equal(validateComponent(clone).ok, false, label);
  };
  reject((c) => (c.surfaces = c.surfaces.slice(0, 1)), "fewer than 2 surfaces");
  reject((c) => (c.surfaces[c.surfaces.length - 1].refractiveIndexAfter = 1.5), "last surface must exit into air");
  reject((c) => (c.surfaces[c.surfaces.length - 1].thicknessAfterMm = 3), "last thickness must be 0");
  reject((c) => (c.surfaces[0].radiusMm = 0), "zero radius");
  reject((c) => (c.surfaces[1].thicknessAfterMm = -1), "negative thickness");
  reject((c) => (c.surfaces[0].refractiveIndexAfter = 0), "non-positive index");
});

test("S15 fast mode wires the stack matrix and per-surface aperture margin", () => {
  const result = simulateBeamline({
    version: "0.1",
    beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.3, waistPositionMm: 0 },
    components: [
      { id: "d1", kind: "free-space", lengthMm: 20 },
      doublet,
      { id: "d2", kind: "free-space", lengthMm: 60 },
    ],
  });
  assert.equal(result.warnings.filter((w) => w.severity === "error").length, 0);
  const matrixEntry = result.matrices.find((m) => m.componentId === "DBL1");
  const card = paraxialCard(stackOpticFromComponent(doublet));
  assert.ok(matrixEntry);
  for (const key of ["a", "b", "c", "d"] as const) {
    assert.ok(Math.abs((matrixEntry?.[key] ?? Number.NaN) - card.matrix[key]) < 1e-12, `matrix ${key}`);
  }
  assert.ok(Math.abs((matrixEntry?.determinant ?? 0) - 1) < 1e-9, "air-to-air determinant");
  const compResult = result.components.find((c) => c.componentId === "DBL1");
  assert.equal(compResult?.kind, "surface-stack");
  assert.ok(Math.abs((compResult?.endZmm ?? 0) - (compResult?.startZmm ?? 0) - 6.5) < 1e-12, "geometric length 6.5 mm");
  assert.ok(compResult?.apertureMargin !== undefined, "aperture margin from tightest surface aperture");

  // tight surface aperture must raise the margin warning
  const tight = JSON.parse(JSON.stringify(doublet)) as typeof doublet;
  tight.surfaces[1].apertureRadiusMm = 0.2;
  const warned = simulateBeamline({
    version: "0.1",
    beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.3, waistPositionMm: 0 },
    components: [{ id: "d1", kind: "free-space", lengthMm: 20 }, tight],
  });
  assert.ok(warned.warnings.some((w) => w.code === "APERTURE_MARGIN_LOW" && w.componentId === "DBL1"));
});

test("S15 project JSON round-trips the surface-stack component", () => {
  const project: ModeForgeProject = {
    version: "0.1",
    beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.3, waistPositionMm: 0 },
    beamline: [doublet],
  };
  const parsed = parseProjectJson(serializeProject(project));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.value.beamline, [doublet]);
});

function runFieldJob(components: BeamlineComponent[], surfacePhase: "ideal" | "real-sag", probes: number[]): FieldBeamlineJobResult {
  const job = runHeadlessJob({
    kind: "field-beamline",
    input: {
      beamline: { version: "0.1", beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.3, waistPositionMm: 0 }, components },
      grid: { nx: 64, ny: 64, dxMm: 0.04, dyMm: 0.04 },
      probesZmm: probes,
      surfacePhase,
    },
  });
  assert.equal(job.ok, true);
  if (!job.ok || job.value.kind !== "field-beamline") throw new Error("expected field-beamline result");
  return job.value.result;
}

test("S15 a 2-surface air-glass-air stack reproduces the thick-lens field exactly", () => {
  const stack: BeamlineComponent = {
    id: "TL",
    kind: "surface-stack",
    surfaces: [
      { radiusMm: 50, thicknessAfterMm: 5, refractiveIndexAfter: 1.5 },
      { radiusMm: -50, thicknessAfterMm: 0, refractiveIndexAfter: 1 },
    ],
  };
  const thick: BeamlineComponent = { id: "TL", kind: "thick-lens", radius1Mm: 50, radius2Mm: -50, thicknessMm: 5, refractiveIndex: 1.5 };
  for (const surfacePhase of ["ideal", "real-sag"] as const) {
    const a = runFieldJob([{ id: "d1", kind: "free-space", lengthMm: 20 }, stack, { id: "d2", kind: "free-space", lengthMm: 60 }], surfacePhase, [85]);
    const b = runFieldJob([{ id: "d1", kind: "free-space", lengthMm: 20 }, thick, { id: "d2", kind: "free-space", lengthMm: 60 }], surfacePhase, [85]);
    assert.ok(Math.abs(a.probes[0].radiusXmm - b.probes[0].radiusXmm) < 1e-12, `${surfacePhase} radius equivalence`);
    assert.ok(Math.abs(a.probes[0].power - b.probes[0].power) < 1e-12, `${surfacePhase} power equivalence`);
  }
});

test("S15 doublet real-sag matches the analytic paraxial envelope at low NA", () => {
  const components: BeamlineComponent[] = [
    { id: "d1", kind: "free-space", lengthMm: 20 },
    doublet,
    { id: "d2", kind: "free-space", lengthMm: 60 },
  ];
  const result = runFieldJob(components, "real-sag", [40, 86.5]);
  const zIndex = result.analytical.zGridMm.indexOf(86.5);
  assert.ok(zIndex >= 0);
  const analytic = result.analytical.envelope.radiusXmm[zIndex];
  const probe = result.probes.find((p) => p.zMm === 86.5);
  assert.ok(probe);
  const deviation = Math.abs((probe?.radiusXmm ?? Number.NaN) - analytic) / analytic;
  assert.ok(deviation < 0.01, `doublet real-sag vs analytic deviation ${deviation}`);
  // probe inside the first glass element maps via the reduced path and stays finite
  const inner = result.probes.find((p) => p.zMm === 40);
  assert.ok(inner && Number.isFinite(inner.radiusXmm) && inner.radiusXmm > 0);
});

test("S15 cemented glass-glass interface phase matches the analytic sag", () => {
  const n = 65;
  const dx = 0.05;
  const base = createGaussianField({ nx: n, ny: n, dxMm: dx, dyMm: dx, wavelengthUm: 1.064, waistRadiusMm: 1 });
  const field = { ...base, real: base.real.map(() => 1), imag: base.imag.map(() => 0) };
  const out = applySphericalSurfacePhase(field, -45.71, 1.8, 1.74);
  const cy = (n - 1) / 2;
  const k0 = (2 * Math.PI) / (1.064 / 1000);
  for (const offset of [8, 16, 24]) {
    const r = offset * dx;
    const sag = -45.71 + Math.sqrt(45.71 * 45.71 - r * r);
    const expected = k0 * (1.8 - 1.74) * sag;
    const idx = cy * n + (cy + offset);
    const actual = Math.atan2(out.imag[idx], out.real[idx]);
    const wrap = (v: number): number => Math.atan2(Math.sin(v), Math.cos(v));
    assert.ok(Math.abs(wrap(actual - expected)) < 1e-9, `glass-glass sag phase at r=${r}`);
  }
});

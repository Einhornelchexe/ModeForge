import assert from "node:assert/strict";
import test from "node:test";

import { gaussianRadiusAtZ, runHeadlessJob, type BeamlineComponent, type FieldBeamlineJobResult } from "../../packages/api/src/index.ts";

function runJob(input: Parameters<typeof runHeadlessJob>[0]): FieldBeamlineJobResult {
  const job = runHeadlessJob(input);
  assert.equal(job.ok, true);
  if (!job.ok || job.value.kind !== "field-beamline") throw new Error("expected field-beamline result");
  return job.value.result;
}

const gaussianBeam = { kind: "gaussian" as const, wavelengthUm: 1.064, waistRadiusMm: 0.3, waistPositionMm: 0, powerW: 1 };

test("S13B probes in free space match the analytic Gaussian caustic", () => {
  const result = runJob({
    kind: "field-beamline",
    input: {
      beamline: { version: "0.1", beam: gaussianBeam, components: [{ id: "d1", kind: "free-space", lengthMm: 200 }] },
      grid: { nx: 32, ny: 32, dxMm: 0.09, dyMm: 0.09 },
      probesZmm: [50, 120, 200],
    },
  });
  assert.equal(result.probes.length, 3);
  const radii = result.probes.map((p) => p.radiusXmm);
  result.probes.forEach((probe, index) => {
    assert.equal(probe.image.values.length, 32 * 32);
    const analytic = gaussianRadiusAtZ(probe.zMm, 0.3, 1.064);
    assert.ok(Math.abs(probe.radiusXmm - analytic) / analytic < 0.08, `probe ${index} radius ${probe.radiusXmm} vs analytic ${analytic}`);
  });
  assert.ok(radii[0] < radii[1] && radii[1] < radii[2], "radius must grow monotonically in free space");
  // unitary DFT: free propagation conserves power at every probe
  for (const probe of result.probes) {
    assert.ok(Math.abs(probe.power - result.probes[0].power) / result.probes[0].power < 1e-9);
  }
});

test("S13B probe behind a thin lens shows the converging beam", () => {
  const result = runJob({
    kind: "field-beamline",
    input: {
      beamline: {
        version: "0.1",
        beam: gaussianBeam,
        components: [
          { id: "d1", kind: "free-space", lengthMm: 100 },
          { id: "L1", kind: "thin-lens", focalLengthMm: 50 },
          { id: "d2", kind: "free-space", lengthMm: 60 },
        ],
      },
      grid: { nx: 48, ny: 48, dxMm: 0.04, dyMm: 0.04 },
      probesZmm: [100, 140],
    },
  });
  assert.equal(result.probes.length, 2);
  const atLens = result.probes[0];
  const converging = result.probes[1];
  assert.ok(converging.radiusXmm < atLens.radiusXmm * 0.6, `expected strong convergence, got ${atLens.radiusXmm} -> ${converging.radiusXmm}`);
});

test("S13B probe at the end of a slab uses the reduced optical path t/n", () => {
  const beam = { kind: "gaussian" as const, wavelengthUm: 1.064, waistRadiusMm: 0.1, waistPositionMm: 0 };
  const result = runJob({
    kind: "field-beamline",
    input: {
      beamline: {
        version: "0.1",
        beam,
        components: [
          { id: "win", kind: "slab", thicknessMm: 30, refractiveIndex: 1.5 },
          { id: "d1", kind: "free-space", lengthMm: 100 },
        ],
      },
      grid: { nx: 32, ny: 32, dxMm: 0.03, dyMm: 0.03 },
      probesZmm: [30],
    },
  });
  const probe = result.probes[0];
  const analyticReduced = gaussianRadiusAtZ(30 / 1.5, 0.1, 1.064);
  const analyticVacuum = gaussianRadiusAtZ(30, 0.1, 1.064);
  assert.ok(Math.abs(probe.radiusXmm - analyticReduced) / analyticReduced < 0.08, `slab probe ${probe.radiusXmm} vs t/n analytic ${analyticReduced}`);
  assert.ok(Math.abs(probe.radiusXmm - analyticVacuum) > Math.abs(probe.radiusXmm - analyticReduced), "probe must match the reduced path better than the vacuum path");
});

test("S13B probes beyond the beamline end continue in free space", () => {
  const result = runJob({
    kind: "field-beamline",
    input: {
      beamline: { version: "0.1", beam: gaussianBeam, components: [{ id: "d1", kind: "free-space", lengthMm: 50 }] },
      grid: { nx: 32, ny: 32, dxMm: 0.09, dyMm: 0.09 },
      probesZmm: [150],
    },
  });
  assert.equal(result.finalPlane.zMm, 50);
  const probe = result.probes[0];
  assert.equal(probe.zMm, 150);
  const analytic = gaussianRadiusAtZ(150, 0.3, 1.064);
  assert.ok(Math.abs(probe.radiusXmm - analytic) / analytic < 0.08);
});

test("S13B invalid probe positions are skipped with a warning", () => {
  const result = runJob({
    kind: "field-beamline",
    input: {
      beamline: { version: "0.1", beam: gaussianBeam, components: [{ id: "d1", kind: "free-space", lengthMm: 50 }] },
      grid: { nx: 16, ny: 16, dxMm: 0.15, dyMm: 0.15 },
      probesZmm: [-5],
    },
  });
  assert.equal(result.probes.length, 0);
  assert.ok(result.warnings.some((w) => w.code === "INVALID_INPUT" && w.message.includes("probe")));
});

test("S13B omitting probesZmm keeps the result backward-compatible", () => {
  const result = runJob({
    kind: "field-beamline",
    input: {
      beamline: { version: "0.1", beam: gaussianBeam, components: [{ id: "d1", kind: "free-space", lengthMm: 50 }] },
      grid: { nx: 16, ny: 16, dxMm: 0.15, dyMm: 0.15 },
    },
  });
  assert.deepEqual(result.probes, []);
  assert.ok(result.image.values.length === 16 * 16);
});

test("S16 probe at an aperture plane samples AFTER the aperture (mid and end of beamline)", () => {
  const run = (components: BeamlineComponent[]): FieldBeamlineJobResult => {
    const job = runHeadlessJob({
      kind: "field-beamline",
      input: {
        beamline: { version: "0.1", beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.3, waistPositionMm: 0 }, components },
        grid: { nx: 128, ny: 128, dxMm: 0.012, dyMm: 0.012 },
        probesZmm: [0, 10],
      },
    });
    assert.equal(job.ok, true);
    if (!job.ok || job.value.kind !== "field-beamline") throw new Error("expected field-beamline result");
    return job.value.result;
  };
  const aperture: BeamlineComponent = { id: "ap", kind: "aperture", apertureRadiusMm: 0.2 };
  const drift = (id: string, lengthMm: number): BeamlineComponent => ({ id, kind: "free-space", lengthMm });
  for (const components of [[drift("d1", 10), aperture], [drift("d1", 10), aperture, drift("d2", 10)]]) {
    const result = run(components);
    const inputPower = result.probes[0].power;
    const atAperture = result.probes[1].power;
    // clipped: analytic transmission 1 - exp(-2 R^2 / w^2) = 0.5888 at w(10) ~ 0.3002
    const transmission = atAperture / inputPower;
    assert.ok(Math.abs(transmission - 0.588831) < 0.01, `probe must see the CLIPPED power, got T=${transmission}`);
    // and it must agree with the final plane power (propagation conserves power)
    assert.ok(Math.abs(atAperture - result.finalPlane.power) / atAperture < 1e-9, "probe power equals downstream power");
  }
});

test("S16-R3 initial wavefront curvature has the correct sign for both waist offsets", () => {
  const run = (waistPositionMm: number): number => {
    const job = runHeadlessJob({
      kind: "field-beamline",
      input: {
        beamline: {
          version: "0.1",
          beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.3, waistPositionMm },
          components: [{ id: "d", kind: "free-space", lengthMm: 30 }],
        },
        grid: { nx: 96, ny: 96, dxMm: 0.02, dyMm: 0.02 },
        probesZmm: [30],
      },
    });
    assert.equal(job.ok, true);
    if (!job.ok || job.value.kind !== "field-beamline") throw new Error("expected field-beamline result");
    return job.value.result.probes[0].radiusXmm;
  };
  // waist 50 mm upstream: beam DIVERGES -> w(80); downstream: CONVERGES -> w(20)
  const diverging = run(-50);
  const converging = run(50);
  const w80 = gaussianRadiusAtZ(80, 0.3, 1.064);
  const w20 = gaussianRadiusAtZ(20, 0.3, 1.064);
  assert.ok(Math.abs(diverging - w80) / w80 < 1e-6, `diverging ${diverging} vs w(80) ${w80}`);
  assert.ok(Math.abs(converging - w20) / w20 < 1e-6, `converging ${converging} vs w(20) ${w20}`);
  assert.ok(diverging > converging, "diverging beam must end larger than converging one");
});

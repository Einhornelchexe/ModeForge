import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILTIN_MATERIALS,
  oneOverE2RadiusToBasisValueMm,
  oneOverE2RadiusToFwhmDiameterMm,
  runHeadlessJob,
} from "../../packages/api/src/index.ts";

test("S12 UI basis conversion matches core width helpers", () => {
  assert.equal(oneOverE2RadiusToBasisValueMm(0.5, "one_over_e2_radius"), 0.5);
  assert.equal(oneOverE2RadiusToBasisValueMm(0.5, "fwhm_diameter"), oneOverE2RadiusToFwhmDiameterMm(0.5));
  assert.equal(oneOverE2RadiusToBasisValueMm(0.5, "d4sigma_diameter"), 1);
  assert.equal(oneOverE2RadiusToBasisValueMm(0.5, "rms_radius"), 0.25);
});

test("S12 zmx-import job resolves session materials passed by the UI", () => {
  const zmx = "SURF 0\n  RADIUS 62.75\n  DISZ 4.0\n  GLAS S-LAH64\n  DIAM 12.7\nSURF 1\n  RADIUS -45.71\n  DISZ 0\n  DIAM 12.7\n";
  const blocked = runHeadlessJob({ kind: "zmx-import", text: zmx, wavelengthUm: 0.5876 });
  assert.equal(blocked.ok, true);
  if (blocked.ok && blocked.value.kind === "zmx-import") {
    assert.equal(blocked.value.result.ok, false);
    assert.deepEqual(blocked.value.result.unresolvedMaterials, ["S-LAH64"]);
  }

  const agf = runHeadlessJob({
    kind: "agf-import",
    text: "NM S-LAH64\nCD 1.83021453 0.0090482329 0.29056381 0.0330756689 1.28544024 89.3675501\n",
  });
  assert.equal(agf.ok, true);
  if (!agf.ok || agf.value.kind !== "agf-import") return;
  const session = agf.value.result.materials;
  const resolved = runHeadlessJob({
    kind: "zmx-import",
    text: zmx,
    wavelengthUm: 0.5876,
    materials: [...BUILTIN_MATERIALS, ...session],
  });
  assert.equal(resolved.ok, true);
  if (resolved.ok && resolved.value.kind === "zmx-import") {
    assert.equal(resolved.value.result.ok, true);
  }
});

test("S12 field-fresnel job returns display image grids for both planes", () => {
  const job = runHeadlessJob({
    kind: "field-fresnel",
    input: {
      gaussian: { nx: 16, ny: 16, dxMm: 0.05, dyMm: 0.05, wavelengthUm: 1.064, waistRadiusMm: 0.2 },
      distanceMm: 50,
      samplingBeamRadiusMm: 0.2,
    },
  });
  assert.equal(job.ok, true);
  if (!job.ok || job.value.kind !== "field-fresnel") return;
  const result = job.value.result;
  assert.equal(result.inputImage.values.length, 16 * 16);
  assert.equal(result.outputImage.values.length, 16 * 16);
  assert.ok(result.inputImage.max > 0);
  assert.ok(result.outputImage.max > 0);
  assert.ok(Math.max(...result.outputImage.values) <= 1 + 1e-12);
});

import assert from "node:assert/strict";
import test from "node:test";
import { materialsFromPacks, parseAgfCatalog, parseZmxSequential, validateLensPack, validateMaterialPack } from "../../packages/catalog/src/index.ts";
import { N_BK7, resolveMaterial } from "../../packages/materials/src/index.ts";
import { paraxialCard } from "../../packages/optics/src/index.ts";

test("ZMX parser creates a surface stack only when materials resolve", () => {
  const parsed = parseZmxSequential(
    `
SURF 1
  RADIUS 50
  DISZ 5
  GLAS N-BK7
  DIAM 12
SURF 2
  RADIUS -50
  DISZ 0
  GLAS AIR
  DIAM 12
`,
    { id: "sample", materials: [N_BK7] },
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.surfaces.length, 2);
    assert.equal(parsed.value.source, "zmx-import");
    assert.equal(parsed.value.surfaces[0]?.materialAfter, "N-BK7");
    assert.ok((paraxialCard(parsed.value).effectiveFocalLengthMm ?? 0) > 0);
  }
});

test("ZMX parser reports unresolved materials without substitution", () => {
  const parsed = parseZmxSequential(
    `
SURF 1
  RADIUS 50
  DISZ 5
  GLAS MYSTERY_GLASS
`,
    { materials: [N_BK7] },
  );
  assert.equal(parsed.ok, false);
  assert.deepEqual(parsed.unresolvedMaterials, ["MYSTERY_GLASS"]);
  assert.equal(parsed.warnings[0]?.code, "MATERIAL_UNKNOWN");
});

test("AGF parser creates local material models", () => {
  const parsed = parseAgfCatalog(`
NM TESTGLASS
CD 1.03961212 0.00600069867 0.231792344 0.0200179144 1.01046945 103.560653
`);
  assert.equal(parsed.materials.length, 1);
  const resolved = resolveMaterial("TESTGLASS", parsed.materials);
  assert.ok(resolved.material);
  assert.equal(resolved.material.formula, "sellmeier");
});

test("material and lens packs validate local catalog contracts", () => {
  const materialPack = {
    version: "0.1",
    id: "local-materials",
    displayName: "Local Materials",
    source: { sourceName: "unit-test", license: "local-only", citation: "synthetic" },
    materials: [N_BK7],
  } as const;
  const lensPack = {
    version: "0.1",
    id: "local-lenses",
    displayName: "Local Lenses",
    source: { sourceName: "unit-test", license: "local-only" },
    lenses: [{ kind: "thin-lens", id: "f100", displayName: "f=100 mm", focalLengthMm: 100, apertureRadiusMm: 10 }],
  } as const;
  assert.equal(validateMaterialPack(materialPack).ok, true);
  assert.equal(validateLensPack(lensPack).ok, true);
  assert.equal(materialsFromPacks([materialPack])[0]?.license, "local-only");
});

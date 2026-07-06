import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runHeadlessJobJson, runModeForgeProjectJson } from "../packages/api/src/index.ts";

const examplesDir = "examples";
const printSummary = process.argv.includes("--print-summary");
const exampleFiles = (await readdir(examplesDir)).filter((name) => name.endsWith(".modeforge.json")).sort();
const jobFiles = (await readdir(examplesDir)).filter((name) => name.endsWith(".headless.json")).sort();
const observed = [];

function stableNumber(value) {
  return Number(value.toPrecision(12));
}

function summarizeProject(file, result) {
  const beamline = result.value.beamline;
  return {
    file,
    kind: "modeforge-project",
    zGridCount: beamline.zGridMm.length,
    componentCount: beamline.components.length,
    matrixCount: beamline.matrices.length,
    waistCount: beamline.waists.length,
    finalRadiusXmm: stableNumber(beamline.envelope.radiusXmm.at(-1)),
    warningCount: result.value.warnings.length,
  };
}

function summarizeJob(file, result) {
  const value = result.value;
  if (value.kind === "two-lens-optimizer") {
    return {
      file,
      kind: value.kind,
      solutionCount: value.result.solutions.length,
      topScore: stableNumber(value.result.solutions[0]?.score ?? Number.NaN),
      warningCount: value.warnings.length,
    };
  }
  if (value.kind === "zmx-import") {
    return {
      file,
      kind: value.kind,
      ok: value.result.ok,
      surfaceCount: value.result.ok ? value.result.value.surfaces.length : 0,
      unresolvedCount: value.result.unresolvedMaterials.length,
      warningCount: value.warnings.length,
    };
  }
  if (value.kind === "agf-import") {
    return {
      file,
      kind: value.kind,
      materialCount: value.result.materials.length,
      warningCount: value.warnings.length,
    };
  }
  if (value.kind === "measured-beam-fit") {
    return {
      file,
      kind: value.kind,
      ok: value.result.ok,
      waistRadiusMm: stableNumber(value.result.waistRadiusMm ?? Number.NaN),
      m2: stableNumber(value.result.m2 ?? Number.NaN),
      warningCount: value.warnings.length,
    };
  }
  if (value.kind === "field-fresnel") {
    return {
      file,
      kind: value.kind,
      outputPower: stableNumber(value.result.outputPower),
      radiusXmm: stableNumber(value.result.momentRadiusXmm),
      warningCount: value.warnings.length,
    };
  }
  if (value.kind === "field-beamline") {
    return {
      file,
      kind: value.kind,
      planeCount: value.result.planes.length,
      probeCount: value.result.probes.length,
      radiusXmm: stableNumber(value.result.finalPlane.radiusXmm),
      analyticalRadiusXmm: stableNumber(value.result.analytical.envelope.radiusXmm.at(-1)),
      imageCount: value.result.image.values.length,
      warningCount: value.warnings.length,
    };
  }
  return { file, kind: value.kind };
}

assert.ok(exampleFiles.length > 0, "expected at least one headless example");

for (const file of exampleFiles) {
  const json = await readFile(join(examplesDir, file), "utf8");
  const result = runModeForgeProjectJson(json);
  assert.equal(result.ok, true, `${file} should run successfully`);
  if (result.ok) {
    assert.equal(result.value.version, "0.1");
    assert.ok(result.value.beamline.zGridMm.length > 0, `${file} should produce zGridMm`);
    assert.equal(result.value.beamline.envelope.radiusXmm.length, result.value.beamline.zGridMm.length);
    assert.ok(result.value.beamline.waists.length > 0, `${file} should produce waist data`);
    observed.push(summarizeProject(file, result));
  }
}

for (const file of jobFiles) {
  const json = await readFile(join(examplesDir, file), "utf8");
  const result = runHeadlessJobJson(json);
  assert.equal(result.ok, true, `${file} should run successfully`);
  if (result.ok) {
    assert.equal(result.value.version, "0.1");
    assert.equal(typeof result.value.kind, "string");
    observed.push(summarizeJob(file, result));
  }
}

if (printSummary) {
  console.log(JSON.stringify(observed, null, 2));
} else {
  const expected = JSON.parse(await readFile(join(examplesDir, "expected-headless-summary.json"), "utf8"));
  assert.deepEqual(observed, expected);
  console.log(`headless ok: ${exampleFiles.length} projects and ${jobFiles.length} jobs verified against expected summaries`);
}

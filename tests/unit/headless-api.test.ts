import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runHeadlessJobJson, runModeForgeProjectJson } from "../../packages/api/src/index.ts";

test("headless API runs the basic Gaussian example", () => {
  const json = readFileSync("examples/basic-gaussian.modeforge.json", "utf8");
  const result = runModeForgeProjectJson(json);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.version, "0.1");
    assert.equal(result.value.beamline.components.length, 2);
    assert.ok(result.value.beamline.envelope.radiusXmm.every((radius) => radius > 0));
  }
});

test("headless API returns validation errors instead of throwing", () => {
  const result = runModeForgeProjectJson(
    JSON.stringify({
      version: "0.1",
      beam: { kind: "unknown" },
      beamline: [],
    }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join("\n"), /beam kind/);
});

test("headless runner reports missing input file as a command error", () => {
  const run = spawnSync(process.execPath, ["scripts/run-headless.mjs", "examples/does-not-exist.modeforge.json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /ENOENT|no such file/i);
});

test("headless API runs optimizer, import, measurement, and field jobs", () => {
  for (const file of [
    "examples/two-lens-optimizer.headless.json",
    "examples/zmx-import.headless.json",
    "examples/measured-fit.headless.json",
    "examples/field-fresnel.headless.json",
    "examples/field-beamline.headless.json",
  ]) {
    const result = runHeadlessJobJson(readFileSync(file, "utf8"));
    assert.equal(result.ok, true, file);
    if (result.ok) assert.equal(result.value.version, "0.1");
  }
});

test("field-beamline job follows the actual beamline layout and returns an image grid", () => {
  const result = runHeadlessJobJson(readFileSync("examples/field-beamline.headless.json", "utf8"));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.kind, "field-beamline");
    assert.equal(result.value.result.analytical.components.length, 3);
    assert.equal(result.value.result.planes.some((plane) => plane.componentId === "focus-lens"), true);
    assert.equal(result.value.result.image.values.length, result.value.result.image.nx * result.value.result.image.ny);
    const analyticalRadius = result.value.result.analytical.envelope.radiusXmm.at(-1);
    assert.ok(analyticalRadius !== undefined);
    assert.ok(Math.abs(result.value.result.finalPlane.radiusXmm - analyticalRadius) / analyticalRadius < 0.25);
  }
});

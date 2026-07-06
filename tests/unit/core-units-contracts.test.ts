import assert from "node:assert/strict";
import test from "node:test";
import { mmToM, parseProjectJson, serializeProject, umToMm, validateBeamlineInput, warning } from "../../packages/core/src/index.ts";

test("unit conversions are explicit", () => {
  assert.equal(mmToM(2), 0.002);
  assert.equal(umToMm(1064), 1.064);
});

test("beamline validation rejects nonphysical Gaussian input", () => {
  const result = validateBeamlineInput({
    version: "0.1",
    beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: -1, waistPositionMm: 0 },
    components: [],
  });
  assert.equal(result.ok, false);
});

test("beamline validation rejects unknown runtime discriminators", () => {
  const result = validateBeamlineInput({
    version: "0.2",
    beam: { kind: "ray", wavelengthUm: 1.064 },
    components: [{ id: "mystery", kind: "unknown", lengthMm: 1 }],
    pulse: { durationFwhmS: 1e-12, shape: "triangle" },
  } as never);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join("\n"), /beamline version must be 0\.1/);
    assert.match(result.errors.join("\n"), /beam kind must be/);
    assert.match(result.errors.join("\n"), /component kind must be/);
    assert.match(result.errors.join("\n"), /pulse shape must be/);
  }
});

test("runtime validation rejects invalid thick-lens radius and incomplete pulse energy source", () => {
  const result = validateBeamlineInput({
    version: "0.1",
    beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.5, waistPositionMm: 0, m2: 0.9 },
    components: [{ id: "bad-lens", kind: "thick-lens", radius1Mm: 0, radius2Mm: "Infinity", thicknessMm: 5, refractiveIndex: 1.5 }],
    pulse: { durationFwhmS: 1e-12, shape: "gaussian", averagePowerW: 1 },
  } as never);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join("\n"), /m2 must be >= 1/);
    assert.match(result.errors.join("\n"), /radius1Mm must be non-zero/);
    assert.match(result.errors.join("\n"), /pulseEnergyJ or averagePowerW/);
  }
});

test("beamline validation rejects invalid optional z step", () => {
  const result = validateBeamlineInput({
    version: "0.1",
    beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.5, waistPositionMm: 0 },
    components: [],
    zStepMm: 0,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join("\n"), /zStepMm/);
});

test("warnings use stable codes", () => {
  assert.equal(warning("APERTURE_MARGIN_LOW", "margin").code, "APERTURE_MARGIN_LOW");
});

test("ModeForgeProject JSON roundtrips through contract validation", () => {
  const json = serializeProject({
    version: "0.1",
    beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.5, waistPositionMm: 0 },
    beamline: [{ id: "fs1", kind: "free-space", lengthMm: 100 }],
  });
  const parsed = parseProjectJson(json);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.beamline[0]?.id, "fs1");
});

test("ModeForgeProject JSON parser rejects invalid runtime-only shapes", () => {
  const parsed = parseProjectJson(
    JSON.stringify({
      version: "0.1",
      beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.5, waistPositionMm: 0 },
      beamline: [{ id: "bad", kind: "unknown", lengthMm: 1 }],
      pulses: { durationFwhmS: 1e-12, shape: "triangle", pulseEnergyJ: 1e-3 },
      display: { widthBasis: "mystery" },
    }),
  );
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.match(parsed.errors.join("\n"), /component kind must be/);
    assert.match(parsed.errors.join("\n"), /pulse shape must be/);
    assert.match(parsed.errors.join("\n"), /display\.widthBasis/);
  }
});

test("ModeForgeProject JSON parser rejects null optional objects when present", () => {
  const parsed = parseProjectJson(
    JSON.stringify({
      version: "0.1",
      beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.5, waistPositionMm: 0 },
      beamline: [],
      pulses: null,
      display: null,
    }),
  );
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.match(parsed.errors.join("\n"), /pulse must be an object/);
    assert.match(parsed.errors.join("\n"), /project display must be an object/);
  }
});

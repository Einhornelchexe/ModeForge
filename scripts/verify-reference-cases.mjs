// Manager-side cross-check for the S13 verification debates: runs the
// independently derived reference cases in agents/verification/*_cases.json
// against the real physics packages and reports every mismatch.
// Usage: node scripts/verify-reference-cases.mjs [fileFilter]

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  divergenceHalfAngleRad,
  gaussianRadiusAtZ,
  qAtZ,
  radiusFromQ,
  rayleighRangeMm,
  waistFromQ,
  freeSpaceMatrix,
  thinLensMatrix,
  refractiveSurfaceMatrix,
  composeMatrices,
  multiplyMatrices,
  transformQ,
  paraxialCard,
  simulateBeamline,
  surfaceStackMatrix,
  thickSphericalLensStack,
} from "../packages/optics/src/index.ts";
import { refractiveIndex, gvdFs2PerMm, gddFs2, dnDlambda } from "../packages/materials/src/index.ts";
import {
  pulseEnergyJ,
  temporalPeakFactor,
  peakPowerW,
  gaussianPeakFluenceJPerCm2,
  gaussianPeakIntensityWPerCm2,
} from "../packages/pulses/src/index.ts";
import {
  beamWidthToOneOverE2RadiusMm,
  d4SigmaDiameterToMomentRadiusMm,
  fwhmDiameterToOneOverE2RadiusMm,
  oneOverE2RadiusToFwhmDiameterMm,
  momentM2FromD4Sigma,
  hermiteGaussianM2,
  laguerreGaussianM2,
  fitGaussianBeamFromRadii,
} from "../packages/beams/src/index.ts";
import {
  applyCircularAperture,
  applySphericalSurfacePhase,
  applyThinLensPhase,
  createGaussianField,
  dft2,
  fieldMomentRadii,
  fieldPower,
  fieldSamplingWarnings,
  propagateAngularSpectrum,
  propagateFresnel,
  surfacePhaseSamplingWarnings,
} from "../packages/field/src/index.ts";
import { mm2ToCm2, mmToUm, umToMm } from "../packages/core/src/index.ts";
import { oneOverE2RadiusToBasisValueMm, runHeadlessJob } from "../packages/api/src/index.ts";

const flatten = (value, prefix = "") => {
  const out = {};
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
  } else {
    out[prefix] = value;
  }
  return out;
};

// S16 audit helpers: small uniform field factory for phase-mask probes
const uniformField = (n, dxMm, wavelengthUm) => {
  const base = createGaussianField({ nx: n, ny: n, dxMm, dyMm: dxMm, wavelengthUm, waistRadiusMm: 1 });
  return { ...base, real: base.real.map(() => 1), imag: base.imag.map(() => 0) };
};
const centerPhaseAt = (field, offset) => {
  const c = (field.nx - 1) / 2;
  const idx = c * field.nx + (c + offset);
  return Math.atan2(field.imag[idx], field.real[idx]);
};

// target -> (inputs) => actual value object. Keys of the returned object are
// matched against the case's `expected` keys (dot paths allowed).
const handlers = {
  // materials
  refractiveIndex: (i) => ({ n: refractiveIndex(i.material, i.wavelengthUm) }),
  gvdFs2PerMm: (i) => ({ gvdFs2PerMm: gvdFs2PerMm(i.material, i.wavelengthUm) }),
  gddFs2: (i) => ({ gddFs2: gddFs2(i.material, i.wavelengthUm, i.thicknessMm) }),
  dnDlambda: (i) => ({ dnDlambda: dnDlambda(i.material, i.wavelengthUm) }),
  // surface stacks
  paraxialCard: (i) => paraxialCard(i.stack, i.nBefore ?? 1),
  surfaceStackMatrix: (i) => surfaceStackMatrix(i.stack, i.nBefore ?? 1),
  thickSphericalLensStack: (i) => paraxialCard(thickSphericalLensStack(i)),
  // gaussian optics
  rayleighRangeMm: (i) => ({ rayleighRangeMm: rayleighRangeMm(i.waistRadiusMm, i.wavelengthUm, i.m2 ?? 1) }),
  divergenceHalfAngleRad: (i) => ({
    divergenceHalfAngleRad: divergenceHalfAngleRad(i.waistRadiusMm, i.wavelengthUm, i.m2 ?? 1),
  }),
  gaussianRadiusAtZ: (i) => ({
    radiusMm: gaussianRadiusAtZ(i.zFromWaistMm ?? i.zMm, i.waistRadiusMm, i.wavelengthUm, i.m2 ?? 1),
  }),
  qAtZ: (i) => {
    const q = qAtZ(i.zFromWaistMm ?? i.zMm, i.waistRadiusMm, i.wavelengthUm, i.m2 ?? 1);
    return { re: q.re, im: q.im, radiusMm: radiusFromQ(q, i.wavelengthUm, i.m2 ?? 1) };
  },
  radiusFromQ: (i) => ({ radiusMm: radiusFromQ(i.q, i.wavelengthUm, i.m2 ?? 1) }),
  transformQ: (i) => transformQ(i.q, i.matrix),
  waistFromQ: (i) => waistFromQ(i.q, i.wavelengthUm, i.m2 ?? 1),
  multiplyMatrices: (i) => multiplyMatrices(i.left, i.right),
  freeSpaceMatrix: (i) => freeSpaceMatrix(i.lengthMm),
  thinLensMatrix: (i) => thinLensMatrix(i.focalLengthMm),
  refractiveSurfaceMatrix: (i) => refractiveSurfaceMatrix(i.radiusMm, i.nBefore, i.nAfter),
  // thin-lens imaging of a waist via ABCD on q
  thinLensWaistImaging: (i) => {
    const q0 = qAtZ(i.distanceToLensMm, i.waistRadiusMm, i.wavelengthUm, i.m2 ?? 1);
    const m = composeMatrices([thinLensMatrix(i.focalLengthMm), freeSpaceMatrix(i.distanceToLensMm)]);
    const q1 = transformQ(q0, m);
    const w = waistFromQ(q1, i.wavelengthUm, i.m2 ?? 1);
    return { waistRadiusMm: w.waistRadiusMm, waistOffsetMm: w.waistOffsetMm, rayleighRangeMm: w.rayleighRangeMm };
  },
  // pulses
  pulseEnergyJ: (i) => ({ pulseEnergyJ: pulseEnergyJ(i) }),
  temporalPeakFactor: (i) => ({ factor: temporalPeakFactor(i.shape) }),
  peakPowerW: (i) => ({ peakPowerW: peakPowerW(i.energyJ, i.durationFwhmS, i.shape) }),
  gaussianPeakFluenceJPerCm2: (i) => ({
    fluenceJPerCm2: gaussianPeakFluenceJPerCm2(i.energyJ, i.radiusXmm, i.radiusYmm ?? i.radiusXmm),
  }),
  gaussianPeakIntensityWPerCm2: (i) => ({
    intensityWPerCm2: gaussianPeakIntensityWPerCm2(i.powerW, i.radiusXmm, i.radiusYmm ?? i.radiusXmm),
  }),
  // S16 final audit (edge cases for the newest field/stack code)
  s16SagPhase: (i) => {
    // long wavelength keeps |phi| < pi so no unwrap is needed
    const dx = 0.125;
    const field = uniformField(17, dx, 100);
    const out = applySphericalSurfacePhase(field, i.radiusMm, 1, 1.5);
    const k0 = (2 * Math.PI) / (100 / 1000);
    return { value: centerPhaseAt(out, Math.round(i.rMm / dx)) / (k0 * (1 - 1.5)) };
  },
  s16ThinLensPhase: (i) => {
    const field = uniformField(25, 0.01, i.wavelengthUm);
    const out = applyThinLensPhase(field, i.focalLengthMm);
    return { value: centerPhaseAt(out, Math.round(i.xMm / 0.01)) };
  },
  s16GuardThreshold: (i) => {
    // bisect the aperture radius at which the beam-edge phase step crosses pi
    const field = uniformField(9, i.dxMm, i.lambdaUm);
    const warns = (aperture) =>
      surfacePhaseSamplingWarnings(field, i.Rmm, 1, 1 + i.deltaN, aperture, 1e6).some((w) => w.severity === "warning");
    let lo = 0.5;
    let hi = i.Rmm * 0.99;
    for (let step = 0; step < 60; step += 1) {
      const mid = (lo + hi) / 2;
      if (warns(mid)) hi = mid;
      else lo = mid;
    }
    return { value: (lo + hi) / 2 };
  },
  s16ThickLensEfl: (i) => ({
    value: paraxialCard(
      thickSphericalLensStack({ id: "s16", radius1Mm: i.R1Mm, radius2Mm: i.R2Mm, thicknessMm: i.thicknessMm, refractiveIndex: i.n }),
    ).effectiveFocalLengthMm,
  }),
  s16ProbeAfterAperture: (i) => {
    const job = runHeadlessJob({
      kind: "field-beamline",
      input: {
        beamline: { version: "0.1", beam: i.beam, components: i.components },
        grid: { nx: i.gridN, ny: i.gridN, dxMm: i.gridDxMm, dyMm: i.gridDxMm },
        probesZmm: [0, ...i.probesZmm],
      },
    });
    const result = job.value.result;
    return { value: result.probes[1].power / result.probes[0].power };
  },
  s16Dft2Dc: (i) => {
    const field = uniformField(i.nx, 0.1, 1);
    const spectrum = dft2(field, false);
    return { dcReal: spectrum.real[0] };
  },
  s16StackReducedPath: (i) => {
    const result = simulateBeamline({
      version: "0.1",
      beam: { kind: "gaussian", wavelengthUm: 1.064, waistRadiusMm: 0.3, waistPositionMm: 0 },
      components: [
        {
          id: "s16-stack",
          kind: "surface-stack",
          surfaces: i.surfaces.map((s) => ({ radiusMm: "Infinity", thicknessAfterMm: s.thicknessAfterMm, refractiveIndexAfter: s.refractiveIndexAfter })),
        },
      ],
    });
    return { value: result.matrices[0].b };
  },
  // units
  mm2ToCm2: (i) => ({ value: mm2ToCm2(i.valueMm2 ?? i.value) }),
  mmToUm: (i) => ({ value: mmToUm(i.valueMm ?? i.value) }),
  umToMm: (i) => ({ value: umToMm(i.valueUm ?? i.value) }),
  // beams
  oneOverE2RadiusToFwhmDiameterMm: (i) => ({ fwhmDiameterMm: oneOverE2RadiusToFwhmDiameterMm(i.radiusMm) }),
  fwhmDiameterToOneOverE2RadiusMm: (i) => ({ radiusMm: fwhmDiameterToOneOverE2RadiusMm(i.fwhmDiameterMm) }),
  beamWidthToOneOverE2RadiusMm: (i) => ({ radiusMm: beamWidthToOneOverE2RadiusMm(i.value, i.basis) }),
  d4SigmaDiameterToMomentRadiusMm: (i) => ({ radiusMm: d4SigmaDiameterToMomentRadiusMm(i.d4SigmaDiameterMm) }),
  oneOverE2RadiusToBasisValueMm: (i) => ({ value: oneOverE2RadiusToBasisValueMm(i.radiusMm, i.basis) }),
  momentM2FromD4Sigma: (i) => ({
    m2: momentM2FromD4Sigma(i.d4SigmaDiameterMm, i.divergenceFullAngleRad, i.wavelengthUm),
  }),
  hermiteGaussianM2: (i) => hermiteGaussianM2(i.mode ?? { kind: "HG", m: i.m, n: i.n, waistRadiusMm: i.waistRadiusMm ?? 1 }),
  laguerreGaussianM2: (i) => ({
    m2: laguerreGaussianM2(i.mode ?? { kind: "LG", p: i.p, l: i.l, waistRadiusMm: i.waistRadiusMm ?? 1 }),
  }),
  fitGaussianBeamFromRadii: (i) => fitGaussianBeamFromRadii(i.measurements, i.wavelengthUm),
  // field (composite target strings as produced by the field debate)
  "applyCircularAperture / fieldPower": (i) => {
    const field = createGaussianField(i.field ?? i.gaussian);
    const before = fieldPower(field);
    const after = fieldPower(applyCircularAperture(field, i.apertureRadiusMm));
    return { transmission: after / before };
  },
  "propagateFresnel + fieldMomentRadii": (i) => {
    const field = createGaussianField(i.field ?? i.gaussian);
    const radii = fieldMomentRadii(propagateFresnel(field, i.distanceMm));
    return { radiusXmm: radii.radiusXmm, radiusYmm: radii.radiusYmm };
  },
  "propagateFresnel power conservation": (i) => {
    const field = createGaussianField(i.field ?? i.gaussian);
    return { powerRatio: fieldPower(propagateFresnel(field, i.distanceMm)) / fieldPower(field) };
  },
  "propagateAngularSpectrum power conservation": (i) => {
    const field = createGaussianField(i.field ?? i.gaussian);
    return { powerRatio: fieldPower(propagateAngularSpectrum(field, i.distanceMm)) / fieldPower(field) };
  },
  "applyThinLensPhase (axis=x) + propagateFresnel + fieldMomentRadii": (i) => {
    const field = createGaussianField(i.field ?? i.gaussian);
    const lensed = applyThinLensPhase(field, i.lensFocalLengthMm, i.lensAxis ?? "x");
    const radii = fieldMomentRadii(propagateFresnel(lensed, i.propagateDistanceMm ?? i.distanceMm));
    return { radiusXmm: radii.radiusXmm, radiusYmm: radii.radiusYmm };
  },
  fieldSamplingWarnings: (i) => {
    const field = createGaussianField(i.field ?? i.gaussian);
    return { warnings: fieldSamplingWarnings(field, i.beamRadiusMm) };
  },
  apertureTransmission: (i) => {
    const field = createGaussianField(i.gaussian);
    const before = fieldPower(field);
    const after = fieldPower(applyCircularAperture(field, i.apertureRadiusMm));
    return { transmission: after / before };
  },
  fieldFreePropagation: (i) => {
    const field = createGaussianField(i.gaussian);
    const inputPower = fieldPower(field);
    const prop = i.method === "angular-spectrum" ? propagateAngularSpectrum(field, i.distanceMm) : propagateFresnel(field, i.distanceMm);
    const radii = fieldMomentRadii(prop);
    return {
      powerRatio: fieldPower(prop) / inputPower,
      momentRadiusXmm: radii.radiusXmm,
      momentRadiusYmm: radii.radiusYmm,
    };
  },
};

const dir = "agents/verification";
const filter = process.argv[2] ?? "";
const files = (await readdir(dir)).filter((f) => f.endsWith("_cases.json") && f.includes(filter)).sort();
let pass = 0;
let fail = 0;
let skip = 0;
const failures = [];

for (const file of files) {
  const doc = JSON.parse(await readFile(join(dir, file), "utf8"));
  console.log(`\n== ${file} (${doc.domain}) — ${doc.cases.length} cases ==`);
  for (const c of doc.cases) {
    const handler = handlers[c.target];
    if (!handler) {
      console.log(`  SKIP  ${c.id} — no handler for target "${c.target}"`);
      skip += 1;
      continue;
    }
    let actual;
    try {
      actual = flatten(handler(c.inputs));
    } catch (error) {
      console.log(`  FAIL  ${c.id} — threw: ${error instanceof Error ? error.message : error}`);
      failures.push({ file, id: c.id, error: String(error) });
      fail += 1;
      continue;
    }
    let expected = flatten(c.expected);
    // single-value cases: tolerate naming differences between the worker's
    // expected key (often "value") and the handler's key
    const expKeys = Object.keys(expected);
    const actKeys = Object.keys(actual);
    if (expKeys.length === 1 && actKeys.length === 1 && expKeys[0] !== actKeys[0]) {
      expected = { [actKeys[0]]: expected[expKeys[0]] };
    }
    let ok = true;
    const details = [];
    for (const [key, exp] of Object.entries(expected)) {
      const act = actual[key];
      if (typeof exp !== "number") {
        const stable = (v) =>
          JSON.stringify(v, (_k, val) =>
            val !== null && typeof val === "object" && !Array.isArray(val)
              ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)))
              : val,
          );
        if (stable(act) !== stable(exp)) {
          ok = false;
          details.push(`${key}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(act)}`);
        }
        continue;
      }
      const tol = c.toleranceRel ?? 1e-9;
      const delta = Math.abs(act - exp);
      const bound = exp === 0 ? Math.max(tol, 1e-12) : Math.abs(exp) * Math.max(tol, 1e-12);
      if (!(typeof act === "number" && Number.isFinite(act) && delta <= bound)) {
        ok = false;
        const rel = exp !== 0 ? (delta / Math.abs(exp)).toExponential(2) : String(delta);
        details.push(`${key}: expected ${exp}, got ${act} (relΔ ${rel}, tol ${tol})`);
      }
    }
    if (ok) {
      console.log(`  PASS  ${c.id}`);
      pass += 1;
    } else {
      console.log(`  FAIL  ${c.id}\n        ${details.join("\n        ")}`);
      failures.push({ file, id: c.id, details });
      fail += 1;
    }
  }
}

console.log(`\nTOTAL: ${pass} pass, ${fail} fail, ${skip} skipped (no handler)`);
if (failures.length > 0) {
  console.log("Failures need manager triage: worker derivation error vs. real core bug.");
  process.exitCode = 1;
}

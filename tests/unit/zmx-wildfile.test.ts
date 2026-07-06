import assert from "node:assert/strict";
import test from "node:test";

import { parseZmxSequential } from "../../packages/catalog/src/index.ts";
import { paraxialCard } from "../../packages/optics/src/index.ts";

const singlet = "SURF 0\n  RADIUS 25.8\n  DISZ 5.3\n  GLAS N-BK7\n  DIAM 12.7\nSURF 1\n  RADIUS INFINITY\n  DISZ 0\n  DIAM 12.7\n";

test("S16 asphere terms block the import instead of importing a wrong sphere", () => {
  const asphere = "SURF 0\n  RADIUS 25.8\n  CONI -1.0\n  PARM 1 1e-5\n  DISZ 5.3\n  GLAS N-BK7\nSURF 1\n  RADIUS INFINITY\n  DISZ 0\n";
  const result = parseZmxSequential(asphere, { wavelengthUm: 0.5876 });
  assert.equal(result.ok, false);
  assert.ok(result.warnings.some((w) => w.severity === "error" && w.message.includes("Import blocked")));
  assert.ok(result.warnings.some((w) => w.message.includes("CONI") && w.message.includes("PARM")));
});

test("S16 coordinate breaks and mirrors block the import", () => {
  const folded = "SURF 0\n  COORDBRK\n  DISZ 10\nSURF 1\n  RADIUS 50\n  DISZ 0\n";
  const result = parseZmxSequential(folded, { wavelengthUm: 0.5876 });
  assert.equal(result.ok, false);
  assert.ok(result.warnings.some((w) => w.message.includes("COORDBRK")));
});

test("S16 explicit CONI 0 stays a sphere and imports fine", () => {
  const explicitSphere = "SURF 0\n  RADIUS 25.8\n  CONI 0\n  DISZ 5.3\n  GLAS N-BK7\nSURF 1\n  RADIUS INFINITY\n  DISZ 0\n";
  const result = parseZmxSequential(explicitSphere, { wavelengthUm: 0.5876 });
  assert.equal(result.ok, true);
});

test("S16 unrecognized keywords are reported once as info, known meta keywords stay silent", () => {
  const noisy = `VERS 260705\nMODE SEQ\nNAME test file\nUNIT MM\nWAVM 1 0.5876 1\nFOOBAR 12\nQUUX abc\n${singlet}`;
  const result = parseZmxSequential(noisy, { wavelengthUm: 0.5876 });
  assert.equal(result.ok, true);
  const infos = result.warnings.filter((w) => w.message.includes("Unrecognized ZMX keywords"));
  assert.equal(infos.length, 1);
  assert.ok(infos[0].message.includes("FOOBAR") && infos[0].message.includes("QUUX"));
  assert.ok(!infos[0].message.includes("VERS") && !infos[0].message.includes("WAVM"));
});

test("S16-R1 out-of-range Sellmeier blocks the import instead of returning NaN", () => {
  const zmx = "SURF 0\n  RADIUS 25.8\n  DISZ 5.3\n  GLAS N-BK7\nSURF 1\n  RADIUS INFINITY\n  DISZ 0\n";
  const result = parseZmxSequential(zmx, { wavelengthUm: 10 });
  assert.equal(result.ok, false);
  assert.ok(result.warnings.some((w) => w.severity === "error" && w.message.includes("not finite")));
});

test("S16-R1 UNIT INCH geometry is converted to mm with an info note", () => {
  const zmx = "UNIT IN\nSURF 0\n  RADIUS 1\n  DISZ 0.1\n  GLAS N-BK7\n  DIAM 0.5\nSURF 1\n  RADIUS INFINITY\n  DISZ 0\n";
  const result = parseZmxSequential(zmx, { wavelengthUm: 0.5876 });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(Math.abs((result.value.surfaces[0].radiusMm as number) - 25.4) < 1e-12);
    assert.ok(Math.abs(result.value.surfaces[0].thicknessAfterMm - 2.54) < 1e-12);
    assert.ok(Math.abs((result.value.surfaces[0].apertureRadiusMm ?? 0) - 12.7) < 1e-12);
  }
  assert.ok(result.warnings.some((w) => w.message.includes("converted to mm")));
  const bad = parseZmxSequential("UNIT FURLONG\nSURF 0\n  RADIUS 1\n  DISZ 0\n", { wavelengthUm: 0.5876 });
  assert.equal(bad.ok, false);
});

test("S16-R1 MIRR metadata is tolerated, GLAS MIRROR blocks the import", () => {
  // real Thorlabs exports carry "MIRR 2 0" on every refractive surface -
  // substrate metadata, NOT a mirror marker (see the wild-file test below)
  const mirrKeyword = parseZmxSequential(
    "SURF 0\n  MIRR 2 0\n  RADIUS 50\n  DISZ 3\n  GLAS N-BK7\nSURF 1\n  RADIUS INFINITY\n  DISZ 0\n",
    { wavelengthUm: 0.5876 },
  );
  assert.equal(mirrKeyword.ok, true);
  const glasMirror = parseZmxSequential("SURF 0\n  RADIUS 50\n  GLAS MIRROR\n  DISZ 0\n", { wavelengthUm: 0.5876 });
  assert.equal(glasMirror.ok, false);
  assert.ok(glasMirror.warnings.some((w) => w.message.includes("GLAS MIRROR")));
});

test("S16-R3 real-export skeleton: OBJ/IMA planes trimmed, image gap stays on the back face", () => {
  const zmx = [
    "VERS 140124 258 25548", "MODE SEQ", "UNIT MM",
    "SURF 0", "  CURV 0", "  DISZ INFINITY",
    "SURF 1", "  RADIUS 25.8", "  DISZ 5.3", "  GLAS N-BK7", "  DIAM 12.7",
    "SURF 2", "  RADIUS INFINITY", "  DISZ 45.5", "  DIAM 12.7",
    "SURF 3", "  CURV 0", "  DISZ 0",
  ].join("\n");
  const result = parseZmxSequential(zmx, { wavelengthUm: 0.5876 });
  assert.equal(result.ok, true);
  if (result.ok) {
    // OBJ (surf 0) and IMA (surf 3) trimmed; the lens itself remains
    assert.equal(result.value.surfaces.length, 2);
    assert.equal(result.value.surfaces[0].radiusMm, 25.8);
    assert.equal(result.value.surfaces[1].thicknessAfterMm, 45.5);
  }
  assert.ok(result.warnings.some((w) => w.severity === "info" && w.message.includes("trimmed")));
  assert.ok(!result.warnings.some((w) => w.severity === "error"), "no bogus DISZ INFINITY error anymore");
});

test("S16-R3 DISZ INFINITY on an optical surface blocks the import", () => {
  const zmx = "SURF 0\n  RADIUS 25.8\n  DISZ INFINITY\n  GLAS N-BK7\nSURF 1\n  RADIUS INFINITY\n  DISZ 0\n";
  const result = parseZmxSequential(zmx, { wavelengthUm: 0.5876 });
  assert.equal(result.ok, false);
  assert.ok(result.warnings.some((w) => w.message.includes("DISZ INFINITY")));
});

test("S16-R4 leading iris is kept, object plane at infinity is trimmed despite DIAM", () => {
  // real front iris: plane air surface, finite gap, aperture -> must survive
  const iris = "SURF 0\n  CURV 0\n  DISZ 5\n  DIAM 3\nSURF 1\n  RADIUS 25.8\n  DISZ 5.3\n  GLAS N-BK7\nSURF 2\n  RADIUS INFINITY\n  DISZ 0\n";
  const withIris = parseZmxSequential(iris, { wavelengthUm: 0.5876 });
  assert.equal(withIris.ok, true);
  if (withIris.ok) {
    assert.equal(withIris.value.surfaces.length, 3);
    assert.equal(withIris.value.surfaces[0].apertureRadiusMm, 3);
  }
  assert.ok(withIris.warnings.some((w) => w.message.includes("kept as an iris")));
  // Zemax OBJ plane: DISZ INFINITY with bookkeeping DIAM -> trimmed anyway
  const obj = "SURF 0\n  CURV 0\n  DISZ INFINITY\n  DIAM 10\nSURF 1\n  RADIUS 25.8\n  DISZ 5.3\n  GLAS N-BK7\nSURF 2\n  RADIUS INFINITY\n  DISZ 0\n";
  const withObj = parseZmxSequential(obj, { wavelengthUm: 0.5876 });
  assert.equal(withObj.ok, true);
  if (withObj.ok) assert.equal(withObj.value.surfaces.length, 2);
  // image plane with semi-diameter -> trimmed with an explicit note
  const ima = "SURF 0\n  RADIUS 25.8\n  DISZ 5.3\n  GLAS N-BK7\nSURF 1\n  RADIUS INFINITY\n  DISZ 40\nSURF 2\n  CURV 0\n  DISZ 0\n  DIAM 0.2\n";
  const withIma = parseZmxSequential(ima, { wavelengthUm: 0.5876 });
  assert.equal(withIma.ok, true);
  if (withIma.ok) assert.equal(withIma.value.surfaces.length, 2);
  assert.ok(withIma.warnings.some((w) => w.message.includes("image-plane semi-diameter")));
});

test("S16-R5 real Thorlabs-style export parses to the bare singlet", () => {
  // structure replicated from a real LA1116 export (values rounded):
  // full meta header, MIRR/SLAB/HIDE/POPS/FLAP per surface, DIAM 0 on OBJ,
  // DISZ INFINITY object distance, image distance on the plano back face
  const zmx = [
    "VERS 120928 0 30221", "MODE SEQ", "NAME Plano-Convex - N-BK7",
    "NOTE 0 FOR INFORMATION ONLY", "PFIL 0 0 0", "UNIT MM X W X CM MR CPMM",
    "ENPD 5.4", "GCAT SCHOTT INFRARED MISC", "WAVM 2 5.876E-1 1", "PWAV 2",
    "COFN QF \"COATING.DAT\"",
    "SURF 0", "  TYPE STANDARD", "  CURV 0.0 0 0 0 0 \"\"", "  HIDE 0 0 0", "  MIRR 2 0", "  SLAB 2",
    "  DISZ INFINITY", "  DIAM 0 0 0 0 1 \"\"", "  POPS 0 0 0",
    "SURF 1", "  COMM LA1116", "  STOP", "  TYPE STANDARD", "  CURV 1.941747572815534000E-001 0 0 0 0 \"\"",
    "  MIRR 2 0", "  DISZ 2.46", "  GLAS N-BK7 0 0 0 0 0 0 0 0 0 0", "  DIAM 3.0 1 0 0 1 \"\"", "  FLAP 0 3.0 0",
    "SURF 2", "  TYPE STANDARD", "  CURV 0.0 0 0 0 0 \"\"", "  MIRR 2 0", "  DISZ 7.765227030585", "  DIAM 3.0 1 0 0 1 \"\"",
    "SURF 3", "  TYPE STANDARD", "  CURV 0.0 0 0 0 0 \"\"", "  MIRR 2 0", "  DISZ 0", "  DIAM 1.120010135153E-1 0 0 0 1 \"\"",
    "BLNK ", "TOL TOFF   0   0", "MNUM 1 1", "MOFF   0   1 \"\"",
  ].join("\n");
  const result = parseZmxSequential(zmx, { wavelengthUm: 0.5876 });
  assert.equal(result.ok, true);
  assert.ok(!result.warnings.some((w) => w.severity === "error"), JSON.stringify(result.warnings));
  if (result.ok) {
    // OBJ and IMA trimmed -> plano-convex singlet: front R = 1/0.194175 = 5.15, back plane
    assert.equal(result.value.surfaces.length, 2);
    assert.ok(Math.abs((result.value.surfaces[0].radiusMm as number) - 5.15) < 0.001);
    assert.equal(result.value.surfaces[0].apertureRadiusMm, 3);
    // EFL check: R/(n-1) with n(N-BK7, 587.6nm) ~ 1.5168 -> ~9.97 mm (Thorlabs f = 10 mm)
    const card = paraxialCard(result.value);
    assert.ok(card.effectiveFocalLengthMm !== undefined && Math.abs(card.effectiveFocalLengthMm - 9.97) < 0.05,
      `EFL ${card.effectiveFocalLengthMm}`);
  }
});

test("S16-R7 NUL-interleaved text from a mis-decoded UTF-16 paste still parses", () => {
  const clean = "SURF 0\n  RADIUS 25.8\n  DISZ 5.3\n  GLAS N-BK7\nSURF 1\n  RADIUS INFINITY\n  DISZ 0\n";
  const interleaved = [...clean].join(String.fromCharCode(0));
  const result = parseZmxSequential(interleaved, { wavelengthUm: 0.5876 });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.surfaces.length, 2);
});

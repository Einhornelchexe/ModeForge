# ModeForge S10 Measured Beams Result

**Datum:** 2026-07-02.
**Status:** HOLD vor Commit, S10 Headless-Kernel geschlossen.
**Auftrag:** `Plan/HEADLESS_PHASES v1.md` S10 - Astigmatic and Measured Beam Support.
**Verweis:** `docs/theory/measured_beams.md`, `Plan/INDEX.md`.

---

## 0. Verdikt zuerst

**S10 liefert per-axis cylindrical-lens propagation, measured-beam Import und Fit-Diagnostik.** Circular Gaussian beams werden bei cylindrical optics in x/y propagation promoted; synthetische Messpunkte rekonstruieren Waist, Waist-Position und M2, und CSV/FWHM-Messdaten werden auf die interne Radiusbasis konvertiert.

---

## 1. Diff-Scope

**Neue Artefakte:**
- `packages/beams/src/fitting.ts`
- `docs/theory/measured_beams.md`
- `tests/unit/measured-beams.test.ts`

**Geaendert:**
- `packages/core/src/contracts.ts`
- `packages/core/src/validation.ts`
- `packages/optics/src/simulate.ts`
- `packages/beams/src/index.ts`

**Nicht geaendert:**
- kein `apps/web`
- keine UI-Komponenten
- keine neuen Dependencies

---

## 2. Inhalt

Der erste S10-Slice liefert:

- `cylindrical-lens` als BeamlineComponent.
- Per-axis ABCD-Anwendung fuer cylindrical lenses.
- `fitGaussianBeamFromRadii(measurements, wavelengthUm)`.
- `parseBeamWidthMeasurementsCsv(text, widthBasis)`.
- FWHM/D4sigma/RMS-Konvertierung zur internen 1/e^2-Radiusbasis.
- `residualRmsMm`, `maxRelativeResidual`, `MEASUREMENT_FIT_RESIDUAL_HIGH`.
- Quadratischer Fit von `w(z)^2 = a z^2 + b z + c`.

---

## 3. Verifikation

| Gate | Ergebnis | Evidenz |
|---|---|---|
| TypeScript | PASS | `npm.cmd run typecheck` -> Exit 0. |
| Unit Tests | PASS | `npm.cmd test` -> 50 Tests, 50 pass, 0 fail. |
| Scope-Check | PASS | `npm.cmd run check:scope` -> `scope ok: no UI app exists before S12`. |
| Headless Examples | PASS | `npm.cmd run verify:headless` -> `headless ok: 2 projects and 4 jobs verified against expected summaries`. |

---

## 4. Abschlussstand S10

Erfuellt sind die S10-Gates: qx/qy via per-axis propagation, cylindrical optics, Mx2/My2 ueber Beam-Contracts, CSV/JSON-nahe Measurement-Inputs, D4sigma/FWHM-Konvertierung, Fit-Qualitaet und synthetische Rekonstruktion innerhalb Toleranz.

Deferred bleibt ein separater Multi-Dataset-x/y-Fit; der Core-Vertrag kann ihn aus zwei `fitGaussianBeamFromRadii`-Laeufen zusammensetzen.

**Doc-Version:** 1.1, 2026-07-02.

# ModeForge S11 Field Mode Result

**Datum:** 2026-07-02.
**Status:** HOLD vor Commit, S11 Headless-Kernel geschlossen.
**Auftrag:** `Plan/HEADLESS_PHASES v1.md` S11 - Field Mode Numerical Propagation.
**Verweis:** `docs/theory/field_mode.md`, `Plan/INDEX.md`.

---

## 0. Verdikt zuerst

**S11 liefert einen kleinen, deterministischen Field-Mode-Kernel: ScalarField/Grid, naive unitary DFT-Fresnel, Angular-Spectrum, Circular Aperture, Power-Integration, Moment-Radii und Sampling-Warnings.** Der Kernel ist fuer kleine Headless-Validierungsgrids gedacht, nicht fuer grosse Produktions-FFT-Jobs.

---

## 1. Diff-Scope

**Neue Artefakte:**
- `packages/field/package.json`
- `packages/field/src/index.ts`
- `packages/field/src/scalar-field.ts`
- `docs/theory/field_mode.md`
- `tests/unit/field.test.ts`

**Geaendert:**
- `packages/core/src/warnings.ts`

**Nicht geaendert:**
- kein `apps/web`
- keine UI-Komponenten
- keine neuen Dependencies

---

## 2. Inhalt

Der erste Field-Slice liefert:

- `ScalarField`.
- `createGaussianField`.
- `propagateFresnel`.
- `propagateAngularSpectrum`.
- `fieldPower`.
- `fieldMomentRadii`.
- `applyCircularAperture`.
- `fieldSamplingWarnings`.

Die Fresnel-Propagation nutzt eine unitary 2D DFT und den paraxialen Transfer:

```text
H(fx, fy) = exp(-i * pi * lambda * z * (fx^2 + fy^2))
```

---

## 3. Verifikation

| Gate | Ergebnis | Evidenz |
|---|---|---|
| TypeScript | PASS | `npm.cmd run typecheck` -> Exit 0. |
| Unit Tests | PASS | `npm.cmd test` -> 50 Tests, 50 pass, 0 fail. |
| Scope-Check | PASS | `npm.cmd run check:scope` -> `scope ok: no UI app exists before S12`. |
| Headless Examples | PASS | `npm.cmd run verify:headless` -> `headless ok: 2 projects and 4 jobs verified against expected summaries`. |

---

## 4. Abschlussstand S11

Erfuellt sind die S11-Gates: Fresnel und Angular-Spectrum, Aperture, Sampling-Diagnostik, Energy Conservation und numerische Gaussian-Moment-Radii gegen analytisches Fast-Mode-Oracle.

Deferred bleiben schnelle FFT/worker paths fuer grosse Grids und kalibrierte Field-Imports; sie sind Performance-/Workflow-Erweiterungen, nicht Voraussetzung fuer den Headless-Kernel.

**Doc-Version:** 1.1, 2026-07-02.

# ModeForge S07 Headless API Result

**Datum:** 2026-07-02.
**Status:** HOLD vor Commit, S07 Headless-Contract geschlossen.
**Auftrag:** `Plan/HEADLESS_PHASES v1.md` S07 - Headless API, Examples, CLI/Runner Contracts.
**Verweis:** `Plan/INDEX.md`, `docs/architecture/API v1.md`.

---

## 0. Verdikt zuerst

**S07 liefert jetzt den Headless-Vertrag fuer Projekte und Rechenjobs: Projekt-JSON, Optimizer-, Import-, Measurement- und Field-Jobs laufen ohne UI zu typed Result-JSON und werden gegen deterministische Fixture-Summaries verifiziert.** Die spaetere UI kann damit gegen stabile Resultobjekte bauen, statt Physik im Frontend zu duplizieren.

---

## 1. Diff-Scope

**Neue Artefakte:**
- `packages/api/package.json`
- `packages/api/src/index.ts`
- `examples/basic-gaussian.modeforge.json`
- `examples/thick-lens-pulse.modeforge.json`
- `examples/*.headless.json`
- `examples/expected-headless-summary.json`
- `examples/README.md`
- `scripts/run-headless.mjs`
- `scripts/verify-headless.mjs`
- `docs/architecture/API v1.md`
- `tests/unit/headless-api.test.ts`

**Geaendert:**
- `package.json`
- `packages/core/src/validation.ts`

**Nicht geaendert:**
- kein `apps/web`
- keine UI-Komponenten
- keine neuen Dependencies

---

## 2. Inhalt

Headless API:

- `projectToBeamlineInput(project)`.
- `runModeForgeProject(project)`.
- `runModeForgeProjectJson(json)`.
- `runHeadlessJob(input)`.
- `runHeadlessJobJson(json)`.

Runner:

- `node scripts/run-headless.mjs <project.modeforge.json|job.headless.json> [output.json]`.
- `npm.cmd run verify:headless`.
- Datei-I/O-Fehler im Runner werden als CLI-Fehler mit Exit-Code `1` gemeldet.
- Simulation-Exceptions im JSON-Pfad werden als `ValidationResult` statt als Throw nach aussen gegeben.
- `verify-headless` vergleicht stabile Summaries gegen `examples/expected-headless-summary.json`.

Beispiele:

- `examples/basic-gaussian.modeforge.json`.
- `examples/thick-lens-pulse.modeforge.json`.
- `examples/two-lens-optimizer.headless.json`.
- `examples/zmx-import.headless.json`.
- `examples/measured-fit.headless.json`.
- `examples/field-fresnel.headless.json`.

---

## 3. Verifikation

| Gate | Ergebnis | Evidenz |
|---|---|---|
| TypeScript | PASS | `npm.cmd run typecheck` -> Exit 0. |
| Unit Tests | PASS | `npm.cmd test` -> 50 Tests, 50 pass, 0 fail. |
| Scope-Check | PASS | `npm.cmd run check:scope` -> `scope ok: no UI app exists before S12`. |
| Headless Examples | PASS | `npm.cmd run verify:headless` -> `headless ok: 2 projects and 4 jobs verified against expected summaries`. |
| Runner Smoke | PASS | `node scripts/run-headless.mjs examples/basic-gaussian.modeforge.json` -> `ok: true`, BeamlineResult mit zGrid, envelope, waists, components, matrices. |

---

## 4. Abschlussstand S07

Erfuellt sind die S07-Pflichtpunkte aus `Plan/HEADLESS_PHASES v1.md`: Public Entry Points, versionierte Resultobjekte, Projekt- und Job-Beispiele, CLI-Runner, deterministische Fixture-Summaries und keine DOM-/React-/Browser-Abhaengigkeit.

Deferred ist nur Komfort-Doku aus generierten Typedoc-Exports; das ist kein S07-Gate.

## 5. DeepSeek-Review-Follow-up

Ein read-only DeepSeek-V4-Pro/max Review-Retry scheiterte nach Provider-Output mit `worker_response_args_invalid_json`, lieferte aber im Parse-Snippet verwertbare Findings. Gefixt wurden:

| Finding | Status | Fix |
|---|---|---|
| `runModeForgeProjectJson` sollte Simulation-Exceptions als `ValidationResult` kapseln. | gefixt | Try/catch um `runModeForgeProject`. |
| `scripts/run-headless.mjs` sollte Datei-I/O-Fehler sauber melden. | gefixt | Try/catch mit stderr und Exit-Code `1`. |
| `zStepMm` war im Runtime-Validator nicht validiert. | gefixt | Optional-positive Validation plus Test. |

**Doc-Version:** 1.1, 2026-07-02.

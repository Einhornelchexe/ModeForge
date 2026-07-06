# ModeForge S06 Core Hardening - Runtime Validation Result

**Datum:** 2026-07-02.
**Status:** HOLD vor Commit, S06 geschlossen.
**Auftrag:** `Plan/HEADLESS_PHASES v1.md` S06 - Core Hardening and Physics Invariants.
**Verweis:** `Plan/INDEX.md`, `docs/architecture/CONVENTIONS.md`.

---

## 0. Verdikt zuerst

**S06 ist als Core-Haertungsschritt implementiert und verifiziert: JSON-/Runtime-Validation lehnt unbekannte Discriminators und physikalisch ungueltige Pflichtfelder ab; Aperture-Warnings werden global und komponentennah gespiegelt; Matrix-, SurfaceStack- und Pulse-Helfer werfen bei nichtphysikalischen Direkteingaben.** Das schliesst konkrete Luecken zwischen TypeScript-Compile-Time-Typen, JSON-Runtime-Inputs und den Headless-Resultvertraegen.

---

## 1. Orchestrierung-Trail

Ein kleiner `Implementierungs-Lauf` wurde mit DeepSeek V4 Pro/max versucht. Die Orchestrierung blockierte den Task vor dem Provider-Call mit `disallowed_file_type`, Stage `before_provider_call`, `Retry-Flag=false`, ohne Kosten. Deshalb wurde der eng begrenzte TypeScript-Patch durch den Manager angewendet.

Hinweis: Ein vorheriger Hintergrundversuch ueber einen kurzlebigen stdio-Orchestrierung-Prozess blieb als queued Session `ws_0e254d3c8e9f4b3887c2d39fa0a1a620` stehen; fuer weitere stdio-Orchestrierung-Calls werden synchrone Calls verwendet, solange kein langlebiger HTTP-Orchestrierung-Prozess aktiv ist.

---

## 2. Diff-Scope

**Geaendert:**
- `packages/core/src/validation.ts`
- `packages/core/src/project.ts`
- `packages/optics/src/matrix.ts`
- `packages/optics/src/simulate.ts`
- `packages/optics/src/surface-stack.ts`
- `packages/pulses/src/pulses.ts`
- `tests/unit/core-units-contracts.test.ts`
- `tests/unit/fast-core.test.ts`
- `tests/unit/materials-pulses.test.ts`
- `tests/unit/profiles-simulation.test.ts`
- `docs/validation/reference_cases.md`

**Nicht geaendert:**
- kein `apps/web`
- keine UI-Komponenten
- keine neuen Dependencies

---

## 3. Inhalt

Runtime-Validation ist jetzt strenger fuer:

- unbekannte `BeamInput.kind` Werte,
- unbekannte `BeamlineComponent.kind` Werte,
- unbekannte `PulseInput.shape` Werte,
- falsche `BeamlineInput.version`,
- fehlende Pflichtfelder wie Waist-Position oder Moment-M2,
- physikalisch ungueltiges `m2 < 1`,
- finite Thick-Lens-Radien mit `0` statt `"Infinity"`,
- unvollstaendige Pulse-Energiequelle,
- ungueltiges `display.widthBasis` in `ModeForgeProject`.
- `pulses: null` oder `display: null` in Projekt-JSON werden als invalide optionale Objekte erkannt.
- `zStepMm` wird als optionaler positiver Wert validiert.
- Aperture-Warnings werden nicht nur in `BeamlineResult.warnings`, sondern auch in `ComponentResult.warnings` am betroffenen Component-Eintrag abgelegt.
- Matrix-Helfer pruefen finite ABCD-Eintraege, nicht-null Thin-Lens-Fokus und positive Refractive Indices.
- SurfaceStack-Helfer lehnen negative Dicken und nichtpositive Medien ab.
- Pulse-Helfer lehnen zero/negative Energie, Dauer, Repetition Rate und Strahlradien ab; unbekannte Pulse-Shapes fallen nicht mehr still auf rectangular zurueck.

---

## 4. Verifikation

| Gate | Ergebnis | Evidenz |
|---|---|---|
| TypeScript | PASS | `npm.cmd run typecheck` -> Exit 0. |
| Unit Tests | PASS | `npm.cmd test` -> 50 Tests, 50 pass, 0 fail. |
| Scope-Check | PASS | `npm.cmd run check:scope` -> `scope ok: no UI app exists before S12`. |
| Headless Regression | PASS | `npm.cmd run verify:headless` -> `headless ok: 2 projects and 4 jobs verified against expected summaries`. |

---

## 5. Abschlussstand S06

Erfuellt sind die S06-Gates: Runtime-Validation, Formula-/Invariant-Tests fuer bestehende Core-Pfade, Warning-Propagation, dokumentierte Referenzfaelle und `check:scope` ohne `apps/web`.

**Doc-Version:** 1.1, 2026-07-02.

# ModeForge - Headless Computation Phases v1

**Datum:** 2026-07-02.
**Status:** PLAN-v1.
**Grundlage:** `Plan/PLAN v3.md`, `Plan/MASTERPLAN v1.md`, `Plan/SUBPHASENPLAN v1.md`, `Plan/S00_S05_IMPLEMENTATION_RESULT.md`.
**Ausloeser:** Nutzerentscheidung, zuerst alle Rechen-/Headless-Sachen fertigzustellen und Frontend/Design erst danach via Claude Design zu bauen.

---

## 0. Verdikt zuerst

**S06-S11 werden als Headless-Rechenphasen neu geschnitten; UI/Claude Design beginnt erst danach.** Damit wird ModeForge zuerst eine stabile TypeScript-Rechenplattform mit API, Optimizer, Importern, Messdatenmodellen und Field Mode. `apps/web` bleibt bis zum UI-Handoff verboten.

---

## 1. Orchestrierung-Plan-Trail

Die Revision wurde mit der `Hybrid-Planungsrezept`-Methode erstellt: drei DeepSeek-V4-Pro/max Plan-Drafts aus verschiedenen Winkeln, danach Manager-Grounding gegen den realen Repo-Stand.

| Draft | Modell/Routing | Ergebnis |
|---|---|---|
| core-risk-first | DeepSeek V4 Pro, max effort | ok; Schwerpunkt Physik-Invarianten, Tests, Field-Risiken. |
| api-optimizer-first | DeepSeek V4 Pro, max effort | ok; Schwerpunkt Headless API, Optimizer, Contracts. |
| import-field-first | DeepSeek V4 Pro, max effort | ok; Schwerpunkt Catalog/AGF/ZMX, Measured Beam, Field Mode. |

Routing-Ehrlichkeit: Der erste Provider-Versuch wurde durch Sandbox-Netzwerkrechte blockiert (`worker_http_error`, `WinError 10013`, `Retry-Flag=true`, Stage `during_provider_call`). Der Retry lief mit freigegebenem Netzwerkzugriff ueber denselben lokalen `private Orchestrierungsschicht` und lieferte drei ok-Drafts. Die Rohdaten liegen transient unter `(privates Orchestrierungs-Verzeichnis)/headless_plan_drafts_2026-07-02.json` und werden nicht als Commit-Artefakt behandelt.

---

## 2. Grounding gegen Repo

| Behauptung | Grounding |
|---|---|
| S00-S05 existieren als Core-Basis. | `packages/core`, `packages/optics`, `packages/beams`, `packages/materials`, `packages/pulses`, `packages/validation`, `tests/unit`. |
| UI existiert noch nicht. | `scripts/check-scope.mjs` und `tests/unit/scaffold.test.ts` pruefen, dass `apps/web` nicht existiert. |
| Optimizer existiert noch nicht. | Kein `packages/optimizer` im Repo. |
| Catalog/Importer existiert noch nicht. | Kein `packages/catalog` im Repo. |
| Field Mode existiert noch nicht. | Kein `packages/field` im Repo; `tests/unit/profiles-simulation.test.ts` markiert statische Profile explizit als nicht propagiert. |
| Aktuelle Contracts sind startfaehig, aber nicht final. | `packages/core/src/contracts.ts` enthaelt Beamline-, Pulse- und Project-Typen; Optimizer-, Import-, Field- und Measurement-Resulttypen fehlen noch. |

---

## 3. Verbindlicher Headless-Schnitt

Wo dieser Plan dem alten `MASTERPLAN v1` oder `SUBPHASENPLAN v1` widerspricht, gilt diese Headless-Revision fuer S06-S12.

| Phase | Neuer Scope | Abhaengigkeit | Gate |
|---|---|---|---|
| S06 | Core Hardening and Physics Invariants | S00-S05 | Jede vorhandene Formel hat Test, Referenz oder dokumentierte Toleranz; keine UI. |
| S07 | Headless API, Examples, CLI/Runner Contracts | S06 | JSON-Projekt rein, typed JSON-Result raus; Beispielprojekte laufen ohne UI. |
| S08 | Optimizer Kernel | S07 | Ranked telescope/focus solutions mit Constraints, Sensitivity und Referenztests. |
| S09 | Import, Catalog, Material Library | S06-S08 | ZMX/AGF/sample import ohne stille Materialsubstitution; Warnings sind typed. |
| S10 | Astigmatic and Measured Beam Support | S06-S08 | qx/qy, cylindrical optics und synthetic measurement fit reproduzieren bekannte Parameter. |
| S11 | Field Mode Numerical Propagation | S06-S10 | Gaussian numerical propagation gegen Fast-Mode-Oracle, Energy Conservation und Sampling-Warnings. |
| S12 | Claude Design UI Handoff | S07-S11 | UI rendert nur Core-/Worker-Resultate; keine Formelduplikate in UI. |

---

## 4. S06 - Core Hardening and Physics Invariants

**Ziel:** Bestehenden Fast/Core physikalisch haerten, bevor neue Module auf ihm aufbauen.

**Scope:**
- Matrix-Konventionen, determinant/symplectic checks, Medien-Konventionen.
- Gaussian/q/M2/D4sigma/Rayleigh/divergence Referenzen.
- Surface-stack, thick lens, slab, material dispersion und pulse edge cases.
- Warning propagation und Validation fuer fehlerhafte Inputs.
- Kein neues Produktfeature ohne Referenztest.

**Artefakte:**
- Erweiterte `packages/validation` Referenzfaelle.
- Mehr Tests in `tests/unit`.
- Aktualisierte Theorie-Doku in `docs/theory` und `docs/validation`.

**Gate:** `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run check:scope` PASS; kein `apps/web`.

---

## 5. S07 - Headless API, Examples, CLI/Runner Contracts

**Ziel:** Eine stabile headless Schnittstelle definieren, gegen die spaeter Claude Design rendert.

**Scope:**
- Public API-Kontrakt: stabile Entry Points, Versionierung, Result-Objekte.
- `examples/*.modeforge.json` und erwartete Result-Fixtures.
- Headless Runner oder Script, das Projekt-JSON validiert und Result-JSON erzeugt.
- Resulttypen fuer Optimizer, Import, Measurement und Field als Vorab-Vertraege.
- Keine DOM-, React- oder Browser-Abhaengigkeit.

**Artefakte:**
- `docs/architecture/API v1.md`.
- `examples/`.
- `scripts/verify-headless.mjs` oder aequivalenter Test-Harness.
- Contract-Tests fuer JSON roundtrips.

**Gate:** Beispielprojekte liefern deterministische Result-JSONs; alle Result-Felder tragen Units oder eindeutig dokumentierte dimensionslose Bedeutung.

---

## 6. S08 - Optimizer Kernel

**Ziel:** Telescope/focus optimizer als reines Rechenmodul bauen.

**Scope:**
- `packages/optimizer` mit `OptimizationInput`, `OptimizationResult`, Ranking und Warnings.
- Two-lens Kepler/Galilei Suche ueber User-Lens-Listen.
- Targets: waist, target plane, diameter, optional fluence/intensity aus PulseResult.
- Constraints: Distanzen, Aperture Margin, fixed planes, beamline length.
- Sensitivity: lens shift, focal length, M2 uncertainty.

**Artefakte:**
- `packages/optimizer`.
- `tests/unit/optimizer.test.ts`.
- `docs/theory/optimizer.md`.

**Gate:** Bekannte Telescope-Faelle werden gefunden und gerankt; unmoegliche Constraints erzeugen typed warnings statt stiller Leerresultate.

---

## 7. S09 - Import, Catalog, Material Library

**Ziel:** Praktische Optik-/Materialdaten lokal und lizenzsauber als Headless-Module verarbeiten.

**Scope:**
- `packages/catalog` fuer ZMX sequential surface parsing und AGF glass parsing.
- Material alias resolver und user/imported material database.
- Runtime schemas fuer Lens/Material Packs.
- ImportResult mit Warnings, unresolved materials, source/license metadata.
- Keine proprietaeren Vendor-Daten im Repo ausser explizit erlaubten Mini-Samples.

**Artefakte:**
- `packages/catalog`.
- Parser-Tests mit erlaubten Samples.
- `docs/theory/imports.md` oder `docs/validation/import_cases.md`.

**Gate:** Import ersetzt Material niemals still; SurfaceStackOptic aus Sample-ZMX ist validierbar und paraxial auswertbar.

---

## 8. S10 - Astigmatic and Measured Beam Support

**Ziel:** Reale x/y-Beams und Messdaten ohne Field Mode abbilden.

**Scope:**
- qx/qy Propagation als explizites Modell.
- Cylindrical lens component und per-axis ABCD-Anwendung.
- Mx2/My2, unterschiedliche Waist-Positionen, D4sigma/FWHM-Konvertierung.
- Measurement import format fuer Beam-width points.
- Fit von waist, divergence und M2 mit Fit-Qualitaetswarnings.

**Artefakte:**
- Erweiterungen in `packages/beams`, `packages/optics`, `packages/core`.
- `tests/unit/measured-beams.test.ts`.
- `docs/theory/measured_beams.md`.

**Gate:** Synthetische Messpunkte rekonstruieren bekannte waist/divergence/M2 innerhalb dokumentierter Toleranz.

---

## 9. S11 - Field Mode Numerical Propagation

**Ziel:** Numerische Feldpropagation erst nach stabiler analytischer Basis bauen.

**Scope:**
- `packages/field` mit ScalarField/Grid types.
- Fresnel und angular-spectrum propagation.
- Aperture masks und clipping diffraction.
- Sampling diagnostics, energy conservation und aliasing warnings.
- Gaussian Field Oracle gegen Fast Mode; HG/LG Field spaeter nur mit Validierung.

**Artefakte:**
- `packages/field`.
- `tests/unit/field.test.ts`.
- `docs/theory/field_mode.md`.
- Headless examples fuer kleine deterministic grids.

**Gate:** Numerische Gaussian propagation bleibt innerhalb Toleranz zum analytischen Radius; Energy Conservation und Sampling-Warnings sind getestet.

---

## 10. Agent-Split fuer S06-S11

| Rolle | Primaerer Scope | Nicht erlaubt |
|---|---|---|
| Core-Agent DeepSeek V4 Pro max | Kleine Rechenmodule, Contract-Erweiterungen, Tests. | UI, Design, ungetestete Formeln. |
| Validation-Agent DeepSeek V4 Pro max | Referenzfaelle, Toleranzen, Theorie-Doku. | Features ohne Oracle. |
| Import-Agent DeepSeek V4 Pro max | Parser, Material-Pack-Schemas, Import-Warnings. | Proprietaere Daten bundlen. |
| Field-Agent DeepSeek V4 Pro max | Numerische Propagation und Sampling-Diagnostik. | UI-Visualisierung, grosse ungepruefte FFT-APIs. |
| Manager | Scope, Grounding, Patch-Review, Tests, Index. | Worker-Summaries blind uebernehmen. |
| User via Claude Design | Erst ab S12 UI/UX/Visualisierung. | Physikformeln im Frontend. |

---

## 11. Abschlussregel

Eine Headless-Phase gilt erst als abgeschlossen, wenn:

1. Artefakte existieren.
2. Tests fuer ihren Scope gruen sind.
3. `npm.cmd run check:scope` bestaetigt, dass kein `apps/web` existiert.
4. `Plan/INDEX.md` aktualisiert ist.
5. Offene Risiken in der naechsten Phase explizit weitergefuehrt werden.

**Doc-Version:** 1.0, 2026-07-02.

# ModeForge - Masterplan v1

**Datum:** 2026-07-02.
**Status:** PLAN-v1.
**Grundlage:** `Plan/PLAN v3.md`.
**Erstellt durch:** Manager-Synthese aus Orchestrierung-Plan-Breadth mit DeepSeek-V4-Pro/max.

---

## 0. Verdikt zuerst

**ModeForge wird zuerst als statische, browser-lokale, testbare Physikplattform gebaut, nicht als UI-Spielwiese und nicht als Client/Server-App.** Der Masterplan schneidet `PLAN v3.md` in 14 Subphasen: zuerst Vertrage, Definitionen, Core und Validierung; danach UI, Worker, Release; danach Optimizer, Real-Beam-Features, Field Mode, Lab Library und Advanced-Module.

Der Plan ist bewusst `PLAN-v1`: Er ist grounded gegen die vorhandene Datei `Plan/PLAN v3.md`, aber noch nicht durch eine zweite unabhaengige Cross-Review-Runde terminal bestaetigt.

---

## 1. Grounding

Aktuell existiert im Projekt noch keine Produktiv-Codebasis. Vorhanden sind:

- `Plan/PLAN v3.md`
- `.mcp.json`
- gitignorierter Orchestrierung-State unter `(privates Orchestrierungs-Verzeichnis)/`

Alle Pfade aus `PLAN v3.md` wie `apps/web`, `packages/core`, `packages/optics` oder `docs/theory` sind daher **Zielpfade, nicht vorhandene Dateien**.

| Quelle | Relevanz fuer Masterplan |
|---|---|
| `Plan/PLAN v3.md:1` | Produktname, statische Web-App, UI/Core/Worker/Optional-Backend. |
| `Plan/PLAN v3.md:56` | Simulation Modes: Fast, Moment, Field, Pulse. |
| `Plan/PLAN v3.md:196` | Beam/Profile-Modelle, M^2 ist Qualitaetsparameter, kein Profil. |
| `Plan/PLAN v3.md:232` | Optische Komponenten. |
| `Plan/PLAN v3.md:262` | Surface-stack und Thick-Lens-Modell. |
| `Plan/PLAN v3.md:365` | Catalog Import und Material/Dispersion. |
| `Plan/PLAN v3.md:652` | Telescope and Focus Optimizer. |
| `Plan/PLAN v3.md:748` | Main UI Panels. |
| `Plan/PLAN v3.md:816` | Validation Strategy. |
| `Plan/PLAN v3.md:850` | Roadmap Stage 0-6. |
| `Plan/PLAN v3.md:999` | Frontend + browser-local computation core. |
| `Plan/PLAN v3.md:1052` | Ziel-Monorepo-Struktur. |
| `Plan/PLAN v3.md:1181` | Core API Contracts. |
| `Plan/PLAN v3.md:1376` | Static-hosting compatibility. |
| `Plan/PLAN v3.md:1493` | First public release definition. |

---

## 2. Nicht verhandelbare Architekturregeln

1. UI implementiert keine Physik. React/Svelte-Komponenten duerfen keine Strahlformeln enthalten.
2. Core ist pure TypeScript ohne DOM/React-Abhaengigkeit.
3. Worker sind fuer teure Jobs zustaendig, liefern aber normale typisierte Resultate.
4. Der erste ernsthafte Release bleibt GitHub-Pages/static-hosting-kompatibel.
5. Material- und Vendor-Dateien bleiben lokal beim User, sofern keine explizite Lizenz zum Bundling vorliegt.
6. Jede Formel bekommt mindestens einen Test oder eine Referenzrechnung.
7. Definitionen fuer `radius`, `diameter`, `1/e^2`, `FWHM`, `D4sigma`, `M^2`, Vorzeichen und Einheiten werden vor Implementierung fixiert.
8. Frontend-Design, visuelle Ausgestaltung, Interaktionsdesign und finale Visualisierung gehoeren dir und werden spaeter separat via Claude Design umgesetzt. Bis einschliesslich S05 bauen wir nur Rechenbasis, Datenvertraege, Tests und ggf. minimale technische Schnittstellen.

---

## 3. Masterphasen

| Phase | Ziel | Abhaengig von | Hauptartefakte | Gate |
|---|---|---|---|---|
| S00 Governance and scaffold | Repo-, Doku-, Tooling- und Orchestrierung-Arbeitsweise festlegen. | PLAN v3 | Monorepo-Skelett, Doku-Konvention, Test-Runner, CI-Basis. | Build/Test-Kommandos laufen leer oder mit Minimaltests. |
| S01 Contracts and definitions | Einheiten, physikalische Definitionen, Datenvertraege, Warning-Codes fixieren. | S00 | Contract-Package, Theorie-Notiz, Validation Fixtures. | Kein Core-Code ohne akzeptierte Definitionen. |
| S02 Fast Core base | ABCD, q-Parameter, Free Space, Thin Lens, Gaussian TEM00. | S01 | `packages/core`, `packages/optics`, erste Tests. | Analytical Gaussian/Thin-Lens Tests gruen. |
| S03 Materials, surface stack, pulse base | Materialinterface, Thick Lens, Surface Stack, Pulse-Grundformeln. | S02 | `packages/materials`, `packages/pulses`, SurfaceStack types. | EFL/BFL/FFL, GDD/Pulse-Basis gegen Referenzen getestet. |
| S04 Validation catalogue | Validierungsfaelle, Theorie-Doku, numerische Toleranzen. | S02-S03 | `docs/theory`, `docs/validation`, fixtures. | Jede Formel aus S02/S03 hat Oracle. |
| S05 Profile and Stage-1 core | Elliptical, M^2, HG/LG Envelope, statische Profile, Warnings. | S01-S04 | Beam modules, Warning taxonomy, JSON contracts. | Stage-1-Core komplett ohne UI-Formeln. |
| S06 Static UI shell | App Shell, Panels, Plots, Result Rendering. | S05 Contracts | `apps/web`, UI adapters. | UI zeigt Core-Resultate, keine Formelduplikate. |
| S07 Worker and local data | Worker API, IndexedDB, Import-Shell. | S06 + Contracts | `packages/worker-api`, persistence adapters. | Worker roundtrip typed, UI bleibt responsive. |
| S08 First public release | Stage-1-Release harden: docs, examples, export/import, deployment. | S00-S07 | README, examples, deployed static build. | First release definition erfuellt ohne Backend. |
| S09 Optimizer | Telescope/focus optimizer mit Constraints und Sensitivity. | S03-S08 | `packages/optimizer`, worker jobs, UI panel. | Ranking + Sensitivity gegen Referenzfaelle getestet. |
| S10 Astigmatic and measured beams | qx/qy, Mx^2/My^2, Cylindrical Lens, Measurement Fit. | S05 + S09 | Real-beam models, fit routines. | Messpunkte -> Fit -> propagation reproduzierbar. |
| S11 Field Mode | FFT/Fresnel/angular spectrum, apertures, sampling warnings. | S04 + S07 | `packages/field`, worker jobs, validation docs. | Energy/sampling/oracle tests gruen. |
| S12 Lab library and catalog | ZMX/AGF, Material Packs, User Lens Library. | S03 + S07 | `packages/catalog`, material conversion scripts. | Import cards zeigen Warnings; keine lizenzwidrigen Daten. |
| S13 Advanced and optional backend | Thermal lens, cavity, nonlinear, backend convenience. | S08-S12 | Optional modules, backend only if justified. | Local open-source core bleibt reproduzierbar. |

---

## 4. Agent-Aufteilung

Die Arbeit wird nicht als einzelner grosser Auftrag vergeben. Pro Subphase gibt es kleine Orchestrierung-Tasks mit klarer Write-Scope.

| Agent-Rolle | Primaerer Scope | Nicht erlaubt |
|---|---|---|
| Core-Agent DeepSeek V4 Pro max | Physik-Core, Datenmodelle, Tests, Validierung. | UI-Komponenten mit Formeln. |
| Validation-Agent DeepSeek V4 Pro max | Referenzfaelle, Testtoleranzen, Theorie-Doku. | Neue Physik ohne Testanker. |
| UI-Agent / User via Claude Design | App Shell, Panels, Plots, UX, Styling, visuelle Ausgestaltung. | Physikformeln, Materialmodelle, Optimizerlogik. |
| Worker-Agent DeepSeek V4 Pro max | Worker API, Parser-Jobs, Optimizer-Jobs, Field-Jobs. | Direkter UI-State als Physikquelle. |
| Review-Agent | Lueckenpruefung, Phantom-Check, Gate-Review. | Unbelegte Datei-/Zeilenbehauptungen. |
| Manager | Scope, Entscheidung, Patch-Review, Apply, Tests, Status. | Blindes Uebernehmen von Worker-Summary. |

---

## 5. Eingearbeitete Review-Korrekturen

| ID | Severity | Masterplan-Entscheidung |
|---|---|---|
| R-1 | HIGH | S01 muss M^2, D4sigma, Radius/Diameter/FWHM und q-/Moment-Konventionen fixieren, bevor S02/S05 beginnt. |
| R-2 | HIGH | Surface-Radius-Signatur und Lichtausbreitungsrichtung werden in S01/S03 testbar festgelegt. |
| R-3 | HIGH | Stage-1-Super-Gaussian/Top-hat wird als statische Profilvisualisierung oder explizite Approximation behandelt; echte Propagation kommt erst S11. |
| R-4 | HIGH | Full Optimizer ist S09, nicht Voraussetzung fuer S08. S08 darf nur einen einfachen Telescope Calculator enthalten, falls er sauber aus Core-Funktionen kommt. |
| R-5 | MED | S04 ist eigene Validierungsphase, nicht Nebenprodukt. |
| R-6 | MED | Worker-API bekommt eigene Fehler-/Progress-Kontrakte in S07. |
| R-7 | MED | Material-Pack-Konvertierung und manuelle Sellmeier-Eingaben bekommen Validierungs-Gates. |
| R-8 | LOW | Lizenz/SPDX, AI-assisted code policy, URL-Length und clientseitiger Report-Export werden vor Public Release entschieden. |

---

## 6. Build-Regel je Subphase

Jede Subphase laeuft nach demselben Orchestrierung-Manager-Rhythmus:

1. Scope aus diesem Masterplan und `SUBPHASENPLAN v1.md` lesen.
2. Kontext-Bundle previewen.
3. Budget setzen.
4. Einen kleinen Worker-Task delegieren.
5. Rohantwort und Diff lesen.
6. Patch anwenden nur nach Manager-Review.
7. Tests/Build ausfuehren.
8. Ergebnis und Status im Index nachziehen.

---

## 7. Headless-Revision v2 - verbindlich ueber S06-S12

**Status:** PLAN-v2 fuer den Phasenschnitt ab S06.
**Datum:** 2026-07-02.
**Grundlage:** `Plan/HEADLESS_PHASES v1.md`.

Die urspruengliche Reihenfolge `S06 UI -> S07 Worker -> S08 Release -> S09 Optimizer` wird durch die Nutzerentscheidung ueberholt, zuerst alle Rechensachen fertigzustellen. **Wo diese Revision dem v1-Body widerspricht, gilt diese Revision.**

| # | Severity | Revision |
|---|---|---|
| HR-1 | HIGH | `S06` ist nicht mehr Static UI Shell, sondern Core Hardening and Physics Invariants. |
| HR-2 | HIGH | `S07` ist Headless API, Examples und CLI/Runner Contracts statt UI-nahe Worker/Persistence. |
| HR-3 | HIGH | `S08` ist Optimizer Kernel als reines Rechenmodul. |
| HR-4 | HIGH | `S09` ist Import, Catalog, Material Library. |
| HR-5 | HIGH | `S10` ist Astigmatic and Measured Beam Support. |
| HR-6 | HIGH | `S11` ist Field Mode Numerical Propagation. |
| HR-7 | HIGH | `S12` wird der Claude Design UI Handoff; `apps/web` bleibt bis dahin verboten. |

**Konsequenz:** Die Build-Regel aus Abschnitt 6 bleibt gueltig, aber der Scope wird ab S06 aus `Plan/HEADLESS_PHASES v1.md` genommen.

**Doc-Version:** 1.1, 2026-07-02. PLAN-v2 fuer S06-S12.

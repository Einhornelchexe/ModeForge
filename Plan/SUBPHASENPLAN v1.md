# ModeForge - Subphasenplan v1

**Datum:** 2026-07-02.
**Status:** PLAN-v1.
**Grundlage:** `Plan/PLAN v3.md`, `Plan/MASTERPLAN v1.md`.
**Hinweis:** Alle Codepfade in diesem Dokument sind Zielpfade. Sie existieren aktuell noch nicht.

---

## 0. Verdikt zuerst

**Die Umsetzung wird in kleine, testbare Subphasen geschnitten; jede Subphase produziert entweder belastbare Vertrage, Core-Code mit Tests, UI ohne Physikformeln oder ein klar isoliertes Worker-/Import-Modul.** Field Mode, Full Catalog Library und Advanced Modules werden bewusst nach hinten geschoben, damit die analytische Basis nicht durch Scope-Druck verwischt.

**Arbeitsaufteilung:** Bis einschliesslich S05 wird zuerst die Rechenbasis gebaut: Definitionen, Contracts, Core-Physik, Validierung und testbare Resultatobjekte. Frontend-Design, visuelle Ausgestaltung, Interaktionsdesign und finale Visualisierung sind nicht Teil dieser ersten Build-Strecke; sie werden ab S06 separat durch dich via Claude Design auf Basis der stabilen Core-/Worker-Resultate umgesetzt.

---

## S00 - Governance, Scaffold, Build-Rahmen

**Ziel:** Aus dem Plan-Repo ein arbeitsfaehiges Monorepo machen, ohne Fachlogik zu implementieren.

**Scope:**
- Package Manager, TypeScript, Test-Runner, Lint, Format, CI/Build-Script.
- Zielstruktur aus `PLAN v3.md:1052`: `apps/web`, `packages/*`, `docs/*`, `tests/*`, `examples/*`.
- Doku-Konvention und Orchestrierung-Workflow fixieren.

**Agent-Split:**
- Core-Agent: Monorepo- und Package-Grenzen.
- Validation-Agent: Test-Runner und Beispiel-Minimaltest.
- Manager: prueft, dass keine Physikformeln eingebaut wurden.

**Artefakte:**
- Monorepo-Skelett.
- `docs/architecture/CONVENTIONS.md` oder aequivalenter Workflow-Hinweis.
- Minimaler Build-/Test-Output.

**Gate:** `npm test` oder aequivalenter Testbefehl laeuft mit mindestens einem harmlosen Infrastrukturtest.

---

## S01 - Definitionen, Units, Contracts, Warnings

**Ziel:** Alle physikalischen und API-seitigen Begriffe festlegen, bevor Formeln implementiert werden.

**Scope:**
- Definitionen fuer `radius`, `diameter`, `1/e^2`, `FWHM`, `rms`, `D4sigma`, `M^2`, `BPP`.
- Radiensignatur fuer optische Flaechen: Lichtausbreitung, positive/negative Krummungsradien.
- Contract-Typen aus `PLAN v3.md:1181`: `BeamInput`, `BeamlineInput`, `BeamlineResult`, `PulseInput`, `PulseResult`, `SimulationWarning`, `ModeForgeProject`.
- Einheitenregel: Felder tragen explizite Unit-Suffixe wie `radiusMm`, `wavelengthUm`, `powerW`, `energyJ`; interne Hilfstypen verhindern UI/Core/Worker-Mismatch.
- Warning taxonomy mit stabilen Codes.

**Agent-Split:**
- Core-Agent: Type definitions und Zod/Schema-Validierung.
- Validation-Agent: Definitions-Oracle und Fixture-Beispiele.
- Review-Agent: prueft Inkonsistenzen zwischen Fast/Moment/Pulse/Field-Begriffen.

**Artefakte:**
- `packages/core` Contract- und Unit-Basis.
- `docs/theory/definitions.md`.
- Contract-Tests fuer Validierung und Unit-Konvertierung.

**Gate:** Kein Core-Feature aus S02 darf starten, solange M^2, D4sigma und Radius-Signatur nicht testbar dokumentiert sind.

---

## S02 - Fast Core Basis: ABCD, q-Parameter, Free Space, Thin Lens

**Ziel:** Das kleinste vertrauenswuerdige analytische Strahlpropagationsmodul bauen.

**Scope:**
- ABCD-Matrix-Typen und Matrix-Komposition.
- Freiraum-Propagation.
- Gaussian q-Parameter.
- Thin Lens.
- Gaussian TEM00 Envelope fuer `BeamlineResult`.
- Erste Clipping-/Paraxial-Warnings als reine Core-Warnings.

**Agent-Split:**
- Core-Agent: Implementierung in `packages/optics` und `packages/beams`.
- Validation-Agent: analytische Referenzfaelle.
- Manager: kontrolliert, dass UI unberuehrt bleibt.

**Artefakte:**
- Unit-Tests: Free-space Gaussian, Rayleigh range, Thin-lens q-transform.
- `docs/theory/fast_mode.md`.

**Gate:** Analytical reference tests gruen; keine React/DOM-Abhaengigkeit im Core.

---

## S03 - Thick Lens, Surface Stack, Material- und Pulse-Basis

**Ziel:** Die USP-Basis aus PLAN v3 bauen: thick-lens/surface-stack statt nur focal length.

**Scope:**
- `SurfaceStackOptic` und `OpticalSurface` aus `PLAN v3.md:296`.
- Curved refractive surface, plane slab/window, thick spherical lens.
- Material interface: constant-n und erster Sellmeier-Pfad.
- Compact core material pack fuer wenige sichere Materialien.
- Pulse-Basis: average power, rep rate, energy, peak power, fluence/intensity ohne Nonlinearitaet.

**Agent-Split:**
- Core-Agent: Surface-stack und thick-lens paraxial matrices.
- Validation-Agent: EFL/BFL/FFL/Principal planes fuer konkrete Referenzlinsen.
- Core-Agent: Pulse-Formeln mit Shape-Factors.

**Artefakte:**
- `packages/materials`, `packages/pulses`, `packages/optics`.
- Tests fuer Slab, Thick Lens, Surface Stack, Pulse conversions.
- Warnings fuer unknown/constant material and dispersion disabled.

**Gate:** Surface-stack berechnet EFL/BFL/FFL reproduzierbar; Pulse-Tests gegen bekannte Formeln.

---

## S04 - Validation Catalogue and Theory Docs

**Ziel:** Validierung als Produktbestandteil etablieren, nicht als Nacharbeit.

**Scope:**
- Referenzkatalog fuer alle Formeln aus S02/S03.
- Toleranzregeln und Einheiten-Normalisierung.
- Cross-check-Skripte oder Fixtures fuer spaetere Regressionen.
- Dokumentierte Sign- und Radiuskonvention.

**Agent-Split:**
- Validation-Agent: Testkatalog und fixtures.
- Review-Agent: Phantom-Check gegen echte Testausgaben.
- Manager: entscheidet Toleranzen, wenn numerisch strittig.

**Artefakte:**
- `docs/validation/reference_cases.md`.
- `packages/validation` oder `tests/unit` fixtures.

**Gate:** Jede in S02/S03 produktiv verwendete Formel hat einen benannten Testfall.

---

## S05 - Profiles and Stage-1 Core Completeness

**Ziel:** Die Stage-1-Core-Funktionen ohne Field-Mode-Uebergriff komplettieren.

**Scope:**
- Elliptical Gaussian.
- Mx^2/My^2 propagation nach S01-Definition.
- HG/LG Envelope und statische Field-Visualisierungsdaten, ohne echte Field-Propagation.
- Super-Gaussian/Top-hat nur als statische Profilvisualisierung oder explizit markierte Approximation.
- JSON import/export Contracts.

**Agent-Split:**
- Core-Agent: Beam/Profile-Modelle.
- Validation-Agent: Normalisierung und Definitionstests.
- Review-Agent: prueft, dass kein Field-Mode-Versprechen in Stage 1 gerutscht ist.

**Artefakte:**
- `packages/beams`.
- Tests fuer elliptical, M^2, HG/LG metadata, static profiles.

**Gate:** Stage-1-Core kann `BeamlineResult` fuer Gaussian, elliptical und M^2 liefern; Top-hat/Super-Gaussian ist klar als nicht-propagiert gekennzeichnet.

---

## S06 - Static UI Shell

**Ziel:** Eine nutzbare Web-Oberflaeche bauen, die ausschliesslich Core-/Worker-Resultate rendert.

**Ownership:** Diese Phase ist der Handoff an dich/Claude Design fuer Frontend, Design, Visualisierung und UX. Die Orchestrierung-/DeepSeek-Seite liefert bis dahin stabile Contracts, Core-Funktionen, Worker-Schnittstellen und Tests; sie schreibt keine finalen Designentscheidungen vor.

**Scope:**
- App Shell mit Panels aus `PLAN v3.md:748`.
- Beam Input, Beamline Component List, Output Panel, Warning Cards.
- Envelope Plot und Profile Plot aus `BeamlineResult`.
- Keine Formeln in UI-Komponenten.

**Agent-Split:**
- User via Claude Design / UI-Agent: Layout, Komponenten, Interaktion, visuelle Ausgestaltung.
- Core-Agent: fehlende Contract-Felder nach Bedarf.
- Manager: scannt UI-Code auf Formelduplikate.

**Artefakte:**
- `apps/web`.
- UI integration tests fuer display-value == core-result.

**Gate:** Aenderung eines Inputs erzeugt validiertes Core-Result und aktualisiert Plot/Warnungen; UI enthaelt keine Strahlformeln.

---

## S07 - Worker API, Local Persistence, Import Shell

**Ziel:** Teure Jobs und lokale Daten sauber kapseln.

**Scope:**
- Typed Worker API fuer parse/optimizer/material-pack jobs.
- Progress- und Error-Codes.
- IndexedDB fuer Projekte, User-Materials, Lens Library.
- localStorage nur fuer UI preferences.
- Import shell: upload -> worker parse -> summary card -> confirm.

**Agent-Split:**
- Worker-Agent: `packages/worker-api`.
- UI-Agent: Import dialogs and persistence UX.
- Review-Agent: failure states, browser compatibility.

**Artefakte:**
- Worker roundtrip tests.
- Persistence roundtrip for `ModeForgeProject`.

**Gate:** Worker kann Stub-Parse und Stub-Optimizer typed ausfuehren; UI bleibt responsive; gespeichertes Projekt reproduziert dasselbe Resultat.

---

## S08 - First Public Release Hardening

**Ziel:** Den ersten oeffentlichen Release aus Stage 1 stabil, dokumentiert und static-hosting-faehig machen.

**Scope:**
- GitHub Pages/static deployment.
- README, Screenshots, Beispiele.
- JSON project import/export.
- Theory/validation docs.
- Basic telescope calculator nur, wenn er aus S02/S03-Core kommt; full optimizer bleibt S09.
- Experimental ZMX import nur, wenn S07/S12-Teile schon sicher genug sind; sonst klar deferred.
- Lizenzentscheidung und SPDX-Regel.

**Agent-Split:**
- UI-Agent: Release UX and docs screenshots.
- Validation-Agent: release examples.
- Review-Agent: static-hosting, license, legal, README honesty.

**Artefakte:**
- Deployed static build.
- Example projects.
- Public release checklist.

**Gate:** Erster Release ist nutzbar ohne Backend, Login, API-Key oder proprietaere Daten.

---

## S09 - Telescope and Focus Optimizer

**Ziel:** Das erste grosse Lab-Design-Feature bauen.

**Scope:**
- Two-lens search over user-provided lens list.
- Kepler/Galilei options.
- Target waist, target plane, target diameter, fluence/intensity if PulseResult exists.
- Constraints: distances, beamline length, aperture margin, fixed planes.
- Ranking metric and sensitivity: lens shift, focal length, M^2 uncertainty.
- Worker execution for sweeps.

**Agent-Split:**
- Core-Agent: optimizer kernel and objective functions.
- Worker-Agent: optimizer job execution.
- UI-Agent: optimizer panel.
- Validation-Agent: known telescope cases and sensitivity fixtures.

**Artefakte:**
- `packages/optimizer`.
- Optimizer panel.
- Reference cases and ranking tests.

**Gate:** Optimizer returns ranked solutions with warnings and sensitivity table; no silent impossible constraints.

---

## S10 - Astigmatic and Measured Beams

**Ziel:** Reale Beam-Imperfektionen abbilden.

**Scope:**
- qx/qy propagation.
- Mx^2/My^2 and different waist positions.
- Cylindrical lens.
- Import measured beam-width points.
- Fit waist, divergence, M^2.
- Compare measurement to model.

**Agent-Split:**
- Core-Agent: x/y models and cylindrical optics.
- Validation-Agent: fit fixtures.
- UI-Agent: measurement import and comparison plots.

**Artefakte:**
- Astigmatic beam result contracts.
- Measurement import format.
- Fit diagnostics.

**Gate:** Synthetic measurement points can be fitted back to known waist/divergence/M^2 within tolerance.

---

## S11 - Field Mode

**Ziel:** Numerische Feldpropagation erst bauen, wenn analytischer Core stabil ist.

**Scope:**
- Scalar Field type and grid model.
- Fresnel and angular-spectrum propagation.
- Aperture masks and clipping diffraction.
- Sampling diagnostics.
- HG/LG field propagation.
- Imported CSV/image intensity only after calibration rules are set.

**Agent-Split:**
- Core-Agent: numerical field algorithms.
- Worker-Agent: FFT/propagation jobs.
- Validation-Agent: energy normalization, sampling and aperture tests.
- UI-Agent: field visualization.

**Artefakte:**
- `packages/field`.
- Field worker jobs.
- Field theory and sampling docs.

**Gate:** Energy conservation and sampling warnings are tested; UI blocks invalid grids before misleading plots are shown.

---

## S12 - Lab Library, ZMX/AGF, Material Packs

**Ziel:** Praktische Lab-Workflows und importierte Optiken sauber ermoeglichen.

**Scope:**
- User lens library.
- ZMX sequential surface parser.
- AGF glass catalog parser.
- Alias resolver with user confirmation.
- Build-time material conversion to compact JSON packs.
- Legal/license metadata per material source.
- Missing material workflow.

**Agent-Split:**
- Worker-Agent: parser and pack loading.
- Core-Agent: material resolver and dispersion functions.
- UI-Agent: import cards and warnings.
- Review-Agent: legal/licensing and substitution honesty.

**Artefakte:**
- `packages/catalog`.
- Runtime material pack schema.
- Import summary cards.
- Parser tests with allowed sample files.

**Gate:** Import never silently substitutes material; all warnings are visible before user confirmation.

---

## S13 - Advanced Modules and Optional Backend

**Ziel:** Spaetere Module nur nach stabiler lokaler Core-Basis.

**Scope:**
- Thermal lens placeholder.
- Cavity/resonator calculator.
- Nonlinear-crystal geometry.
- GDD/chirp module.
- Grating/prism estimates.
- Mode decomposition.
- Vector-field module.
- GPU acceleration.
- Optional backend only for accounts/cloud/collab/heavy compute.

**Agent-Split:**
- Manager: entscheidet, ob Modul den Scope wert ist.
- Core-Agent: module-specific physics only with validation.
- Backend-Agent: optional convenience layer, niemals Pflicht fuer Core.

**Artefakte:**
- Module RFC before implementation.
- Separate validation plan per advanced module.

**Gate:** Local open-source core reproduces main results without server.

---

## Abschlussregel

Eine Subphase gilt erst als abgeschlossen, wenn:

1. Artefakte existieren.
2. Tests/Build fuer ihren Scope gruen sind.
3. Review-Agent oder Manager-Review keine HIGH/MED Blocker offen laesst.
4. `Plan/INDEX.md` aktualisiert ist.
5. Der naechste Subphase-Scope nicht heimlich erweitert wurde.

---

## Headless-Revision v2 - verbindlich ueber S06-S12

**Status:** PLAN-v2 fuer den Subphasen-Schnitt ab S06.
**Datum:** 2026-07-02.
**Grundlage:** `Plan/HEADLESS_PHASES v1.md`.

Der v1-Body bleibt als Historie erhalten. **Wo diese Revision den alten S06-S13-Abschnitten widerspricht, gilt diese Revision.**

| Alt | Neu | Verbindlicher Scope |
|---|---|---|
| S06 Static UI Shell | S06 Core Hardening and Physics Invariants | Formeln, Warnings, Referenzen und Edge Cases haerten; kein UI. |
| S07 Worker API, Local Persistence, Import Shell | S07 Headless API, Examples, CLI/Runner Contracts | JSON-Projekt rein, typed Result-JSON raus; Beispiele und API-Kontrakte. |
| S08 First Public Release Hardening | S08 Optimizer Kernel | Telescope/focus optimizer als reines Rechenmodul mit Referenztests. |
| S09 Telescope and Focus Optimizer | S09 Import, Catalog, Material Library | ZMX/AGF, Materialdaten, ImportResult, keine stille Substitution. |
| S10 Astigmatic and Measured Beams | S10 Astigmatic and Measured Beam Support | qx/qy, cylindrical optics, Messdaten-Fit. |
| S11 Field Mode | S11 Field Mode Numerical Propagation | Field/Grid, Fresnel/angular spectrum, Sampling/Energy-Gates. |
| S12 Lab Library, ZMX/AGF, Material Packs | S12 Claude Design UI Handoff | UI/UX/Visualisierung durch User via Claude Design, keine Frontend-Formeln. |
| S13 Advanced Modules and Optional Backend | S13 Release/Advanced nach UI-Handoff | Public Release Hardening und optionale Advanced-Module nach stabiler Headless- und UI-Schicht. |

**Konsequenz:** Fuer Implementierung ab S06 ist `Plan/HEADLESS_PHASES v1.md` die operative SSOT.

**Doc-Version:** 1.1, 2026-07-02. PLAN-v2 fuer S06-S12.

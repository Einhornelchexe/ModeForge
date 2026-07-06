# ModeForge Plan-Index

**Datum:** 2026-07-05.
**Status:** S16 Release Hardening abgeschlossen: Physik-Core doppelt extern gegengeprueft (Debatte + GPT-5.5 R1/R2 PASS), MIT/README/Deploy-Prep fertig, sanitisierter Public-Mirror bereit. Livegang wartet nur noch auf die Betreiber-Schalter (Repo public, DEPLOY_PAGES, DNS).
**Grundlage:** `Plan/PLAN v3.md`.
**Zweck:** Schneller Einstieg in die aktuelle Plan-Dokumentation und den Aufbau-Trail.

---

## Pflege-Konvention

1. Nach jedem abgeschlossenen Plan-, Implementierungs- oder Review-Schritt wird dieser Index aktualisiert.
2. Neue Eintraege stehen newest-first im passenden Block.
3. Status bleibt strikt: `PLAN-v1`, `NEEDS-REVISION`, `PLAN-READY`, `HOLD`, `PASS`, `STOP, melden`.
4. Zukunftspfade wie `apps/web` werden als zu erstellende Pfade markiert, solange sie im Repo nicht existieren; existierende Core-Pfade werden als Arbeitsstand gefuehrt.
5. Worker-/Reviewer-Routing wird ehrlich dokumentiert: Modell, Effort, Kosten und ob echte Repo-Dateien geprueft wurden.

---

## Plan-Artefakte

| Artefakt | Status | Inhalt |
|---|---|---|
| `Plan/PLAN v3.md` | Ausgangsplan | Produktvision, Architektur, Roadmap, technische Zielstruktur. |
| `Plan/MASTERPLAN v1.md` | PLAN-v1 | Manager-Synthese: verbindlicher Phasenschnitt und Build-Reihenfolge. |
| `Plan/SUBPHASENPLAN v1.md` | PLAN-v1 | Detaillierte Subphasenplaene mit Scope, Gates, Artefakten und Agent-Split. |
| `Plan/PLAN_REVIEW v1.md` | Diagnose-only | DeepSeek-Agent-Trail, Grounding, Luecken-/Ungenauigkeiten-Review. |
| `Plan/S00_S05_IMPLEMENTATION_RESULT.md` | HOLD vor Commit | S00-S05 Implementierungsergebnis, Verifikation, DeepSeek-Review-Fixes und UI-Grenze. |
| `Plan/HEADLESS_PHASES v1.md` | PLAN-v1 | Neue verbindliche Headless-Rechenphasen S06-S11; UI/Claude Design erst ab S12. |
| `Plan/S06_CORE_HARDENING_RUNTIME_VALIDATION_RESULT.md` | HOLD vor Commit | S06 geschlossen: Runtime-Validation, Component-Warning-Propagation und Public-Core-Invarianten gehaertet; 50/50 Tests. |
| `Plan/S07_HEADLESS_API_RESULT.md` | HOLD vor Commit | S07 geschlossen: Headless API, Runner, Projekt-/Job-Beispiele und Fixture-Verifier; 50/50 Tests plus 2 Projekte und 4 Jobs gegen Expected Summaries. |
| `Plan/S08_OPTIMIZER_RESULT.md` | HOLD vor Commit | S08 geschlossen: Two-lens optimizer kernel, Radius/Diameter/Waist/Pulse-Ziele, Constraints und Position/Focal/M2-Sensitivity; 50/50 Tests. |
| `Plan/S09_IMPORT_CATALOG_RESULT.md` | HOLD vor Commit | S09 geschlossen: ZMX/AGF parser, Material-/Lens-Pack-Vertraege und Material-Resolution ohne stille Substitution; 50/50 Tests. |
| `Plan/S10_MEASURED_BEAMS_RESULT.md` | HOLD vor Commit | S10 geschlossen: cylindrical lens per-axis propagation, measured CSV import, FWHM/D4sigma-Konvertierung und Fit-Residualdiagnostik; 50/50 Tests. |
| `Plan/S11_FIELD_MODE_RESULT.md` | HOLD vor Commit | S11 geschlossen: ScalarField, Fresnel und Angular-Spectrum, aperture, moment-radii oracle, power and sampling tests; 50/50 Tests. |
| `Plan/S06_S11_COMPLETION_AUDIT.md` | HOLD vor Commit, PASS | Abschluss-Audit: S06-S11 gegen `HEADLESS_PHASES v1` geprueft; typecheck/test/check:scope/verify:headless PASS. |
| `Plan/S17_MODES_GUIDE_RESULT.md` | live | S17 (Live-Reports): echte HG/LG-Moden-Felder (Rekurrenzen, ISO-Taillensemantik, 6 analytische Orakel inkl. Selbstaehnlichkeit <1%) + guide.html DE/EN mit ehrlicher Grenzen-Doku; 99/99 Tests. |
| `Plan/S16_RELEASE_HARDENING_RESULT.md` | auf main | S16: finale Debatte fand 1 echten Probe-Reihenfolge-Defekt (gefixt, Orakel als Gate 52->60); GPT-5.5-R1 "no formula/convention error", 6 Import-/Vertragsraender reproduziert+gefixt, R2 PASS; Gemini-Cross fand 1 echten HIGH (Startphasen-Vorzeichen, beidseitig 1e-9 gefixt) + OBJ/IMA-Trim + Margin-Eintritt, GPT-5.5-R3 CONFIRMED (+Iris-Randfall gefixt); 90/90 Tests; MIT, README, Wild-ZMX-Ehrlichkeit, Pages-Workflow, Firefox-Smoke, sanitisierter Ein-Commit-Mirror (eigenstaendig 85/85+60/60). |
| `Plan/S15_SURFACE_STACK_RESULT.md` | auf main | S15: neuer Komponententyp `surface-stack` — beliebige ZMX-Verschreibungen in Beamline (Stapel-ABCD, engste Flaechen-Apertur) und Feld (real-sag Flaeche-fuer-Flaeche inkl. Kittflaechen); Stack==Dicklinse-Aequivalenz 1e-12, Kittglied vs Envelope <1 %, E2E Import->Resolver->Beamline->Feld PASS; 76/76 Tests. |
| `Plan/S14_FFT_SAG_RESULT.md` | auf main | S14: separable FFT/Twiddle-DFT ersetzt O(N^4)-Kern (N=128 ~5 ms, Referenz-DFT-Aequivalenz <1e-10, Baselines unveraendert); `surfacePhase: real-sag` prägt exakte sphaerische Flaechenphasen der Dicklinsen auf (0.19 % gegen analytische Envelope, schlaegt ideal-Modus; TEA-Grenzen ehrlich dokumentiert, 2 Draft-Fehler vom Manager korrigiert); 69/69 Tests. |
| `Plan/S13_FIELD_BEAMLINE_UI_RESULT.md` | auf main `0c920ff` + Progress-Worker-Nachtrag | S13 Teil B: Field-Tab-Umschalter mit Default Projekt-Strahlengang; `field-beamline` um `probesZmm` erweitert (Bilder+Momente an freien z-Ebenen, exaktes Span-Splitting bit-identisch verifiziert), AUTO-dx, achsgetrennter Kreuzcheck, Sampling-Warnungen pro Probe; Hybrid-Planungsrezept-Trail (3 Drafts ~0.04 USD, Grounding O(N^4)-DFT bestaetigt); 61/61 Tests, 2 Projekte + 6 Jobs, Playwright PASS. |
| `Plan/S13_CORE_VERIFICATION_RESULT.md` | PASS | S13 Teil A: 5 Verifikations-Debatten (deepseek-v4-pro/max, 2 unabhaengige Proposer) auditieren alle Rechen-Domaenen — 0x WRONG, 3 Doku-SUSPECTs; Manager-Cross-Check 52/52 Referenzfaelle PASS via neuem Gate `verify:cases`; Orchestrierung-Befunde dokumentiert. |
| `Plan/S12_CLAUDE_DESIGN_UI_V2_CLOSEOUT.md` | auf main committet `cd1f2fd` | Closeout S12 v2: Commit-Scope geprueft (36 Dateien), Cleanup der lokalen Design-Artefakte (ZIP, `.design_import_tmp/`, `.tmp_*`), Folge-Scope Richtung S13 (Core-Verifikation, Field/Beamline-Entscheid). |
| `Plan/S12_CLAUDE_DESIGN_UI_V2_RESULT.md` | auf main committet `cd1f2fd` | S12 v2: 1:1-Umsetzung des Claude-Design-Projekts (Workbench mit 5 Tabs, EN/DE, Landing, Rechtsseiten als 4-Seiten-Build), API-Erweiterung (Re-Exports, ZMX-Materials, Feld-Bilder), 55/55 Tests, Playwright-Funktions- und Visual-Abgleich gegen den Prototyp. |
| `Plan/S12_CLAUDE_DESIGN_UI_RESULT.md` | auf main committet `fc3c908`, durch S12 v2 abgeloest | S12 Web-Handoff (Platzhalter-Anlehnung): Vite-App in `apps/web`, lokale Fonts, keine Runtime-CDNs, API-only Physics Boundary, Field-Tab ueber `field-beamline`, SEO-Basis, 52/52 Tests und Playwright-Smoke. |
| `Plan/S12_CLAUDE_DESIGN_UI_CLOSEOUT.md` | auf main committet `fc3c908` | Closeout zum ersten Main-Snapshot; `git show --stat fc3c908` geprueft, ZIP/Temp/Build-Artefakte bewusst nicht committet. |

---

## Master-Schnitt

| ID | Status | Kurzscope |
|---|---|---|
| S00 | HOLD vor Commit | Repo-, Doku- und Workflow-Fundament; Workspaces, Tests und Scope-Check ohne UI-App. |
| S01 | HOLD vor Commit | Einheiten, Konventionen, Datenvertraege, Warnungsmodell und JSON-Projektvertrag. |
| S02 | HOLD vor Commit | Fast-Core-Basis: ABCD, q-Parameter, freie Propagation, Thin Lens mit analytischen Tests. |
| S03 | HOLD vor Commit | Materialkern, Thick Lens, Surface Stack und Pulse-Basis mit Referenztests. |
| S04 | HOLD vor Commit | Validierungskatalog, Theorie-Doku und numerische Referenzen in Tests eingebunden. |
| S05 | HOLD vor Commit | Beam/Profile-Modelle, M2/D4sigma, statische Profile und Stage-1-Core-Vollstaendigkeit. |
| S06 | HOLD vor Commit, geschlossen | Core Hardening: Runtime-Validation lehnt unbekannte Discriminators, falsche Versionen, ungueltige Pulse/Display-Felder, M2<1 und Thick-Lens-Radius 0 ab; Aperture-Warnings werden global und komponentennah gespiegelt; Matrix/SurfaceStack/Pulse-Helfer pruefen nichtphysikalische Direkteingaben. |
| S07 | HOLD vor Commit, geschlossen | Headless API: Projekt-JSON und `*.headless.json` Jobs laufen ueber typed Result-JSON; Fixture-Verifier prueft 2 Projekte und 4 Jobs ohne UI. |
| S08 | HOLD vor Commit, geschlossen | Optimizer Kernel: two-lens ranking, Radius/Diameter/Waist/Pulse-Ziele, impossible-constraint warning und Position/Focal/M2-Sensitivity. |
| S09 | HOLD vor Commit, geschlossen | Import/Catalog: konservativer ZMX-Subset-Parser, AGF-Materialparser, Material-/Lens-Pack-Schemas und typed ImportResult ohne stille Materialsubstitution. |
| S10 | HOLD vor Commit, geschlossen | Astigmatic/measured: cylindrical-lens Component, per-axis propagation, CSV/FWHM/D4sigma measurement import und quadratischer measured-beam fit mit Residuen. |
| S11 | HOLD vor Commit, geschlossen | Field Mode: ScalarField/Grid, Fresnel, Angular-Spectrum, Circular Aperture, Moment-Radii, Power-Integration und Sampling-Warnings. |
| S12 | v1 `fc3c908`, v2 `cd1f2fd` auf main | Claude Design UI: v2 setzt das Design-Projekt 1:1 um (Workbench-Tabs, Landing, Rechtsseiten, EN/DE); `apps/web` rendert ausschliesslich API-Resultate, lokale Fonts, keine Runtime-CDNs; Field-Tab per Design als `field-fresnel`-Playground (CONVENTIONS Regel 10 revidiert). |
| S13 | Teil A PASS; Teil B auf main `0c920ff` + Progress-Worker-Nachtrag | Teil A: unabhaengige Core-Verifikation, 52/52 Referenzfaelle (`verify:cases`). Teil B: Beamline-gekoppelter Field-Tab mit Auswerteposition, freigegeben und gepusht; Nachtrag: Web-Worker-Ausfuehrung mit determiniertem Fortschrittsbalken. |
| S16 | abgeschlossen | Release Hardening: Doppel-Audit (Debatte + GPT-5.5 R1/R2), Probe-Sampling-Fix, Import-Ehrlichkeit (NaN-n, UNIT, MIRR/GLAS MIRROR), free-space L/n, LICENSE/README/How-built, Deploy-Prep, Public-Mirror. Betreiber-Schritte fuer Livegang in Abschnitt 4 des Result-Docs. |
| S15 | auf main | surface-stack: ZMX-Mehrflaechenstapel als Beamline-Komponente (Validation letzte Flaeche n=1/t=0, Stapel-Matrix, per-Flaechen-Aperturen); Feld real-sag Flaeche-fuer-Flaeche inkl. Glas-Glas; Editor-Tabelle, Plot-Silhouette, Import-Button; Beispiel + Expected additiv. Read-only-Editor als v1-Grenze. |
| S14 | auf main | FFT-Upgrade (Radix-2 + Twiddle-DFT, ~1000x bei N=128, Baselines bitstabil) und Option 1: `surfacePhase real-sag` mit exakter Flaechen-Sag-Phase je Dicklinsen-Flaeche, Sampling-Guards, UI-Select, Task-A-artige Orakel (Maske exakt, r^4-Term quantitativ, Envelope-Konvergenz 0.19 %); TEA-Grenzen dokumentiert. Offen: N-Cap 256?, Guard-Radius-Verfeinerung, ZMX-Mehrflaechen-Hook. Veroeffentlichung weiter zurueckgestellt. |

---

## Aktueller Review-Stand

Die Planung wurde am 2026-07-02 mit mehreren DeepSeek-V4-Pro/max Plan-Agents ausgearbeitet und durch den Manager synthetisiert.

Die Implementierung S00-S05 steht am 2026-07-02 auf HOLD vor Commit. Verifikation: `npm.cmd run typecheck` PASS, `npm.cmd test` PASS mit 20/20 Tests, `npm.cmd run check:scope` PASS ohne `apps/web`. Direct Worker-Implementation fuer `.ts` wurde durch die Orchestrierung-Write-Policy blockiert; der Manager hat die TypeScript-Patches angewendet, DeepSeek V4 Pro/max hat Review-Findings geliefert und diese sind gefixt. Ein anschliessender Manager-Audit fixte zusaetzlich die planparallele Slab-Matrix (`B = thicknessMm / refractiveIndex`).

Am 2026-07-02 wurde per `Hybrid-Planungsrezept` eine neue Headless-Revision erstellt: drei DeepSeek-V4-Pro/max Plan-Drafts liefen erfolgreich nach Sandbox-Network-Retry; Manager-Grounding gegen Repo ergab, dass `packages/optimizer`, `packages/catalog`, `packages/field` und `apps/web` noch nicht existieren. Ergebnis: S06-S11 werden Rechen-/Headless-Phasen, `apps/web` bleibt bis S12 verboten.

S06 wurde am 2026-07-02 geschlossen: `packages/core/src/validation.ts`, `packages/core/src/project.ts`, `packages/optics/src/matrix.ts`, `packages/optics/src/simulate.ts`, `packages/optics/src/surface-stack.ts`, `packages/pulses/src/pulses.ts` und Tests haerten Runtime-Validation, Warning-Propagation und Public-Core-Invarianten inklusive `zStepMm`. Verifikation: `npm.cmd run typecheck` PASS, `npm.cmd test` PASS mit 50/50 Tests, `npm.cmd run verify:headless` PASS mit 2 Projekten und 4 Jobs gegen Expected Summaries, `npm.cmd run check:scope` PASS ohne `apps/web`.

S07 wurde am 2026-07-02 geschlossen: `packages/api`, `scripts/run-headless.mjs`, `scripts/verify-headless.mjs`, `examples/*.modeforge.json`, `examples/*.headless.json`, `examples/expected-headless-summary.json`, `docs/architecture/API v1.md` und `tests/unit/headless-api.test.ts` liefern einen headless JSON->Result-Runner fuer Projekt- und Job-Resultate. DeepSeek-Review-Follow-up fixte Simulation-Exception-Handling und Datei-I/O-Fehler im Runner. Verifikation: `npm.cmd run typecheck` PASS, `npm.cmd test` PASS mit 50/50 Tests, `npm.cmd run verify:headless` PASS mit 2 Projekten und 4 Jobs gegen Expected Summaries, `npm.cmd run check:scope` PASS ohne `apps/web`.

S08 wurde am 2026-07-02 geschlossen: `packages/optimizer` mit `optimizeTwoLensTelescope`, Ranking, Radius-/Diameter-/Waist-/Pulse-Zielen, Constraints und Position/Focal/M2-Sensitivity. Verifikation: `npm.cmd run typecheck` PASS, `npm.cmd test` PASS mit 50/50 Tests, `npm.cmd run verify:headless` PASS mit 2 Projekten und 4 Jobs gegen Expected Summaries, `npm.cmd run check:scope` PASS ohne `apps/web`.

S09 wurde am 2026-07-02 geschlossen: `packages/catalog` mit konservativem ZMX-Subset-Parser, AGF-Materialparser, Material-/Lens-Pack-Vertraegen und Material-Resolution ohne stille Substitution. Verifikation: `npm.cmd run typecheck` PASS, `npm.cmd test` PASS mit 50/50 Tests, `npm.cmd run verify:headless` PASS mit 2 Projekten und 4 Jobs gegen Expected Summaries, `npm.cmd run check:scope` PASS ohne `apps/web`.

S10 wurde am 2026-07-02 geschlossen: `cylindrical-lens` in Contracts/Simulation, per-axis matrix output, CSV/FWHM/D4sigma Measurement-Import und `fitGaussianBeamFromRadii` mit Residualdiagnostik fuer synthetische measured-beam Rekonstruktion. Verifikation: `npm.cmd run typecheck` PASS, `npm.cmd test` PASS mit 50/50 Tests, `npm.cmd run verify:headless` PASS mit 2 Projekten und 4 Jobs gegen Expected Summaries, `npm.cmd run check:scope` PASS ohne `apps/web`.

S11 wurde am 2026-07-02 geschlossen: `packages/field` mit ScalarField/Grid, unitary DFT-Fresnel, Angular-Spectrum, Circular Aperture, Power-Integration, Moment-Radii und Sampling-Warnings. Verifikation: `npm.cmd run typecheck` PASS, `npm.cmd test` PASS mit 50/50 Tests, `npm.cmd run verify:headless` PASS mit 2 Projekten und 4 Jobs gegen Expected Summaries, `npm.cmd run check:scope` PASS ohne `apps/web`.

S12 v2 wurde am 2026-07-04 als 1:1-Umsetzung des Claude-Design-Projekts `Frontend design V3 masterplan` implementiert: Design-Quelle per DesignSync-MCP gezogen und byte-genau gegen die lokale ZIP verifiziert (7/7 identisch); `apps/web` komplett neu als 4-Seiten-Build (Landing, Workbench, Datenschutz, Impressum) mit allen fuenf Workbench-Tabs, EN/DE, Presets, Beamline-Editor, SVG-Plots, Puls-Panel, Mode-Helfer, JSON-Modal, ZMX/AGF-Resolver-Flow, Kaustik-Fit und Feld-Canvases. `packages/api` um UI-Re-Exports, `oneOverE2RadiusToBasisValueMm`, ZMX-`materials`-Durchreichung und `field-fresnel`-Bild-Grids erweitert; `CONVENTIONS.md` Regel 10 an die Design-Quelle revidiert. Verifikation: `npm.cmd run typecheck` PASS, `npm.cmd run typecheck:web` PASS, `npm.cmd test` PASS mit 55/55, `npm.cmd run verify:headless` PASS mit 2 Projekten und 5 Jobs, `npm.cmd run check:scope` PASS, `npm.cmd run build:web` PASS, Playwright-Funktions- und Visual-Abgleich gegen den Design-Prototyp PASS (keine Page-Errors, keine externen Font-/CDN-Requests, numerische Deckungsgleichheit der Ergebniswerte). Kein Worker-Einsatz (Orchestrierung-Write-Policy blockiert `.ts`; Routing im Ergebnis-Dokument begruendet). Am 2026-07-04 nach Nutzer-Freigabe auf main committet `cd1f2fd`; Cleanup der lokalen Design-Artefakte danach.

S16 wurde am 2026-07-05 als Release-Gate durchgezogen: finale Debatten-Runde (2 unabhaengige Herleitungen) fand den Probe-Reihenfolge-Defekt an Null-Laengen-Elementen — inklusive ehrlich dokumentiertem Manager-Fehlgriff beim ersten Gegenbeweis (Peak-1-Normierung) — gefixt mit Regressionstest gegen die analytische Blenden-Transmission; die 8 Debatten-Orakel sind permanente verify:cases-Handler (60 total). GPT-5.5-Tiefenreview R1 sprach den gesamten Rechenkern formelfrei frei und fand 6 Import-/Vertragsraender (alle reproduziert, 0 Halluzinationen): NaN-Brechzahl ausserhalb Sellmeier-Range, UNIT-INCH-Stillimport, MIRR/GLAS-MIRROR-Inkonsistenz, ignoriertes free-space.refractiveIndex (jetzt L/n in beiden Engines), 2 Doku-LOWs. Zweite unabhaengige GPT-5.5-Session: PASS, keine neuen Findings. Release-Artefakte: MIT-LICENSE, Fremden-README mit How-this-was-built (Methodik-Ebene, Interna geheim), echte Landing-Links, CNAME+Pages-Workflow (Deploy hinter DEPLOY_PAGES), Firefox-Smoke, sanitisierter Ein-Commit-Public-Mirror mit maschinellem Verbots-Sweep und eigenstaendiger Gate-Verifikation.

S15 wurde am 2026-07-05 nach Betreiber-Freigabe umgesetzt (3 Hybrid-Planungsrezept-Drafts ~0.05 USD; Grounding-Kernbefund: surfaceStackMatrix propagiert auch das letzte thicknessAfter -> Embedding-Policy letzte Flaeche t=0/n=1, von der Validation erzwungen). Neuer Kind `surface-stack` durch Contracts/Validation/simulateBeamline (Stapel-ABCD, Laenge=Summe t, Apertur-Reserve ueber engste Flaechen-Apertur), Feld-Steps real-sag Flaeche-fuer-Flaeche (Kittflaechen via Indexsprung, per-Flaechen-Guards mit Envelope-Radius am Eintritt) bzw. ideal kollabiert; UI: Import-Button fuer Nicht-Singlets, Chip `N surf · EFL`, Read-only-Flaechentabelle, Plot-Silhouette mit Kittlinien. Orakel: Stack==Dicklinse 1e-12 (ideal+real-sag), Kittglied real-sag vs analytische Envelope <1 %, Glas-Glas-Sag <1e-9, Roundtrip, Margin-Warning. Gates: 76/76 Tests, verify:headless 3 Projekte + 6 Jobs (Expected nur additiv), verify:cases 52/52, scope, build, Playwright-E2E PASS.

S14 wurde am 2026-07-05 auf Betreiber-Auftrag ("starte fft + option 1 mit das Hybrid-Planungsrezept") umgesetzt: 2 Plan-Draft-Lauf-Drafts (~0.02 USD) + Manager-Grounding; zwei Draft-Fehler wurden im Judgment-Schritt korrigiert (Orientierungs-Asymmetrie-Orakel in TEA physikalisch falsch; Fokusebenen-Orakel auf Single-Grid nicht aufloesbar). FFT: separable Radix-2/Twiddle-Transformation ersetzt den O(N^4)-Kern kontraktgleich — Aequivalenz <1e-10 gegen unabhaengige Referenz-DFT, Leistung 1e-12, alle 12-stelligen Baselines unveraendert, N=128 ~5 ms / N=256 ~14 ms. Option 1: `surfacePhase real-sag` mit exakter sphaerischer Sag-Phase je Dicklinsen-Flaeche + t/n; Orakel: Maskengeometrie <1e-9, r^4-Residuum <2 % gegen modell-eigene Vorhersage, Envelope-Konvergenz 0.19 % (ideal-Modus 8 % — Hauptebenen-Befund dokumentiert), Sampling-/Hemisphaeren-Guards. UI-Select + TEA-Hinweis EN/DE. Gates: 69/69 Tests, verify:headless/cases unveraendert PASS, scope, build, Browser-Lauf PASS.

S13 Teil B wurde am 2026-07-05 implementiert und dev-verifiziert (HOLD vor Commit): Planung via Hybrid-Planungsrezept-Rezept (3 Plan-Draft-Lauf-Drafts deepseek-v4-pro/high aus UI-/Risiko-/Test-Winkel, ~0.04 USD; Manager-Grounding bestaetigte u. a. die O(N^4)-DFT-Kosten und die Verifier-Mechanik; Synthese durch den Manager, `.ts`-Implementierung Manager-seitig wegen Orchestrierung-Write-Policy). Ergebnis: `field-beamline` mit `probesZmm` (physisches z, t/n in Glas, Probe an Element-Ebene misst dahinter, Beyond-End-Fortsetzung, Sampling-Warnungen pro Probe, INVALID_INPUT bei ungueltigen Probes), Field-Tab-Umschalter mit Default Projekt-Strahlengang (Ebenen-Chips, freie Auswerte-z, AUTO-dx aus densifizierter Envelope, achsgetrennter Kreuzcheck, N bis 128 mit ehrlichem Kostenhinweis), Playground unveraendert. Verifikation: typecheck/typecheck:web PASS, 61/61 Tests (6 neue analytische Probe-Orakel), verify:headless 2 Projekte + 6 Jobs (Expected-Diff nur probeCount; Probes-Beispiel bit-identischer End-Radius), verify:cases 52/52, check:scope PASS, build:web PASS, Playwright-Funktionslauf PASS.


S12 v1 wurde am 2026-07-03 als Claude-Design-Handoff implementiert: `apps/web` enthaelt eine statische Vite-TypeScript-Workbench mit Beamline/Optimizer/Import/Beam-fit/Field Tabs, lokalen `woff2`-Fonts, Datenschutz/Impressum-Ansichten, SEO-Meta/JSON-LD/robots/sitemap und Field-Rendering ueber `runHeadlessJob({ kind: "field-beamline" })` gegen die aktuelle Projekt-Beamline. Verifikation: `npm.cmd run typecheck` PASS, `npm.cmd run typecheck:web` PASS, `npm.cmd test` PASS mit 52/52 Tests, `npm.cmd run verify:headless` PASS mit 2 Projekten und 5 Jobs, `npm.cmd run check:scope` PASS, `npm.cmd run build:web` PASS, Playwright Desktop/Mobile-Smoke PASS ohne blockierte Google-Fonts/unpkg/jsdelivr-Requests. DeepSeek V4 Pro/max konnte wegen Orchestrierung-Write-Policy keine `.ts`-Implementierung schreiben; ein read-only `Plan-Draft-Lauf` lieferte nach eskaliertem Retry eine Review-Pruefliste, aber keine Findings, daher Manager-Review mit Greps/Gates/Playwright.

Wichtigste eingearbeitete Korrekturen:

- M^2, D4sigma, Radius/Diameter/FWHM und Surface-Radius-Signaturen muessen vor Core-Code formalisiert werden.
- Frontend-Design, visuelle Ausgestaltung und Interaktionsdesign liegen bei dir via Claude Design; zuerst wird nur die Rechenbasis mit Contracts und Tests gebaut.
- Stage-1-Scope darf Field-Mode-Funktionen nicht heimlich vorziehen; Super-Gaussian/Top-hat in Stage 1 nur als statische Profilvisualisierung oder klar als Approximation.
- Der erste Release bekommt hoechstens einen einfachen Telescope Calculator; der volle Optimizer bleibt eine eigene Subphase.
- UI darf keine Physikformeln enthalten; alle Werte kommen aus Core-/Worker-Resultaten.
- Materialdaten und ZMX/AGF-Import bleiben lokal/static-hosting-kompatibel und lizenzsauber.

**Doc-Version:** 1.2, 2026-07-04.

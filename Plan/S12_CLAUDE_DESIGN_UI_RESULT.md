# S12 - Claude Design UI Handoff: Implementierungs-Ergebnis

**Datum:** 2026-07-03.
**Status:** Implementierung + Dev-Verifikation; **HOLD vor Commit**.
**Auftrag:** Lokale Claude-Design-ZIP `Frontend design V3 masterplan.zip` produktiv in `apps/web` einarbeiten.
**Plan:** `Plan/HEADLESS_PHASES v1.md` S12 UI-Handoff.

---

## 0. Verdikt zuerst

**S12 ist als statische Vite-Workbench implementiert und lokal verifiziert.** Die UI nutzt lokale Fonts, keine externen Runtime-CDNs und ruft fuer Rechnungen die Headless-API auf. Der Field-Tab rendert `field-beamline` ueber den aktuellen echten Strahlengang statt eines isolierten Gaussian-only Jobs.

---

## 1. Design-Quelle und Boundary

Quelle war die lokale ZIP-Extraktion unter `.design_import_tmp/` mit `ModeForge Workbench.dc.html`, `ModeForge Index.dc.html`, `ModeForge Datenschutz.dc.html` und `ModeForge Impressum.dc.html`.

Nicht als Produktivruntime uebernommen:

- `.design_import_tmp/support.js`
- `.design_import_tmp/modeforge-core.js`
- Google-Fonts-Links aus den `.dc.html` Prototypen
- externe Runtime-CDNs wie `unpkg`

Produktiv-Boundary:

- `apps/web/src/main.ts` importiert Rechenfunktionen aus `packages/api/src/index.ts`.
- `apps/web/src/styles.css` nutzt lokale `woff2`-Dateien aus `apps/web/public/fonts`.
- `scripts/check-scope.mjs` blockiert Google Fonts, externe Runtime-CDNs, kopierte Claude-Runtime-Dateien und direkte Physikpaket-Imports aus `apps/web/src`.

---

## 2. Diff - was gebaut wurde

Neue Web-App:

- `apps/web/index.html`
- `apps/web/package.json`
- `apps/web/tsconfig.json`
- `apps/web/vite.config.ts`
- `apps/web/public/robots.txt`
- `apps/web/public/sitemap.xml`
- `apps/web/src/main.ts`
- `apps/web/src/styles.css`
- `apps/web/src/legal.ts`
- `apps/web/src/sample-project.ts`
- `apps/web/src/vite-env.d.ts`

Produktiv-Touches:

- `package.json` und `package-lock.json`: Workspace `apps/*`, `dev:web`, `build:web`, `typecheck:web`.
- `scripts/check-scope.mjs`: S12-Scope-Gate fuer lokale Assets und API-only Physics Boundary.
- `tests/unit/scaffold.test.ts`: S12-Workspace- und Konventionspruefung.
- `docs/architecture/CONVENTIONS.md`: S12-UI-Regeln, lokale Fonts, keine Runtime-CDNs, Field-Tab ueber `field-beamline`.
- `.gitignore`: `.design_import_tmp/` transient.

---

## 3. Dev-Runtime-Verifikation

Gates:

| Gate | Ergebnis |
|---|---|
| `npm.cmd run typecheck` | PASS |
| `npm.cmd run typecheck:web` | PASS |
| `npm.cmd test` | PASS, 52/52 |
| `npm.cmd run verify:headless` | PASS, 2 Projekte und 5 Jobs |
| `npm.cmd run check:scope` | PASS |
| `npm.cmd run build:web` | PASS |

Playwright-Smoke:

| Check | Ergebnis |
|---|---|
| Desktop-Seite laedt | PASS, `titlePresent: true` |
| Envelope-Canvas | PASS, `nonzero: 252480` |
| Field-Canvas | PASS, `nonzero: 339270`, `bright: 15224` |
| Console/Page Errors | PASS, keine Page-Errors; nur Vite-Debug im Dev-Server |
| Mobile-Smoke | PASS, keine Page-Errors |
| Externe Runtime-Requests | PASS, `blockedRequests: []` fuer Google Fonts/unpkg/jsdelivr |

Artefakt-Screenshots:

- `.tmp_modeforge_desktop.png`
- `.tmp_modeforge_mobile.png`

---

## 4. Akzeptanz-Matrix

| Akzeptanz-Punkt | Status | Evidenz |
|---|---|---|
| Claude-Design als Quelle genutzt | erreicht | `.design_import_tmp/ModeForge Workbench.dc.html` und Legal/Index-Seiten wurden als Layout-/Textquelle ausgewertet. |
| Keine Google Fonts im Produktivbuild | erreicht | `npm.cmd run check:scope` PASS; `rg` findet Google-Fonts-Needles nur in `scripts/check-scope.mjs`. |
| Keine externen Runtime-CDNs | erreicht | Playwright `blockedRequests: []`; `check:scope` blockiert externe Script-/Stylesheet-URLs. |
| UI rechnet keine Physikformeln | erreicht | `apps/web/src/main.ts` importiert `packages/api`; `check:scope` blockiert direkte Physikpaket-Imports. |
| Field-Tab nutzt echte Beamline | erreicht | `apps/web/src/main.ts` ruft `runHeadlessJob({ kind: "field-beamline", input: { beamline: projectToBeamlineInput(project), ... } })`. |
| SEO-Basis vorhanden | erreicht | `apps/web/index.html`, `apps/web/public/robots.txt`, `apps/web/public/sitemap.xml`. |
| Datenschutz-Aussage passt zu Build | erreicht | lokale Fonts, keine Google-Fonts/CDN-Requests; Hosting-Logs in `apps/web/src/legal.ts` benannt. |

---

## 5. Orchestrierung-/DeepSeek-Trail

Die direkte Worker-Implementierung wurde vor Provider-Call durch die Orchestrierung-Write-Policy blockiert:

- Fehler: `disallowed_file_type`
- Ursache: Orchestrierung erlaubt Worker-Schreibziele aktuell nicht fuer `.ts`/`.tsx`.
- Kosten: keine Provider-Kosten fuer diese blockierten Implementierungsversuche.

Daraufhin wurde Option 1 umgesetzt: Manager implementiert TypeScript lokal; DeepSeek V4 Pro/max bleibt fuer Planung/Review.

DeepSeek V4 Pro/max wurde read-only ueber `Plan-Draft-Lauf` auf die S12-Boundary angesetzt. Der erste Versuch scheiterte an `WinError 10013`; der eskalierte Retry lief erfolgreich mit Kosten `$0.014336`, lieferte aber toolbedingt eine Review-Pruefliste statt Findings. Deshalb wird dies nicht als externer PASS-Review gewertet; der Manager-Review wurde mit lokalen Greps, Gates und Playwright-Smoke abgeschlossen.

---

## 6. Handoff

S12 ist dev-verifiziert und HOLD vor Commit. Offene Folgepunkte vor Release:

- Endgueltige Domain bestaetigen: `https://modeforge.rholabs.de/` ist aktuell in Canonical, Open Graph, JSON-LD und Sitemap gesetzt.
- Falls GitHub Pages ohne Custom Domain unter einem Projektpfad laeuft, muss die Canonical/Sitemap-URL angepasst werden.
- Finales Rechtsreview fuer Impressum/Datenschutz bleibt Betreiber-Aufgabe.

**Offen vor Commit:** Nutzer-/Architekten-Freigabe und Commit-Scope-Pruefung.

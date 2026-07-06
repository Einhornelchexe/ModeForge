# S12 v2 - Claude Design UI 1:1-Umsetzung: Implementierungs-Ergebnis

**Datum:** 2026-07-04.
**Status:** Implementierung + Dev-Verifikation; **HOLD vor Commit**.
**Auftrag:** Das Claude-Design-Projekt `Frontend design V3 masterplan` (claude.ai/design, Projekt `b130d077-06a5-48de-b081-907ec9783d2b`) 1:1 produktiv in `apps/web` umsetzen; der bisherige S12-Stand war eine vereinfachte Anlehnung ("Platzhalter").
**Plan:** `Plan/HEADLESS_PHASES v1.md` S12 UI-Handoff; Vorgaenger `Plan/S12_CLAUDE_DESIGN_UI_RESULT.md`.

---

## 0. Verdikt zuerst

**Die Workbench, die Landing-Page und die Rechtsseiten sind jetzt eine 1:1-Umsetzung des Claude-Design-Projekts.** Alle fuenf Tabs (Beamline, Optimizer, Import, Beam fit, Field) sind mit vollem Funktionsumfang des Design-Prototyps implementiert, inklusive EN/DE-Sprachumschalter, Presets, Beamline-Editor mit Komponenten-Auswahl, SVG-Envelope-Plot mit Linsen-Silhouetten und Hover, Puls-Panel, Mode->M2-Helfer, Breitenbasis-Umschaltung, JSON-Import/Export-Modal, ZMX/AGF-Import mit Material-Resolver-Flow, Kaustik-Fit mit Plot und Feld-Tab mit |E|^2-Canvases. Screenshot-Abgleich gegen den im Browser laufenden Design-Prototyp zeigt visuelle und numerische Deckungsgleichheit (z. B. Beamline: w0x 34.4 um @ 136.3 mm, Fluenz 0.131 J/cm2; Optimizer: #1 f200@100 + f150@300, 501 um, 0.1 %; Fit: M2 1.197; Feld: 344 um, Delta 0.00 %).

---

## 1. Design-Quelle und Abgleich

1. Quelle ist das Claude-Design-Projekt `Frontend design V3 masterplan`; Zugriff via DesignSync MCP nach `/design-login` durch den Nutzer.
2. Der MCP-Live-Stand wurde vollstaendig heruntergeladen und byte-genau gegen die lokale ZIP `Frontend design V3 masterplan.zip` verglichen: **alle 7 Dateien identisch** (Canvas, Index, Datenschutz, Impressum, Workbench, modeforge-core.js, support.js). Quelle liegt unter `.design_import_tmp/` (gitignored).
3. Nicht als Produktivruntime uebernommen (unveraendert zur S12-Boundary): `support.js`, `modeforge-core.js`, Google-Fonts-Links, externe CDNs. `modeforge-core.js` diente nur als Verhaltens-Referenz; produktiv rechnet ausschliesslich `packages/api`.

---

## 2. Diff - was gebaut wurde

Neue/ersetzte Web-App (`apps/web`):

- `index.html` - Landing-Page-Einstieg (SEO-Head, JSON-LD) + `src/landing.ts`/`src/landing.css` (Hero mit animiertem Teleskop-SVG, Toolkit-Features, Physik-Prinzipien, Footer, EN/DE).
- `workbench.html` - Workbench-Einstieg + `src/main.ts` (State, Aktionen, Draft-Mechanik mit Fokus-Erhalt, Hover-Fastpath, Feld-Canvas-Rendering).
- `datenschutz.html`, `impressum.html` - statische Rechtsseiten 1:1 aus dem Design (noindex,follow) + `src/legal.css`/`src/legal-entry.ts`.
- `src/views/beamline.ts|optimizer.ts|importTab.ts|fit.ts|field.ts|chrome.ts|ui.ts` - Tab-Views, Header, Modal; Markup/Styles aus dem Design transkribiert.
- `src/plot.ts` - Plot-Geometrie 1:1 portiert (Envelope-Flaechen/-Linien, Nice-Ticks, Komponenten-Marker, Apertur-Blenden, stilisierte Linsen-Silhouetten mit Kruemmungs-Sag, Waist-Marker).
- `src/i18n.ts` - EN/DE-Texte wortgleich aus dem Design; `localStorage`-Key `modeforge-lang` wie im Design und in der Datenschutzerklaerung benannt.
- `src/compute.ts` - API-Anbindung inkl. Densify-Logik (display-only Input-Konstruktion, jede Probe rechnet der Core), memoisiert.
- `src/state.ts`, `src/store.ts`, `src/format.ts`, `src/base.css`, `src/workbench.css`.
- `public/fonts/`: zusaetzlich Space Grotesk 700 und IBM Plex Mono 600 (lokal, aus @fontsource kopiert).
- `public/sitemap.xml`: + `workbench.html`; `vite.config.ts`: Multi-Page-Build (4 Seiten).
- Entfernt: `src/styles.css`, `src/legal.ts`, `src/sample-project.ts` (Platzhalter-Artefakte).

Produktiv-Touches ausserhalb `apps/web`:

- `packages/api/src/index.ts`: UI-Re-Export-Block (Contract-Typen und Display-Helfer wie `serializeProject`, `parseProjectJson`, `parseBeamWidthMeasurementsCsv`, `hermiteGaussianM2`/`laguerreGaussianM2`, `divergenceHalfAngleRad`, `gaussianRadiusAtZ`, `paraxialCard`, `thickSphericalLensStack`, `BUILTIN_MATERIALS`, `refractiveIndex`, `relativeError`); neu `oneOverE2RadiusToBasisValueMm` (Anzeige-Basis-Umrechnung); `zmx-import`-Job reicht optionale `materials` an `parseZmxSequential` durch (Session-Resolver-Flow); `field-fresnel`-Job liefert zusaetzlich `inputImage`/`outputImage` (normierte |E|^2-Grids fuer die Canvases).
- `tests/unit/api-ui-surface.test.ts` (neu, 3 Tests): Basis-Konvertierung, ZMX-Materials-Durchreichung (blockiert -> AGF -> aufgeloest), Feld-Bild-Grids.
- `docs/architecture/CONVENTIONS.md`: Regel 10 an die Design-Quelle angepasst (siehe Abschnitt 4).

---

## 3. Dev-Runtime-Verifikation

Gates:

| Gate | Ergebnis |
|---|---|
| `npm.cmd run typecheck` | PASS |
| `npm.cmd run typecheck:web` | PASS |
| `npm.cmd test` | PASS, 55/55 (52 Bestand + 3 neue API-Surface-Tests) |
| `npm.cmd run verify:headless` | PASS, 2 Projekte und 5 Jobs gegen Expected Summaries |
| `npm.cmd run check:scope` | PASS (lokale Assets, API-only Physics Boundary) |
| `npm.cmd run build:web` | PASS, 4 Seiten (index, workbench, datenschutz, impressum) |

Playwright-Verifikation (Dev-Server, Desktop 1500x940 + Mobile 390x844):

| Check | Ergebnis |
|---|---|
| Page-Errors ueber alle Seiten/Tabs | PASS, keine |
| Externe Requests (Google Fonts/unpkg/jsdelivr) | PASS, `blockedRequests: []` |
| Fokus-Erhalt beim Tippen (Re-Render pro Keystroke) | PASS, `data-k`-Fokus bleibt |
| Komponenten-Auswahl + Editor | PASS |
| Preset-Wechsel (inkl. astigmatisch, x/y-Kurven) | PASS |
| Optimizer-Lauf | PASS, 8 Loesungen, Plot, Send-to-Beamline erzeugt 5-Komponenten-Layout |
| ZMX unbekanntes Glas -> IMPORT BLOCKED -> AGF adoptieren -> erneut parsen | PASS, Surface Stack + EFL-Karte |
| Singlett-Sample -> Add to Beamline verfuegbar | PASS |
| Beam fit (Kaustik-Sample) | PASS, 6 Ergebnis-Kacheln + Fit-Plot |
| Feld-Job | PASS, beide Canvases 48x48 mit hellem Kern; Kreuzcheck Delta 0.00 % |
| Export-Modal | PASS, valides ModeForgeProject-JSON; DE-Umschalter PASS |
| Rechtsseiten + Landing | PASS, 1:1 gegen Design-Prototyp-Screenshots |

Referenz: Screenshots des Design-Prototyps (ueber lokalen Static-Server + Playwright) und der neuen App liegen im Session-Scratchpad (`proto-*.png` / `app-*.png`); Wertevergleich siehe Verdikt.

---

## 4. Abweichungen und Entscheidungen

1. **Konventions-Revision (Field-Tab):** Die alte Regel 10 ("Field-Tab ueber `field-beamline`") stammte aus dem Platzhalter-S12 und widersprach der Design-Quelle. Das Design definiert den Field-Tab explizit als `field-fresnel`-Playground mit "Use project beam"-Sync und Paraxial-Kreuzcheck; die eigene Design-Notiz sagt "Full beamline field propagation lands with the Field Mode UI stage". Umgesetzt wurde das Design; `field-beamline` bleibt Teil der Headless-API und wird weiter durch `verify:headless` geprueft. `CONVENTIONS.md` Regel 10 wurde entsprechend revidiert.
2. **Seitenstruktur:** Statt einer Single-Page mit In-App-Legal-Views jetzt vier statische Seiten wie im Design (Landing `/`, `workbench.html`, `datenschutz.html`, `impressum.html`); Sitemap um die Workbench-URL ergaenzt, Rechtsseiten bleiben noindex.
3. **Display-Konvertierungen:** Die Anzeige-Basis-Umrechnung (1/e^2 -> FWHM/D4sigma/rms) liegt als `oneOverE2RadiusToBasisValueMm` in `packages/api` statt in der UI - strengere Auslegung der "UI rechnet keine Physik"-Regel als im Design-Prototyp, der die Inverse in der UI rechnete.
4. **Domain:** `https://modeforge.rholabs.de/` bleibt wie im Design und im bisherigen Stand gesetzt (Canonical/OG/JSON-LD/Sitemap); GitHub-/Docs-/Validation-Links der Landing sind wie im Design Platzhalter-Anker.

---

## 5. Orchestrierung-/Routing-Trail

Kein Worker-Einsatz fuer diese Implementierung. Begruendung: Die Orchestrierung-Write-Policy blockiert Worker-Schreibziele fuer `.ts`/`.tsx` (dokumentiert im S12-Trail, `disallowed_file_type`); der Umfang war fast vollstaendig TypeScript/CSS/HTML. Der read-only Review-Versuch in S12 lieferte toolbedingt nur eine Pruefliste ohne Findings. Manager-Implementierung mit vollstaendiger Design-Quelle im Kontext plus Gates und echtem Browser-Abgleich wurde daher als der verlaesslichere Weg gewaehlt; ein externer Cross-Review (z. B. `externes KI-Review` Codex/Gemini) bleibt als optionaler Folgeschritt offen. Keine Provider-Kosten.

---

## 6. Handoff

S12 v2 ist dev-verifiziert und **HOLD vor Commit**. Offene Folgepunkte:

1. Nutzer-Freigabe des neuen UI-Stands (visueller Eindruck im Dev-Server: `npm run dev:web`, Landing unter `/`, Workbench unter `/workbench.html`).
2. Domain final bestaetigen; bei GitHub-Pages-Projektpfad ohne Custom Domain SEO-URLs/Vite-Base anpassen (unveraendert aus S12-Closeout).
3. GitHub-/Docs-/Validation-Links der Landing auf echte Ziele setzen, sobald das Repo veroeffentlicht ist.
4. Finales Rechtsreview Impressum/Datenschutz bleibt Betreiber-Aufgabe.
5. Optional: externer Cross-Review des UI-Codes.

**Offen vor Commit:** Nutzer-/Architekten-Freigabe und Commit-Scope-Pruefung.

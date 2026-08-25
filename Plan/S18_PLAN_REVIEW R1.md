# S18 Plan-Review R1 (Cross-Review auf Plan v1)

**Datum:** 2026-08-15.
**Artefakt:** `Plan/S18_IMAGE_ANALYZER_PLAN v1.md`.
**Legs (Routing ehrlich):**
- **Opus 5** (frische Session, read-only, neutraler Peer-Brief, Selbstauskunft "Opus 5, 1M-Kontext"): vollstaendig geliefert — 9 HIGH, 21 MEDIUM, 8 LOW, 5 INFO, fast alle mit Datei:Zeile.
- **Gemini 3.7 Flash (High)** (Zweit-Reviewer-Kanal): Lauf 1 scheiterte am 600s-Wrapper-Timeout, Lauf 2 wurde ohne Output gestoppt. **Ausstehend** — optional auf v2 nachholbar.
- Codex: auf Betreiber-Ansage ausgelassen (Kontingent leer).

**Halluzinationscheck (Manager):** Alle datei-verankerten HIGH-/Schluessel-Claims stichprobenverifiziert (tests/field-modes ISO-Treffer, main.ts Upload-Limit, verify-headless toPrecision(12), warnings-Union, impressum "normgerechte", profiles.ts Super-Gauss-Konvention, api-Dispatch synchron). **0 Halluzinationen gefunden.** Mathematische Claims per Nachrechnung bestaetigt.

## Verdikt-Tabelle

| ID | Sev | Kurzclaim | Verdikt | Disposition (v2) |
|---|---|---|---|---|
| O-H1 | HIGH | Async-Decode (DecompressionStream) bricht synchronen runHeadlessJob-Vertrag (api 748-782, alle Aufrufer synchron) | VALID | Decode vom Job getrennt: async decodeImageFile-API, Job bleibt synchron, fileBase64-Variante gestrichen (§3/§7) |
| O-H2 | HIGH | Ungeklippte Negativwerte koennen Kovarianz indefinit machen (sqrt(negativ), q undefiniert) | VALID | Momente rechnen dokumentiert mit w=max(I,0); Guards Sum>0, lambda_min>=0; neuer Code IMAGE_MOMENTS_UNDEFINED (§4) |
| O-H3 | HIGH | Anisotrope px->mm-Skalierung verfaelscht Winkel/Breiten/q/Elliptizitaet | VALID | mm-Groessen via exakter Quadratform-Transformation bzw. mm-Raum-Momente, nie naive Ergebnis-Skalierung (§6/§7) |
| O-H4 | HIGH | Perf-Budget (<3s) widerspricht 5x-Voll-Re-Auswertung; LM auf 4.2 MP unrealistisch | VALID | Stabilitaets-Sweep ohne 2D-Fit; LM fittet auf ROI; Budget neu formuliert (§4/§6) |
| O-H5 | HIGH | base64+number[]-Transport sprengt Speicher bei 4096^2 (>400 MB Kopien) | VALID | Typed-Array-Transport + Transferables, Float32-Residuenbild, kein base64 (§7) |
| O-H6 | HIGH | Bestehender Upload-Pfad: 5-MB-Limit + Text-only + stiller Abbruch (main.ts:1204/1236) | VALID | Eigener binaerer Upload-Pfad mit eigenem Cap und sichtbarer Fehlermeldung (§7) |
| O-H7 | HIGH | ISO-Bestand unvollstaendig: tests/unit/field-modes.test.ts:81+103 (Testname!) | VALID | Sweep + Gate-Scope um tests/ und scripts/ erweitert (§8) |
| O-H8 | HIGH | 12-Stellen-Exakt-Pinning vs. LM-Iterationskipp cross-platform | TEILWEISE | V8 bringt eigene, plattformdeterministische Math-Impl (bestehende Field-Pins belegen das); dennoch: Fit-Parameter nur mit 6 Stellen gepinnt, Momente/Diagnostik 12, Node-Version im CI gepinnt (§8) |
| O-H9 | HIGH | Huber-Ebene ohne Skala/Abbruch nicht skalenaequivariant | VALID | delta=1.345*sigma_hat, sigma_hat=1.4826*MAD der Residuen, je Iteration nachgefuehrt, Abbruch definiert (§4) |
| O-M1 | MED | IMAGE_*-Codes koppeln image an core; SimulationWarning hat keine Bild-Kontextfelder | TEILWEISE | Union-Erweiterung in core ist das etablierte Muster und bleibt; Kontextwerte im message-String (bestehendes Muster); keine neuen Felder (§7) |
| O-M2 | MED | Codeliste deckt eigene Features nicht (FWHM-Mehrdeutigkeit, Decoder-Block, Kalibrierung, Dark-Mismatch, Kovarianz) | VALID | 6 Codes ergaenzt (§7) |
| O-M3 | MED | Super-Gauss-Formel nicht fixiert; Repo-Konvention existiert (profiles.ts:51) | VALID | Konvention exp(-2*(r/edge)^(2*order)) wiederverwendet; w<->Moment-Beziehung numerisch im Orakel (§6) |
| O-M4 | MED | (w1,w2,theta) bei w1~w2 entartet; 1e-6-Orakel so nicht haltbar | VALID | Orakel-Synthetik deutlich elliptisch (>=1.3); Kanonisierung w1>=w2, theta in [0,pi); runder Fall prueft nur rotationsinvariante Groessen (§6) |
| O-M5 | MED | Ebenen-Fit unzentriert: cond ~5e7, 1e-9 optimistisch | VALID | Zentrierte Koordinaten im Design (§4) |
| O-M6 | MED | MAD kann exakt 0 sein -> Schwelle degeneriert | VALID | Floor: max(1.4826*MAD, halber Quantisierungsschritt); Float-Fallback Stdabw (§4) |
| O-M7 | MED | Subpixel-Verfahren mehrdeutig; 0.05px ohne Sampling-Bedingung | VALID | Definiert: 2x separable 3-Punkt-Parabeln auf I; Gueltigkeit w>=3px; Bias dokumentiert (§5) |
| O-M8 | MED | FWHM-Basislinie (I_max vs I_max-B) nicht festgelegt | VALID | Halbmaximum ueber Hintergrund: B_hat+(I_peak-B_hat)/2 (§5) |
| O-M9 | MED | Delta-chi^2 ohne Rauschmodell nicht interpretierbar | VALID | Ersetzt durch relative RMS-Residuenreduktion in %, ohne Signifikanzanspruch (§6) |
| O-M10 | MED | Naive Poisson-Inversion unterlaeuft bei grossem lambda (e^-lambda=0) | VALID | Normalapproximation ab lambda>50, seeded; Grenze dokumentiert (§9) |
| O-M11 | MED | ROI-Sweep variiert nur Groesse, nicht Lage; 1.2x-Randfall undefiniert | VALID | Sweep + Zentrums-Shifts; Randregel Clamp+Shrink+Flag (§4) |
| O-M12 | MED | OME-XML-Passthrough trifft innerHTML-Renderer (XSS/Groesse) | VALID | esc()-Pflicht + 4-KB-Anzeige-Kappung (§7) |
| O-M13 | MED | Full-innerHTML-Rerender vertraegt kein ROI-Drag | VALID | Canvas-Overlay-Fastpath nach onPlotMove-Praezedenz, Commit bei Release (§7) |
| O-M14 | MED | Playwright = neue Toolchain, CI kennt weder Browser-Runner noch typecheck | VALID | Playwright bleibt dev-seitiges Gate (wie S12-S17); CI um typecheck/typecheck:web ergaenzt; kleine Binaer-Fixtures (§8) |
| O-M15 | MED | verify-headless: ohne summarizeJob-Zweig pinnt das Beispiel nichts; "additiv" ist real eine Regeneration | VALID | Eigener Summary-Zweig; Regen-Hinweis; Praezisionswahl je Feld (§8) |
| O-M16 | MED | check-scope-Ausweitung braucht Excludes (node_modules/dist) + .xml fehlt | VALID | Kanonische Root-/Exclude-Liste; .xml ergaenzt (§8) |
| O-M17 | MED | Deutsche Flexion ("normgerechte", impressum:43) entgeht dem Gate; Verneinungs-Schutzklausel darf nicht brechen | VALID | Stamm-Matching normkonform/normgerecht + Exact-String-Allowlist fuer die Schutzklausel (§8) |
| O-M18 | MED | Token-Varianten: ISO11146, DIN-EN entkommen; \bISO\b trifft ISO-8601-artiges | VALID | Pattern-Spez erweitert; "ISO 8601"-Schreibweise in Produkttexten vermieden (Datumsformat ausschreiben) (§8) |
| O-M19 | MED | ...Deg bricht Rad-Konvention; ...Px/...Counts sind neue Suffixklassen | VALID | thetaRad im Vertrag (UI zeigt Grad); CONVENTIONS.md-Ergaenzung fuer ...Px/...Counts (§7/§8) |
| O-M20 | MED | Typed-Array-Immutabilitaet nicht erzwingbar (Object.freeze wirft) | VALID | Formulierung korrigiert: defensive Kopien + No-Mutation-Tests (§3) |
| O-M21 | MED | v1.1-Release-Doku: >=9 Stellen fehlen (Version-Pill, package.json, README-Zahlen stale, Landing EN/DE, JSON-LD, CONVENTIONS, API-Doku, examples/README, reference_cases, footDate) | VALID | Vollstaendige Release-Doku-Checkliste (§8) |
| O-L1 | LOW | Mode-Pill zeigt fuer neuen Tab "FAST MODE" | VALID | Pill-Mapping fuer Analyzer-Tab (§7) |
| O-L2 | LOW | else-Zweig rendert Field-Tab; Tab-Cast ungeprueft; state.ts:16 | VALID | Expliziter Render-Zweig + Tab-Union erweitern (§7) |
| O-L3 | LOW | .wb-tabs ohne Overflow-Verhalten fuer 6. Reiter | VALID | Umbruch-/Overflow-Pruefung inkl. Mobile (§7) |
| O-L4 | LOW | PNG-Blockfaelle unvollstaendig (Adam7, Palette, 16-bit-RGB, tRNS) | VALID | Explizit blocken (§3) |
| O-L5 | LOW | Peak-to-Background bei B_hat<=0 undefiniert | VALID | Guard + Hinweis (§6) |
| O-L6 | LOW | Subpixel am Bildrand undefiniert | VALID | Am Rand unterdrueckt, an EDGE_TOUCH gekoppelt (§5) |
| O-L7 | LOW | runHeadlessJob validiert Inputs nicht; packages/image muss alles pruefen | VALID | Eingangsvalidierung in packages/image (pixels-Laenge, dtype, Endlichkeit) (§7) |
| O-L8 | LOW | footDate "July 2026" wird stale | VALID | In Release-Checkliste (§8) |
| O-I1 | INFO | Zwei "Momentenradius"-Bedeutungen im Produkt (field: 2sigma um Gittermitte; Analyzer: 4sigma um Schwerpunkt) | VALID | UI-Label-Abgrenzung + Doku-Notiz (§7) |
| O-I2 | INFO | "UI rechnet nichts (check:scope)" ueberzeichnet das Gate (prueft nur Importe) | VALID | Formulierung praezisiert (§7) |
| O-I3 | INFO | Plan nennt drei verschiedene Gate-Geltungsbereiche | VALID | Eine kanonische Liste (§8) |
| O-I4 | INFO | ISO-Bestandsaufnahme des Plans fuer ihren Scope korrekt (5 Treffer exakt) | Bestaetigung | — |
| O-I5 | INFO | DecompressionStream/atob typisiert + verfuegbar; Problem ist nur Asynchronitaet | Bestaetigung | — |

**Ergebnis:** 0 abgelehnte Findings, 2 teilweise uebernommen (O-H8, O-M1) mit Begruendung in der Tabelle. Alle uebrigen eingearbeitet in `Plan/S18_IMAGE_ANALYZER_PLAN v2.md`.

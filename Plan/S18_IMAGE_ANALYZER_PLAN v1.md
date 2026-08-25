# S18 - Beam-Image-Analyzer: Plan v1

**Datum:** 2026-08-15.
**Status:** PLAN-v1 (HOLD vor Implementierung; Betreiber-Review offen).
**Ziel:** Release v1.1 der Web-App (live ueber modeforge.rholabs.de).
**Routing (ehrlich):** 2 unabhaengige Plan-Drafts (deepseek-v4-pro, max effort, read-only Repo-Erkundung inkl. je einer Welle von 3 Sub-Erkundern; Winkel mvp-first und risk-first; zusammen ~0.11 USD), automatisches Grounding gegen den echten Repo-Index, Manager als Judge mit Merge-Synthese und eigenen Spot-Checks gegen echte Dateien (runHeadlessJob-Dispatch in packages/api, packages/beams/src/fitting.ts, apps/web/src/field-worker.ts, Wording-Grep ueber Produktoberflaechen).

## 0. Auftrag

Browserlokaler Einzelbild-Beam-Profil-Analyzer (TIFF/PNG-Import, Diagnostik, Hintergrundkorrektur, ROI, Momente, Profile, Fits beliebiger Strahlformen inkl. Super-Gauss, Export) als neue Workbench-Faehigkeit. Verbindliche Randbedingung: Die Verwendung der einschlaegigen DIN-EN-ISO-Verfahren wurde von der zustaendigen Stelle nicht gestattet; der Analyzer ist deshalb ein eigenstaendig definierter, vollstaendig oeffentlich dokumentierter Auswerteweg ohne jede Norm-Behauptung.

## 1. Zielbild & Normfreiheit

ModeForge v1.1 erweitert die Web-App um einen vollstaendig browserlokalen Einzelbild-Beam-Profil-Analyzer als sechsten Workbench-Tab. Alle Methoden bilden den eigenstaendig definierten, oeffentlich dokumentierten "ModeForge-Auswerteweg" (docs/theory/image_analysis.md) mit eigenen Namen ("ModeForge 4sigma second-moment diameter", "Suggested ROI", "numerische Sensitivitaet/Stabilitaetsbereich") und Verweisen auf oeffentliche Literatur. In Produktoberflaechen (packages/, apps/, docs/, README, examples, Guide) erscheint nirgends "ISO", "11146", "DIN EN", "normkonform" oder ein Konformitaetsanspruch; keine M2-Bestimmung aus mehreren Ebenen; keine normativen Pruefberichte; keine Aussage "messtechnisch gueltig". Der bestehende Kaustik-Fit-Tab bleibt funktional unberuehrt.

## 2. Scope v1.1 (Release-Gate) vs. nachgelagert

**Drin (v1.1-Release-Gate):**

- TIFF-Import: 8/16/32-bit uint, 32-bit float, Multi-Page mit Seitenwahl, OME-TIFF-Metadaten lesend.
- PNG: Grau 8/16-bit exakt; RGB(A) 8-bit mit expliziter Kanalwahl; Falschfarben-Warnung.
- Rohbild-Diagnostik vor jeder Auswertung.
- 5 Hintergrundmethoden: keine | Dunkelbild | manueller Offset | Hintergrund-Rechtecke (Median + 1.4826*MAD) | robuste geneigte Ebene (Huber).
- ROI: full-frame | manuell | Suggested-ROI als bestaetigungspflichtiger Vorschlag; ROI-Stabilitaetsanalyse 0.8-1.2x.
- Peaks raw/korrigiert/Subpixel-Parabel; Schwerpunkt + Peak-Abstand.
- Momentenanalyse: Kovarianz, Hauptachsen, Orientierungskontrast q, sigma1/sigma2, 4sigma-Durchmesser.
- Profile/Projektionen/Achsenschnitte; FWHM interpoliert mit Mehrdeutigkeitsmarkierung.
- Fits: 1D-Gauss, rotierter elliptischer 2D-Gauss, Super-Gauss zuschaltbar; Residuendiagnostik.
- Abgeleitete Kenngroessen; JSON/CSV/PNG-Export; EN/DE; Guide-Sektion.

**Bewusst NICHT in v1.1:** CSV-Intensitaetsmatrizen-Import, Multi-Page-als-Messserie, Rolling-Ball (komplett nachgelagert), Analyzer-Zustand im Projekt-JSON-Vertrag (bleibt sessionslokal), Batch-Auswertung.

## 3. S18a - Fundament + Import-Ehrlichkeit

Neues Paket `packages/image` (eigenstaendige Domaene ohne Optik-Abhaengigkeit):

- `src/contracts.ts`: unveraenderlicher typed-array Originalpuffer + Metadaten, ImageAnalyzerConfig, Result-Skelett.
- `src/decode.ts`: konservativer Eigen-Decoder nach ZMX-Vorbild "ehrlich blocken statt still substituieren" - TIFF-Subset (little/big endian, Strips unkomprimiert, 8/16/32-bit uint + 32-bit float, IFD-Kette/Seitenwahl, ImageDescription/OME-XML durchgereicht; Kompression/Tiles/Planar/Palette blocken mit klarer Meldung), PNG Grau 8/16-bit exakt via nativer DecompressionStream-Inflate, PNG RGB(A) 8-bit mit Kanalwahl. Gebuendeltes geotiff.js/utif2 nur als dokumentierte Rueckfalloption (Betreiber-Entscheid nach Lizenz-/Bundle-Messung).
- `src/diagnostics.ts`: O(N) Min/Max/Histogramm, Saettigung (Anzahl+Anteil, dtype-abhaengige Grenze; Float nur mit Nutzerangabe), Null-/Negativ-/NaN-Werte, Hot-Pixel-Kandidaten (MAD), Randintensitaet, Multi-Maxima, Dynamikbereich, Rand-Beruehrung.
- **Ab S18a aktiv:** Normfreiheits-Gate in `scripts/check-scope.mjs` - wortgrenzen-genauer Verbots-Scan ("ISO", "11146", "DIN EN", "normkonform", "norm-/standard-compliant") ueber packages/image, apps/web, docs/theory/image*, i18n/Guide; `packages/image` zusaetzlich in der UI-Import-Blockliste.

Gates: Format-Orakel je dtype/Endianness/Multipage/Block-Fall, Immutabilitaets-Test, typecheck, npm test.

## 4. S18b - Hintergrund + ROI + Stabilitaet

- `src/background.ts`: none; Dunkelbild I_raw - I_dark mit Dimensions-/dtype-Pruefung; manueller Offset; Hintergrund-Rechtecke -> Mittelwert/Median/Stdabw/MAD, B_hat = median, sigma_B_hat = 1.4826*MAD; robuste Ebene B0 + Bx*x + By*y per IRLS mit Huber-Gewichten aus Hintergrundpixeln. Negative Werte nach Korrektur werden nicht geklippt, sondern gezaehlt und ausgewiesen.
- `src/roi.ts`: full-frame, manuelles Rechteck, Suggested-ROI (B_hat/sigma_B_hat aus Raendern oder markierten Bereichen, Maske I > B_hat + k*sigma_B_hat mit dokumentiertem k-Default, groesste zusammenhaengende Peak-Region, Bounding Box + dokumentiertes Padding; Ergebnis nur Vorschlag, Flag userConfirmed im Result).
- ROI-Stabilitaetsanalyse: vollstaendige Re-Auswertung bei 0.8/0.9/1.0/1.1/1.2-facher Fenstergroesse, pro Kenngroesse +/-%-Sensitivitaet, Instabilitaetswarnung ueber Schwelle.

Orakel: geneigte Ebene rauschfrei <1e-9 rekonstruiert, MAD-Robustheit gegen Hot Pixels, Suggested-ROI trifft Ground-Truth-Region, Sensitivitaeten deterministisch.

## 5. S18c - Momente/Peaks/Profile

- `src/moments.ts`: intensitaetsgewichteter Schwerpunkt; Kovarianzmatrix -> lambda1/lambda2 + Hauptachsenwinkel; Orientierungskontrast q = (lambda_max - lambda_min)/(lambda_max + lambda_min), Warnung bei q < 0.05; sigma1/sigma2 und "ModeForge 4sigma second-moment diameter" 4*sigma1/4*sigma2; Peak raw/korrigiert; Subpixel-Peak als lokaler Parabelfit (3x3), unterdrueckt mit Warnung bei Saettigung in der Peak-Umgebung; Abstand Peak-Schwerpunkt als Asymmetrie-Indikator.
- `src/profiles.ts`: Schnitte durch Peak und Schwerpunkt (x/y), integrierte Projektionen, Profile entlang Moment- und Fit-Achsen (bilineare Interpolation); FWHM ueber interpolierte Halbmaximum-Schnittpunkte, bei Mehrfach-Schnitten/Multi-Peak als "nicht eindeutig" markiert; strikte Trennung FWHM(Daten) / FWHM(Fit) / 1-ueber-e2-Breite / 2. Moment in Vertrag und UI.

Orakel: Schwerpunkt/Winkel/sigma gegen analytische Synthetik (rauschfrei <1e-9, verrauscht mit festem Seed statistisch), Subpixel <0.05 px, FWHM = w*sqrt(2*ln2) der Einheits-Gauss.

## 6. S18d - Fits + Kenngroessen

- `src/fit.ts`: eigene Levenberg-Marquardt-Implementierung in TypeScript (analytische Jacobians, Marquardt-Daempfung, Parameter-Skalierung, Konvergenz ueber relative chi^2-/Parameter-Deltas, Iterations-/Zeitbudget, Status konvergiert/nicht-konvergiert/am-Bound). Modelle: 1D-Gauss I = B + A*exp(-2(x-x0)^2/w^2) auf Profilen; rotierter elliptischer 2D-Gauss (x0, y0, A, w1, w2, theta; Hintergrund konstant oder geneigt mitgefittet); Super-Gauss-Exponent n zuschaltbar (Start n=1, Bounds [0.5, 10]); Startwerte aus Momenten; optionale Huber-Gewichtung. Ausgaben: Parameter, Residuenbild + Residuenprofile, RMS-/Max-Residuum, Fit- vs. Momentenbreiten-Vergleich; alle Streuangaben heissen "numerische Sensitivitaet", nie Messunsicherheit.
- `src/metrics.ts`: Elliptizitaet (dokumentierter Achsenquotient), Peak-to-Background, eingeschlossene Leistung in Kreis/Ellipse, radiale Verteilung, Multi-Peak-Anzahl + Abstaende, Symmetriefehler, Gauss-vs-Super-Gauss-Delta-chi^2, Clipping-Indikator, Hot-Pixel-Anteil.
- Performance-Budget: 2048x2048 Float64 im Worker <3 s fuer Momente + 2D-Fit (Referenz-Desktop); groessere Bilder blocken ehrlich (Cap-Vorschlag 4096x4096).

Orakel: LM rekonstruiert rauschfreie Synthetik <1e-6 rel, Seed-Toleranzen verrauscht, n-Rekonstruktion, ehrlicher Nichtkonvergenz-Status, Residuen-RMS gegen eingespeistes Rauschniveau.

## 7. S18e - API + Worker + UI

- `packages/api`: neues HeadlessJob-Kind `image-analysis` - Input entweder `{pixels: number[] zeilenmajor, width, height, dtype}` (Tests/Fixtures) oder `{fileBase64, formatHint, pageIndex, channel}` (Decode + Analyse komplett in packages/image); Pixelkalibrierung optional `pixelPitchUmX`/`pixelPitchUmY` (nicht-quadratische Pixel erlaubt); Ergebnisse primaer in px, mm-Felder nur bei gesetzter Kalibrierung; Result versioniert mit Sektionen raw/background/roi/stability/peak/centroid/moments/profiles/fits/metrics/warnings; alle Felder mit Einheitensuffix (...Px, ...Mm, ...Um, ...Counts, ...Deg).
- Warncodes IMAGE_* im bestehenden SimulationWarning-Modell (`packages/core/src/warnings.ts`) mit exakten Triggern: SATURATION, EDGE_TOUCH, MULTI_PEAK, ORIENTATION_UNSTABLE (q<0.05), ROI_SENSITIVE, ROI_UNCONFIRMED, FIT_NOT_CONVERGED, RESIDUAL_HIGH, FALSE_COLOR_SOURCE, SUBPIXEL_SUPPRESSED_SATURATION, NEGATIVE_AFTER_BACKGROUND, HOT_PIXELS, FLOAT_SPECIALS, SIZE_BLOCKED.
- **Verbindliche Betreiber-Vorgabe (2026-08-15):** Der Analyzer bekommt einen EIGENEN Reiter; die UI-Schicht folgt exakt dem bestehenden Workbench-Stil (workbench.css-Bausteine, vorhandene Panel-/Chip-/Plot-/Format-Muster, gleiche Typografie- und Farblogik) - keine neue Designsprache.
- `apps/web`: sechster Tab (Vorschlag EN "Analyzer" / DE "Bildanalyse") als `views/image.ts` + `image-worker.ts` nach dem field-worker.ts-Muster (Token/Progress/Fallback, Decode-Cache im Worker); Upload-Flow mit Seiten-/Kanalwahl + Kalibrierung; Colormap-Rendering strikt getrennt vom Originalpuffer; ROI-Interaktion (Rechteck ziehen, Suggested-ROI als Vorschlag mit Bestaetigen-Button); Panel-Reihenfolge Diagnostik -> Hintergrund -> ROI/Stabilitaet -> Momente/Profile -> Fits/Residuen; Export JSON/CSV/PNG; i18n EN/DE; main/chrome/state-Verdrahtung; UI rechnet nichts (check:scope).

## 8. S18f - Release-Haertung v1.1

- **Norm-Wording-Sweep der BESTEHENDEN Oberflaechen:** README.md:16 "ISO-style least-squares fit" und die vier "ISO semantics"-Kommentare in packages/api/src/index.ts:128/184/263/372 auf normfreie Formulierung ("measured second-moment waist convention", finaler Wortlaut Betreiber-Entscheid). Danach gilt das Verbots-Gate aus S18a repo-weit fuer Produktoberflaechen (packages, apps, docs, README, examples; Plan/ und agents/ als historischer Trail dokumentiert ausgenommen).
- `docs/theory/image_analysis.md`: jede Methode mit Formel, Parametern, Grenzen, oeffentlichen Quellen. Guide EN/DE neue Sektion inkl. "Grenzen ehrlich" (keine Norm-Konformitaet, Stabilitaet != Messunsicherheit, Einzelbild != M2).
- `examples/image-analysis.headless.json` mit kleiner eingebetteter Synthetik-Matrix + additiver expected summary; `agents/verification/image_analyzer_cases.json` + Handler in `scripts/verify-reference-cases.mjs` (~10-15 neue Faelle). Landing-Bullet.
- Volle Gates: typecheck, typecheck:web, npm test, verify:cases, verify:headless, check:scope inkl. Norm-Gate, build:web, Playwright-Smoke mit echter kleiner TIFF/PNG-Fixture (Upload -> ROI bestaetigen -> Fit -> Export).
- Plan/INDEX.md-Trail; Public-Mirror-Neuaufbau + Deploy hinter DEPLOY_PAGES erst nach Betreiber-Freigabe.

## 9. Querschnitt Test-Infrastruktur

`packages/image/src/synthetic.ts` (test-only, ueber api exportiert) erzeugt deterministische Ground-Truth-Bilder: Gauss / elliptisch-rotiert / Super-Gauss, konstanter + geneigter Hintergrund, seeded Gauss- und Poisson-Rauschen ueber eigenen PRNG (kein Math.random), Hot Pixels, Saettigungs-Clipping, Randbeschnitt, Nebenreflex-Geist. Alle Orakel plattformdeterministisch (feste Seeds, Float64), damit verify-cases-artige Pinnung traegt.

## 10. Risiken & offene Betreiber-Entscheidungen

1. **Decoder-Strategie:** Empfehlung Eigen-Subset mit ehrlichem Blocken (0 Dependencies, ZMX-Philosophie); Alternative gebuendeltes geotiff.js (breitere Wild-TIFF-Abdeckung inkl. LZW/Deflate-komprimierter Kamera-TIFFs, +Bundle, Lizenzpruefung) - Entscheid in S18a nach Messung. Risiko der Empfehlung: komprimierte TIFFs blocken in v1.1 ehrlich.
2. **Tab-Name** EN/DE (Vorschlag "Analyzer" / "Bildanalyse").
3. **Suggested-ROI-Defaults** k und Padding.
4. **Bildgroessen-Cap** (Vorschlag 4096x4096 hart, 2048^2 Performance-Referenz).
5. **Ersatz-Wortlaut fuer die bestehenden ISO-Formulierungen** (juristisch heikelster Punkt - Betreiber entscheidet Wortlaut).
6. **Float-Saettigungsgrenze ohne Metadaten:** Default keine Saettigungserkennung bei Float ohne Nutzerangabe + Hinweis.
7. **Rolling-Ball** bleibt draussen bis eigener Auftrag.

Groesste technische Risiken: LM-Robustheit auf realen verrauschten Bildern (Gegenmittel: Momente-Start, Huber, Bounds, ehrlicher Status) und Wild-TIFF-Vielfalt (Gegenmittel: ehrliches Blocken mit praezisen Meldungen statt stiller Fehlinterpretation).

## Revisionen

- **v1 (2026-08-15):** Erstfassung aus 2-Draft-Panel + Manager-Synthese. Nachtrag gleicher Tag (vor Review): verbindliche Betreiber-Vorgabe eingearbeitet - eigener Reiter, UI-Schicht im bestehenden Workbench-Stil. Spine: Draft B (mvp-first: v1.1-Schnitt, Datenvertraege, Numerik, Orakelplan). Grafts aus Draft A (risk-first): Normfreiheits-Verbots-Gate in check:scope ab S18a, IMAGE_*-Warncodes, Subpixel-Unterdrueckung bei Saettigung, konkrete UI-Verdrahtungspunkte. Manager-Ergaenzungen: Sweep der bestehenden ISO-Formulierungen (README.md:16 + 4 Kommentare packages/api/src/index.ts - von beiden Drafts uebersehen), Eigen-Decoder-Empfehlung nach ZMX-Ehrlichkeits-Vorbild, PNG-Grau-16-bit exakt via nativer DecompressionStream, deterministische Seeds fuer alle Rausch-Orakel, Analyzer bleibt ausserhalb des Projekt-JSON-Vertrags, Rolling-Ball ganz nachgelagert.

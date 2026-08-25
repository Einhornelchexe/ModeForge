# S18 - Beam-Image-Analyzer: Plan v2

**Datum:** 2026-08-15.
**Status:** PLAN-v2 nach Cross-Review R1 (HOLD vor Implementierung; Betreiber-Review offen).
**Ziel:** Release v1.1 der Web-App (live ueber modeforge.rholabs.de).
**Ersetzt:** `Plan/S18_IMAGE_ANALYZER_PLAN v1.md`. **Review-Trail:** `Plan/S18_PLAN_REVIEW R1.md` (39 Findings, 0 Halluzinationen, 0 Ablehnungen, 2 teilweise).
**Routing (ehrlich):** v1 aus 2 unabhaengigen Plan-Drafts (deepseek-v4-pro, max effort, read-only Repo-Erkundung inkl. Sub-Erkunder-Wellen; ~0.11 USD) + Manager-Merge. R1-Review: Opus 5 (frische Session, peer/blind, 39 Findings gegen echten Code); Gemini-Leg (3.7 Flash high) ausstehend, optional auf v2. Manager-Halluzinationscheck aller tragenden Claims gegen Datei:Zeile.

## 0. Auftrag

Browserlokaler Einzelbild-Beam-Profil-Analyzer (TIFF/PNG-Import, Diagnostik, Hintergrundkorrektur, ROI, Momente, Profile, Fits beliebiger Strahlformen inkl. Super-Gauss, Export) als neue Workbench-Faehigkeit. Verbindliche Randbedingung: Die Verwendung der einschlaegigen DIN-EN-ISO-Verfahren wurde von der zustaendigen Stelle nicht gestattet; der Analyzer ist ein eigenstaendig definierter, vollstaendig oeffentlich dokumentierter Auswerteweg ohne jede Norm-Behauptung.

## 1. Zielbild & Normfreiheit

ModeForge v1.1 erweitert die Web-App um einen vollstaendig browserlokalen Einzelbild-Beam-Profil-Analyzer als sechsten Workbench-Tab. Alle Methoden bilden den eigenstaendig definierten, oeffentlich dokumentierten "ModeForge-Auswerteweg" (docs/theory/image_analysis.md) mit eigenen Namen ("ModeForge 4sigma second-moment diameter", "Suggested ROI", "numerische Sensitivitaet/Stabilitaetsbereich") und Verweisen auf oeffentliche Literatur. In Produktoberflaechen erscheint nirgends "ISO", "11146", "DIN EN", "normkonform"/"normgerecht" als Eigenschaftsbehauptung (kanonischer Gate-Geltungsbereich in Abschnitt 8; verneinende Schutzklauseln wie im Impressum bleiben per Allowlist erhalten). Keine M2-Bestimmung aus mehreren Ebenen; keine normativen Pruefberichte; keine Aussage "messtechnisch gueltig". Der bestehende Kaustik-Fit-Tab bleibt funktional unberuehrt.

## 2. Scope v1.1 (Release-Gate) vs. nachgelagert

**Drin (v1.1-Release-Gate):**

- TIFF-Import: 8/16/32-bit uint, 32-bit float, Multi-Page mit Seitenwahl, OME-TIFF-Metadaten lesend.
- PNG: Grau 8/16-bit exakt; RGB(A) 8-bit mit expliziter Kanalwahl; Falschfarben-Warnung. Ehrlich geblockt: Adam7-Interlace, Palette (Farbtyp 3), 16-bit-RGB, tRNS.
- Rohbild-Diagnostik vor jeder Auswertung.
- 5 Hintergrundmethoden: keine | Dunkelbild | manueller Offset | Hintergrund-Rechtecke (Median + 1.4826*MAD mit Floor) | robuste geneigte Ebene (Huber-IRLS, vollstaendig spezifiziert).
- ROI: full-frame | manuell | Suggested-ROI als bestaetigungspflichtiger Vorschlag; ROI-Stabilitaetsanalyse (Groessen- UND Lage-Sweep, ohne 2D-Fit).
- Peaks raw/korrigiert/Subpixel (definiertes Verfahren); Schwerpunkt + Peak-Abstand.
- Momentenanalyse: Kovarianz (dokumentierte Negativwert-Regel), Hauptachsen, Orientierungskontrast q, sigma1/sigma2, 4sigma-Durchmesser.
- Profile/Projektionen/Achsenschnitte; FWHM interpoliert (definierte Basislinie) mit Mehrdeutigkeitsmarkierung.
- Fits (auf der ROI): 1D-Gauss, rotierter elliptischer 2D-Gauss, Super-Gauss zuschaltbar (Repo-Konvention); Residuendiagnostik.
- Abgeleitete Kenngroessen; JSON/CSV/PNG-Export; EN/DE; Guide-Sektion.

**Bewusst NICHT in v1.1:** CSV-Intensitaetsmatrizen-Import, Multi-Page-als-Messserie, Rolling-Ball (komplett nachgelagert), Analyzer-Zustand im Projekt-JSON-Vertrag (bleibt sessionslokal), Batch-Auswertung, Fit-Parameter-Sensitivitaet im Stabilitaets-Sweep (nur auf expliziten Nutzer-Klick, nachgelagert falls teuer).

## 3. S18a - Fundament + Import-Ehrlichkeit

Neues Paket `packages/image` (eigenstaendige Rechen-Domaene; nutzt aus packages/core nur das geteilte Warn-/Validation-/Units-Vokabular, keine Optik-Pakete):

- `src/contracts.ts`: ImageBuffer (Originalpuffer als typed array + Metadaten: width, height, dtype, Seitenzahl, Quelle, Kanalwahl), ImageAnalyzerConfig, ImageAnalysisResult-Skelett. Original wird nach Decode defensiv kopiert und nie mutiert; Zusicherung ueber No-Mutation-Tests (Object.freeze auf TypedArrays ist nicht moeglich - die Garantie ist Disziplin + Test, nicht Sprachmechanik). Eingangsvalidierung im Paket: pixels.length == width*height, bekannter dtype, endliche Dimensionen (runHeadlessJob selbst validiert nicht).
- `src/decode.ts`: konservativer Eigen-Decoder nach ZMX-Vorbild "ehrlich blocken statt still substituieren".
  - **API ist async und vom Analyse-Job getrennt:** `decodeImageFile(bytes, opts) -> Promise<ValidationResult<DecodedImage>>` (PNG-Inflate via nativer DecompressionStream ist await-pflichtig). Der Analyse-Job bleibt synchron (Abschnitt 7); die UI ruft decode im Worker auf und uebergibt dem Job nur noch Pixel.
  - TIFF-Subset (synchron dekodierbar): little/big endian, Strips unkomprimiert, 8/16/32-bit uint + 32-bit float, IFD-Kette/Seitenwahl, ImageDescription/OME-XML als Metadaten-String durchgereicht. Geblockt mit klarer Meldung: Kompression, Tiles, Planar, Palette.
  - PNG: Grau 8/16-bit exakt (eigener Chunk-Parser + DecompressionStream + Unfilter); RGB(A) 8-bit mit Kanalwahl. Geblockt: Adam7, Palette, 16-bit-RGB, tRNS.
  - Gebuendeltes geotiff.js/utif2 nur als dokumentierte Rueckfalloption (Betreiber-Entscheid nach Lizenz-/Bundle-Messung).
- `src/diagnostics.ts`: O(N) Min/Max/Histogramm, Saettigung (Anzahl+Anteil, dtype-abhaengige Grenze; Float nur mit Nutzerangabe), Null-/Negativ-/NaN-Werte, Hot-Pixel-Kandidaten (MAD), Randintensitaet, Multi-Maxima, Dynamikbereich, Rand-Beruehrung.
- **Ab S18a aktiv:** Normfreiheits-Gate in `scripts/check-scope.mjs` nach der Spezifikation in Abschnitt 8 (kanonischer Geltungsbereich, Token-Patterns, Allowlist), plus `packages/image` in der UI-Import-Blockliste.

Gates: Format-Orakel je dtype/Endianness/Multipage/Block-Fall (synthetische TIFF/PNG-Bytes), No-Mutation-Test, Validierungs-Fehlerfaelle, typecheck, npm test.

## 4. S18b - Hintergrund + ROI + Stabilitaet

- `src/background.ts`:
  - none | Dunkelbild I_raw - I_dark (Dimensions- UND dtype-Gleichheit erzwungen, sonst IMAGE_DARK_MISMATCH) | manueller Offset | Hintergrund-Rechtecke: Mittelwert/Median/Stdabw/MAD; B_hat = median; sigma_B_hat = max(1.4826*MAD, halber Quantisierungsschritt des dtype); ist MAD exakt 0 bei Float-Daten, Fallback auf Stdabw mit Hinweis.
  - Robuste geneigte Ebene, vollstaendig spezifiziert: zentrierte Koordinaten (x-x_mean, y-y_mean) im Design (Konditionierung); Start = gewoehnliche LS-Loesung; IRLS mit Huber-Gewichten, Knick delta = 1.345*sigma_hat mit sigma_hat = 1.4826*MAD der aktuellen Residuen, je Iteration nachgefuehrt; Abbruch bei relativer Parameteraenderung < 1e-10 oder 50 Iterationen; Ergebnis skalenaequivariant (8-bit-, 16-bit- und Float-Version derselben Szene liefern dieselbe Ebene bis auf Skala).
  - Negative Werte nach Korrektur: nie geklippt im gespeicherten Korrekturbild; Anteil wird berichtet (IMAGE_NEGATIVE_AFTER_BACKGROUND). **Momentenregel (dokumentierter ModeForge-Weg):** Schwerpunkt/Kovarianz rechnen mit w = max(I_corr, 0); zusaetzlich Guards Sum(w) > 0 und lambda_min >= 0, sonst IMAGE_MOMENTS_UNDEFINED und null-Ergebnis statt NaN-Kaskade.
- `src/roi.ts`: full-frame, manuelles Rechteck, Suggested-ROI (B_hat/sigma_B_hat aus Raendern oder markierten Bereichen, Maske I > B_hat + k*sigma_B_hat mit dokumentiertem k-Default, groesste zusammenhaengende Peak-Region, Bounding Box + dokumentiertes Padding; Ergebnis nur Vorschlag, Flag userConfirmed, sonst IMAGE_ROI_UNCONFIRMED).
- ROI-Stabilitaetsanalyse (ohne 2D-Fit, siehe Budget in Abschnitt 6): Re-Auswertung von Hintergrund, Schwerpunkt, Momenten und FWHM bei (a) Fenstergroessen 0.8/0.9/1.0/1.1/1.2x und (b) Zentrums-Shifts von +-5% der Fensterbreite in x und y (9 Varianten gesamt); pro Kenngroesse +-%-Spannweite als "numerische Sensitivitaet"; Fenster am Bildrand: Clamp+Shrink und als eingeschraenkt geflaggt; Instabilitaetswarnung IMAGE_ROI_SENSITIVE ueber Schwelle.

Orakel: geneigte Ebene rauschfrei < 1e-9 (zentriert), MAD-Robustheit gegen Hot Pixels, Skalenaequivarianz-Test (8/16-bit/Float derselben Szene), Suggested-ROI trifft Ground-Truth-Region, MAD=0-Degenerationsfall, Sensitivitaeten deterministisch.

## 5. S18c - Momente/Peaks/Profile

- `src/moments.ts`: intensitaetsgewichteter Schwerpunkt; Kovarianzmatrix -> lambda1/lambda2 + Hauptachsenwinkel (Vertragsfeld `thetaRad`, Kanonisierung sigma1 >= sigma2, theta in [0, pi)); Orientierungskontrast q = (lambda_max - lambda_min)/(lambda_max + lambda_min), Warnung IMAGE_ORIENTATION_UNSTABLE bei q < 0.05; sigma1/sigma2 und "ModeForge 4sigma second-moment diameter" 4*sigma1/4*sigma2; Peak raw/korrigiert.
- Subpixel-Peak, definiert: zwei separable 3-Punkt-Parabeln auf I (x- und y-Richtung um das diskrete Maximum); dokumentierte Gueltigkeit ab w >= 3 px (systematischer Bias der I-Parabel bei schmaleren Strahlen dokumentiert); unterdrueckt mit IMAGE_SUBPIXEL_SUPPRESSED_SATURATION bei Saettigung in der 3x3-Umgebung; am Bildrand (unvollstaendige Nachbarschaft) unterdrueckt und an IMAGE_EDGE_TOUCH gekoppelt.
- Abstand Peak-Schwerpunkt als Asymmetrie-Indikator.
- `src/profiles.ts`: Schnitte durch Peak und Schwerpunkt (x/y), integrierte Projektionen, Profile entlang Moment- und Fit-Achsen (bilineare Interpolation). FWHM: Basislinie definiert als Halbmaximum UEBER HINTERGRUND, d. h. Schnitt bei B_hat + (I_peak - B_hat)/2, interpolierte Schnittpunkte; bei Mehrfach-Schnitten/Multi-Peak IMAGE_FWHM_AMBIGUOUS statt Zahl ohne Kontext. Strikte Trennung FWHM(Daten)/FWHM(Fit)/1-ueber-e2-Breite/2. Moment in Vertrag und UI.

Orakel: Schwerpunkt/Winkel/sigma gegen analytische Synthetik (rauschfrei < 1e-9, verrauscht mit festem Seed statistisch), Subpixel < 0.05 px bei w >= 3 px, FWHM = w*sqrt(2*ln2) der Einheits-Gauss (rauschfrei, hintergrundfrei) + Basislinien-Fall mit konstantem Hintergrund.

## 6. S18d - Fits + Kenngroessen

- `src/fit.ts`: eigene Levenberg-Marquardt-Implementierung in TypeScript (analytische Jacobians, Marquardt-Daempfung, Parameter-Skalierung, Konvergenz ueber relative chi^2-/Parameter-Deltas, Iterations-/Zeitbudget, Status konvergiert/nicht-konvergiert/am-Bound). **Gefittet wird auf der ROI**, nicht dem Full-Frame.
- Modelle: 1D-Gauss I = B + A*exp(-2(x-x0)^2/w^2) auf Profilen; rotierter elliptischer 2D-Gauss (x0, y0, A, w1, w2, theta; Hintergrund konstant oder geneigt mitgefittet); Super-Gauss zuschaltbar in der **bestehenden Repo-Konvention** von `packages/beams/src/profiles.ts:51` (relative Intensitaet exp(-2*(r/edge)^(2*order)), order=1 = Gauss; Start order=1, Bounds [0.5, 10]). Startwerte aus Momenten; optionale Huber-Gewichtung. Ergebnis-Kanonisierung wie Abschnitt 5 (w1 >= w2, thetaRad in [0, pi)).
- **Pixelkalibrierung (anisotropiefest):** optional pixelPitchUmX/pixelPitchUmY. mm-Groessen entstehen NIE durch naive Skalierung von px-Ergebnissen: Momente/Kovarianz werden in physikalischen Koordinaten gerechnet (Koordinaten vor der Momentenbildung skaliert); Fit-Ergebnisse werden exakt ueber die Quadratform transformiert (A' = S^-T A S^-1, Breiten/Winkel aus deren Eigenzerlegung). Bei pitchX != pitchY zusaetzlich IMAGE_ANISOTROPIC_PIXELS (info). Ohne Kalibrierung nur px-Felder + IMAGE_CALIBRATION_MISSING (info).
- Ausgaben: Parameter, Residuenbild (Float32Array + dims) + Residuenprofile, RMS-/Max-Residuum, Fit- vs. Momentenbreiten-Vergleich (Umrechnung je Modell dokumentiert; fuer Super-Gauss w<->sigma-Beziehung numerisch verankert, siehe Abschnitt 9); Modellvergleich Gauss vs. Super-Gauss als **relative RMS-Residuenreduktion in %** - bewusst KEIN chi^2-Signifikanzanspruch (kein Rauschmodell); alle Streuangaben heissen "numerische Sensitivitaet", nie Messunsicherheit. Peak-to-Background nur bei B_hat > 0, sonst als undefiniert ausgewiesen.
- `src/metrics.ts`: Elliptizitaet (dokumentierter Achsenquotient sigma2/sigma1 bzw. w2/w1), Peak-to-Background (mit Guard), eingeschlossene Leistung in Kreis/Ellipse, radiale Verteilung, Multi-Peak-Anzahl + Abstaende, Symmetriefehler, Modellvergleich (s. o.), Clipping-Indikator, Hot-Pixel-Anteil.
- **Performance-Budget (revidiert):** O(N)-Paesse (Diagnostik, Hintergrund, Momente, Profile) + 9-Varianten-Stabilitaets-Sweep < 1 s bei 2048x2048 (Float64, Worker); 2D-LM auf typischer ROI < 2 s; Gesamtanalyse-Ziel < 5 s bei 2048^2 auf Referenz-Desktop, mit ehrlichem Progress im Worker. Groessere Bilder bis Cap 4096x4096, darueber IMAGE_SIZE_BLOCKED; Speicherpfad siehe Abschnitt 7.

Orakel: LM rekonstruiert rauschfreie, DEUTLICH elliptische Synthetik (w1/w2 >= 1.3) < 1e-6 rel in allen Parametern; nahezu runder Fall prueft nur rotationsinvariante Groessen (Breitenprodukt, Zentrum, Amplitude); order-Rekonstruktion beim Super-Gauss; ehrlicher Nichtkonvergenz-Status; Residuen-RMS gegen eingespeistes Rauschniveau; Quadratform-Transformation gegen direkt in mm gerechnete Momente (anisotroper Pitch-Testfall).

## 7. S18e - API + Worker + UI

- `packages/api`:
  - Neues HeadlessJob-Kind `image-analysis`, **synchron wie alle Job-Kinds**: Input = {pixels: Float64Array | Float32Array | number[] (zeilenmajor), width, height, dtype, calib?, config?}. **Kein fileBase64-Input.** Fuer Tests/CLI-Fixtures kleine number[]-Matrizen (JSON-faehig); im Browser reicht der Worker typed arrays durch.
  - Decode als eigene async API-Funktion re-exportiert: `decodeImageFile(...)` aus packages/image (I/O-nahe Vorstufe, kein Physik-Leak in die UI; check:scope-Blockliste bleibt intakt, die UI importiert weiter nur packages/api).
  - Result versioniert mit Sektionen raw/background/roi/stability/peak/centroid/moments/profiles/fits/metrics/warnings; Einheitensuffixe ...Px, ...Mm, ...Um, ...Counts und Winkel als `thetaRad` (Repo-Konvention Rad im Vertrag, Grad nur in der UI-Anzeige). mm-Felder nur bei gesetzter Kalibrierung (Herkunft: Abschnitt 6).
  - Grosse Puffer (Residuenbild, optionale Korrekturbild-Ansicht) als Float32Array + dims im Result; die UI-Worker-Bruecke nutzt **Transferables** (ArrayBuffer-Move statt Kopie) in beide Richtungen.
- Warncodes IMAGE_* im bestehenden SimulationWarning-Modell (`packages/core/src/warnings.ts`; Union-Erweiterung ist das etablierte Muster, Kontextwerte stehen wie bisher im message-String): SATURATION, EDGE_TOUCH, MULTI_PEAK, ORIENTATION_UNSTABLE, ROI_SENSITIVE, ROI_UNCONFIRMED, FIT_NOT_CONVERGED, RESIDUAL_HIGH, FALSE_COLOR_SOURCE, SUBPIXEL_SUPPRESSED_SATURATION, NEGATIVE_AFTER_BACKGROUND, HOT_PIXELS, FLOAT_SPECIALS, SIZE_BLOCKED, FWHM_AMBIGUOUS, DECODE_BLOCKED, MOMENTS_UNDEFINED, DARK_MISMATCH, CALIBRATION_MISSING, ANISOTROPIC_PIXELS.
- `apps/web` (verbindliche Betreiber-Vorgabe 2026-08-15: eigener Reiter, UI-Schicht exakt im bestehenden Workbench-Stil - workbench.css-Bausteine, Panel-/Chip-/Plot-/Format-Muster, keine neue Designsprache):
  - Sechster Tab (Vorschlag EN "Analyzer" / DE "Bildanalyse") als `views/image.ts` + `image-worker.ts` nach field-worker.ts-Muster (Token/Progress/Fallback), Decode-Cache im Worker.
  - **Eigener binaerer Upload-Pfad** (arrayBuffer statt TextDecoder) mit eigenem Cap (Vorschlag 64 MB) und SICHTBARER Fehlermeldung - der bestehende 5-MB-Text-Pfad (main.ts:1204/1236, stiller Abbruch) wird nicht mitbenutzt und bleibt unveraendert.
  - Upload-Flow mit Seiten-/Kanalwahl + Kalibrierungseingabe; Colormap-Rendering strikt getrennt vom Originalpuffer.
  - ROI-Interaktion als Canvas-Overlay-Fastpath nach dem onPlotMove-Praezedenzfall (direkte DOM-/Canvas-Manipulation waehrend des Ziehens, Zustands-Commit + Rerender erst bei Release - der Full-innerHTML-Rerender der Shell vertraegt kein Drag pro Mousemove); Suggested-ROI als gestrichelter Vorschlag mit Bestaetigen-Button.
  - Panel-Reihenfolge Diagnostik -> Hintergrund -> ROI/Stabilitaet -> Momente/Profile -> Fits/Residuen; Export JSON/CSV/PNG; i18n EN/DE.
  - Verdrahtung vollstaendig: state.ts Tab-Union erweitern (state.ts:16), main.ts expliziter Render-Zweig (kein else-Fallthrough auf den Field-Tab), chrome.ts Tab-Button + Mode-Pill-Mapping fuer den Analyzer (Vorschlag "IMAGE · LOCAL"; heute binaer FIELD/FAST), .wb-tabs-Overflow/Umbruch fuer 6 Reiter inkl. Mobile pruefen (workbench.css:57-66).
  - Metadaten-Anzeige (ImageDescription/OME-XML): ausschliesslich ueber esc() (format.ts), Anzeige auf 4 KB gekappt mit "mehr anzeigen"; Laufzeit-Metadaten beruehren das Repo-Wort-Gate nicht.
  - UI-Beschriftung grenzt die zwei Momentenbegriffe des Produkts ab: Field-Tab "Momentenradius (2sigma, um Gittermitte)" vs. Analyzer "4sigma-Durchmesser (um Schwerpunkt)"; Doku-Notiz in docs/theory/image_analysis.md.
  - Sprachdisziplin: "UI importiert keine Physikpakete (check:scope-Gate) und rechnet per Review-Disziplin nicht selbst" - das Gate prueft Importe, nicht Arithmetik.

## 8. S18f - Release-Haertung v1.1

- **Norm-Wording-Sweep der BESTEHENDEN Oberflaechen:** README.md:16 ("ISO-style least-squares fit"), packages/api/src/index.ts:128/184/263/372 ("ISO semantics"-Kommentare), tests/unit/field-modes.test.ts:81 (Kommentar) und :103 (Testname "uses ISO waist semantics") -> normfreie Formulierung ("measured second-moment waist convention", finaler Wortlaut Betreiber-Entscheid).
- **Normfreiheits-Gate, kanonische Spezifikation (die eine massgebliche Fassung):**
  - Roots: packages/, apps/, docs/, examples/, tests/, scripts/, README.md, LICENSE, package.json. Ausgenommen: Plan/, agents/ (historischer Trail, dokumentiert), node_modules/, dist/, .git/.
  - Text-Extensions von check-scope um .xml ergaenzt (sitemap.xml).
  - Token-Patterns: /\bISO\b/ (case-sensitiv), /ISO[- ]?11146/i, /\b11146\b/, /\bDIN[- ]EN\b/i, /norm(konform|gerecht)\w*/i, /(norm|standards?)-?compliant/i. Bare "norm"/"normal(ized)" matcht NICHT (Physik-Bezeichner bleiben frei).
  - Exact-String-Allowlist fuer verneinende Schutzklauseln (impressum.html:43 "... keine normgerechte Auslegung dar." bleibt - sie schuetzt, statt zu behaupten). Jeder Allowlist-Eintrag mit Begruendung im Gate-Skript.
  - Produkttexte vermeiden kuenftig auch "ISO 8601"-Schreibweisen (Datumsformat ausschreiben: YYYY-MM-DD).
- `docs/theory/image_analysis.md`: jede Methode mit Formel, Parametern, Grenzen, oeffentlichen Quellen (inkl. Subpixel-Bias, FWHM-Basislinie, Momenten-Negativregel, Huber-Spezifikation, Super-Gauss-Konvention). Guide EN/DE neue Sektion inkl. "Grenzen ehrlich" (keine Norm-Konformitaet, Stabilitaet != Messunsicherheit, Einzelbild != M2).
- Verifikation:
  - `examples/image-analysis.headless.json` (kleine eingebettete Synthetik-Matrix) + **neuer summarizeJob-Zweig** in scripts/verify-headless.mjs; die expected-Datei wird dabei REGENERIERT (alphabetische Einfuegung), Diff wird auf Nur-Additivitaet der bestehenden Eintraege geprueft. Pinning-Praezision je Feld: Momente/Diagnostik 12 signifikante Stellen, Fit-Parameter 6 (Determinismus-Fussnote: V8 bringt seine eigene Math-Implementierung mit - dieselbe Basis, auf der die bestehenden Field-Pins cross-platform halten; Node-Version im CI-Workflow pinnen).
  - `agents/verification/image_analyzer_cases.json` + Handler in scripts/verify-reference-cases.mjs (~10-15 Faelle).
  - CI-Workflow (.github/workflows/deploy-pages.yml): `typecheck` und `typecheck:web` ergaenzen (laufen dort bisher nicht); Node-Version pinnen.
  - Playwright bleibt dev-seitiges Gate wie in S12-S17 (nicht im CI): Smoke Upload -> ROI bestaetigen -> Fit -> Export, mit kleinen Binaer-Fixtures (<= 10 KB) unter tests/fixtures/.
- **Release-Doku-Checkliste (vollstaendig):** chrome.ts:31 Version-Pill ("v1.1 · ..."), package.json + apps/web/package.json Versionen, README-Zahlen aktualisieren (Testzahl ist heute schon stale: "81" vs. real ~100), Landing footTools + features EN und DE (landing.ts:62/108-124) inkl. Analyzer-Karte, footDate, apps/web/index.html JSON-LD-Beschreibung, docs/architecture/CONVENTIONS.md (neuer Tab als Architektur-Regel + neue Suffixklassen ...Px/...Counts + thetaRad-Praezedenz), docs/architecture/API v1.md (Job-Kind-Liste + Result-Union), examples/README.md, docs/validation/reference_cases.md, Guide-Links.
- Plan/INDEX.md-Trail; Public-Mirror-Neuaufbau + Deploy hinter DEPLOY_PAGES erst nach Betreiber-Freigabe.

## 9. Querschnitt Test-Infrastruktur

`packages/image/src/synthetic.ts` (test-only, ueber api exportiert) erzeugt deterministische Ground-Truth-Bilder: Gauss / elliptisch-rotiert / Super-Gauss (Repo-Konvention), konstanter + geneigter Hintergrund, seeded Gauss-Rauschen und Poisson-Rauschen (eigener mulberry32-artiger PRNG, kein Math.random; **Poisson: Knuth-Inversion nur fuer lambda <= 50, darueber seeded Normalapproximation** - dokumentierte Grenze, sonst Endlosschleife bei e^-lambda = 0), Hot Pixels, Saettigungs-Clipping, Randbeschnitt, Nebenreflex-Geist. Die Super-Gauss-w<->Moment-Beziehung wird numerisch verankert (hochaufgeloeste Referenzintegration im Orakel), nicht als unbelegte Formel. Alle Orakel plattformdeterministisch (feste Seeds, Float64).

## 10. Risiken & offene Betreiber-Entscheidungen

1. **Decoder-Strategie:** Empfehlung Eigen-Subset mit ehrlichem Blocken (0 Dependencies, ZMX-Philosophie); Alternative gebuendeltes geotiff.js (breitere Wild-TIFF-Abdeckung inkl. komprimierter Kamera-TIFFs, +Bundle, Lizenzpruefung) - Entscheid in S18a nach Messung. Risiko der Empfehlung: komprimierte TIFFs blocken in v1.1 ehrlich.
2. **Tab-Name** EN/DE (Vorschlag "Analyzer"/"Bildanalyse") **und Mode-Pill-Text** (Vorschlag "IMAGE · LOCAL").
3. **Suggested-ROI-Defaults** k und Padding.
4. **Bildgroessen-Cap** (Vorschlag 4096x4096 hart) **und Upload-Cap** (Vorschlag 64 MB, sichtbare Fehlermeldung).
5. **Ersatz-Wortlaut fuer die bestehenden ISO-Formulierungen** (README, api-Kommentare, Testname - juristisch heikelster Punkt, Betreiber entscheidet Wortlaut).
6. **Float-Saettigungsgrenze ohne Metadaten:** Default keine Saettigungserkennung bei Float ohne Nutzerangabe + Hinweis.
7. **Rolling-Ball** bleibt draussen bis eigener Auftrag.

Groesste technische Risiken: LM-Robustheit auf realen verrauschten Bildern (Gegenmittel: Momente-Start, Huber, Bounds, ROI-Fit, ehrlicher Status), Wild-TIFF-Vielfalt (Gegenmittel: ehrliches Blocken mit praezisen Meldungen), Speicher-/Interaktionspfad der UI (Gegenmittel: Transferables, Canvas-Overlay-Fastpath, Caps mit sichtbaren Meldungen).

## Revisionen

- **v2 (2026-08-15): Cross-Review R1 eingearbeitet.** Quelle: `Plan/S18_PLAN_REVIEW R1.md` (Opus-5-Leg, 39 Findings; Manager-Halluzinationscheck 0 Halluzinationen; Gemini-Leg ausstehend). Alle Findings adjudiziert: 37 uebernommen, 2 teilweise (O-H8: 6-Stellen-Pins + Node-Pin statt Verzicht aufs Pinning, da V8-Math plattformdeterministisch; O-M1: IMAGE-Codes bleiben in der core-Union als etabliertes Muster, Kontext via message), 0 abgelehnt. Wichtigste Aenderungen: Decode async und vom synchronen Job getrennt, fileBase64 gestrichen, Typed-Array-Transport mit Transferables, dokumentierte Momenten-Negativregel + MOMENTS_UNDEFINED-Guard, anisotropiefeste mm-Ableitung per Quadratform, Stabilitaets-Sweep ohne 2D-Fit + Lage-Shifts + Randregel, Huber-/MAD-/Subpixel-/FWHM-Spezifikationen vervollstaendigt, Super-Gauss auf Repo-Konvention, thetaRad statt ...Deg, 6 zusaetzliche Warncodes, eigener binaerer Upload-Pfad (bestehendes stilles 5-MB-Text-Limit umgangen), ROI-Drag als Canvas-Fastpath, Gate-Spezifikation kanonisch + Stamm-Matching + Verneinungs-Allowlist + tests//scripts/ im Scope, ISO-Sweep um tests/unit/field-modes.test.ts:81/103 erweitert, verify-headless-Zweig + differenzierte Pin-Praezision, CI um typecheck ergaenzt, vollstaendige Release-Doku-Checkliste.
- **v1 (2026-08-15):** Erstfassung aus 2-Draft-Panel + Manager-Synthese; Nachtrag gleicher Tag: Betreiber-Vorgabe eigener Reiter + UI im bestehenden Workbench-Stil. Details in `Plan/S18_IMAGE_ANALYZER_PLAN v1.md`.

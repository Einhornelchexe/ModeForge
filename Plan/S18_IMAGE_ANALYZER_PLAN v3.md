# S18 - Beam-Image-Analyzer: Plan v3

**Datum:** 2026-08-15.
**Status:** PLAN-v3 nach Cross-Reviews R1 + R2 (HOLD vor Implementierung; Betreiber-Freigabe offen).
**Ziel:** Release v1.1 der Web-App (live ueber modeforge.rholabs.de).
**Ersetzt:** v2. **Review-Trail:** `Plan/S18_PLAN_REVIEW R1.md` (Opus-Leg, 39 Findings) und `Plan/S18_PLAN_REVIEW R2.md` (Gemini 3.7 Flash + frisches Opus-Leg, ~35 deduplizierte Findings; 0 Halluzinationen in beiden Runden; 0 Ablehnungen).
**Routing (ehrlich):** v1 aus 2 unabhaengigen Plan-Drafts (deepseek-v4-pro, max effort, read-only Repo-Erkundung inkl. Sub-Erkunder; ~0.11 USD) + Manager-Merge; R1 Opus 5 peer/blind; R2 Gemini 3.7 Flash (High) + frisches Opus 5 auf v2; Manager-Halluzinationschecks gegen Datei:Zeile und per Nachrechnung.

## 0. Auftrag

Browserlokaler Einzelbild-Beam-Profil-Analyzer (TIFF/PNG-Import, Diagnostik, Hintergrundkorrektur, ROI, Momente, Profile, Fits beliebiger Strahlformen inkl. Super-Gauss, Export) als neue Workbench-Faehigkeit. Verbindliche Randbedingung: Die Verwendung der einschlaegigen DIN-EN-ISO-Verfahren wurde von der zustaendigen Stelle nicht gestattet; der Analyzer ist ein eigenstaendig definierter, vollstaendig oeffentlich dokumentierter Auswerteweg ohne jede Norm-Behauptung.

## 1. Zielbild & Normfreiheit

ModeForge v1.1 erweitert die Web-App um einen vollstaendig browserlokalen Einzelbild-Beam-Profil-Analyzer als sechsten Workbench-Tab. Alle Methoden bilden den eigenstaendig definierten, oeffentlich dokumentierten "ModeForge-Auswerteweg" (docs/theory/image_analysis.md) mit Verweisen auf oeffentliche Literatur. **Terminologie folgt dem bestehenden Produktvokabular** (kein Namens-Fork): Breiten heissen wie im Bestand "D4sigma diameter" (docs/theory/definitions.md:9, i18n `bD4`, BeamWidthBasis `d4sigma_diameter`) und werden dort als 4x Second-Moment mit eigener, oeffentlich hergeleiteter Definition dokumentiert; dazu "Suggested ROI" und "numerische Sensitivitaet/Stabilitaetsbereich" (nie "Messunsicherheit"). In Produktoberflaechen erscheint nirgends "ISO", "11146", "DIN EN", "IEC 60825", "normkonform"/"normgerecht"/"Norm-Konformitaet" als Eigenschaftsbehauptung (Gate-Spezifikation in Abschnitt 8; verneinende Schutzklauseln bleiben per Allowlist). Keine M2-Bestimmung aus mehreren Ebenen; keine normativen Pruefberichte; keine Aussage "messtechnisch gueltig". Der bestehende Kaustik-Fit-Tab bleibt funktional unberuehrt.

## 2. Scope v1.1 (Release-Gate) vs. nachgelagert

**Drin (v1.1-Release-Gate):**

- TIFF-Import: 8/16/32-bit uint, 32-bit float, Multi-Page mit Seitenwahl, OME-TIFF-Metadaten lesend (sanitisiert, gekappt).
- PNG: Grau 8/16-bit exakt; RGB(A) 8-bit mit expliziter Kanalwahl; Falschfarben-Warnung. Ehrlich geblockt: Adam7-Interlace, Palette, 16-bit-RGB, tRNS.
- Rohbild-Diagnostik vor jeder Auswertung.
- 5 Hintergrundmethoden: keine | Dunkelbild | manueller Offset | Hintergrund-Rechtecke (Median + MAD mit Floor) | robuste geneigte Ebene (Huber-IRLS, vollstaendig spezifiziert inkl. Skalen-Floor).
- ROI: full-frame | manuell | Suggested-ROI als bestaetigungspflichtiger Vorschlag; ROI-Stabilitaetsanalyse (Groessen- + Lage-Sweep, ohne 2D-Fit, mit Randfall- und Partial-Sweep-Regeln).
- Peaks raw/korrigiert/Subpixel (definiertes Verfahren mit Degenerations-Guards); Schwerpunkt + Peak-Abstand.
- Momentenanalyse: vorzeichenbehaftete Second-Moments (unbiased), Hauptachsen, Orientierungskontrast q mit Nenner-Guard, sigma1/sigma2, D4sigma-Durchmesser.
- Profile/Projektionen/Achsenschnitte; FWHM interpoliert (Basislinie ueber Hintergrund) mit Mehrdeutigkeitsmarkierung.
- Fits (ROI-basiert, Groessenregel): 1D-Gauss, rotierter elliptischer 2D-Gauss, Super-Gauss zuschaltbar (Repo-Konvention); Residuendiagnostik.
- Abgeleitete Kenngroessen; JSON/CSV/PNG-Export; EN/DE; Guide-Sektion.

**Bewusst NICHT in v1.1:** CSV-Matrizen-Import, Multi-Page-als-Messserie, Rolling-Ball, Analyzer-Zustand im Projekt-JSON-Vertrag (sessionslokal), Batch-Auswertung, Fit-Parameter-Sensitivitaet im Stabilitaets-Sweep (nur auf expliziten Nutzer-Klick, nachgelagert falls teuer).

## 3. S18a - Fundament + Import-Ehrlichkeit

Neues Paket `packages/image` (eigenstaendige Rechen-Domaene; nutzt aus packages/core nur Warn-/Validation-/Units-Vokabular, keine Optik-Pakete):

- `src/contracts.ts`: ImageBuffer (Originalpuffer als typed array + Metadaten), ImageAnalyzerConfig, ImageAnalysisResult-Skelett. Original wird nach Decode defensiv kopiert und nie mutiert; Zusicherung ueber No-Mutation-Tests (Object.freeze auf TypedArrays ist nicht moeglich). Eingangsvalidierung im Paket: pixels.length == width*height, bekannter dtype, endliche Dimensionen (runHeadlessJob selbst validiert nicht).
- `src/decode.ts`: konservativer Eigen-Decoder, "ehrlich blocken statt still substituieren".
  - **API async und vom Analyse-Job getrennt:** `decodeImageFile(bytes, opts) -> Promise<ValidationResult<DecodedImage>>`. Der Analyse-Job bleibt synchron (Abschnitt 7).
  - TIFF-Subset: little/big endian, Strips unkomprimiert, 8/16/32-bit uint + 32-bit float, IFD-Kette/Seitenwahl; ImageDescription/OME-XML als Metadaten-String durchgereicht — **sanitisiert (NUL-/Steuerzeichen entfernt, Repo-Praezedenz UTF-16-ZMX/NUL-sanitize) und auf 4 KB gekappt (Anzeige UND Export)**. Geblockt: Kompression, Tiles, Planar, Palette.
  - PNG: Grau 8/16-bit exakt (Chunk-Parser + DecompressionStream + Unfilter); RGB(A) 8-bit mit Kanalwahl. Geblockt: Adam7, Palette, 16-bit-RGB, tRNS.
  - **DecompressionStream ist eine dokumentierte Ausnahme zu CONVENTIONS-Regel 3** (Web-Plattform-Global in der Decoder-Schicht; kein DOM/UI-State; in Node >= 18 ebenfalls global -> CLI-/Test-faehig). CONVENTIONS.md wird entsprechend ergaenzt (Abschnitt 8).
  - Gebuendeltes geotiff.js/utif2 nur als dokumentierte Rueckfalloption (Betreiber-Entscheid nach Lizenz-/Bundle-Messung).
- `src/diagnostics.ts`: O(N) Min/Max/Histogramm, Saettigung (dtype-abhaengige Grenze; Float nur mit Nutzerangabe), Null-/Negativ-/NaN-Werte, Hot-Pixel-Kandidaten (MAD), Randintensitaet, Multi-Maxima, Dynamikbereich, Rand-Beruehrung.
- **Ab S18a aktiv:** Normfreiheits-Gate in `scripts/check-scope.mjs` nach der Spezifikation in Abschnitt 8, **inklusive der dokumentierten Bestands-Allowlist** (die 8 bekannten Alt-Treffer bleiben bis S18f zugelassen; neue Treffer brechen sofort). Plus `packages/image` in der UI-Import-Blockliste (check-scope.mjs:21-22).

Gates: Format-Orakel je dtype/Endianness/Multipage/Block-Fall, Metadaten-Sanitisierungstest, No-Mutation-Test, Validierungs-Fehlerfaelle, typecheck, npm test.

## 4. S18b - Hintergrund + ROI + Stabilitaet

- `src/background.ts`:
  - none | Dunkelbild I_raw - I_dark (Dimensions- UND dtype-Gleichheit, sonst IMAGE_DARK_MISMATCH) | manueller Offset | Hintergrund-Rechtecke: Mittelwert/Median/Stdabw/MAD; B_hat = median; sigma_B_hat = max(1.4826*MAD, floor) mit floor = halber Quantisierungsschritt bei Integer-dtypes bzw. 1e-12*(max-min) bei Float; ist MAD trotzdem 0, Fallback Stdabw mit Hinweis.
  - Robuste geneigte Ebene, vollstaendig: zentrierte Koordinaten (x-x_mean, y-y_mean); Start = LS-Loesung; IRLS mit Huber-Gewichten, Knick delta = 1.345*sigma_hat mit **sigma_hat = max(1.4826*MAD(Residuen), floor wie oben)**, je Iteration nachgefuehrt; sind alle |Residuen| <= floor, gilt die Ebene als exakt -> sofort konvergiert; Abbruch sonst bei skalenbewusster Parameteraenderung |dp| <= 1e-10 * max(|p|, Parameterskala aus Datenspanne) oder 50 Iterationen.
  - **Skalenverhalten ehrlich:** Aequivarianz gilt (und wird als Orakel geprueft) fuer exakte Skalierung I -> a*I (Ebene skaliert mit a, 1e-12). Requantisierte Varianten derselben Szene (8- vs 16-bit-Rendering) sind NICHT exakt aequivariant; dafuer separater Konsistenz-Test mit dokumentierter, loser Toleranz.
  - Negative Werte nach Korrektur: nie geklippt; Anteil berichtet (IMAGE_NEGATIVE_AFTER_BACKGROUND).
- **Momentenregel (revidiert nach R2/P2-H1):** Schwerpunkt/Kovarianz rechnen mit den **vorzeichenbehafteten** korrigierten Intensitaeten (unbiased: Rauschen mittelt sich heraus; die v2-Regel w=max(I,0) erzeugte einen numerisch belegten, ROI-abhaengigen D4sigma-Bias und ist gestrichen). Guards: Sum(I_corr) <= 0, lambda_min < 0 oder lambda1+lambda2 <= 0 -> betroffene Groessen null + IMAGE_MOMENTS_UNDEFINED (deckt auch den Einzelpixel-Fall q=0/0). docs/theory/image_analysis.md dokumentiert die Rausch-Varianz der Second-Moments und ihre ROI-Flaechen-Abhaengigkeit — genau dafuer gibt es die Stabilitaetsanalyse.
- `src/roi.ts`: full-frame, manuelles Rechteck, Suggested-ROI (Maske I > B_hat + k*sigma_B_hat, groesste zusammenhaengende Peak-Region, Bounding Box + dokumentiertes Padding; nur Vorschlag, Flag userConfirmed, sonst IMAGE_ROI_UNCONFIRMED).
- ROI-Stabilitaetsanalyse (ohne 2D-Fit): Re-Auswertung von Hintergrund, Schwerpunkt, Momenten, FWHM bei Fenstergroessen 0.8/0.9/1.0/1.1/1.2x plus Zentrums-Shifts +-5% der Fensterbreite in x/y (9 Varianten; Shift-Prozente bei Kalibrierung in physischen Koordinaten). Fenster am Bildrand: Clamp+Shrink, geflaggt. **Voll-Frame-Sonderfall:** Vergroesserungs-Varianten entfallen; Sensitivitaet wird aus den verfuegbaren Varianten gerechnet und im Result als "partial sweep" gekennzeichnet (keine kuenstlich kleine Sensitivitaet ausweisen). IMAGE_ROI_SENSITIVE ueber Schwelle.

Orakel: geneigte Ebene rauschfrei < 1e-9 (zentriert); exakte Skalen-Aequivarianz 1e-12; Quantisierungs-Konsistenz (lose, dokumentiert); MAD-Robustheit gegen Hot Pixels; MAD=0-/Floor-Faelle; **verrauschte Gauss-Synthetik: vorzeichenbehaftete D4sigma-Rekonstruktion innerhalb dokumentierter statistischer Toleranz bei definiertem SNR und ROI (Regressionsfall gegen den v2-Bias)**; Suggested-ROI trifft Ground-Truth; Sensitivitaeten deterministisch.

## 5. S18c - Momente/Peaks/Profile

- `src/moments.ts`: intensitaetsgewichteter Schwerpunkt; Kovarianz -> lambda1/lambda2 + Hauptachsenwinkel (`thetaRad`, Kanonisierung sigma1 >= sigma2, theta in [0, pi)); q = (lambda_max - lambda_min)/(lambda_max + lambda_min) **nur bei lambda1+lambda2 > 0**, sonst undefiniert + Hinweis; IMAGE_ORIENTATION_UNSTABLE bei q < 0.05; sigma1/sigma2 und D4sigma-Durchmesser 4*sigma (Produktvokabular, Abschnitt 1); Peak raw/korrigiert.
- Subpixel-Peak: zwei separable 3-Punkt-Parabeln auf I um das diskrete Maximum; **Guards: nicht-konkaver Nenner (<= 0) oder |Verschiebung| > 0.5 px -> unterdrueckt mit Hinweis**; unterdrueckt bei Saettigung in der 3x3-Umgebung (IMAGE_SUBPIXEL_SUPPRESSED_SATURATION) und am Bildrand (an IMAGE_EDGE_TOUCH gekoppelt); dokumentierte Gueltigkeit ab w >= 3 px, systematischer Bias der I-Parabel dokumentiert (rauschfrei <= 0.022 px bei w=3 px).
- Abstand Peak-Schwerpunkt als Asymmetrie-Indikator.
- `src/profiles.ts`: Schnitte durch Peak und Schwerpunkt (x/y), integrierte Projektionen, Profile entlang Moment- und Fit-Achsen (bilineare Interpolation; bei Kalibrierung in physischen Koordinaten). FWHM-Basislinie: Halbmaximum UEBER HINTERGRUND (Schnitt bei B_hat + (I_peak - B_hat)/2), interpoliert; Mehrfach-Schnitte/Multi-Peak -> IMAGE_FWHM_AMBIGUOUS. Strikte Trennung FWHM(Daten)/FWHM(Fit)/1-ueber-e2-Breite/Second-Moment in Vertrag und UI.

Orakel: Schwerpunkt/Winkel/sigma gegen analytische Synthetik (rauschfrei < 1e-9; verrauscht mit festem Seed statistisch); Subpixel rauschfrei < 0.05 px bei w >= 3 px, verrauscht statistisch; Subpixel-Degenerationsfaelle (Plateau, Rand); FWHM = w*sqrt(2*ln2) der Einheits-Gauss + Basislinien-Fall mit konstantem Hintergrund.

## 6. S18d - Fits + Kenngroessen

- `src/fit.ts`: eigene Levenberg-Marquardt-Implementierung (analytische Jacobians, Marquardt-Daempfung, Parameter-Skalierung, Konvergenz ueber relative chi^2-/Parameter-Deltas skalenbewusst, Iterations-/Zeitbudget, Status konvergiert/nicht-konvergiert/am-Bound). **Fit-Gebiet: die ROI; ist die ROI groesser als 1024x1024, wird fuer den Fit deterministisch um 2^k dezimiert (dokumentiert, IMAGE_FIT_DECIMATED als Info) — Momente/Diagnostik bleiben full-res.**
- Modelle: 1D-Gauss I = B + A*exp(-2(x-x0)^2/w^2); rotierter elliptischer 2D-Gauss (x0, y0, A, w1, w2, theta; Hintergrund konstant oder geneigt mitgefittet); Super-Gauss zuschaltbar in der Repo-Konvention von `packages/beams/src/profiles.ts:51` (exp(-2*(r/edge)^(2*order)), order=1 = Gauss; Start 1, Bounds [0.5, 10]). Numerik-Hinweis: Exponentenargument clampen (bei order~10 unterlaufen exp und Jacobian jenseits ~1.5*w — Gradienten sauber auf 0). Startwerte aus Momenten; optionale Huber-Gewichtung. Kanonisierung wie Abschnitt 5.
- **Pixelkalibrierung (anisotropiefest, vollstaendig):** optional pixelPitchUmX/pixelPitchUmY. ALLE mm-Groessen entstehen in physischen Koordinaten: Momente/Kovarianz mit skalierten Koordinaten (C' = S C S^T); Fit-Quadratform exakt transformiert (A' = S^-T A S^-1; **Breiten aus den Kehrwerten der Eigenwerte**, Winkel aus den Eigenvektoren); FWHM entlang gedrehter Achsen, Profile, eingeschlossene Leistung (Kreis/Ellipse) und Sweep-Shifts ebenfalls in physischen Koordinaten. pitchX != pitchY -> IMAGE_ANISOTROPIC_PIXELS (info). Ohne Kalibrierung nur px-Felder + IMAGE_CALIBRATION_MISSING (info).
- Ausgaben: Parameter; Residuen-STATISTIK full-res (RMS-/Max-Residuum) + Residuen-ANZEIGE als downgesampeltes Grid <= 512x512 (number[], Abschnitt 7); Residuenprofile; Fit- vs. Momentenbreiten-Vergleich (Umrechnung je Modell dokumentiert; **Super-Gauss w<->sigma geschlossen ueber die Gamma-Formel** — im Review numerisch auf 1e-13 bestaetigt, Herleitung in docs/theory; Gamma test-only via Lanczos; bei order < 1 ist der Momentenvergleich tail-/ROI-limitiert — dokumentiert und im Result markiert); Modellvergleich Gauss vs. Super-Gauss als relative RMS-Residuenreduktion in % (kein Signifikanzanspruch); alle Streuangaben heissen "numerische Sensitivitaet". Peak-to-Background nur bei B_hat > 0, sonst undefiniert ausgewiesen.
- `src/metrics.ts`: Elliptizitaet (sigma2/sigma1 bzw. w2/w1, dokumentiert), Peak-to-Background (Guard), eingeschlossene Leistung, radiale Verteilung, Multi-Peak-Anzahl + Abstaende, Symmetriefehler, Modellvergleich, Clipping-Indikator, Hot-Pixel-Anteil.
- **Performance- und Speicherbudget (beziffert):** O(N)-Paesse + 9-Varianten-Sweep < 1 s bei 2048x2048 (Referenz: ~18 ms pro Momentenpass, R2-gemessen); 2D-LM auf ROI <= 1024^2 ("typische ROI" ist damit definiert) < 2 s; Gesamt < 5 s bei 2048^2. Working-Set-Ziel <= 300 MiB am 4096^2-Cap: Original (1x, worker-eigen) + transienter Float64-Arbeitspuffer + Anzeige-Grids <= 512^2; KEIN persistentes Full-res-Residuenbild (nur Statistik + Anzeige-Grid); Korrektur-Ansicht auf Abruf. Allokationsfehler -> IMAGE_SIZE_BLOCKED mit Meldung. Cap 4096x4096.

Orakel: LM rekonstruiert rauschfreie, deutlich elliptische Synthetik (w1/w2 >= 1.3, q ~ 0.26) < 1e-6 rel; nahezu runder Fall prueft nur rotationsinvariante Groessen; order-Rekonstruktion; Super-Gauss-sigma gegen die Gamma-Formel (exakt) UND gegen hochaufgeloeste Integration; **Cross-Check-Test in tests/unit: packages/image-Formel gegen packages/beams superGaussianRelativeIntensity auf einem Gitter (tests duerfen beide importieren — kein Formel-Drift)**; ehrlicher Nichtkonvergenz-Status; Residuen-RMS gegen eingespeistes Rauschniveau; Quadratform- vs. direkte mm-Momente im anisotropen Fall; Dezimierungsfall (Fit auf 2^k-Gitter vs. full-res-Fit innerhalb Toleranz).

## 7. S18e - API + Worker + UI

- `packages/api`:
  - Neues HeadlessJob-Kind `image-analysis`, synchron: Input = {pixels: Float64Array | Float32Array | number[] (zeilenmajor), width, height, dtype, calib?, config?}. Kein fileBase64-Input. CLI-/Test-Fixtures nutzen kleine number[]-Matrizen.
  - **Result ist reines JSON** (kompatibel mit runHeadlessJobJson, verify-headless, Export): Skalare + Profile + Anzeige-Grids <= 512x512 als number[] (FieldImageGrid-Muster, api:150-153); volle Aufloesung existiert nur worker-intern. Typed Arrays tauchen im Result NICHT auf (JSON.stringify wuerde sie als Dictionary serialisieren).
  - Decode als eigene async API-Funktion re-exportiert (`decodeImageFile`).
  - Result-Sektionen raw/background/roi/stability/peak/centroid/moments/profiles/fits/metrics/warnings; Suffixe ...Px, ...Mm, ...Um, ...Counts; Winkel `thetaRad` (UI zeigt Grad). Stability-Sektion traegt das partial-sweep-Flag. mm-Felder nur bei Kalibrierung.
- **Transfer/Copy-Matrix (explizit):** Dateibytes UI -> Worker als Transferable (UI braucht sie danach nicht); dekodierter Originalpuffer + Arbeitspuffer bleiben WORKER-EIGEN (Decode-Cache; nie transferiert); Ergebnisse gehen als JSON zurueck (kein Detach-Konflikt); Pixel-Inspektion (Hover-Wert) fragt den Worker asynchron ab (Token-Request/Response wie das field-worker-Muster). `field-worker.ts:16-19` postMessage-Typisierung wird um die Transfer-Liste erweitert.
- **Worker-Fallback definiert** (Muster main.ts:174-188 laeuft synchron auf dem Main-Thread): ohne Worker laeuft decodeImageFile async auf dem Main-Thread und die Analyse synchron mit Lade-Hinweis, ohne Progress; dokumentiert.
- Warncodes IMAGE_* in packages/core/src/warnings.ts (Union-Erweiterung = etabliertes Muster; Kontextwerte im message-String): SATURATION, EDGE_TOUCH, MULTI_PEAK, ORIENTATION_UNSTABLE, ROI_SENSITIVE, ROI_UNCONFIRMED, FIT_NOT_CONVERGED, RESIDUAL_HIGH, FALSE_COLOR_SOURCE, SUBPIXEL_SUPPRESSED_SATURATION, NEGATIVE_AFTER_BACKGROUND, HOT_PIXELS, FLOAT_SPECIALS, SIZE_BLOCKED, FWHM_AMBIGUOUS, DECODE_BLOCKED, MOMENTS_UNDEFINED, DARK_MISMATCH, CALIBRATION_MISSING, ANISOTROPIC_PIXELS, FIT_DECIMATED.
- `apps/web` (verbindliche Betreiber-Vorgabe: eigener Reiter, UI-Schicht exakt im bestehenden Workbench-Stil — workbench.css-Bausteine, Panel-/Chip-/Plot-/Format-Muster, keine neue Designsprache):
  - Sechster Tab (Vorschlag EN "Analyzer" / DE "Bildanalyse") als `views/image.ts` + `image-worker.ts` (Token/Progress/Fallback), Decode-Cache im Worker.
  - **Eigener binaerer Upload-Pfad** (arrayBuffer statt TextDecoder) mit eigenem Cap (Vorschlag 64 MB) und SICHTBARER Fehlermeldung. **Achtung Koexistenz:** der bestehende globale Drop-Handler (main.ts:1194-1207) erzwingt heute 5 MB fuer ALLE [data-drop]-Zonen und bricht still ab — er bekommt eine minimale per-Zonen-Cap-Regel (Analyzer-Zone: 64 MB, sichtbarer Fehler; Bestandszonen unveraendert 5 MB).
  - Upload-Flow mit Seiten-/Kanalwahl + Kalibrierung; Colormap-Rendering strikt getrennt vom Originalpuffer.
  - ROI-Interaktion als Canvas-Overlay-Fastpath nach onPlotMove-Praezedenz (kein Full-innerHTML-Rerender pro Mousemove; Commit bei Release); Suggested-ROI als gestrichelter Vorschlag mit Bestaetigen-Button.
  - Panels Diagnostik -> Hintergrund -> ROI/Stabilitaet -> Momente/Profile -> Fits/Residuen; Export JSON (Result inkl. sanitisierter, gekappter Metadaten)/CSV/PNG.
  - **Verdrahtung vollstaendig:** state.ts:16 Tab-Union; main.ts expliziter Render-Zweig (kein else-Fallthrough); chrome.ts Tab-Button + Mode-Pill-Mapping (Vorschlag "IMAGE · LOCAL") + Versions-Pill; **i18n.ts: Strings-Interface (i18n.ts:6-10) + BEIDE Literalbloecke EN/DE** — sonst bricht typecheck:web; .wb-tabs-Overflow/Umbruch fuer 6 Reiter inkl. Mobile (workbench.css:57-66).
  - **Breitenbasis:** Der Analyzer folgt bewusst NICHT der globalen S.widthBasis (die gilt fuer Beamline-Anzeigen); er zeigt jede Breite explizit beschriftet (D4sigma / FWHM / 1-ueber-e2 / Fit-w). Dokumentiert in Guide + theory-Doc.
  - UI-Label-Abgrenzung der zwei Momentenbegriffe: Field-Tab-Kacheln "MOMENT Rx/Ry" (views/field.ts:304-305, hartkodiert) erhalten den 2sigma-um-Gittermitte-Zusatz; Analyzer beschriftet D4sigma um den Schwerpunkt.
  - Metadaten-Anzeige ausschliesslich ueber esc() (format.ts) + 4-KB-Kappung; Sanitisierung passiert bereits im Decoder (Abschnitt 3).
  - Sprachdisziplin: "UI importiert keine Physikpakete (check:scope-Gate) und rechnet per Review-Disziplin nicht selbst".

## 8. S18f - Release-Haertung v1.1

- **Norm-Wording-Sweep der Bestandsoberflaechen (leert die Bestands-Allowlist):** README.md:16, packages/api/src/index.ts:128/184/263/372, tests/unit/field-modes.test.ts:81 (Kommentar) + :103 (Testname) -> normfreie Formulierung ("measured second-moment waist convention", finaler Wortlaut Betreiber). Danach enthaelt die Allowlist nur noch die Dauer-Ausnahme (Impressum-Schutzklausel).
- **Normfreiheits-Gate, kanonische Spezifikation:**
  - Roots: packages/, apps/, docs/, examples/, tests/, scripts/, README.md, LICENSE, package.json. Ausnahmen: Plan/, agents/ (historischer Trail; die neue cases-Datei dort wird selbst normfrei verfasst — Begruendung im Gate-Kommentar), node_modules/, dist/, .git/, .vite*/ — **Excludes greifen auf JEDER Verzeichnisebene** (walk() hat heute keinerlei Filter, check-scope.mjs:24-33; apps/web/node_modules existiert bereits).
  - **Selbst-Ausschluss:** scripts/check-scope.mjs nimmt sich selbst per Pfad aus (es enthaelt per Konstruktion alle verbotenen Pattern-Literale und die Allowlist).
  - Text-Extensions um .xml ergaenzt (sitemap.xml).
  - Token-Patterns: /\bISO\b/ (case-sensitiv), /ISO[- ]?11146/i, /\b11146\b/, /\bDIN[- ]EN\b/i, /norm-?(konform|gerecht)\w*/i (deckt "Norm-Konformitaet", "normgerechte"), /iso-?konform\w*/i, /(norm|standards?)-?compliant/i, /\bIEC[- ]?60825\b/i. Bare "norm"/"normal(ized)"/"Standardvertragsklauseln" matchen NICHT (verifiziert).
  - **Allowlist als (Datei, Pattern, erwartete Trefferzahl)-Tripel** — robust gegen Zeilenumbrueche (die Impressum-Klausel ist real ueber Zeile 43/44 umbrochen; ein Exact-String-Match wuerde nie treffen) und count-gepinnt, damit NEUE Treffer in derselben Datei weiterhin brechen. Bestands-Allowlist ab S18a: die 8 bekannten Alt-Treffer; ab S18f nur noch impressum.html (verneinende Schutzklausel, 1 Treffer).
  - Produkttexte vermeiden "ISO 8601"-Schreibweisen (Datumsformat als YYYY-MM-DD ausschreiben).
- `docs/theory/image_analysis.md`: jede Methode mit Formel, Parametern, Grenzen, Quellen (inkl. Subpixel-Bias, FWHM-Basislinie, vorzeichenbehaftete Momentenregel + Rausch-/ROI-Verhalten, Huber-Spezifikation, Super-Gauss-Konvention + Gamma-Beziehung, Anisotropie-Behandlung). Guide EN/DE inkl. "Grenzen ehrlich".
- Verifikation:
  - `examples/image-analysis.headless.json` (kleine Synthetik-Matrix) + neuer summarizeJob-Zweig in scripts/verify-headless.mjs mit **parametrisierter Rundung** (stableNumber(value, digits) — heute fest 12, verify-headless.mjs:12-14): Momente/Diagnostik 12 Stellen, Fit-Parameter 6. Expected-Datei wird REGENERIERT (alphabetische Einfuegung); Diff-Pruefung: Bestandseintraege byte-identisch.
  - Determinismus-Fussnote korrigiert: V8 bringt die eigene Math-Implementierung mit (Basis der bestehenden Field-Pins); der CI-Pin `node-version: 24` ist nur ein MAJOR-Pin (deploy-pages.yml:22-24) -> auf exakte Version umstellen (version-file/.nvmrc), sonst koennen V8-Minor-Wechsel die 12-Stellen-Pins theoretisch bewegen.
  - `agents/verification/image_analyzer_cases.json` + Handler in scripts/verify-reference-cases.mjs (~10-15 Faelle); **jeder Image-Fall setzt toleranceRel explizit** (Default 1e-9 passt nicht zu 6-Stellen-Fit-Groessen).
  - CI-Workflow: typecheck + typecheck:web ergaenzen (laufen dort heute nicht), Node exakt pinnen.
  - Playwright bleibt dev-seitiges Gate (wie S12-S17, nicht im CI): Smoke Upload -> ROI bestaetigen -> Fit -> Export, kleine Binaer-Fixtures (<= 10 KB) unter tests/fixtures/.
- **Release-Doku-Checkliste (vollstaendig):** chrome.ts:31 Versions-Pill; package.json + apps/web/package.json Versionen; README.md:27 UND :42 (Testzahl "81" -> real, "60 cases" -> neue Zahl, UND die pauschale "12-significant-digit"-Aussage an die differenzierte Pin-Praezision anpassen); Landing footTools + features EN/DE inkl. Analyzer-Karte; footDate; apps/web/index.html: JSON-LD-Beschreibung UND softwareVersion (heute "0.1" — schon jetzt inkonsistent zu v1.0) UND meta description/keywords/og:description; docs/architecture/CONVENTIONS.md (Statuszeile ist noch "S12" — aktualisieren; neuer Tab als Architektur-Regel; Suffixklassen ...Px/...Counts; thetaRad; DecompressionStream-Ausnahme zu Regel 3); docs/architecture/API v1.md (Job-Kind-Liste + Result-Union — dort fehlt schon heute field-beamline, mitziehen); examples/README.md; docs/validation/reference_cases.md; Guide-Links.
- Plan/INDEX.md-Trail; Public-Mirror-Neuaufbau + Deploy hinter DEPLOY_PAGES erst nach Betreiber-Freigabe.

## 9. Querschnitt Test-Infrastruktur

`packages/image/src/synthetic.ts` (test-only, ueber api exportiert): deterministische Ground-Truth-Bilder — Gauss / elliptisch-rotiert / Super-Gauss (Repo-Konvention), konstanter + geneigter Hintergrund, seeded Gauss-Rauschen (Box-Muller auf mulberry32) und Poisson-Rauschen: **Knuth-Inversion fuer lambda <= 50 (exakt), darueber seeded Normalapproximation (Box-Muller, auf ganze Zahl gerundet, Clamp >= 0). Begruendung ehrlich: O(lambda)-Kosten pro Pixel und Underflow-FEHLERGEBNISSE ab lambda ~ 746 (exp(-745) = 5e-324, exp(-746) = 0) — keine "Endlosschleife"; die Approximationsguete ist bei lambda > 50 fuer die Testtoleranzen irrelevant.** Hot Pixels, Saettigungs-Clipping, Randbeschnitt, Nebenreflex-Geist. Gamma-Funktion (fuer die Super-Gauss-sigma-Formel) test-only via Lanczos. Alle Orakel plattformdeterministisch (feste Seeds, Float64).

## 10. Risiken & offene Betreiber-Entscheidungen

1. **Decoder-Strategie:** Empfehlung Eigen-Subset mit ehrlichem Blocken (0 Dependencies); Alternative geotiff.js (breitere Wild-TIFF-Abdeckung, +Bundle, Lizenz) — Entscheid in S18a nach Messung. Risiko: komprimierte Kamera-TIFFs blocken in v1.1 ehrlich.
2. **Tab-Name** EN/DE (Vorschlag "Analyzer"/"Bildanalyse") **und Mode-Pill-Text** (Vorschlag "IMAGE · LOCAL").
3. **Suggested-ROI-Defaults** k und Padding.
4. **Bildgroessen-Cap** (Vorschlag 4096x4096) **und Upload-Cap** (Vorschlag 64 MB, sichtbare Fehlermeldung, per-Zonen-Regel im globalen Drop-Handler).
5. **Ersatz-Wortlaut fuer die Bestands-ISO-Formulierungen** (README, api-Kommentare, Testname — Betreiber entscheidet Wortlaut).
6. **Float-Saettigungsgrenze ohne Metadaten:** Default keine Saettigungserkennung bei Float ohne Nutzerangabe + Hinweis.
7. **Rolling-Ball** bleibt draussen bis eigener Auftrag.
8. **Terminologie bestaetigen:** Analyzer nutzt das bestehende "D4sigma"-Produktvokabular (Empfehlung, statt Eigennamen) und ignoriert bewusst die globale Breitenbasis.

Groesste technische Risiken: LM-Robustheit auf realen verrauschten Bildern (Gegenmittel: Momente-Start, Huber, Bounds, ROI-Fit + Dezimierregel, ehrlicher Status), Wild-TIFF-Vielfalt (ehrliches Blocken), Speicher-/Interaktionspfad der UI (Working-Set-Ziel, JSON-Grids <= 512^2, Canvas-Fastpath, sichtbare Caps).

## Revisionen

- **v3 (2026-08-15): Cross-Review R2 eingearbeitet** (Quelle: `Plan/S18_PLAN_REVIEW R2.md`; Legs: Gemini 3.7 Flash (High) 10 Findings + frisches Opus-5-Leg 34 Findings inkl. Fresh-Exploration; dedupliziert ~35; 0 Halluzinationen; 0 Ablehnungen). Wichtigste Aenderungen: **Momentenregel der v2 revertiert** (vorzeichenbehaftete Momente statt w=max(I,0) — der Clip erzeugte einen numerisch belegten, ROI-abhaengigen D4sigma-Bias; Guards decken jetzt auch q=0/0), Gate ab S18a mit count-gepinnter Bestands-Allowlist statt Phasenbruch, Gate-Selbstausschluss + Excludes auf jeder Ebene + erweiterte Token (Norm-Konformitaet, Iso-konform, IEC 60825), Allowlist als (Datei, Pattern, Count)-Tripel (Impressum-Klausel ist real zeilenumbrochen), IRLS-Skalen-Floor + skalenbewusstes Abbruchkriterium + Konvergenz-Kurzschluss, Skalenaequivarianz-Orakel gesplittet (exakt vs. Quantisierung), Result rein JSON (Anzeige-Grids <= 512^2, keine Typed Arrays im Result), Transfer/Copy-Matrix + Worker-Fallback + per-Zonen-Cap im globalen Drop-Handler, Fit-ROI <= 1024^2 mit Dezimierregel, Speicher-Working-Set beziffert, Terminologie auf bestehendes D4sigma-Vokabular vereinheitlicht + widthBasis-Abgrenzung, Anisotropie fuer ALLE mm-Groessen, Poisson-Begruendung korrigiert + Sampler spezifiziert, Subpixel-Degenerations-Guards, Super-Gauss-Gamma-Formel als exaktes Orakel + Cross-Check-Test gegen packages/beams, Metadaten-Sanitisierung (NUL/Steuerzeichen) + Export-Kappung, CONVENTIONS-Regel-3-Ausnahme dokumentiert, Node-EXAKT-Pin, Release-Checkliste erweitert (README:27+42, JSON-LD softwareVersion, meta/og, CONVENTIONS-Statuszeile, API-Doku inkl. fehlendem field-beamline).
- **v2 (2026-08-15):** Cross-Review R1 (Opus-Leg, 39 Findings; 37 uebernommen, 2 teilweise). Details in `Plan/S18_IMAGE_ANALYZER_PLAN v2.md`.
- **v1 (2026-08-15):** Erstfassung aus 2-Draft-Panel + Manager-Synthese; Nachtrag: Betreiber-Vorgabe eigener Reiter + UI im Workbench-Stil. Details in `Plan/S18_IMAGE_ANALYZER_PLAN v1.md`.

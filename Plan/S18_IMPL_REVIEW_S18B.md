# S18b Implementierungs-Gegenlese (Opus-5-Leg) — offener Fix-Backlog

**Datum:** 2026-08-16 (spaet). **Artefakte:** packages/image/src/background.ts, roi.ts, stability.ts + zugehoerige Tests (Stand: angewendet, 181/181 Tests gruen, typecheck+Wortlaut-Gate gruen).
**Leg:** Opus 5 (frische Session, read-only, mit eigenen Mess-/Rechenskripten im Scratchpad; Routing-Selbstauskunft claude-opus-5[1m]). Gemini 3.7 Flash war zuvor 1x am Werkzeug-Timeout gescheitert -> Betreiber-autorisierter Fallback.
**Status (aktualisiert 2026-08-17):** Fix-Runde GELANDET — B1-B5, M3-M11 (ohne M1/M2-Cap-Pfad), M7/M8/M10 und die LOW-Punkte sind behoben (2 parallele agentische DeepSeek-Fix-Tasks + Manager-Nachbesserungen); Orakel 1-9 ergaenzt; Suite 215/215. Details und Restpunkte im Abschlussabschnitt unten. Alle Zahlen in den Tabellen sind vom Reviewer GEMESSEN (nicht behauptet).

## HIGH (Fix-Pflicht vor S18d-Verdrahtung)

| # | Befund | Messbeleg | Fix-Richtung |
|---|---|---|---|
| B1 | IRLS-Huber-delta kollabiert bei float32: Residuen-Floor = 1e-12*Residuen-Spanne ist praktisch 0; delta wird beliebig klein -> Hard-Rejector statt Huber; Gewichte ~0 | delta=1.63e-8 counts bei 20% +300-Ausreissern; Repo-Spike-Test laeuft real mit delta=2.2e-9 | Residuen-Skala braucht einen ABSOLUTEN Anker (z. B. max(1.4826*MAD, medianbasierte Perzentil-Skala, epsilon*Datenspanne der WERTE statt Residuen) — Design morgen festlegen |
| B2 | Folge von B1: gewichtete Normalgleichung wird singulaer -> RangeError "degenerate background geometry" bei GESUNDER Geometrie mitten in der IRLS | 5x 1x1-Rects, OLS det ok, IRLS-Iter 1: delta=4.8e-27 -> Throw | Mit B1 beheben + Guard-Meldung differenzieren (Gewichtskollaps != Geometrie) |
| B3 | Leverage-Bruch: Ausreisser auf schwach gestuetzter Koordinate reisst Steigung; Rang-/det-Guard greift nicht (Plan fordert Konditions-Guard) | Spalte + 1 Einzelpixel: Spike +1000 -> bx=1000.1, converged=true | Leverage-/Konditionspruefung (z. B. Hebelwerte h_ii oder Mindest-Stuetzung je Koordinate) |
| B4 | std-Fallback (float32, MAD=0, std>0) macht sigma nicht-robust; dtype-Label springt Faktor 4801 | Flach+3 Hotpixel: sigma=54.05 statt ~0 -> suggestRoi verschluckt echten 100-count-Strahl (null); uint16 identischer Daten: 0.5 | Fallback ersetzen (z. B. Perzentil-Schaetzer/getrimmte Std) + Vertrag Z.38 in Plan v5 anpassen |
| B5 | Float-Floor 1e-12*(max-min) der SAMPLES wird von EINEM Ausreisser dominiert (1.67e14x) und ueberschreibt die echte MAD-Skala | 1 Pixel auf 1e6 -> floor 1e-6, sigma 337x ueber MAD | Floor aus robuster Spanne (z. B. Interquartil) oder dtype-nahem Epsilon ableiten |

## MEDIUM (mit B-Fixes bzw. in S18c/d-Naehe einplanen)

M1 Stiller Kipp-Fit: kontaminierter Streifen -> by=63.8 statt 0.3 bei converged=true und gesundem sigma (Diagnose aus Endresiduen des verkippten Fits) — Erkennungsfeld/Guard noetig. M2 50er-Cap real erreichbar (12/65 Konfigurationen), converged=false ungetestet. M3 stability: size-Varianten driften systematisch +0.5 px (Math.round-Paritaet) — Zentrumstreue-Rundung. M4 Shifts degenerieren fuer Basis < 10 px zu 4 Baseline-Duplikaten (round(5%*w)=0), zaehlen aber als gueltige Varianten. M5 geclampte Varianten verfaelschen halfSpread ungeflaggt (28.89 statt 36.67 im Messfall; zwei Varianten kollabieren auf dasselbe Rect). M6 ungueltige Baseline -> sensitivities=[] statt vertraglicher Kennzeichnung. M7 ueberlappende Rects doppelt gezaehlt (Median kippt messbar) — dedup oder verbieten. M8 xMean/yMean fehlen im BackgroundResult (Ebene nicht rekonstruierbar; NaN-abhaengiger Bezugspunkt, 0.0254-counts-Beleg). M9 suggestRoi @4096^2: 754 ms / +307 MB Heap (Budget-Grenzfall; Uint32Array-Queue statt number[]). M10 estimateBackgroundNoise ohne Subsample-Cap: 2048^2-Rect -> 340 MB (diagnostics.ts hat den Stride-Cap bereits — angleichen). M11 sigma=0 liefert grosse Rausch-ROI statt null/Flag (44% des Frames im Messfall). M12 noUncheckedIndexedAccess-Hinweis (INFO-nah).

## LOW (Sammelpass)

Toter Tie-Break-Zweig (roi.ts:140-142); floorApplied=true ohne wirkenden Floor (0<=0); -Infinity zaehlt nicht als negativ; Inf-Inf -> +Inf statt NaN im dark-frame; huberDeltaCounts gemeldet ohne gelaufene Iteration; redundante Filterbedingung; Testtitel-Prefix "S18a" in S18b-Dateien (auch S18c-A-Spez nutzt S18a-Prefix — vereinheitlichen oder als Serien-Prefix dokumentieren); thresholds-Konstanten der neuen Module fehlten im Barrel (HEUTE bereits gefixt).

## Fehlende Orakel (Reviewer-priorisiert, Top-Auswahl fuer die Fix-Runde)

1. IRLS-Weight-Collapse/Singular-Throw-Regression (4 kollineare + 1 abseitiges 1x1). 2. Leverage-Fixture (Spalte+Einzelpixel, Spike -> Steigung stabil). 3. converged=false am Cap. 4. sigma-Kette std-Fallback -> suggestRoi (verschluckter Strahl). 5. Floor-Dominanz + Integer-MAD=0-bei-grosser-Streuung. 6. Ueberlappende Rects. 7. Zentrumstreue der size-Varianten. 8. Nullshift w<=9. 9. halfSpread mit geclampten Varianten (Zahl, nicht nur Flag). 10. Nicht-Zweierpotenz-Skalenfaktor im Aequivarianz-Orakel (8=2^3 ist in FP exakt und beweist nichts); Requantisierungs-Toleranz 2e-2 -> ~1e-3; Spike-Orakel mit ECHTEM Rauschen (aktuell 3.5e9x zu locker). 11. ROI mit Gauss-/Diagonal-Formen + erreichbarer Tie-Break. 12. Speicher-/Zeitbudget @4096^2.

## Positiv verifiziert

b0-Semantik konsistent (8.9e-16); Skalen-Aequivarianz auch ueber dataSpan-Grenzen sauber; exakt kollineare Geometrien werfen korrekt (8 Faelle); Wortlaut-Gate 0 Treffer auf allen neuen Dateien; Determinismus/Nicht-Mutation/frische Float64Array bestaetigt; noch keine Konsumenten ausserhalb der Tests (Fixes brechen also nichts).

**Naechste Session, Schritt 1:** B1-B5 als EIN agentischer Fix-Task (background.ts + Tests, inkl. Orakel 1-6), danach M3-M6 als stability/roi-Fix-Task (inkl. Orakel 7-9), dann Orakel-Haertung 10-12; erst danach S18c-B und S18d.

## Abschluss der Fix-Runde (2026-08-17)

**Geliefert:** Zwei parallele agentische DeepSeek-Fix-Tasks (dateidisjunkt) + Manager-Nachbesserungen; Suite 103->215 seit S18-Start, jetzt 215/215, typecheck + Wortlaut-Gate gruen.

- **B1/B2:** IRLS-delta wertskalen-verankert (anchorFloor = 1e-6 * Dezilspanne der Fit-WERTE fuer float32; Integer bleibt 0.5). Orakel: 4-kollinear+1-abseits-Fixture wirft nicht mehr und trifft die Ebene < 1e-9. Mid-IRLS-Singular-Meldung differenziert.
- **B3:** Leverage-Guard (P90-P10 der Koordinaten je > 0) VOR dem Fit; Spalte+Spike-Fixture wirft jetzt in beiden Varianten (statt bx=1000.1 converged).
- **B4:** Stdabw-Fallback ERSATZLOS entfernt; Kaskade MAD -> IQR/1.349 -> 0; neue Felder iqrCounts/scaleSource, stdFallbackUsed weg. Plan v5 Z.38 revidiert (v5.1-Vermerk im Plan).
- **B5:** Float-Floor = 1e-12 * nearest-rank-Dezilspanne (P90-P10) der Samples; 1e6-Ausreisser-Orakel: floor < 1e-9, sigma bleibt MAD-skaliert.
- **M3-M6:** half-to-even-Geometrie (Zentrumstreue <= 0.5 px, Bias-Summe 0), Shift-Floor 1 px, Duplikat-Dedup (duplicateOfLabel, aus Aggregation und validVariantCount raus) + clampedContributing je Sensitivitaet, ungueltige Baseline -> sensitivities=null + undeterminable.
- **M7:** Rect-Ueberlappung pixel-dedupliziert (Randstreifen-Ecken zaehlten doppelt — auch in der eigenen Test-Fixture).
- **M8:** plane.xMeanPx/yMeanPx; Orakel rekonstruiert die Ebene pixelgenau.
- **M9:** eine wiederverwendete Uint32Array-BFS-Queue; GEMESSEN 4096^2: 70.7 ms / +0.09 MB Heap (vorher 754 ms / +307 MB).
- **M10:** Stride-Subsample ueber ROBUST_STATS_MAX_EXACT + Werte-only-Sammlung mit Single-Rect-Fast-Path (Manager-Nachbesserung); GEMESSEN 2048^2-Rect: 972 ms, retained Heap ~0 (vorher 340 MB).
- **M11:** maskFraction + suspectNoiseDominated (sigma==0 && Anteil > SUGGESTED_ROI_NOISE_SUSPECT_FRACTION=0.25) als UI-Warn-Hook, kein Verhaltensbruch.
- **LOWs:** floorApplied-Semantik, Inf-Inf->NaN im Dark-Frame (+Orakel), huberDelta-Reporting, toter Tie-Break-Zweig, redundanter Filter.

**Offen bleibt:** M1 (stiller Kipp-Fit — Erkennungsfeld, in S18d-Naehe einplanen); M12 (noUncheckedIndexedAccess, INFO); Testtitel-Prefix "S18a" bleibt als dokumentierter SERIEN-Prefix (Entscheid 2026-08-17, kein Rename). Anmerkungen: B4-Ketten-Orakel laeuft auf uint16 (der B4-Kern ist ueber das Kaskaden-Rewrite-Orakel direkt abgedeckt); M3-Orakel-Fixture selbst tie-frei (Diskriminierung liegt im revidierten Edge-Clamp-Test).

## Nach-Fix-Verifikation + zweite Fix-Runde (2026-08-17 nachmittags)

Ein Opus-Verifikations-Review (read-only, eigene Messskripte) bestaetigte B1/B2/B4/B5 und M3-M9 mit Zahlen (u. a. delta-Anker 4.12e-4 statt 1.63e-8; Floor-Ratio 1.00 statt 975x; Zentrierungs-Bias exakt 0; Aequivarianz auch x3.7 bei 1.7e-7) — fand aber 2 neue HIGHs + 5 MEDIUMs. Sofort-Fixes (Manager): M11-Flag-Bedingung von sigma==0 auf threshold < 1e-9*peak umgestellt (float32-Floors abgedeckt), partialSweep bei Duplikat-Kollaps, praezisierte Kommentare, Weight-Collapse-Message. Kernfixes (Opus-Fix-Agent auf Betreiber-Anweisung, background.ts + Tests, 19->26 Orakel):

- **HIGH-1 (Anker=0 auf flachen float32-Feldern -> spurious Throw bei punktsymmetrischer Kontamination, z. B. jedem exakt zentrierten Top-Hat):** anchorFloor jetzt FLOAT_ANCHOR_FACTOR*(IQR(Werte)+|median(Werte)|), Fallback dataSpan, 0 nur bei echt konstantem Feld. Messfall 9x9-flat+Zentrum-5000: vorher Throw, nachher konvergiert, bx=by exakt 0, b0-Fehler 1.7e-6. Loest MEDIUM-4 gleich mit (Anker importiert nicht mehr die Skala heller Kontamination >10%: delta 1.367e-4 statt 1.3449, Steigungsfehler ~1700x besser).
- **HIGH-2 (Dezil-Guard bei n<=10 durchlaessig, Spike-bx=1000 reproduzierbar):** echter Leverage-Guard max h_ii > 0.99 -> Ablehnung (h_ii = 1/n + zentrierte Form ueber die 2x2-Inverse). Das alte 4+1-Orakel-Fixture hat h=1.00 und wird jetzt KORREKT abgelehnt — Orakel auf leverage-gesunde 3+2-Geometrie umgebaut (max h 0.733, Fit exakt 3.6e-16). Bewusste Verhaltensaenderung: 3-Sample-Fits sind jetzt immer abgelehnt (jedes h exakt 1); realistische Layouts weit darunter (Randring 0.032, Eckboxen 0.050, L-Form 0.272).
- **MEDIUM-1 (Cap "unerreichbar" widerlegt):** 15% eines strukturierten Sweeps erreichen it=50; echtes converged=false-Orakel ergaenzt, tautologisches Assert ersetzt, Kommentare korrigiert.
- **MEDIUM-2 (Stride-Aliasing):** Stride waechst bis gcd(stride, width)=1; Messfall 2048^2 mit Spaltenperiode 4: sigma 2.9652 (=1.4826*MAD) statt 0.
- **MEDIUM-5 (Multi-Rect-Union unbounded):** Uint8Array-Belegungs-Bitmap ueber die Bounding-Box statt Set; 2 Rects, die 4096^2 kacheln: 0.8-1.0 s / +253 MB statt 14.6-16.2 s / +1034 MB, bitidentische Ergebnisse.

Verbleibende LOW-Reste aus der Verifikation: LOW-6 (rect-median-Offset erbt das Subsample — durch gcd-Fix entschaerft, dokumentiert), zwei koexistierende Quantil-Definitionen (nearest-rank im Floor, Typ-7 im Guard/Anker — dokumentiert beabsichtigt). Gates nach allem: **233/233, typecheck, Wortlaut-Gate gruen.**

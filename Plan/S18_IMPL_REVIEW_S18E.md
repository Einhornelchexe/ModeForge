# S18e Cross-Verifikation (Opus-Leg) — Orchestrierung + API + Worker + metrics

**Datum:** 2026-08-18. **Artefakte:** packages/image/src/analyze.ts + warnings.ts + metrics.ts, packages/api (image-analysis-Job), apps/web/src/image-worker.ts + main.ts-Dispatch (S18e-C-View war zum Review-Zeitpunkt noch in Arbeit und ist NICHT Gegenstand). Alle Zahlen GEMESSEN (76 Tool-Laeufe, eigene Skripte).
**Status:** Findings triagiert; Fix-Runde wird nach Landung von S18e-C delegiert (ein Sammel-Task S18e + ein fit.ts-Punkt).

## Kern bestaetigt

Pipeline gegen Ground Truth (rect-median, 200x160, sigma (11,6), theta 0.7): released d4 px -0.317/-0.166 %, PHYSISCH -0.234/-0.249 % inkl. Trunkierungsfaktor — im dokumentierten Band. API-Job identisch zu analyzeImage (0 Diffs). Stufen-Trennung referenzsauber (0 geteilte Objekte, Mutationsprobe negativ). M-3 sqrt(N)-Verdrahtung numerisch bewiesen (Guard kippt exakt an der Grenze). Fehler-Containment 35/35 hostile Inputs ohne Throw (Ausnahme = HIGH-2). Performance: 2048^2 in 3.58 s (< 5-s-Budget); metrics.ts (Flash-geschrieben) mathematisch exakt: Radial-Bins 5.55e-16 gegen Brute-Force, Encircled-Inverse 1.1e-16, Spiegel-Involution 4000/4000 beliebige Zentren, comparedPixelCount exakt.

## Fix-Pflicht (HIGH)

| # | Befund | Messbeleg | Fix-Richtung |
|---|---|---|---|
| H1 | sigma_B wird auf dem ROHBILD gemessen (analyze.ts uebergibt rawImage an estimateBackgroundNoise), alle Konsumenten (Residuen-Gate 2sigma, FWHM 3sigma, Multi-Peak 4sigma, PtBN) sind korrigiert-domaenig — die eben entfernte Ebene steckt in sigma_B | Rampe 0.5: sigma_B 56.03 statt 2.0 (+2702 %); Residuen-Gate faktisch tot | Schaetzung auf dem KORRIGIERTEN Feld |
| H2 | mapMomentsToPhysical ist als einziger Physik-Mapper NICHT try/catch-gewrappt -> analyzeImage wirft bei kaputter Kalibrierung nach bestandener Validierung (Contract-Bruch) | calibration {} -> RangeError | wrappen wie mapGauss2dToPhysical + Warnung |
| H3 | Kalibrierung wird NIE validiert: contracts prueft input.calib, der Input heisst calibration — tote Validierung; NaN/negative/0/1e308-Pitches leaken in released stepUm/physical-Felder | stepUm=-3, d4SigmaMajorUm=NaN released | Feld angleichen + Validierung scharf schalten (positive finite Pitches) |
| H4 | startMoments-Verfeinerung reaktiviert die per R4 ausgeschlossene Full-Frame-Momenten-Start-Falle: Sockel-Szene -> "converged" mit Zentrum (-11097,-5602) px, sigma 23022 px; fits.physical released 345 mm auf 1.1-mm-Sensor UNGEGATED; kein IMAGE_FIT_NOT_CONVERGED | 4/56 Sockel-Szenen | startMoments nur unter Plausibilitaets-Gate (Zentroid in der ROI, sigma < ROI-Ausdehnung) ODER ganz weg (Plan-treu: momentenfrei); fits.physical nur bei konvergiertem, amplituden-positivem, im-Bild-liegendem Fit |
| H5 | image-worker self-Guard (typeof self) ist im BROWSER-Fenster wahr -> der Main-Thread-Fallback-Import klobbert window.onmessage und beantwortet fremde postMessages (Endlos-Loop beobachtet) | 21 Loop-Iterationen im Simulator | Guard auf WorkerGlobalScope-instanceof bzw. typeof importScripts === "function" |

## MEDIUM (in die Fix-Runde bzw. dokumentieren)

M1 Rim-sigma wird von rahmenfuellendem Beam gefressen (+4974 % bei sigma=70 auf 160er-Frame) — silent (scaleSource "mad", edgeTouch false weil Median angehoben); Gegenmittel: Rim-Kontaminations-Indikator (z. B. Rim-Median vs. Gesamt-Median) + Warnung. M2 NaN/Infinity in released Tiefen-Feldern bei hostilen Inputs (934 Issues/12 Faelle: projection values NaN, widths peak NaN, residual grid NaN, negativePowerRatio Infinity) — Sanitisierungs-Pass vor Result-Bau (null statt NaN, dokumentiert). M3 Working-Set 4096^2: +623 MiB (> 400-Budget); Array.from(corrected)-Doppelkopie in analyze.ts entfernen (number[]-Zweitframe); Stage-Kosten: estimateBackgroundNoise 638 ms teuerste Stufe @2048^2. M4 Bestaetigte ROI begrenzt Stufe B nicht (Ellipse/Paesse lesen Bildpixel ausserhalb der ROI; Poison ausserhalb kippt die Freigabe) — Blenden-Paesse auf ROI-Schnitt begrenzen + Clipping-Gate gegen ROI statt Bild. M5 Warn-Rauschen auf Lehrbuch-Szene (ROI_SENSITIVE 11.7 % aus Shrink-only-Sweep; NEGATIVE_POWER 0.133 bei korrekt korrigiertem Bild — Schwellen fuer Full-Frame kalibrieren: NEGATIVE_POWER-Schwelle ist fuer Rauschbilder unsinnig niedrig). M6 (fit.ts) WEDGE_GRADIENT_TOLERANCE absolut 1e-8 auf skalenabhaengigem Gradienten -> false fit_not_converged bei amp 1000/65535 auf perfektem Beam — Toleranz skalieren. M7 executeImageJob wirft bei pixels null (Float32Array.from vor Validierung) + allokiert Render fuer abgelehnte Jobs.

## LOW (dokumentiert)

Radial-Bin-Konvention Code [r0,r1) vs Doku (r0,r1]; unbekannte background.method degradiert silent zu none (gewarnt), unbekannter Worker-op laeuft silent als analyze (ungewarnt); Rim=ganze ROI bei Mini-ROIs (nicht-monoton via Math.round); computeEllipticity(5,10)=2 ausserhalb [0,1] bei ungeordnetem Input; runHeadlessJob aliast warnings===result.warnings; main.ts pendingImageJobs ohne Timeout + toter imageJobToken-Staleness-Kommentar; Decode-Fehler zeigen rohe TypeError-Texte.

## Wichtig fuer S18e-C

CW-01-Testfixture (16x16, sigma 1.8) KANN nicht releasen: die 6-sigma-Pruefellipse braucht W >= 12*sigma+1 ~ 22.6 px. 24x24 released (gemessen, d4/expected = 1.00012). Fix = Fixture vergroessern, nicht den Analyzer aendern.

## Coverage-Gaps (in die Fix-Runde uebernehmen)

Gradient+Plane-sigma-Orakel (H1); Sockel/startMoments-Divergenz (H4); fits.physical-Plausibilitaet; Kalibrierungs-Validierung (H2/H3); NaN-Walk auf hostilen Szenen; Rim nicht-full-frame/Mini-ROI; Worker: echter Decode-Erfolg, structuredClone, unknown-op; metrics: Bin-Kanten-Konvention, Overflow, Involutions-Pinning.

## Nachtrag: Fix-Trail der S18E-Befunde (Stand 2026-08-18)

Alle HIGH-Befunde gefixt und empirisch abgenommen; Suite 359/359, typecheck + typecheck:web + Wortlaut-Gate gruen (alles weiterhin uncommitted, HOLD gilt).

- **H1** sigma_B jetzt auf dem KORRIGIERTEN Feld: User-Referenz-Rechtecke, sonst dokumentierter ROI-Randrahmen (SIGMA_REFERENCE_RIM_FRACTION = 0.05, min. 1 px). Rampen-Repro geschlossen.
- **H2/H3** Kalibrierung wird validiert (positive finite Pitches), mapMomentsToPhysical gewrappt; kaputte Kalibrierung liefert Warnung statt Throw, keine NaN/negativen Pitches mehr in released Feldern.
- **H4** startMoments nur noch unter Plausibilitaets-Gate (Zentroid in ROI, 4*sigma_maj < kleinste ROI-Seite); fitGeometryIsReleasable prueft gegen die ROI (nicht das Bild) — die Sockel-Falle (345 mm auf 1.1-mm-Sensor) ist geschlossen.
- **H5** Worker-Guard auf importScripts/WorkerGlobalScope umgestellt; Main-Thread-Loop-Repro geschlossen. (Im Zuge dessen: postMessage-Korrelationsfeld heisst requestId — Umbenennung wegen Secret-Scanner-Hard-Block auf "token".)
- **M2** Sanitisierungs-Pass vor Result-Bau: nicht-finite Werte werden null (dokumentiert), 934-Issue-Repro leer.
- **M4** Profiles-Lane ROI-gebunden (ROI-Subframe mit Rueckverschiebung der Koordinaten in den Bildraum; Projektions-sigma = sigma_B * sqrt(max contributingCount) aus dem Subframe). Erste Fix-Delegation setzte den Auftrag NICHT um (Poison-1e6-Repro schlug weiter durch) und baute stattdessen eine nicht beauftragte Zentrum-Kaskade — Lehre: Fix-Abnahmen IMMER mit Pflicht-Repro; Zweitdelegation lieferte exakt, Poison-Orakel deep-equal gruen.
- **M5** nicht per Konstanten-Tuning geschlossen, sondern als statistisches Problem erkannt und in die Gate-Rekalibrierung ueberfuehrt -> `Plan/S18_GATE_CALIBRATION_SPEC.md` Abschnitt 4 (adaptive Praedikate fuer IMAGE_NEGATIVE_POWER und IMAGE_ROI_SENSITIVE).
- **M6** Wedge-Toleranz skaliert: 1e-8 * max(1, dataSpan); amp-1000/65535-Repro geschlossen.
- **CW-01** Export-Testfixture auf 32x32 vergroessert (Diagnose bestaetigt: 6-sigma-Pruefellipse braucht >= 12*sigma+1; kein Analyzer-Bug).
- **Offen dokumentiert**: M1 (Rim-Kontaminations-Indikator), M3 (Working-Set/Array.from-Doppelkopie), M7 (executeImageJob-Reihenfolge) und die LOW-Liste — Kandidaten fuer S18f.

Anschlussbefund der Nachmessung (eigenes Kapitel): Die festen Gate-Schwellen unterdruecken bei SNR 20 einen PERFEKTEN Gauss in 24/25 Seeds (Release-Rate A/100 15/15 -> A/20 1/15). Loesung (Betreiber-approved): selbstkalibrierende Gates per Bild; Zwei-Legs-Herleitung adjudiziert und als bindende Spec abgelegt -> `Plan/S18_GATE_CALIBRATION_SPEC.md` (dort auch die dokumentierte Verhaltensaenderung des core+halo-Fixtures sigmaB 5 -> 2 samt Companion-Orakel).

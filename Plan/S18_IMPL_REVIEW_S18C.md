# S18c Review-Meilenstein (Opus-Leg) — Momente + Profile

**Datum:** 2026-08-17 (nachmittags). **Artefakte:** packages/image/src/moments.ts, profiles.ts + Tests (Stand: 233/233 gruen vor dem Review).
**Leg:** Opus (frische Session, read-only, eigene Mess-/Referenzskripte im Scratchpad). Alle Zahlen GEMESSEN.
**Status:** GEFIXT. Der beauftragte Opus-Fix-Agent starb dreimal am API-Fehler 529 (Anthropic-Ueberlast); die Fixes wurden daraufhin als dokumentierter Fallback MANAGER-seitig umgesetzt (identisches Design wie im Fix-Auftrag) und mit 13 neuen Orakeln abgesichert. Beim Orakel-Schreiben fiel ein ZUSAETZLICHER Grenzfall: ein winziger negativer covXy-Rundungsrest macht theta_raw = -eps, die +pi-Korrektur rundet auf EXAKT pi — ausserhalb der dokumentierten Domaene [0, pi); gefixt durch Rueckfaltung pi -> 0. Suite nach allem: **246/246**, typecheck + Wortlaut-Gate gruen. M-3/M-4/M-5 sind VERDRAHTUNGSPUNKTE fuer S18d/S18e (unten).

## Positiv verifiziert (Kern belastbar)

D4sigma gegen geschlossene Form inkl. Trunkierung: schlechtester rel. Fehler 0.004 % bei alpha=4; alpha-Sweep matcht sqrt([1-(1+S)e^-S]/(1-e^-S)), alpha=4 -> 0.998656797 (der dokumentierte 0.9986568). Theta-Kanonisierung ueber alle Quadranten in [0, pi), Abweichung <= 6.2e-10, pi/2 bitexakt. Praedikat-Kurzschlussreihenfolge mit Doppeltrigger-Fixtures bestaetigt; 0.01-Grenze exakt inklusiv. Subpixel-Guard-Reihenfolge korrekt (erster Guard gewinnt), |shift|=0.5 akzeptiert. Ellipsen-Domaene brute-force-identisch (81/81, 47/47), Randpixel inklusive. 3-Pass-Akkumulation 1.2e-15 vs. Kahan (Shift-Theorem waere 2.1e-10). FWHM/1e2 auf schiefem Lobe exakt gegen stueckweise-lineare Referenz; Plateaus, exakter Threshold-Treffer, Peak am Rand, +-Inf-Projektionen, anisotroper stepUm (4.4e-16), Bounds-Sicherheit nahe letzter Zeile — alles sauber. Performance 4096^2: projection-x 304 ms, axis 3.1 ms, cut 0.7 ms.

## Gefixt in der S18c-Fix-Runde (Opus-Fix-Agent, gleiche Session)

| # | Befund | Messbeleg | Fix |
|---|---|---|---|
| HIGH-1 | Exakt kollineare Pixelmengen mit schraeger Steigung -> lambdaMin = -2.2e-16 statt 0 (katastrophale Ausloeschung, keine Toleranz) -> faelschlich indefinite_covariance; Plan verlangt Linie=gueltig (q=1) | 16/80 Steigungen im 256^2-Sweep abgelehnt; positions-/frameabhaengig | Clamp: lambdaMin in [-1e-9*lambdaMax, 0) -> 0 (EIG_NEGATIVE_TOLERANCE, echte Indefinitheit aus signierten Gewichten bleibt abgelehnt) |
| HIGH-2 | Achsparallele Winkel nie exakt (cos(pi/2)=6.1e-17): axisOffsetBounds verliert bis 64/65 Samples; bilinear verlangt Finitheit von ~1e-16-Gewicht-Nachbarn -> 95.7 % NaN-Kontamination aus Nachbarspalte | angle=pi, Zentrum (0,0): 1 von 65 Samples; extractCut identische Linie: 0 NaN | Richtungs-Snapping (|cos|<1e-12 -> exakt achsparallel) + Gewichts-Epsilon im Bilinear (Terme < 1e-12 samt Finitheitsanforderung uebersprungen) |
| M-1/M-2 | Ambiguity-Scan inkonsistent zum Kreuzungs-Walk: tangentiale Beruehrung (Lobe erreicht exakt threshold) und NaN-umzaeunte Lobes unsichtbar | [.,30,50,30,.] thr=50 -> false; NaN-Zaun-95er-Lobe -> false | Vereinheitlichte Regel: irgendein finites Sample AUSSERHALB des einschliessenden Paars >= threshold -> ambiguous |
| LOW-1 | measureProfileWidths (exportierte API) validiert Laengen-Mismatch/absteigende Positionen nicht (stille NaN-/Negativ-Breiten) | widthPx=-2.111 bei [3,2,1,0] | RangeError-Validierung |
| LOW-3 | computeEllipseMoments akzeptiert vertauschte Halbachsen still | a=2,b=5 -> 31 px gueltig | RangeError bei semiMajor < semiMinor |

## VERDRAHTUNGSPUNKTE fuer S18d/S18e (nicht in den Modulen fixbar, in die Task-Specs uebernehmen!)

- **M-3 (Projektions-sigma):** measureProfileWidths braucht die Rauschskala DES PROFILS; fuer Projektionen (Summen ueber ~N Pixel) ist die Pixel-sigma_B falsch (Messfall: Peak 2.9*sigma_B je Pixel -> Cut korrekt unterdrueckt, Projektion misst froehlich). Verdrahtung muss sigma skalieren (unkorreliert: sigma_B*sqrt(contributingCount)) — im Code jetzt dokumentiert + Doku-Orakel.
- **M-4 (flacher Sattel):** Bimodal mit Sattel > threshold liefert +71 % Breite bei ambiguous=false (nur zwei Kreuzungen existieren — wortlautkonform). Kompensation ist das MULTI_PEAK-Gate aus Plan v5 §7 (>=2 Peaks ueber k*sigma mit Abstand > 2*w_est) — MUSS in S18e an die FWHM-Anzeige gekoppelt werden.
- **M-5 (fehlende §5-Ausweise):** IMAGE_ORIENTATION_UNSTABLE (q<0.05), "sigma_minor < 1 px -> Achse nicht aufgeloest", IMAGE_FWHM_AMBIGUOUS als Code, Subpixel-Gueltigkeit w>=3 px existieren nur im Plan, in keinem .ts. Die Module liefern die Rohgroessen (q, sigmaMinor, ambiguous, Peakbreite) — die Schwellen-/Warncode-Auswertung gehoert in die §7-Schicht (S18e); Messfall: zirkulaerer Gauss liefert thetaRad=0.0259 (reines Rundungsrauschen) ohne Vorbehalt.

## Offen/abgewogen (LOW, dokumentiert statt gefixt)

Leere Ellipsen-Domaene meldet nonpositive_sum (pixelCount=0 im Ergebnis unterscheidet den Fall); peakCentroidDistancePx ohne Overflow-Schutz (mit Pixelkoordinaten unerreichbar); projection-x column-major 8.4x langsamer als projection-y (304 ms @4096^2, im Budget — Kandidat fuer Sammelpass); Denormal-Amplituden liefern valid=true mit verzerrter sigma (inhaerent); Testtitel-Prefix "S18a" als Serien-Prefix (Entscheid dokumentiert).

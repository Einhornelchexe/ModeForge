# S18d Review-Meilenstein (Opus-Leg) — Fit + Blenden-Gates + Reporting

**Datum:** 2026-08-17 (abends). **Artefakte:** packages/image/src/fit.ts, aperture.ts, reporting.ts + Tests (Stand: 300/300 gruen vor dem Review).
**Leg:** Opus (read-only, eigene Mess-/Referenzskripte; ein Verbindungsabbruch mittendrin, per Resume fortgesetzt). Alle Zahlen GEMESSEN.
**Status:** GEFIXT — die Fix-Runde (HIGH-1/2/3 + MEDIUM-1/2, ein agentischer DeepSeek-Task, 12 Turns, $0.28) ist gelandet: eigen22-Clamp, aperture_clipped-Gate (Praezedenz fit -> nonpositive_amplitude -> residual -> aperture_clipped -> alpha -> multi_peak), Multi-Peak-Schwelle max(k*sigmaB, 0.1*peak), nonpositive_amplitude-Guard (nullt auch fitWidths), Hintergrund-Subtraktion fuer Ellipsen-Paesse/Pedestal + fittedBackgroundRelativeToPeak-Hint. Alle Reviewer-Orakel uebernommen (inkl. Clipping-Walk cx=80/24/16/8 und sigmaB=0-Rauschimmunitaet). Suite danach **309/309**, typecheck + Wortlaut-Gate gruen. LOWs bleiben dokumentiert (unten).

## Kern messbestaetigt (nahe Maschinenpraezision)

Jacobians: schlechteste relative Abweichung 2.0e-6 gegen Richardson-extrapolierte zentrale Differenzen ueber ~110k Vergleiche an frischen Zufallspunkten (alle 4 Modellformen, inkl. Clamp-Raender n=0.5/10). Konvergenz-Sweep: 220/230 randomisierte Fixtures (95.7%), Nichtkonvergenz nur bei 5%-Rauschen, Cap 30 nicht bindend. Skalen-Aequivarianz x3.7: schlechteste 4.0e-11. Kanonisierung: 0 Verstoesse. Zeitbudget deterministisch. Dezimierung nach b^2/12-Korrektur: 1.6e-6 (grosse sigma) bis 4.4e-3 (sigma=3, b=2). Lanczos-Gamma: schlechteste 1.9e-14 (unabhaengige Stirling-Referenz + exakte Identitaeten 4e-16). Kovarianz-Roundtrip: 5.5e-16 ueber 210 Faelle inkl. 100:1-Anisotropie. Ende-zu-Ende-Kette (fit -> aperture -> physisch): +0.003% rauschfrei, <= 0.30% bis 2% Rauschen, Trunkierungsfaktor inklusive. startMoments-Verfeinerung funktioniert (1.3 vs 7.0 Iterationen). Gate-Praezedenz-Wahrheitstabelle: vollstaendig korrekt. Multi-Peak-Greedy-Zaehlung (3 kollineare Peaks): korrekt.

## Fix-Pflicht (in der laufenden Fix-Runde)

| # | Befund | Messbeleg | Fix-Design |
|---|---|---|---|
| HIGH-1 | reporting.eigen22 ohne Negativ-Clamp -> NaN-Breiten auf degeneriert-aber-gueltigem Input; BREITER als der Manager-Verdacht: auch ISOTROP bei sigmaMinorPx=0 (24.1% der Winkel); produktiv erreichbar (fit.mapSigma liefert exakt 0 bei dezimiertem sigma <= 1/sqrt(12)) | mapMomentsToPhysical der Rank-1-Kette: NaN in 20.2% der Pitch-Paare; Repro-Fixture 4 Pixel auf Linie | Clamp wie moments.ts (EIG_NEGATIVE_TOLERANCE 1e-9 rel. lambdaMajor) |
| HIGH-2 | Alpha-Gate strukturell blind fuer Blenden-Clipping: beide Ellipsen-Paesse werden gleich beschnitten, Ratio bleibt stabil, beide gleich falsch -> gruene Freigabe bei bis zu -23.49% Breiten-Bias | Walk cx=80/24/16/8: Bias +0.003/-2.43/-9.90/-23.49%, alpha-Delta durchweg < 0.14%, suppressionReason null | Neues Gate "aperture_clipped" (Bounding-Box der 6-sigma-Pruefellipse muss im Bild liegen), Praezedenz fit -> residual -> clipped -> alpha -> multiPeak |
| HIGH-3 | sigmaB=0 -> Multi-Peak-Schwelle kollabiert auf value>0; jeder reale Einzelstrahl (Rauschen 1e-9 counts!) liefert 12 "Peaks" = Greedy-Packungskapazitaet -> falsche Unterdrueckung | 12-14 Peaks konstant, nur exakt rauschfreie Bilder bestehen | Schwelle = max(k*sigmaB, 0.1*peak) (MULTI_PEAK_MIN_PEAK_FRACTION, neue Konstante) |
| MEDIUM-1 | Kein Amplituden-Positivitaets-Guard: invertierter Strahl (Dip) konvergiert vereinzelt mit A=-899; Stage-C released Breiten fuer ein Loch, physisches Mapping meldet d4-Werte | 1/25 Noisy-Runs converged mit A<0; fitWidths {28,28} released | Neuer Reason "nonpositive_amplitude" direkt nach Gate 1; fitWidths dann ebenfalls null |
| MEDIUM-2 | Alpha-Gate/Stufe-B-Momente/Pedestal ignorieren den gefitteten Hintergrund, den Gate 2 korrekt abzieht: 0.1% Rest-Untergrund kippt das Alpha-Gate (5.4% Delta), waehrend pedestal.hint (10x lockerer) still bleibt | perfekter Fit, B0=1 auf 1000er-Peak -> alpha_inconsistent + hint false | Ellipsen-Paesse + Pedestal auf fit-hintergrund-subtrahierten Werten; pedestal um fittedBackgroundRelativeToPeak erweitert (Hint feuert ueber BEIDE Wege) |

## LOW (dokumentiert, kein Fix jetzt)

LOW-1: Dezimierung laesst systematischen negativen sigma-Bias bei kleinem sigma/b (-0.81% minor bei sigma=3, b=2) — als bekannte Toleranz dokumentiert; Kandidat fuer eine feinere Korrektur in S18e-Doku. LOW-2: time_budget_exceeded mit iterations=0 traegt den ungefitteten Startvektor in params (vertragskonform, aber Konsumenten-Falle — S18e-Verdrahtung muss status pruefen). LOW-3: scaledRelativeStep-Namenskosmetik + iterations-Zaehlung am Cost-Floor-Exit um 1 versetzt (kosmetisch).

## Coverage-Gaps (vom Reviewer, in die Fix-Runde uebernommen)

Degenerierte Mapping-Inputs isotrop+anisotrop; Alpha-Gate mit ueberhaengender Blende; sigmaB=0 mit realistischem Rauschboden; konvergierter Fit mit A<0; Alpha-Gate vs. Rest-Untergrund (reale Toleranz ~0.05% Peak); Dezimierungs-Toleranz bei kleinem sigma/b.

# S17 - Echte Moden-Felder + Nutzer-Anleitung: Ergebnis

**Datum:** 2026-07-06.
**Status:** live deployed (modeforge.rholabs.de).
**Auftrag:** Live-Betreiber-Reports nach Launch: (A) Anleitung/Manual auf der Seite (DE/EN, inkl. Grenzen-Doku); (B) "hoehere Moden sehen im Feld immer aus wie die Grundmode".

## B: Echte HG/LG-Moden-Felder

Befund: Der Moden-Helfer setzte nur das Envelope-M2; das Feld renderte immer die Grundmode (der alte UI-Text versprach die Moden-Darstellung sogar als "kommt spaeter"). Umsetzung via Hybrid-Planungsrezept (1 Draft @max fuer Physik/Numerik/Orakel, Manager-Grounding der Herleitungen):

- packages/field: `createModeFieldAtPlane` (TransverseMode HG{m,n} | LG{p,l}, Ordnungen 0..12): physikalische Hermite-Rekurrenz bzw. verallgemeinerte Laguerre-Rekurrenz, Konventionen identisch zur Grundmode (w = 1/e2-Radius der eingebetteten Gaussmode, Wellenfrontphase +k r^2/(2R), LG mit exp(i l phi)); Feld auf Einheitsleistung normiert.
- packages/api: `sourceMode` auf field-beamline, `mode` auf field-fresnel. **ISO-Semantik:** die Strahl-Taille ist die GEMESSENE Second-Moment-Taille der Mode; die eingebettete Gaussmode ist pro Achse um sqrt(M2_axis) kleiner. Info-Warnung nennt das passende Strahl-M2 fuer den konsistenten Fast-Mode-Kreuzcheck. (Erste Implementierung nutzte die eingebettete Taille als Nutzereingabe - der Beamline-Orakeltest deckte die Konventions-Kollision sofort auf; auf ISO umgestellt.)
- UI: FELD-QUELLE-Segment (Gauss | HG | LG + Ordnungen) in beiden Feld-Modi; alter modeNote-Text korrigiert.

Orakel (tests/unit/field-modes.test.ts, alle < Promille-Toleranzen): HG(0,0) == Grundmode bis 1e-12; Second-Moment-Radien w*sqrt(2m+1) je Achse (QHO-Herleitung <u^2> = m + 1/2, manager-verifiziert) bzw. w*sqrt(2p+|l|+1) isotrop; diskrete Orthogonalitaet HG10/HG00 < 1e-10; **Selbstaehnlichkeit unter Propagation**: Moment-Radius folgt exakt gaussianRadiusAtZ(W0_gemessen, M2) (<1%); End-to-End-Beamline-Job: Probe == analytische M2-Envelope. E2E-Browsertest: HG(1,0)-Zeilenprofil zeigt die zwei Keulen mit zentralem Einbruch.

## A: Anleitung (guide.html)

Neue indexierbare Seite mit EN/DE-Umschalter (Legal-Styling): 8 Sektionen - 60-Sekunden-Start, Strahlengang, Optimierer, Import inkl. "Warum blockiert mein Import?", Strahl-Fit (CSV-Format), Feld-Modus inkl. Feld-Quelle/Kreuzcheck/SAMPLING-GRENZE lesen, **Grenzen ehrlich** (paraxial, TEA, eine Wellenlaenge, Gitter, nicht unterstuetzte Geometrien, kein Laserschutz), Projektdateien. Verlinkt aus Landing-Nav+Footer, Workbench-Header ("?"), Sitemap-Eintrag.

## Gates

99/99 Tests (6 neue Moden-Orakel), verify:cases 60/60, verify:headless unveraendert, scope, build; Playwright: Guide-Seite (Sprachumschalter, 8 Sektionen, Links) und HG-Zweikeulen-Profil im Live-Workflow.


## Nachtrag: Gemini+GPT-5.5-Doppel-Cross (Betreiber-Wunsch)

Beide extern, parallel, danach Manager-Triage. Codex bestaetigte alle Kernformeln/Rekurrenzen/Orakel explizit "ohne Befund" und verifizierte 99/99 selbst; zusammen 8 valide Findings, 0 Halluzinationen:

| Fund | Quelle | Fix |
|---|---|---|
| Quell-Playground nutzte Taille als EINGEBETTETE Taille + Kreuzcheck mit M2=1 (ISO-Bruch zur Beamline-Semantik) | GPT H | Fresnel-Mode-Pfad teilt je Achse durch sqrt(M2), Playground-Kreuzcheck rechnet mit Moden-M2x |
| LG + elliptische Quelle ergab Hybrid (elliptische Huelle, zirkulares Laguerre) | Gemini H + GPT M | LG-Konstruktion vollstaendig zirkular (Huelle UND Wellenfront aus x); Warnung bei elliptischer Quelle |
| elliptisch/Moment-Strahlen propagierten trotz Warnung effektiv mit M2=1 (Altbestand seit S13) | Gemini H | m2x==m2y: exakter Effektiv-Wellenlaengen-Trick wie beim Gauss; m2x!=m2y: ehrliche "qualitativ"-Warnung |
| M2-Hinweis "max(m2x,m2y)" bei m!=n irrefuehrend | GPT M | achsenspezifischer Hinweis (M2x/M2y, elliptische Quelle empfohlen) |
| Einheitsleistungs-Moden vs Peak-1-Gauss: POWER-Kacheln inkonsistent | GPT M | Moden tragen jetzt pi*wx*wy/2 wie der Peak-1-Fundamentalmode; HG(0,0) == Gauss exakt |
| Fokus-Warnung uebersprang Taille exakt bei z=0 | Gemini M | z >= 0 |
| Guide "ab 2 Flaechen" vs Singlet=2 Flaechen | Gemini L | Formulierung beide Sprachen |
| API-Kommentare noch mit alter Embedded-Semantik | GPT L | Kommentare auf ISO angeglichen |

Neue Regressionstests fuer jeden Code-Fix (LG-Zirkularisierung, Fresnel-ISO, elliptisch m2x==m2y vs Envelope <2%, z=0-Fokuswarnung, Leistungskonvention). Endstand 103/103 Tests, 60/60 Referenzfaelle, Baselines unveraendert.

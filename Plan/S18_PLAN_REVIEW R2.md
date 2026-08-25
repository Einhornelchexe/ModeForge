# S18 Plan-Review R2 (Cross-Review auf Plan v2)

**Datum:** 2026-08-15.
**Artefakt:** `Plan/S18_IMAGE_ANALYZER_PLAN v2.md`.
**Legs (Routing ehrlich):**
- **Gemini 3.7 Flash (High)** (Zweit-Reviewer-Kanal, Selbstauskunft Zeile 1 "Gemini 3.7 Flash"): 3 HIGH, 3 MEDIUM, 2 LOW, 2 INFO.
- **Opus 5** (frische Session, nicht der R1-Reviewer, read-only, mit Fresh-Exploration): 5 HIGH, 9 MEDIUM, 9 LOW, 5 INFO + 6 Fresh-Exploration-Beobachtungen; mehrere Claims numerisch nachgerechnet (eigene Simulationen).

**Halluzinationscheck (Manager):** check-scope.mjs komplett gelesen (Zeilen 7/21-22/24-33/35 bestaetigt), deploy-pages.yml gelesen (node-version 24 Major-Pin, kein typecheck — bestaetigt), D4sigma-Bestandsvokabular gegengeprueft (definitions.md:9-10, i18n.ts:251/268/488/505, api:95 — bestaetigt), impressum-Zeilenumbruch aus dem R1-Grep belegt (Z. 43 endet auf "normgerechte"). Mathematische Claims (Rectified-Noise-Sockel im 2. Moment, exp(-746)=0 erst ab ~746, Quantisierung != Skalierung, Parabel-Nenner-Degeneration) per Nachrechnung/Analytik bestaetigt. **0 Halluzinationen.**

## Verdikt-Tabelle (dedupliziert; G2-* = Gemini, P2-* = Opus)

| ID | Sev | Kurzclaim | Verdikt | Disposition (v3) |
|---|---|---|---|---|
| P2-H1 | HIGH | v2-Momentenregel w=max(I,0) erzeugt ROI-abhaengigen D4sigma-Bias (+13% bei 1.0x, monoton wachsend; numerisch belegt); ohne Clipping unbiased | VALID | v2-Regel REVERTIERT: Momente rechnen vorzeichenbehaftet (unbiased); Guards fangen Degeneration; Bias-Mechanik in docs/theory dokumentiert; Rausch-Orakel ergaenzt (§4) |
| G2-H1 | HIGH | Gate ab S18a aktiv, Bestands-ISO-Kommentare aber erst in S18f bereinigt -> Gate bricht sofort | VALID | Gate ab S18a MIT dokumentierter Bestands-Allowlist (8 Treffer); S18f-Sweep leert sie bis auf die Dauer-Ausnahme (Impressum) (§3/§8) |
| G2-H2 / P2-H3 | HIGH | Gate matcht seine eigenen Pattern-/Allowlist-Literale, sobald scripts/ im Scope liegt | VALID | Gate-Skript schliesst sich selbst per Pfad aus (dokumentiert) (§8) |
| P2-H2 | HIGH | Exact-String-Allowlist scheitert am Zeilenumbruch der Impressum-Klausel (Z.43/44) | VALID | Allowlist als (Datei, Pattern, erwartete Trefferzahl)-Tripel — umbruchrobust und count-gepinnt (§8) |
| G2-H3 / P2-H4 (+G2-L1) | HIGH | IRLS-Skala 1.4826*MAD ohne Floor -> delta=0, Gewichte 0/NaN, singulaere Normalgleichungen; Float-Floor undefiniert; Nullparameter-Konvergenzkriterium undefiniert | VALID | IRLS-Floor wie Rechteck-Regel (int: halber Quantisierungsschritt; float: 1e-12*Wertespanne); alle Residuen <= Floor -> konvergiert; skalenbewusstes Abbruchkriterium (§4) |
| P2-H5 | HIGH | "Skalenaequivarianz 8/16-bit/Float" ist unter Requantisierung falsch (5.5e-3..1.6e-2 gemessen); Orakel so unerfuellbar | VALID | Orakel gesplittet: exakte Float-Skalierung (streng, 1e-12) + Quantisierungs-Konsistenz (lose Toleranz, dokumentiert) (§4) |
| G2-M1 | MED | q = 0/0 = NaN bei Einzelpixel-Peak (lambda1=lambda2=0), Guard greift nicht | VALID | Guard erweitert: lambda1+lambda2 <= 0 -> q undefiniert + Hinweis (§5) |
| P2-M1 | MED | Poisson-Begruendung falsch (exp(-745)=5e-324, erst ~746 -> 0; keine Endlosschleife, sondern falsches Ergebnis); Normalapprox unterspezifiziert | VALID | Begruendung korrigiert (O(lambda)-Kosten + Underflow-FEHLERGEBNIS); Spez: Box-Muller auf mulberry32, Rundung, Clamp>=0 (§9) |
| P2-M2 | MED | Subpixel-Parabel ohne Nenner-/Clamp-Guard auf Rauschplateaus; Bias-Zahlen halten (0.021px @w=3) | VALID | Guards: Nenner <= 0 oder Verschiebung > 0.5 px -> unterdrueckt; Orakel trennt rauschfrei/verrauscht (§5) |
| P2-M3 (+G2-L2) | MED | Speicherbudget am 4096^2-Cap unbeziffert (350-500 MiB moeglich); Full-Frame-2D-LM sprengt 2s | VALID | Working-Set-Tabelle + Ziel <=300 MiB; Residuen nur als Stats + <=512^2-Anzeige-Grid; 2D-Fit-ROI <= 1024^2, sonst deterministische 2^k-Dezimierung + Hinweis (§6/§7) |
| G2-M3 / P2-M4 | MED | Float32Array im Result bricht JSON-Vertrag/Export/Pinning (JSON.stringify -> Dictionary) | VALID | Result ist reines JSON: Anzeige-Grids <=512^2 als number[] (FieldImageGrid-Muster), volle Aufloesung nur intern; Typed Arrays nur worker-intern (§7) |
| G2-M2 / P2-L4 | MED | Transferables "in beide Richtungen" kollidiert mit Decode-Cache (Detach) | VALID | Explizite Transfer/Copy-Matrix: Dateibytes UI->Worker transferiert; Original bleibt worker-eigen; Hover-Inspektion via async Query; Ergebnisse als JSON (§7) |
| P2-M5 | MED | README:27 behauptet zusaetzlich "12-significant-digit" pauschal + "60 cases"; "81" steht an 2 Stellen | VALID | Checkliste praezisiert (beide Stellen, beide Aussagen) (§8) |
| P2-M6 | MED | Node-Pin existiert schon als Major-Pin (24) — traegt weniger als der Plan verkauft | VALID | Exakte Version pinnen (version-file/.nvmrc); Fussnote korrigiert (§8) |
| P2-M7 | MED | Terminologie-Fork: Repo hat bereits "D4sigma diameter" (definitions.md:9, i18n:268/505, BeamWidthBasis); globale widthBasis unadressiert | VALID | Analyzer nutzt das BESTEHENDE D4sigma-Vokabular statt Eigenname; folgt bewusst NICHT der globalen widthBasis (alle Breiten explizit beschriftet) (§1/§5/§7) |
| P2-M8 | MED | Anisotropiefestigkeit nur fuer Momente/2D-Fit; FWHM/Profile/enclosed power/Sweep-Shift richtungsabhaengig ungeregelt; Eigenwert-Kehrwert unerwaehnt | VALID | Alle mm-Groessen aus physischen Koordinaten; Kehrwert-Hinweis ergaenzt (§6) |
| P2-M9 | MED | DecompressionStream = erste Plattform-Global-Abhaengigkeit in packages/* vs CONVENTIONS Regel 3 | VALID | Dokumentierte Ausnahme in CONVENTIONS (Decoder-Schicht; Node>=18 hat das Global ebenfalls -> CLI/test-faehig) (§3/§8) |
| P2-L1 | LOW | JSON-LD softwareVersion 0.1 + meta/keywords/og fehlen in Checkliste | VALID | Checkliste ergaenzt (§8) |
| P2-L2 | LOW | i18n-Verdrahtung fehlt in "Verdrahtung vollstaendig"; field.ts:304 Kacheln hartkodiert | VALID | §7 ergaenzt; 2sigma-Label-Abgrenzung in S18e |
| P2-L3 | LOW | Worker-Fallback (main.ts:174-188 synchron auf Main-Thread) fuer async Decode ungeregelt | VALID | Fallback definiert: async Decode + synchrone Analyse auf Main-Thread mit Hinweis, ohne Progress (§7) |
| P2-L5 | LOW | Voll-Frame-ROI degeneriert den Sweep (1.1/1.2x clampen auf 1.0x) -> kuenstlich kleine Sensitivitaet | VALID | Nur verfuegbare Varianten + "partial sweep"-Kennzeichnung im Result (§4) |
| P2-L6 | LOW | Super-Gauss: geschlossene Gamma-Formel existiert (1e-13 verifiziert); n=0.5 Momentenvergleich ROI-limitiert; n=10 Exponent-Underflow | VALID | Gamma-Formel als exaktes Orakel (Lanczos test-only); Tail-Einschraenkung bei n<1 dokumentiert+markiert; Arg-Clamp-Numerikhinweis (§6/§9) |
| P2-L7 | LOW | Formel-Duplikat image vs beams ohne Cross-Check-Test (image darf beams nicht importieren) | VALID | Cross-Check-Test in tests/unit (importiert beide Pakete) (§6-Orakel) |
| P2-L8 | LOW | Gate-Walker braucht Excludes auf JEDER Ebene; apps/web/node_modules/.vite existiert bereits | VALID | Exclude-Set (node_modules, dist, .git, .vite*) auf jeder Ebene (§8) |
| P2-L9 | LOW | Token-Luecken: "Norm-Konformitaet" (Bindestrich), "Iso-konform", IEC 60825 | VALID | Patterns erweitert: /norm-?(konform|gerecht)\w*/i, /iso-?konform\w*/i, /\bIEC[- ]?60825\b/i (§8) |
| G2-I1 | INFO | stableNumber fest auf 12 — 6-Stellen-Pins brauchen parametrisierte Rundung | VALID | §8 nennt die Helper-Parametrisierung |
| P2-I1 | INFO | API v1.md Result-Union ist schon heute unvollstaendig (field-beamline fehlt seit S13) | VALID | In Checkliste mitgezogen (§8) |
| P2-I2 | INFO | agents/ vom Gate ausgenommen, aber §8 legt dort ein NEUES aktives Artefakt an | VALID | Ausnahme bleibt; neue cases-Datei wird normfrei verfasst, Begruendung im Gate dokumentiert (§8) |
| P2-I3 | INFO | ISO-Bestand fuer das Root-Set vollstaendig: exakt 8 Treffer | Bestaetigung | Allowlist-Basis (§8) |
| P2-I4/I5 | INFO | O(N)-Budget plausibel (17.6 ms/Momentenpass @2048^2); Zahlen-Konsistenz geprueft (FWHM-Faktor, q-Schwellen, fieldMomentRadii um Gittermitte) | Bestaetigung | — |
| P2-FE1 | FE | Globaler Drop-Handler erzwingt 5-MB-Cap fuer ALLE Zonen (main.ts:1194-1207) — neuer Binaerpfad muss koexistieren | VALID | Globaler Handler bekommt per-Zonen-Cap (minimale Erweiterung; Bestandszonen unveraendert) (§7) |
| P2-FE2 | FE | Keine NUL-/Steuerzeichen-Sanitisierung fuer Metadaten-Passthrough (Repo-Praezedenz existiert); Export-Kappung ungeregelt | VALID | Metadaten sanitisiert (NUL/Steuerzeichen) + 4-KB-Kappung auch im JSON-Export (§3/§7) |
| P2-FE3 | FE | verify-reference-cases Default-Toleranz 1e-9 passt nicht zu 6-Stellen-Fit-Pins | VALID | Image-Faelle setzen toleranceRel explizit (§8) |
| P2-FE4 | FE | CONVENTIONS.md-Statuszeile veraltet ("S12") | VALID | In Checkliste (§8) |
| P2-FE5/6 | FE | Worktree-Kopien im Arbeitsverzeichnis; Landing-Prinzip 03 bleibt haltbar | Kenntnisnahme | Keine Plan-Aenderung |

**Ergebnis:** 0 Ablehnungen; alle Findings eingearbeitet (P2-H1 als Revert der v2-eigenen Momentenregel — die R1-Massnahme O-H2 wird stattdessen ueber vorzeichenbehaftete Momente + Guards erfuellt). Ergebnis-Dokument: `Plan/S18_IMAGE_ANALYZER_PLAN v3.md`.

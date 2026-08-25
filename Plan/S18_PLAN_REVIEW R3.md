# S18 Plan-Review R3 (Cross-Review auf Plan v3)

**Datum:** 2026-08-15.
**Artefakt:** `Plan/S18_IMAGE_ANALYZER_PLAN v3.md`.
**Legs (Routing ehrlich):**
- **Gemini 3.1 Pro (High)** (Zweit-Reviewer-Kanal, Selbstauskunft Zeile 1): 4 HIGH, 4 MEDIUM, 2 LOW — durchgehend OHNE Datei:Zeile, alles als ANNAHME markiert (das Leg hat erkennbar primaer gegen den Brief statt gegen Dokument+Code geprueft; 3 Findings im Halluzinationscheck zurueckgewiesen).
- **Opus 5** (frische Session, dritter unabhaengiger Opus-Reviewer): 6 HIGH, 11 MEDIUM, 7 LOW + 6 Fresh-Exploration; mehrere eigene MESSUNGEN (Monte-Carlo Momente, LM-Timing, structuredClone, Gate-Simulation ausgefuehrt) — inkl. Nachbau des Norm-Gates: **laeuft mit 4 Allowlist-Tripeln auf dem aktuellen Baum gruen (127 Dateien, 0 Rest-Treffer)**.

**Halluzinationscheck (Manager):** Opus-Messungen mechanisch nachvollzogen (Rectified-/Ordnungsstatistik-Argument fuer den D4sigma-Bias ist mathematisch zwingend; LM-Flops-Rechnung konsistent; Truncation-Mathe der Blenden-Loesung selbst nachgerechnet: alpha=4 -> sigma-Fehler 0.13 %). Gemini-Rejections mit Beleg: "ISO 11146 fehlt im Gate" widerlegt durch v3 §8 (/ISO[- ]?11146/i, /\b11146\b/ stehen drin); "IRLS-Endlosschleife" widerlegt durch den 50-Iterationen-Cap in v3 §4; "Count-Pinning hyperfragil" ist dokumentierter Gate-Zweck (fail-closed).

## Verdikt-Tabelle (G3-* = Gemini 3.1 Pro, P3-* = Opus)

| ID | Sev | Kurzclaim | Verdikt | Disposition (v4) |
|---|---|---|---|---|
| P3-H1 | HIGH | Vorzeichenbehaftete Momente brechen bei grosser ROI/Full-Frame zusammen (Guard feuert 19-47/60; D4sigma +29..+157 % Median-Bias; Monte-Carlo) | VALID | Zweistufiger Ausweis: ROI-Momente (transparent, Sweep) + **Blenden-Momente** in Ellipse alpha=4 x sigma_Fit als rausch-robuster Default (Gauss-Trunkierungsfehler <0.15 % in sigma, exakt dokumentiert); Full-Frame-Momente nur diagnostisch + Warnung; Aggregationsregel fuer undefined-Sweep-Varianten (§4/§5) |
| P3-H2 | HIGH | §4-/§5-Guards widersprechen sich (lambda_min<0 vs Spur>0: q=1.33>1 moeglich, sigma2=NaN) | VALID | EIN Gueltigkeitspraedikat fuer alle Momentengroessen, NaN-robust negiert formuliert (§4) |
| G3-H1 | HIGH | NaN passiert Vorzeichen-Guards (NaN<=0 ist false) | VALID | Negierte Guards (!(x>0)-Form) + definierte NaN-Pixel-Behandlung (ausschliessen, zaehlen, IMAGE_FLOAT_SPECIALS) (§4) |
| P3-H3 | HIGH | LM-Budget "<2 s @1024^2" 2.5-6x zu optimistisch (gemessen 240.9 ms/Iteration @1024^2) | VALID | Fit-Gitter je Achse <=512 (Pooling), Iterations-Cap 30, Budget <2 s @512^2 mit Browser-Marge; Working-Set/Orakel angepasst (§6) |
| P3-H4 | HIGH | Elliptisches Super-Gauss-Modell undefiniert; zwei Verallgemeinerungen differieren 9.5-13.5 % in sigma/w; Repo-Funktion ist radial-skalar | VALID | Modell EXAKT definiert: I=B+A*exp(-2*((u/w1)^2+(v/w2)^2)^n) (radiale Potenz; fuer w1=w2 identisch zur Repo-Konvention); sigma/w = sqrt(2^(-1/n)*Gamma(2/n)/(2*Gamma(1/n))); Cross-Check gegen packages/beams nur im zirkularen Fall — dokumentiert (§6) |
| P3-H5 | HIGH | B_hat als Skalar in 3 Sektionen vorausgesetzt, existiert nur bei Rechteck-Methode | VALID | Semantik vereinheitlicht: alle Schwellen/Basislinien operieren auf I_corr (B_eff=0 nach Korrektur); sigma_hat je Methode definiert (Rechtecke: MAD; sonst MAD ueber ROI-Randrahmen); FWHM-Basislinie = I_peak_corr/2; Peak-to-Background wird Peak-to-Background-Noise (I_peak_corr/sigma_hat) (§4/§5/§6) |
| P3-H6 | HIGH | Fit-Domaene der robusten Ebene ungenannt (Vollbild vs Rechtecke; beide mit eigenen Fehlermodi) | VALID | Ebene fittet NUR Hintergrundpixel (Nutzer-Rechtecke oder dokumentierter ROI-Randrahmen); Rang-/Konditions-Guard, Mindestausdehnung in beiden Achsen (§4) |
| G3-H2 | HIGH | "Rein JSON" vs Zero-Copy widerspruechlich; number[]-Grid teuer | TEILWEISE | Kein JSON-Parsing auf dem Pfad (structured clone) — Wording praezisiert; Kosten real: siehe P3-M3 (§7) |
| G3-H3 | HIGH | "ISO 11146 fehlt in den Gate-Patterns" | ZURUECKGEWIESEN | Steht woertlich in v3 §8 (/ISO[- ]?11146/i, /\b11146\b/, /\bISO\b/); Finding verdreht zudem den Gate-Zweck |
| G3-H4 | HIGH | Knuth-Sampler O(lambda) blockiert die UI | ZURUECKGEWIESEN | Sampler ist test-only (synthetic.ts), kein UI-Pfad; Notiz: Synthetik-Bilder klein halten (§9) |
| P3-M1 | MED | Working-Set-Inventar unvollstaendig: mit Dunkelbild+Labels 344 MiB > 300-MiB-Ziel | VALID | Budget itemisiert neu: <=400 MiB @4096^2; Dateibytes nach Decode freigegeben, Dunkelbild als f32, Labels transient (§6) |
| P3-M2 | MED | 4096^2-Cap und 64-MB-Upload-Cap fuer 32-bit unvereinbar (4096^2*4B = 64.0 MiB exakt) | VALID | Upload-Cap-Vorschlag 128 MB; Pixel-Cap bleibt 4096^2 (§7/§10) |
| P3-M3 (+G3-H2) | MED | structuredClone 512^2-number[] = 124 ms (vs 2.7 ms typed); JSON-Export 4.8 MB/Grid | VALID | Anzeige-Grids <=256^2 als number[] im Result (~30 ms, ~1.2 MB); Worker sendet zusaetzlich render-optimierte Float32Array-Kopien fuer Canvas (kein JSON-Kontakt) (§7) |
| P3-M4 (+G3-L1) | MED | Dezimierung unterspezifiziert; Block-Mittel verzerrt w (+b^2/3, korrigierbar), Subsampling aliasing-/undersampling-anfaellig | VALID | Per-Achse 2^k-Mittelwert-Pooling bis je Achse <=512; dokumentierte Breiten-Korrektur w=sqrt(w_fit^2 - b^2/3) (Gauss exakt, Super-Gauss als Naeherung markiert); Koordinaten-Rueckabbildung x_full=b*x_dec+(b-1)/2 (§6) |
| P3-M5 | MED | Dezimierungs-Orakel verlangt den teuren Full-res-Fit (10-20 s in einer 2.1-s-Suite) | VALID | Orakel gegen Synthetik-TRUTH statt Full-res-Fit; Toleranzen w-/b-abhaengig definiert (§6) |
| P3-M6 | MED | Norm-Gate (blinder Textmatch) kollidiert mit Quellenpflicht in docs/theory | VALID | Doku-Politik: oeffentliche Literatur (Buecher/Paper) wird zitiert, Norm-Dokumente werden bewusst weder benannt noch zitiert; Normfreiheit als eigener Absatz (§8) |
| P3-M7 | MED | "8er-Bestandsliste" sind im Tripel-Format 4 Tripel; Gate-Sim mit 4 Tripeln laeuft gruen | VALID | Formulierung korrigiert: 4 Tripel decken die 8 Alt-Zeilen; Positiv-Ergebnis der Simulation im Plan notiert (§3/§8) |
| P3-M8 | MED | Per-Zonen-Cap repariert den Drop-Handler nicht: Binaerdatei liefe durch TextDecoder und wuerde still verworfen (main.ts:1206/1226) | VALID | Globaler Handler bekommt Zonen-Branch VOR dem Textpfad: Analyzer-Zone -> arrayBuffer-Route; Bestandszonen unveraendert (§7) |
| P3-M9 | MED | Worker-onerror-Retry nach Transfer hat keine Bytes mehr; Seiten-/Kanalwechsel braucht Rohbytes erneut | VALID | UI haelt das File-HANDLE (nicht die Bytes) und liest per file.arrayBuffer() erneut; Worker-Cache keyed (Datei, Seite, Kanal) (§7) |
| P3-M10 | MED | Schwellen/Severities fuer ROI_SENSITIVE, RESIDUAL_HIGH, HOT_PIXELS, MULTI_PEAK, FLOAT_SPECIALS fehlen (werden in S18f gepinnt) | VALID | Schwellen-/Severity-Tabelle mit konkreten Defaults in einer Konstantendatei (§7) |
| P3-M11 | MED | Voll-Frame: Shift-Varianten degenerieren zu Groessen-Varianten (falsch gelabelt); Aggregationsregel fuer undefined-Varianten fehlt | VALID | Voll-Frame: Shifts entfallen ebenfalls (nur Shrink-Varianten, size-only gelabelt); Sensitivitaet nur ueber definierte Varianten, <3 definierte -> "nicht bestimmbar" + Warnung (§4) |
| G3-M1 | MED | Analyzer ignoriert globale Breitenbasis — UX-Bruch | TEILWEISE | Betreiber-Entscheidung #8 geschaerft: Alternative (Hauptbreite folgt globaler Basis, uebrige explizit) benannt; Empfehlung bleibt explizite Beschriftung (§10) |
| G3-M2 | MED | IRLS-Endlosschleife am Floor | ZURUECKGEWIESEN | 50-Iterationen-Force-Exit steht in v3 §4 |
| G3-M3 | MED | Count-Pinning hyperfragil | ZURUECKGEWIESEN | Fail-closed ist dokumentierter Zweck; klarstellender Satz ergaenzt (§8) |
| G3-M4 | MED | Normalapprox ohne Rundungs-/Stetigkeitsregel leicht verzerrt | TEILWEISE | Spez-Satz: round-half-up; fuer die Test-Zwecke zaehlt Determinismus, nicht Verteilungsguete — dokumentiert (§9) |
| P3-L1 | LOW | Box-Muller: mulberry32 kann exakt 0 liefern -> ln(0) -> NaN (0.78 % je 4096^2-Bild) | VALID | u=1-rand() bzw. Floor auf 2^-33 (§9) |
| P3-L2 | LOW | "Breiten aus den Kehrwerten der Eigenwerte" woertlich falsch (richtig: 1/sqrt(lambda')) | VALID | Wortlaut korrigiert (§6) |
| P3-L3 | LOW | Token-Luecken: "standards compliant"/"norm compliant" (Leerzeichen), "Iso-Norm", "nach Iso", "Normerfuellung", "normative Auslegung" | TEILWEISE | Patterns pragmatisch erweitert ([- ] statt -?, /\biso[- ]norm\w*/i, /normativ\w*/i, /normerf\w*/i); dokumentierte Grenze: das Gate ist ein Netz, kein Beweis — finaler Wording-Review bleibt menschlich (§8) |
| P3-L4 | LOW | Warncodes erscheinen produktweit unuebersetzt (code+message EN) — EN/DE-Zusage nicht einloesbar | VALID | Ehrlich dokumentiert: Warnkanal bleibt EN wie im Bestand; EN/DE gilt fuer UI-Labels/Guide (§7) |
| P3-L5 | LOW | IRLS-Abbruch mischt Einheiten (Offset in Counts, Steigungen in Counts/px) | VALID | Per-Parameter-Skalen (Offset: Datenspanne; Steigungen: Datenspanne/ROI-Ausdehnung) (§4) |
| P3-L6 | LOW | field-worker.ts:16-19 ist die falsche Adresse fuer die Transfer-Liste | VALID | Transfer-Typisierung gehoert in den neuen image-worker.ts (§7) |
| P3-L7 | LOW | typecheck-CI-Ergaenzung erst S18f — S18e-i18n-Fehler fielen durchs Netz | VALID | CI-Ergaenzung (typecheck/typecheck:web, Node-Exakt-Pin) in S18e vorgezogen (§7/§8) |
| P3-FE1 | FE | runHeadlessJobJson prueft nur kind; calib/config kaemen ungeprueft an | VALID | §3-Eingangsvalidierung um calib/config erweitert |
| P3-FE2 | FE | render() ersetzt die Shell per innerHTML — Analyzer-Canvases brauchen denselben rAF-Repaint-Hook wie drawFieldCanvases | VALID | §7: Repaint-Hook fuer Analyzer-Canvases |
| P3-FE3/4/5/6 | FE | npm install fuellt node_modules (Excludes noetig — bereits spez.); Sweep-Budget knapp aber haltbar (18.6 ms/Pass gemessen); mehrere v3-Zahlen bestaetigt (Subpixel-Bias 0.02134 px, exp(-745/746), q(1.3)=0.2565, FWHM-Faktor); README "81" vorbestehend falsch | Bestaetigungen | — |

**Ergebnis:** Opus-Leg: alle 24 Findings + 2 actionable Fresh-Explorations VALID (eingearbeitet). Gemini-3.1-Pro-Leg: 2 VALID, 3 TEILWEISE, **3 ZURUECKGEWIESEN** (mit Beleg — erste Halluzinationen der gesamten Review-Serie). Ergebnis-Dokument: `Plan/S18_IMAGE_ANALYZER_PLAN v4.md`.

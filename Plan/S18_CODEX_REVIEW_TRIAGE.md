# S18 — Externes Physik-Review (ChatGPT/Codex), Triage & Verifikations-Trail

**Datum:** 2026-08-20.
**Status:** Diagnose-only (drei read-only Reviews, kein Produktiv-Code); Verifikation läuft (drei parallele Verifikations-Sessions).
**Auslöser:** Betreiber-Auftrag nach Abschluss der UI-Runde 3 („Review zu der gesamten Physik-Bildauswertungs-Engine … wichtig: ROI-Konvergenz, 4σ-Fits, Residuen … weitere Session auf die Hintergrund-Korrektur, max effort").
**Verweis:** `Plan/S18_GATE_CALIBRATION_SPEC.md` (§10/§11/§12 dokumentierte Grenzen), `Plan/S18_IMAGE_ANALYZER_PLAN v5.md`, Betreiber-Entscheid unten (§4).

---

## 0. Verdikt zuerst

**Drei unabhängige Codex-Reviews (je 13–16 min, read-only, mit Ausschlussliste der dokumentierten Grenzen) liefern zusammen ~30 Findings, davon 9 als HIGH eingestuft; alle Findings sind bis zur adversarialen Verifikation Hypothesen.** Die Reviews bestätigen die Kern-Arithmetik (Momente, Kovarianz-Mapping, Vorzeichen-Handling) und benennen als Vertrauensproblem-Cluster: (a) unzertifizierte Hintergrund-Zustände werden konsumiert, (b) die ROI-Iterations-Schleife hat destabilisierende Pfade, (c) das Rauschmodell ist rein additiv-Gaussisch, (d) TIFF-Metadaten-Semantik (Polarität/Orientierung) wird ignoriert. Drei parallele Verifikations-Sessions prüfen jede Behauptung mit numerischen Repros gegen den Code; erst deren Verdikte (CONFIRMED / DOCUMENTED-LIMIT / PARTIAL / REFUTED) sind die Grundlage des Fix-Plans.

---

## 1. Lauf-Übersicht

| Lauf | Scope | Dauer | Findings (Selbst-Einstufung) |
|---|---|---|---|
| Breit (`task-mt1lu5ny-jgm0r2`) | packages/image/src gesamt | 13m19s | 2 HIGH, 4 MEDIUM, 2 LOW (F1–F8) |
| ROI-Kette (`task-mt1mcpgp-j1li7v`) | roi/fit/aperture/metrics/reporting/analyze + UI-ROI-Ableitung | 14m40s | 4 HIGH + MEDIUM-Cluster (V1–V6-Prüfliste) |
| Hintergrund (`task-mt1mezj1-q060nw`, max effort) | background.ts + Verdrahtung + σ_B-Konsumenten | 16m05s | 8 HIGH-Claims + MEDIUM-Cluster (C1–C11-Prüfliste); enthält eigene In-Memory-Experimente |

Routing-Ehrlichkeit: Alle drei Läufe liefen über die Codex-CLI des Betreiber-Accounts (Session-IDs im Betreiber-Terminal via `/codex:result` dokumentiert); Modell-/Effort-Echo wurde vom CLI-Wrapper nicht zurückgegeben — konservativ als „Codex, unbestätigte Sub-Version" geführt.

---

## 2. Findings-Kondensat (Hypothesen-Status, vor Verifikation)

### 2.1 Breiter Lauf (F1–F8)

| # | Sev | Behauptung (Kurzform) |
|---|---|---|
| F1 | HIGH | Robust-Plane-IRLS mit `converged=false` wird von analyzeImage trotzdem angewendet; kein Warncode. |
| F2 | HIGH | Rauschmodell homoskedastisch (Fit ungewichtet, MC injiziert überall σ_B); Shot-Noise-dominierte Frames unterschätzt. |
| F3 | MED | Alpha-MC-Null verwirft Realisierungen (Background-Dominanz-Prädikat) und rechnet RMS nur über Survivors → Schwelle konditioniert. |
| F4 | MED | Residual-/Multi-Peak-Floors nutzen peakCorr inkl. gefittetem B → additive Offset-Invarianz verletzt (B=0 vs B=1000 ändert Detektion). |
| F5 | MED | TIFF WhiteIsZero akzeptiert, aber nicht invertiert → inverses Profil analysierbar. |
| F6 | MED | TIFF-Orientation-Tag weder angewendet noch abgelehnt → Achsen-Kalibrierung stillschweigend falsch zuordenbar. |
| F7 | LOW | ORIENTATION_UNSTABLE prüft Pixel- statt Physik-Raum-Kontrast. |
| F8 | LOW | Dead-Pixel: Observed-Statistik überspringt Non-Finite, MC-Null kennt keine Lücken. |

### 2.2 ROI-Kette (Kern-Claims)

| # | Sev | Behauptung (Kurzform) |
|---|---|---|
| V1 | HIGH | suggestRoi (4σ_B-Schwelle + 8 px Pad) kann die 6σ-Prüfellipse nicht fassen → Apply-and-Rerun läuft deterministisch in `aperture_clipped` (A/σ_B=1000: Halbbreite 41.3 px vs. benötigt 60 px). |
| V2 | HIGH | 0.85-Flächen-Klammer stoppt nur Einzelschritte; 0.95²=0.9025 pro Schritt passiert → kumulative Schrumpfspirale (20 Iterationen → 13.3 % Fläche); Zentrum ungeklemmt. |
| V3 | HIGH | ROI-aus-Fit akzeptiert solver-converged Fits ohne Release-Gates; LM-Zentrum außerhalb des Sensors → ~1×1-Rect am Rand; Full-Frame-Modus umgeht die Klammer. |
| V4 | HIGH | LM-Wedge-Arm 1 (rel. Kostenverbesserung ≤1e-10) verlangt keinen kleinen Parameterschritt → „converged" trotz großem letzten akzeptierten Schritt möglich. |
| V5 | MED | Cluster: Rim-σ_B-Feedback; Residual-Gate nicht χ²-kalibriert (high-SNR under-suppressive); peakCorr = rohes Maximum (Hot-Pixel weitet Toleranz); Non-Finite ohne Coverage-Minimum; Super-Gauß-Sheppard (b²−1)/3 direkt auf w² (~4.5 % bei n=2, diagnostisch); Partial-Block-Pooling. |
| V6 | Kurz | Komponenten-Tie-Oszillation (Scan-Order); 9σ/12σ-Proben bei engem ROI entfallen (Wing-Empfindlichkeit); Minor-Achse ≈1 px → instabile Alpha-Ratios, Warnung erst nach Stage-B-Wert. |

Positiv-Befunde des Laufs: released-D4-ROI-Pfad für Gauß/Flat-Top/Ring expansiv/stabil; non-converged Fits erreichen die freigegebene Stage-B-Ellipse nicht; MC läuft lokal um den 6σ-Support (ROI-Fläche allein erzeugt keinen False-Suppress).

### 2.3 Hintergrund (Kern-Claims C1–C11)

| # | Sev | Behauptung (Kurzform) |
|---|---|---|
| C1 | MED-HIGH | Glatte Gauß-Ausläufer biasen Median UND robuste Ebene (Ecken-Rects, FWHM 59 % der kurzen Seite → ~0.9 % Peak-Bias; 5 %-Rim → 2.5–3.5 %). |
| C2 | HIGH | Ebenen-Fit verbraucht 3 Freiheitsgrade auf den eigenen Referenz-Pixeln → σ_B deflationiert (2×2-Rect: ~−45 %) → MC zu permissiv. |
| C3 | MED | rect-median ohne Mindest-Stichprobe (1×1 gültig → Hot-Defekt −900 Counts Über-Subtraktion möglich). |
| C4 | MED | P10/P90-Float-Floor kollabiert bei 1–2 Samples auf 0. |
| C5 | HIGH | Falsche Methodenwahl (rect-median auf Rampe): deterministische Struktur wird „Rauschen" (σ_B≈332 auf rauschfreiem Fixture) → Gates entschärft → released. |
| C6 | HIGH | Stage-B-Fit läuft ohne tiltedBackground → Rest-Rampe wird nie repariert (kleine Rampen released mit kleinem Bias, größere alpha-suppressed — Grenzbereich zu quantifizieren). |
| C7 | HIGH | MC-Skalierung σ_B/b nur für iid korrekt; Common-Mode-Komponenten mitteln nicht herunter. |
| C8 | HIGH | Bediener-Szenarien: strahlförmige Hot-Corner ohne Laser released (11.98×7.99 px, nur generische Warnungen); Referenz-Rects auf ~3σ-Ausläufern deaktivieren beide Rim-Warn-Arme; Dark-Frame mit anderer Belichtung unerkannt (+0.12–0.19 %). |
| C9 | MED | `<6σ`-Kurzseiten-Trigger unvollständig (1.17× bei exakt 6σ); explizite σ-Rects umgehen ihn ganz. |
| C10 | MED | API: `background.rects` ohne `backgroundSigmaRects` → σ_B vom ROI-Rim trotz sauberer Ebenen-Referenzen (UI koppelt korrekt, API nicht). |
| C11 | LOW/MED | Doku-Drift Dezil-Anker (theory §Hintergrund vs. Code-Anker); 1e8-Float-Anker-Randfall; UI-Dark-Lane akzeptiert nur float32 (uint16-Kamera-Darks in der UI unbrauchbar); Leverage nur auf ungewichtetem Design. |

Positiv-Befunde des Laufs: keine Doppel-Subtraktion (Fit-B semantisch korrekt über der Primär-Korrektur); Negativwerte nach Subtraktion werden korrekt behalten (signed moments, `background_dominated`-Gate statt stiller Rektifikation).

---

## 3. Verifikations-Setup (läuft)

Drei parallele read-only Verifikations-Sessions (Cross-Kanal: Claude Opus gegen Codex-Findings), je mit numerischen Repro-Pflichten und Verdikt-Vokabular **CONFIRMED-AS-STATED / CONFIRMED-BUT-DOCUMENTED-LIMIT (mit Zitat) / PARTIAL / REFUTED**, plus v2.0-Blocking-Urteil pro bestätigtem Punkt:

| Session | Prüfliste | Scratch-Trail |
|---|---|---|
| Verifikator 1 | F1–F8 | `scratchpad/opus-codex-verify/` |
| Verifikator 2 | V1–V6 (mit Kontext: 6σ-Padding war als v1.2 bekannt; Wedge-Arm 3 aus Spec §11; 0.134 % Trunkierung gate-budgetiert; Wing-Grenze §12 dokumentiert) | `scratchpad/opus-codex-verify2/` |
| Verifikator 3 | C1–C11 (F1/F2-Deckung nur notieren, nicht doppelt prüfen) | `scratchpad/opus-codex-verify3/` |

---

## 4. Betreiber-Entscheid (2026-08-20)

1. **Release wird v2.0 statt v1.1** — Scope-Wachstum anerkannt.
2. **Hintergrund-Rechteck-Bedienung nachziehen** (Befund Betreiber-Labortest: bgRects nicht im Overlay sichtbar, nicht drag-bar; Drag bedient immer das Mess-ROI): sichtbare Overlay-Darstellung in eigener Farbe + Legendeneintrag + Export, plus Zeichen-Modus-Umschalter Mess-ROI/Hintergrund-Rechteck mit vorhandener Move/Resize-Griff-Kette.
3. **Bestätigte Codex-Einwände werden gefixt** (nach Verifikations-Verdikten, nicht nach Roh-Findings).
4. **Vor den Fixes: Plan-Session (Opus, Plan-Mode)** über die bestätigten größeren Baustellen → Stufenplan nach Doku-Disziplin (Plan-Doc mit Revisions-Trail).

## 5. Nächste Schritte

1. Drei Verifikations-Verdikte einsammeln → §2-Tabellen um Verdikt-Spalte ergänzen (dieses Doc, Revisions-Sektion).
2. Konsolidierte Baustellen-Liste → Opus-Plan-Session (Plan-Mode) → `Plan/S20_V2_HARDENING_PLAN.md` (v1, dann Review-Trail nach Skill-Konvention).
3. Fix-Delegationen nach Plan (Kanäle nach Betreiber-Regeln: Engine-Physik verifiziert via Opus/Grok-Kreuz, UI via Grok/Opus-Kreuz mit Gemini-Konvergenz-Ebene).
4. Versions-Artefakte 1.1.0 → 2.0.0 (package.json, JSON-LD, Pills, Doku) als eigenes Arbeitspaket am Ende.

---

## 6. Verifikations-Verdikte Runde 1 — F1–F8 (v2, verbindlich über §2.1)

**Verifikator 1 abgeschlossen** (Kreuz-Kanal Opus, 66 Tool-Läufe, numerische Repros in `scratchpad/opus-codex-verify/`; Repo unberührt). Wo diese Sektion §2.1 widerspricht, gilt diese Sektion.

| # | Verdikt | Schlimmster gemessener Released-Fehler | Fängt es etwas? | v2.0-blocking |
|---|---|---|---|---|
| F8 | **CONFIRMED, Severity war UNTERTRIEBEN** | **+53.7 %** released (tote Spalte ±10 px); **+5.9 % bei nur 3.4 %** toten In-Ellipse-Pixeln (CMOS-Bad-Column) | nur `IMAGE_FLOAT_SPECIALS`, dessen Text fälschlich beruhigt („werden ignoriert"); Alpha-Gate strukturell blind (beide Aperturen identisch korrumpiert) | **JA** |
| F4 | **CONFIRMED-AS-STATED** (Code-Entscheid dokumentiert Spec §11.4, Konsequenz nicht) | Breite nur −0.2 %, aber **Verdikt-Flip** SUPPRESSED↔RELEASED zwischen B=0 und B=1000; Default-Pfad (`bgMethod:"none"`) | `IMAGE_PEDESTAL_HINT:info`, teils `ABSORBED_POWER`; nie `IMAGE_MULTI_PEAK` | Grenzfall — **Fix empfohlen** (Einzeiler: Floor auf Stage-B-Peak `peakCorr − backgroundCounts`) |
| F2 | **PARTIAL** | Breite ok (≤0.12 %), aber **exportierter d4Scatter 9.6–191× zu klein** unter Shot-Noise → **falsifiziert `docs/theory/image_analysis.md:166`** („≤2× exported scatter auf 96 %") | Residual-2σ_B-Arm nur nahe Peak≈300; 0.005·peakCorr-Arm blendet darüber | nein — aber **Doku-Zeile 166 MUSS vor Release korrigiert werden** (bzw. Gain-Term v2.0-Option) |
| F7 | **CONFIRMED-AS-STATED** | released physical θ=0.5439 rad ist reines Eigen-Rauschen (q_phys=2e-5 vs. q_px=0.600, Pitch 2/4) | nichts | nein (braucht aniso Pitch); kleiner Fix |
| F6 | **CONFIRMED-AS-STATED** | Achsen-Swap 55×60 µm → 30×110 µm (Orientation 6/8 + Pitch 5/10); Werte 1–9 dekodieren identisch | nichts | nein; Einzeiler (Tag 274 → Fehler) |
| F5 | **CONFIRMED-AS-STATED** | kein falscher Release (`nonpositive_amplitude` 100 %), aber **alle Diagnostik-Anzeigen invertiert** + opaker Suppression-Grund; widerspricht `theory:14`-Policy | nur Suppression | nein; „billigster Honesty-Fix" |
| F3 | **PARTIAL** (Mechanismus doppelt fehlattribuiert: Discard-Prädikat ist `indefinite_covariance` moments.ts:202, nicht Background-Dominanz; dominanter Treiber ist observed-side Null-Delta-fail-closed 92/116) | keiner — **38.7 % False-SUPPRESSION** bei nValid=39/64 (A=5) | fail-closed deckt nValid<32 (A≤3: 100 %) | nein (Yield-Verlust, kein stiller Fehler) |
| F1 | **PARTIAL** (Code-Fakt bestätigt: `converged` wird nirgends gelesen; Konsequenz widerlegt) | **+0.14 %** max über 27 released non-converged Fälle (Fit-B absorbiert Ebenenfehler; konvergierte Ebenen waren schlechter: −0.57 %); Restrisiko: σ_B-Inflation 1.03→87.8 macht Gates permissiv | 6 fremde Warnungen, keine nennt die Ebene | nein; Fix: `IMAGE_BACKGROUND_*`-Warncode verdrahten |

Zusatz-Befunde der Verifikation: (a) `docs/theory/image_analysis.md:42` („Cap praktisch unerreichbar") ist widerlegt — bimodaler Rim erreicht iterations=50; (b) Rückmeldung an den Reviewer: F3-Mechanismus-Korrektur und F8-Szenario-Korrektur (zufällige tote Pixel benign, **strukturierte Masken** sind der Blocker — erreichbar via float32-NaN-TIFF und Dark-Frame-Subtraktion, die NaN by design erzeugt).

---

## 7. Verifikations-Verdikte Runde 2 — ROI-Kette V1–V6 (v3, verbindlich über §2.2)

**Verifikator 2 abgeschlossen** (83 Tool-Läufe, Repros in `scratchpad/opus-codex-verify2/`; instrumentierte fit.ts-Kopie 41 Zeilen add / 0 removed, gegen Shipped-Modul kreuzgeprüft).

| # | Item | Verdikt | Kernzahl | v2.0-blocking |
|---|---|---|---|---|
| V6b | Wing-Detektor erblindet mit engem ROI | **CONFIRMED (neuer Winkel auf dokumentierte Grenze)** | §11.1-Wing-Szene: ROI 512→Probe 12, Excess 1.73 % → Warnungen feuern; **ROI 100 → 0 Warnungen, released d4 31.99 vs. Wahrheit 54.97 (−41.6 %)**; der App-eigene ROI-aus-Fit ergibt für diesen Strahl ROI 120 — einen Schritt vor totaler Stille | **JA** |
| V5a-Cap | Alpha-MC-Schwelle ungecappt + Ehrlichkeits-Instrumente rausch-blind | **CONFIRMED** | Schwelle bis **159 % (minor)**; Halo-Szene σ_B=100: Schwelle 22.29 % vs. Delta 6.33 % → **released −40.1 %**, Tier-Gap 147.5 % feuert nicht; Rim-Loop selbst konvergiert (kein Runaway) | **JA** (Cap-Teil) |
| V1 | suggestRoi kann 6σ-Ellipse nicht fassen | **CONFIRMED** (Mechanismus war v1.2-bekannt; Deterministik neu) | 15/15 Szenen `aperture_clipped`; Closed-Form: braucht A/σ_B ≥ 3.0e6 bei σ=10 px; **stabiler Fixpunkt** (Re-Apply reproduziert sich selbst); Ein-Klick-Recovery via ROI-aus-Fit existiert | nein — schwerster Flow-Defekt (Standard-CTA → deterministische Sackgasse) |
| V5b | Hot-Pixel kippt Residual- UND Multi-Peak-Gate | **CONFIRMED** | Ceiling exakt 50.0 bei Hot=10 000; kleinster Kipp-Wert **4 500 Counts** auf 1 000er-Peak; still unter Hot-Fraktion 1e-4 | nein (Zweit-Gate fing jeden Messfall) — HIGH |
| V5c | Kein Coverage-Minimum (Non-Finite) | **CONFIRMED** | Release aus 250/5007 finiten Apertur-Pixeln; NaN-Annulus 1.5–2.5σ → **−17.37 % released**; FLOAT_SPECIALS feuert, trägt aber keine Coverage-Zahl | nein formal (Warnung existiert) — HIGH, mit F8 zu einem Fix zu verschmelzen |
| V3 | ROI-aus-Fit ohne Guard | **CONFIRMED (alle 4 Sub-Claims)** | Pure-Noise: converged mit A=−1640, Zentrum (−7309, 2000) → applied 1×128-Rect (2/40 Frames); Full-Frame-Modus umgeht Klammer; Prädikat `fitGeometryIsReleasable` existiert und wird nur nicht konsultiert | nein — Zwei-Zeilen-Fix |
| V6c | Achsen-Warnungen brauchen released Wert | Warn-Gating **CONFIRMED** / Instabilität **REFUTED** | suppressed Frame zeigt fitWidths 36.01×2.80 px (σ_minor 0.70!) ohne beide Warnungen; Alpha-Deltas 0.13–2.17 % gegen Schwellen 3.0–4.7 % = stabil | nein |
| V6a | Komponenten-Tie Scan-Order | **CONFIRMED** | 1e-9 Counts verschieben Vorschlag um 72 px | nein (Determinismus/UX) |
| V5e | Super-Gauß-Sheppard ignoriert n | **CONFIRMED, diagnostic-only bestätigt** | 0.009/0.051/0.204 % bei n=1.5/2/4 (b=2) | nein |
| V4 | Wedge-Arm 1 ohne Schritt-Test | **PARTIAL** (Semantik ✓, Erreichbarkeit ✗) | 618 Szenen, 24 Arm-1-Wedges, max relParam 1.04e-4 vs. 1.56e-2 nötig; Bedingungen antagonistisch | nein (freier Guard trotzdem sinnvoll) |
| V2 | Kumulative Schrumpfspirale | **PARTIAL** (kein Anker ✓, Spirale ✗) | Fixpunkte nach 1–3 Schritten (Ratios 0.9266→0.9615→1.000); Ring-Fallback: Fit meldet max_iterations → Knopf verschwindet | nein |
| V5a-Loop | Rim-σ_B-Feedback | **PARTIAL** (Feedback ✓ bis 61.7×, Runaway ✗) | Loop konvergiert in 2 Schritten; Warn-Arme feuern erst ab 50×50 (bei 60×60 schon 7.2× still) | nein |
| V5d | Partial-Block-Pooling | **PARTIAL** (Mechanismus ✓, Effekt 0.0004 %; „diagnostic-only"-Rahmung falsch — speist Release-Geometrie) | — | nein |

## 8. Verifikations-Verdikte Runde 3 — Hintergrund C1–C11 (v3, verbindlich über §2.3)

**Verifikator 3 abgeschlossen** (50 Tool-Läufe, Repros in `scratchpad/opus-codex-verify3/`).

| # | Item | Verdikt | Kernzahl | v2.0-blocking |
|---|---|---|---|---|
| C11b | UI-Dark-Lane nur float32 | **CONFIRMED** | decode liefert für 16-bit-TIFF immer "uint16", main.ts:1848 verlangt "float32" → **normales uint16-Kamera-Paar kann die Dark-Lane NIE nutzen**; Fehlermeldung fehlattribuiert | **JA** (still kaputte Lane) |
| C6 | Stage B repariert Rest-Rampe nie | **CONFIRMED-BUT-BOUNDED** | tiltedBackground existiert, einziger Produktions-Callsite nutzt ihn nicht; max released Bias 0.49 %, Centroid +0.57 px; **schärfster Fund: TIER_DISAGREEMENT feuert bei Slope 1.0–1.5 und verstummt bei 2.0–5.0** (Stage A wird invalid → Plausibilitäts-Prädikat schaltet Tier-Check ab) | nein — Blind-Spot-Fix empfohlen |
| C2 | Ebenen-Fit deflationiert σ_B | **CONFIRMED** | 3 DoF auf eigenen Referenz-Pixeln: 2×2 → **−41.1 %**; 4×2×2-Ecken (realistisch) → **−24.5 %**; kein Mindest-n-Guard über n≥3; Richtung: Gates werden STRENGER, aber peakToBackgroundNoise/d4Scatter 1.7× zu optimistisch exportiert | nein |
| C5 | Falsche Methode → Struktur wird Rauschen → released | **PARTIAL** (Mechanismus exakt, Breiten-Schaden widerlegt) | σ_B=332.10 auf rauschfreiem Fixture, Gates 4.2× relaxed, released 13.9840×9.9882 — aber Bias nur −0.11 % (= reine 4σ-Trunkierung; lineare Rampe trägt nichts zum zentralen 2. Moment bei); **still falsch ist der Centroid (+0.161 px) + peakToBackgroundNoise 58.4 auf rauschfreiem Bild; Ehrlichkeits-Inversion: korrekte Methode warnt, falsche nicht** | nein |
| C11a | Doku-Drift Anker + 1e8-Randfall | **CONFIRMED (beide)** | theory:42 nennt Dezil-Anker, Code nutzt IQR+\|median\| (Oracle M4 pinnt 1700×-Verbesserung); huberDelta 134.5 bei Level 1e8 (≈17 ULP, vertretbar); **Bonus-Drift: guide:29–38 „not yet a control" ist stale — alle drei Features sind verdrahtet** | nein (Doku-Pflicht) |
| C11c | Leverage nur ungewichtet | **CONFIRMED (statisch)**; gewichteter Fall nicht schädlich konstruierbar | Benachbartes Loch: 35/36-Kontamination eines Referenz-Blocks → konvergierte Ebene bx=320 counts/px auf flachem Feld, kein Guard | nein — Between-Rect-Konsistenz-Check skizziert |
| C3 | 1×1-rect-median | **CONFIRMED-BUT-WARNED** | Offset 1000 → Bild −900; aber σ_B→0 → NOISE_SCALE_SUSPECT(warning) + Suppression residual_high im Voll-Repro | nein |
| C4 | Floor-Kollaps n≤2 | **CONFIRMED + schärfer** | n=2: Floor exakt 0; **[100,140] → σ=29.65 „mad" aus zwei Pixeln ohne jede Warnung** | nein |
| C9 | <6σ-Trigger + Bypass | **CONFIRMED-BUT-MOOT** | Clipping-Gate erzwingt min(ROI) ≥ 12σ_min+1 = 2× Trigger → **auf released Frames unerreichbar** (336 Geometrien: 0 Ko-Okkurrenz); Rim-Median-Arm erreichbar, aber bei Pedestal Fehldiagnose | nein — Re-Anker oder streichen |
| C1 | Smooth-Tail-Bias Ecken-Referenzen | **PARTIAL** (Zahlen exakt reproduziert, Impact widerlegt) | Release-Regime endet bei σ≈11.5 px (Clipping-Gate); im gesamten releasenden Bereich Bias ≤1e-16 Counts | nein |
| C10 | API-Entkopplung rects/sigmaRects | **CONFIRMED (low)** | 1.9× σ_B-Swing konstruierbar, kein released-Zahlen-Unterschied baubar; UI koppelt korrekt | nein — API-Einzeiler |
| C11d | Zwei noise-Objekte | **CONFIRMED, kosmetisch** | Sigmas bit-identisch; nur median/mean differieren; Downstream liest top-level | nein |
| C8a | Blob ohne Laser released | **PARTIAL — fundamentale Ein-Frame-Grenze** | 11.9831×7.9861 exakt reproduziert; NOISE_SCALE_SUSPECT(warning) feuert | nein |
| C8b | Rects auf Ausläufern → Bias | **PARTIAL** (Disable-Logik ✓, Bias REFUTED — bit-identisch zu sauber; Stage-B B_eff=0 cancelt flache Über-Subtraktion exakt) | σ_B zerstört (0→929), nur Info-Warnungen | nein |
| C8c | Dark falsche Belichtung | **REFUTET** | ≤0.02 pp; TIER_DISAGREEMENT(warning) feuert dediziert bei Scale 0.75/0.25; 0.50 → suppressed | nein |
| C7 | MC-σ/b ignoriert Common-Mode | **REFUTET** (Prämisse leer: MAD shift-invariant; für korrelierte FPN ist σ/b zu KLEIN → Gate über-streng, Gegenrichtung) | — | nein |

### Querbefunde beider Verifikatoren (planungsrelevant)

1. **Strukturmuster hinter allen drei Release-Blockern: „Die Ehrlichkeits-Instrumente sind am leisesten auf den schlimmsten Inputs."** Tier-Check schaltet sich ab, wenn Stage A invalid wird (C6); Wing-Detektor verliert seine empfindlichen Proben genau bei den ROIs, zu denen die App selbst steuert (V6b); Alpha-Schwelle öffnet sich mit σ_B (V5a); FLOAT_SPECIALS beruhigt bei strukturierten Masken (F8/V5c).
2. **Stage-B-Design (B_eff=0, Fit-eigener Untergrund) absorbiert flache/lineare Untergrundfehler erster Ordnung** — vier von fünf „released wrong width"-Kandidaten kollabieren auf ≤0.5 %. Die reale Exposition liegt bei **Centroid** und **exportiertem Noise-/Uncertainty-Block**, nicht bei der Schlagzeilen-Breite.

## 9. Konsolidierte Baustellen-Liste (Grundlage der Plan-Session)

**P0 — Release-Blocker (still falsche released Zahl / still kaputte Lane):**
1. Coverage-Gate Non-Finite in der Mess-Apertur (F8 + V5c vereint; strukturierte Masken bis +53.7 % released; FLOAT_SPECIALS-Text korrigieren).
2. Instrumenten-Degradation sichtbar machen: Wing-Proben-Verlust (V6b) + Alpha-Schwellen-Cap mit fail-closed (V5a) + Tier-Check-Überleben bei invalider Stage A (C6-Blindspot) — ein zusammenhängender „Honesty-Floor"-Block.
3. UI-Dark-Lane uint16→float32-Konvertierung (C11b).

**P1 — Empfohlene Fixes:** F4-Floor auf Stage-B-Peak (Einzeiler, Default-Pfad-Verdikt-Flip); V5b robuster peakCorr; V3-Guard ROI-aus-Fit (Prädikat existiert); V1 suggestRoi-σ-abgeleitetes Padding (Formel in §7); C2 √(n/(n−3))+Mindest-n; C5-Gradient-in-Referenz-Warnung; F1-converged-Warncode; F5 WhiteIsZero-Error; F6 Orientation-Error; F7 q physisch; C3/C4 Mindest-Referenz-Samples + n=2-Klemme; V6c-Warn-Fallback; C9-Trigger-Re-Anker; C10-API-Default; F3-Discard-Politik (Yield); V6a-Tie-Break; V4-relParam-Guard (frei).

**P2 — Doku-Pflichten:** theory:166 (Scatter-Claim, falsifiziert für Shot-Noise) + Rauschmodell-Scope; theory:42 (Anker-Drift + „unreachable"-Aussage widerlegt); guide:29–38 stale; §12-Ergänzung Instrumenten-Verlustzonen; C9/C11a-Randnotizen.

**P3 — Scope v2.0:** Hintergrund-Rechtecke Overlay+Drag (Betreiber-Labortest §4); Version 1.1.0→2.0.0 (package.json, JSON-LD, Pills, Checkliste).

**Explizit NICHT fixen (refuted/negligible/fundamental):** C7, C8b-Bias, C8c, V2-Spirale (optional Baseline-Anker), C1-Impact, V5d-Effekt, C8a (optional UI-Hinweis), V6c-Instabilität, F1-Breiten-Konsequenz. **v2.1-Kandidat:** Gain-Term/Poisson-MC (F2) — für v2.0 nur Doku.

**Doc-Version:** 3.0, 2026-08-20. Status: Verifikation 3/3 abgeschlossen; Plan-Session (Opus, Plan-Mode) startet auf §9; Fix-Delegationen folgen dem Plan.

# S20 — Implementierungs-Trail (v2.0 Hardening)

**Datum:** 2026-08-23 (fortlaufend).
**Status:** in Umsetzung nach `Plan/S20_V2_HARDENING_PLAN.md` (PLAN-v3, §7/§8 bindend).
**Konvention:** eine Sektion je Stufe — Status, Kernergebnis, In-Stufe-Entscheide, Kreuz-Check-Verdikte, Commit. X-Check-Regel für Opus-implementierte Stufen (Betreiber, 2026-08-23): erst Grok xhigh, danach eine unabhängige Runde Codex/Sol xhigh.

---

## Stufe 0a — S18-Baseline-Commit

**Status: abgeschlossen, `9db4fbd` (main, privates Dev-Repo).** 87 Dateien, +28 842/−89; ausgeschlossen: 7 Orchestrierung-Memos, 2 transiente Root-Skripte, test-results/, generierte E2E-.tif (.gitignore erweitert). Gates vor Commit: 445/445 + Wortlaut-Gate. Betreiber-Mandat: privates Repo als Zwischenspeicher; Public-Clone unberührt.

## Stufe 0b — Repro-Orakel-Korpus + SNR-50/30-Zellen

**Status: abgeschlossen, `a38b8d7`.** 34 deterministische Orakel in `tests/repro-s20/` (9 Dateien + lib), `npm run verify:s20repros` (bewusst außerhalb des npm-test-Globs), zweifach bit-identisch. Kurven-Zellen SNR 50/30 gemessen (je **15/15**, über den Doku-Werten 14/13; Schwellen-Bänder für §13 notiert: SNR 50 thrMaj 5.566–6.235, SNR 30 thrMaj 9.434–10.356). **Offene Notiz für Stufe I:** über 8 Seed-Basen streuen die Zellen 13–15/15 — Entscheid, ob die Doku-Kurve ein Band statt Punktwerte trägt. Quell-Skripte neutral portiert (Vertraulichkeits-Sweep leer); Reduktionen je Datei im HOLD-Report dokumentiert.

## Stufe D1 — TIFF-Tag-Semantik (F5/F6)

**Status: abgeschlossen, `1ea5898`.** WhiteIsZero (photometric 0) und Orientation ≠ 1 (Tag 274, typ-/count-validiert) blocken jetzt mit präzisen Meldungen; photometric 1 / fehlender Tag byte-identisch. Stop-and-Report-Vorprüfung: kein Repo-Fixture betroffen (Binär-IFDs gedumpt). 6 additive Tests mit fail-before-Beweis. **Doku-Notiz für Stufe J:** `docs/theory/image_analysis.md:14`-Blockliste um beide Blocks erweitern; count-Validierung der übrigen Skalar-Tags als Backlog-Kandidat.

## Stufe D2 — LM-Wedge-Guard (V4)

**Status: abgeschlossen, `e5e3b0a`.** Arm 1 des Wedge-Exits verlangt zusätzlich letzten akzeptierten relativen Parameterschritt ≤ 1e-3 (`WEDGE_PARAM_REL_TOLERANCE`; Kalibrierung: 10× über Korpus-Max 1.04e-4, 15× unter 1.56e-2). **Plan-Korrektur (für §13): der V4-„Erreichbarkeit widerlegt"-Verdikt war falsch** — die Klasse gesättigter/geclippter Plateaus fehlte im 618-Szenen-Sweep. Repro: 128×128, σ 22, Clip bei 300 Counts (22.4 % des Frames), letzter akzeptierter Schritt 1.982e-2 (190× Korpus-Max), zertifizierte mit Residuen-RMS > 10 % der Datenspanne und gefittetem Untergrund −69.6 auf Floor-0-Daten; jetzt ehrlich nicht zertifiziert (Parameter bit-identisch, nur der Verdikt ändert sich). Sonst 0 Verhaltensänderung: 86-Szenen-Digest unverändert, unabhängiger 2724-Fälle-Pre/Post-Sweep 0 Differenzen, S18-R2-F3-Orakel grün.

## Stufe A — Coverage-Gate für nicht-finite Pixel (F8+V5c)

**Status: abgeschlossen, `5d355a6`.** Fünftes Freigabe-Gate: bei nicht-finiten Pixeln in der Mess-Apertur wird das gefittete Strahlmodell (Beam-Term only, R-29 direkt verifiziert: Background-inklusive hätte bis 42 % unterschätzt) mit und ohne beobachtete Maske momentiert; die Differenz ist der induzierte Fehler (auf adversarialen Zeilen Ratio 0.999–1.035 zur echten Released-Abweichung). Strukturierte Masken (+5.9 % bis +53.7 % vorher released) supprimieren als `coverage_insufficient`; finiteFraction-Arm (Floor 0.2) fängt Sparse-Frames (250/5007); INFO-Band (1.0, 2.0]. FLOAT_SPECIALS-Text entschärft. Saubere Frames bit-identisch (I-3: 0/111-No-Entry, alle vier Kurven-Zellen 0/15-Entry, unverändert 15/15). Laufzeit-Pin: +10–11 % nur auf Masken-Frames, Budget 2500 ms gepinnt.

**In-Stufe-Architekten-Entscheid (Stop-and-Report §1 der Stufe, entschieden vom Architekten, Option a):** Die R-54-Prämisse „zufällige Masken bis 50 % benign" galt nur für die Low-Discrepancy-**Gitter**-Maske der F8-Szene. Echte iid-Masken auf marginalen Geometrien (σ_minor 1.5) erzeugen bis 12 % **echten** Fehler — 93.7 % der über dem Ceiling geflaggten Frames sind per eigener Breiten-Messung bestätigt > 2 % falsch; der Schätzer ist korrekt, die Prämisse war falsch. Ceiling `COVERAGE_BIAS_MAX_PERCENT = 2.0` = geometrisches Mittel der Mess-Lücke (2.95× über größter Pflicht-Release-Zeile, 2.89× unter kleinster Pflicht-Suppress-Zeile). Der „Yield-Verlust" (3–4 %) trifft ausschließlich nachweislich korrumpierte Frames — das ist der Gate-Zweck. Kampagne: 1920 maskierte Frames über 32 Szenen; alle Tabellen im Stufen-HOLD-Report; iid-vs-Lattice-Korrektur wandert nach §13.

## Kreuz-Check A+D1+D2 (zweistufig)

| Runde | Kanal | Scope | Verdikt |
|---|---|---|---|
| 1a | Grok 4.6 xhigh (cursor-agent) | D1+D2-Diff | **PASS, 0 Findings** (Attack-Trace; 86er-Digest live bestätigt; Clipped-Plateau-Orakel als load-bearing verifiziert) |
| 1b | Grok 4.6 xhigh | Stufe-A-Engine-Kern | **PASS, 0 Findings** (Trigger-Disziplin, Estimator-Mathe, Präzedenz, Fallback-Spiegel, Grenzwert-Semantik je file:line) |
| 1c | Grok 4.6 xhigh | Stufe-A-Peripherie + Pins | **PASS, 0 Findings** (Warn-Texte, i18n beide Sprachen, eine additive Map-Zeile, Margins 2.51×/2.95×, keine Knife-Edges; analyze 45/45 live) |
| 2 | Codex gpt-5.6-sol xhigh (unabhängig, ohne Runde-1-Ergebnisse) | Gesamt-Diff | **PASS, 0 Findings** (198/198 über acht Einzeldateien; eigene Baseline-Rekomputation des Plateau-Falls; Cross-Stage-Interferenz verneint) |

Betriebs-Lehre: cursor-agent-Läufe mit `git diff` im Prompt hängen am Pager (2× 10-min-Timeout, 0 Bytes) → `git config core.pager cat` gesetzt, Prompts nutzen `git --no-pager`.

**Gesamt-Abnahme vor den Commits:** 462/462 Unit, 34/34 Repros, beide Typechecks, Wortlaut-Gate, verify:headless/cases 60/60; Referenz-Artefakte byte-identisch.

---

## Stufe B — Honesty-Floor (V5a/V6b/C6)

**Status: abgeschlossen, `e661b68`.** Drei additive INFO-Instrumente, null Gate-Drift (alle Suppressions/Kurven bit-identisch): `IMAGE_ALPHA_GATE_WEAK` (>10 %-Ceiling auf released Frames; **40/74** auf dem kanonischen Korpus, ausschließlich Low-SNR, wo die Ceilings real 11.9–530 % sind), `IMAGE_WING_PROBE_REDUCED` + exportierte Sondenreichweite mit Floor-Absenkung 0.003→0.0005 (**0/74** kanonisch + 0/104 + 0/192 noise-free; engste Zeile 0.611 ihres eigenen Ceilings, Oracle-Bound < 0.7; eine frühere 4.3×-Headroom-Angabe hatte kein lauffähiges Backing und wurde in §13 durch die gepinnten Zahlen ersetzt), `IMAGE_TIER_CHECK_UNAVAILABLE` mit getypter Grund-Union (drei Zweige; centroid_outside auf released Frames über 180 Konfigurationen unerreichbar — dokumentiert). Kanonischer 74/111-Korpus rekonstruiert (Amplitude als einzige gefittete Größe über den dokumentierten Release-Split; Provenance-Block mit drei ehrlichen Residuen) und als `tests/repro-s20/s20-clean-reference-set.test.ts` gepinnt. **Incident offengelegt und folgenlos verifiziert** (Worktree-Cleanup folgte einer node_modules-Junction; byte-identisch recovered, package-lock unverändert). **Architekten-Adjudikation des 20×12-Flags:** Das Stop-and-Report-Band (7.42–7.91 %) war amplitudenspezifisch; auf dem kanonischen Amplitude-20-Korpus erreicht ein Seed 11.383 % und die INFO feuert 1/8 — dort ist ihre Aussage wahr (Ceiling > 10), kein Kalibrierfehler; §13 dokumentiert die Amplituden-Abhängigkeit.

## Stufe C — UI-Dark-Lane uint16 (C11b)

**Status: abgeschlossen, `abb0de5`.** uint16-Kamera-Paare laufen jetzt durch (decoded-dtype-Gleichheits-Guard statt float32-only; gemeinsamer Cast-Helper `image-pixels.ts`, Paritäts-Orakel gegen Array.from oberhalb 2²⁴); `darkError` als getypte Union mit Decoder-Detail und tatsächlichen Werten in beiden Sprachen; Fehlerpfade deaktivieren jeden angewendeten Dark; Lifecycle (Neu-Load/Fehl-Load/dtype-Redecode) räumt auf; Generation-Guard gegen Out-of-order. E2E führt die Analyse aus und belegt den none-vs-dark-Unterschied (Pedestal-Fixture). Kette: Gemini R1 6 Kandidaten → Fixbatch (5 fixed/1 refuted) → Gemini R2 CLEAN → Opus-Mess-Check (Kern-PASS, 4 MED/5 LOW) → Terra-Fixrunde F1–F8 → Terra-Recheck.

## Kreuz-Check-Verdikte B+C (Nacharbeiten-Runde)

| Prüfung | Kanal | Verdikt |
|---|---|---|
| B gesamt | Terra xhigh (als gpt-5.6-sol gelaufen — Kanal-Fehlmapping des Architekten, ab jetzt gpt-5.6-terra) | NEEDS-FIXES → S20B-01 (kanonischer Korpus) nachgemessen: N=40/74, X=0/74, Floor bleibt |
| C gesamt | Opus (gemessen) | Kern-PASS; F1–F8 → Terra-Fixrunde, alle acht umgesetzt |
| Nacharbeiten beider | Terra xhigh (gpt-5.6-terra) | NEEDS-FIXES mit 3 Punkten; Adjudikation: R1-01 refuted (Key war verifiziert tot, „additiv-only"-Prompt zu pauschal), R2-02 refuted (Floor-Wechsel ist der sanktionierte B-Kern; HEAD-Diff trennt Haupt-B/Addendum nicht), R2-01 angenommen → dritte Provenance-Grenze ergänzt (deklarierter Handgriff) |

**Lane-Notiz (F9/R-50):** Der C-Edit an `views/image.ts` war strukturell — formale Spannung zur R-50-Regel, folgenlos (A/B berührten die Datei nicht strukturell, G noch nicht gestartet); hiermit im Closeout notiert.

---

## Stufe D3 — suggestRoi σ-abgeleitetes Padding (V1)

**Status: abgeschlossen, `1db3c80`.** Achsweise Gauß-Inversion mit robustem Komponenten-Peak (finite-only 3×3-Median über der Komponente — verschweißte Hot-Pixel können das Padding nicht mehr schrumpfen) + Masken-Extent-Floor **β=2.0** (in-Stufe kalibriert; Plan-Kandidat 0.5 messbasiert widerlegt: bedient Super-Gauß n=2/4 und realistische Flat-Tops; Ring bleibt dokumentierte Grenze — sein Fit-σ ist Modellartefakt). Sackgassen aufgelöst: 15/15 `aperture_clipped` → 0/15; σ3 released ab Dynamik 100 (vorher 1500+), σ10 ab 1e3 (vorher 1e7); der Suggestion-Fixpunkt ist jetzt releasend. Overflow-Politik explizit (vierbeiniges Exakt-Orakel inkl. Skalenfreiheits-Beleg bei 1e307); `paddingX/YPx`+`sigmaEst*` additiv exportiert; `clampedToImage` überall asserted. **Adjudikationen:** σ3@3000-d4-Bewegung 11.989→11.991 = reine Mess-Rechteck-Relokation Richtung 4σ=12.000 (Advisory-Purity bewiesen — bei fixem ROI alles bit-identisch); entdeckte Fit-Fragilität (`singular_normal_equations` auf 51×51 mit perfekten Params, D3-unabhängig reproduziert) → Backlog + §13. Terra-Check: 2 LOW → Delta gelandet; Kern-Angriffe (Handrechnung, Robust-Peak, Guards, Advisory-Purity, R-24) bestanden.

## Stufe G — Hintergrund-Rechtecke sichtbar + Zeichenmodus (P3)

**Status: abgeschlossen, `78f8b84`.** Violette bgRects über den Zwei-Pass-Recorder (über dem ROI-Rahmen gemalt; Legende wählt die am wenigsten belegte Ecke), Legendeneintrag + PNG-Byte-Spiegel; Zeichenmodus-Umschalter treibt die vorhandene Drag-Kette (Create/Select/Move/Edge-Corner-Resize/Topmost-Präzedenz/Removal mit geklemmtem Active-Index); Zeichenmodus erzwingt Vollbild (Preview-Segment ehrlich disabled) und jeder Exit-Pfad restauriert die vorherige Ansicht mit Nutzer-Vorrang; Suggestion-Handler/Methoden-Fallbacks resetten das Ziel; JSON-Export trägt die Rechtecke via expliziten Kontext. **Prüfkette:** Gemini R1 4 Lifecycle-Funde → Fixrunde (Reducer) → Gemini R2 CLEAN → Opus-Mess-Check: Mechanik/Lifecycle/Export/ROI-Regression PASS mit **byte-identischem A/B-Vergleich gegen einen pre-G-Build**, aber Sichtbarkeits-FAIL im Default-Zustand (TL-Rect 0 Pixel: Stroke-Reihenfolge + Legenden-Überdeckung; geliefertes E2E-Orakel strukturell blind) → Terra-Fixrunde G1–G7+G9 → **Opus-Delta-Recheck: alle Items CLOSED** (vier Ecken pur-violett an drei Viewports, PNG-Spiegel; gehärtetes per-Rect-Kantenband-Orakel fängt Reintroduktion). Nicht-blockierendes Residual notiert: Bei der Vier-Ecken-Vorlage ist keine Ecke leer — die relozierte Legende überlappt ~57 % des BR-Kantenbands (jedes Rect behält satte Pure-Purple-Pixel) → Backlog-Kandidat „Legende außerhalb des Canvas". G8 (Guide-Absatz) → Stufe J.

---

## Stufe E — Hintergrund-Statistik (C2/C3/C4/C5/C10)

**Status: abgeschlossen, `8ca4b15`.** c(n)=n/(n−2.4) empirisch kalibriert (ν_eff dekomponiert: 1.5 Ebene + 0.85 MAD-Finite-Sample + Huber-Rest; **der −24.5 %-Vier-Ecken-Anker als PRNG-Seed-Band-Artefakt des Repro-Generators entlarvt** — Erst-Draw sd 0.617; auf gemischten Ensembles ist der Layout-Term null; Anker mit Provenance gepinnt statt wegkalibriert, Generator bewusst unangetastet [0b-Ownership] → §13-Randnotiz). Referenz-Identität = **aufgelöste Pixel-Union** (ordnungs-/duplikations-/tiling-invariant; Subset/Superset bewusst unkorrigiert; Degenerate-Validierung vor jedem Shortcut inkl. Alias). EIN Mindest-n-Regime (Methode×n-Wahrheitstabelle (§13.4-Zählung: 12 rect-Zeilen + 3 rect-freie Methoden); 1×1-Hot-Referenz subtrahiert nie mehr −900). Gradienten-Warnung mit spezifizierter Statistik (K=10; 0/20 000 auf allen Negativkontrollen). API-σ-Parität. Kurven strukturell immun (verifiziert). **Checks:** Terra xhigh → 1 HIGH (ordnungssensitiver Referenz-Vergleich, 26.7 % verpasste Korrektur) → Pixel-Union-Fix → Delta-Recheck → Alias-Mikro-Fix. Adjudikationen: „zero"-Label ehrlich beibehalten (R-47-Wortlaut-Abweichung dokumentiert).

## Stufe F — Gate-Feinschliff (F4/V5b/F7 + geometryReleasable)

**Status: abgeschlossen, `45cab4b`.** Beide Ceilings referenzieren den Stage-B-Peak über einen σ-bewussten robusten Arm (Median nur bei gefitteter σ_minor ≥ 2.5 px — **zwischen zwei gemessenen Verdikt-Flips kalibriert**, Fenster (2, 3.04]; darunter deterministischer Modell-Peak; nie stiller Raw-Max). Offset-Leiter floor-invariant (98.90 überall, war 99.93–299.93; 0/5 Verdikt-Flips, war 3/5); Hot-Pixel-Leiter geheilt (Ceiling ~5.01 überall; der Release bei 100 000 Counts ist weg). Fit-Capture-Grenze dokumentiert **mit gepinntem lauffähigem Zeugen** (Spike fängt den LM, Ceiling ~3× inflationiert, Frame trotzdem suppressed — Spike-Sweep fand keinen defekt-getriebenen Release). F7 als reine Anisotropie-Korrektur belegt (Quadrat-Pitch bit-identisch); `orientationContrastQPhysical` exportiert. Kurve bit-identisch 15/15×4; Coverage-Fixtures unverändert. **Checks:** Terra xhigh → 1 LOW (falsches Zitat der Grenze) → Zeugen-Fix.

## Stufe H — ROI-aus-Fit-Guard (V3)

**Status: abgeschlossen, `71eded1`** (+ G-Nachtrag `c80a0c3` forced-Toggle-Styling, separat für Atomarität). Fit-Fallback verlangt `geometryReleasable === true`; Render und Klick teilen EIN Prädikat (`roiFromFitEligible`) — der Knopf ist auf unreleasable Frames **abwesend**, nicht inert (0/40 Rausch-Frames; archivierte Runaway-Szene derived nichts; VF-35 revert-diskriminierend bewiesen). Released-Zweig und Vollframe-Klammer byte-identisch (R-04-Addendum korrekt nicht implementiert); Repro-Port mit Frozen-State-Kommentar. **Checks:** Opus-Mess-Check PASS, 3 LOW (CSS-Nachtrag separat committet; Frozen-Kommentar ergänzt; prä-existierender Rank-1-Randfall [present-but-inert theoretisch, real unerreichbar] → §13-Randnotiz).

---

## Stufe I — Re-Baseline und Gate-Spec §13

**Status: abgeschlossen, `3ee810a`.** §13 (749 Zeilen) als Messrekord aller v2.0-Verhaltensänderungen an §12 angehängt: Vier-Zellen-Kurve (15/15 auf gepinnter Seed-Basis; Doku-Kurve jetzt ehrlich als Band 14–15/13–15 über Seed-Variation), coverage_insufficient-Kalibrierung inkl. iid-vs-Lattice-Korrektur, die drei Honesty-Codes mit kanonischen Zahlen und der 20×12-Flag-Adjudikation, c(n) mit ν_eff-Dekomposition und PRNG-Seed-Band-Befund, Ceiling-Ledger (Offset/Hot) mit Verdikt-Flip-Fenster, D1–D3-Rekord inkl. Wedge-Erreichbarkeits-KORREKTUR, sieben Residual-Notizen, Register der fortbestehenden Grenzen. **Beleg-Status-Konvention** eingeführt ([oracle]/[campaign]/[session record], 25 Marker) nach Stichproben-Audit — die ersetzten Headroom-Zahlen sind exakt belegt, die 4.3×-Altangabe entfällt. theory: Kurven-Band-Prosa + F7-Physik-Qualifier. **Checks:** Gemini-Konsistenz (2 Trail-seitige Abweichungen → hier korrigiert) + Terra-Stichproben-Audit (8 Zahlen zurückverfolgt, Kernzahlen alle bestätigt; 5 Beleg-Status-Punkte → Konvention). Wortlaut-Gate unabhängig re-gescannt.

## Stufe J — Doku-Konsolidierung

**Status: abgeschlossen, `ba21a1a`** (Manager-Handedit, deklariert; Gemini-Review mit strengem Format-Zwang → 5 Findings, alle gefixt: Gate-Liste um das fünfte Gate ergänzt, Guide-Bodies von der Zwei-Methoden-Falschaussage befreit + Zeichenmodus/coverage-Grund ergänzt [DE+EN], zwei Zahlen-Präzisierungen auf den §13-Rekord, ein Pronomen). theory: Decode-Blockliste + Warum-Satz (D1), Anker-/Cap-Ehrlichkeit + c(n)/Pixel-Union/Mindest-n/Gradienten-Warnung (E), Warn-Register inkl. Coverage-Gate und der drei Honesty-INFOs, Scatter-Claim auf das additive Rauschmodell gescoped mit offener Shot-Noise-Grenze (F2), Instrumenten-Verlustzonen-Absatz mit Register-Notizen (toter Compact-ROI-Arm, Rects-Bypass). guide: Scope-Note durch Shipped-Controls-Beschreibung ersetzt (G8).

## Stufe K — Version 2.0.0

**Status: abgeschlossen (Commit dieser Zeile = der K-Commit).** package.json + package-lock-Root (R-45), JSON-LD softwareVersion, Landing-/Workbench-Pills, Guide-Footer, CONVENTIONS-/theory-Release-Bezüge → 2.0.0; Sweep: 0 verbliebene v1.1-Release-Strings in Produktionsartefakten. Vollabnahme: 507/507 Unit, 60/60 Cases, Playwright 10/10, headless, Wortlaut-Gate.

---

## S21 — Automatik-Paket (Betreiber-Feature nach v2.0)

**Status: abgeschlossen (A+B, Commits dieser Landung).** Engine (A): `{method:"auto"}`-Hintergrund (einmalige Top-Auflösung auf robuste Ebene über engine-generierte 12-%-Ecken-Referenzen — danach wörtlich der manuelle Pfad, Guards per Konstruktion) + `roi:"auto"` (= Apply-and-Rerun in einem Lauf, Zwei-Stufen-σ-Semantik erhalten); additive Provenance (requested/resolvedMethod, resolvedRects, roi.source, autoFallbackReason), Abwesenheits-Regression über fünf gepinnte Vollobjekt-Digests, Auto==Manuell-Gleichheits-Orakel bit-identisch (Unit + Korpus + Ramp-Fixture). Terra-Check: PASS, 0 Findings (Sentinel-Reinheit, Ecken-Handrechnung, Zwei-Stufen-Fluss, Digest-Sensitivität je file:line). UI (B): Auto-Einträge in beiden Selects + **Automodus**-Master-Toggle (Zustand abgeleitet aus beide==auto; Deaktivieren stellt Defaults wieder her; Defaults unverändert — Betreiber-Entscheid), Provenance-Anzeige inkl. display-only-Ecken-Overlay, roi.source-Label-Fix; Gemini R1 fand 3 Stale-Provenance-Bedingungen + der E2E-Ausbau hatte die Spec-Datei geparst-kaputt (Playwright „No tests found" — Lehre: Spec-Dateien laufen NICHT über den apps/web-tsc; nach Spec-Edits immer `playwright test --list`) → Terra-Fixbatch → Gemini R2 CLEAN. Abnahme: 518/518 Unit, Playwright 11/11, beide Typechecks, Wortlaut-Gate. Handgriff deklariert: thresholds.ts-Kommentar-Beispielzahl 13×21→13×13 korrigiert. Backlog-Notizen: doppelter σ-Referenz-Lauf im Auto-ROI-Pre-Pass (Memo-Kandidat); rotiertes ROI bleibt v2.1 (fachlich beantwortet: Messblende ist hauptachsen-rotiert, ROI ist das Rechenfenster).

**S20 v2.0-Hardening: ALLE ZWÖLF STUFEN ABGESCHLOSSEN.** Offen (Betreiber): visuelles OK am Dev-Server, Public-Mirror-Sanitize + Deploy-Freigabe (privates Repo ist der vollständige Stand).

---

## Release 2.0.0 — Lizenz + Veröffentlichung (Betreiber-Freigabe 2026-08-25)

**Status: veröffentlicht.** Lizenz-Entscheid des Betreibers umgesetzt (Dev-Commit `4f76f6e`): Repository bleibt MIT **außer `packages/image`** = AGPL-3.0-or-later mit kommerzieller Lizenz auf Anfrage (`LICENSING.md`-Karte, `packages/image/LICENSE` kanonischer AGPL-Text, `COMMERCIAL-LICENSE.md`, license-Felder in den Manifesten, README-Sektion); der Analyzer war nie zuvor veröffentlicht und erscheint erstmals unter diesen Bedingungen. Public-Release als ein Stand (Public-Commit `44a760b`, 110 Dateien): Analyzer-Engine + Workbench-Bildansicht + S21-Automatik + kompletter Verifikations-Trail (Plan-/Review-Dokumente, Gate-Kalibrier-Rekord §13, Orakel-/Repro-Korpus) als Methoden-Nachweis — interne Betriebs-/Delegations-Notizen sind nicht Teil der Veröffentlichung. Deploy über die bestehende Pages-Pipeline (Gates im CI: Unit-Suite, Cases, Headless, Scope, Build).

**Release-Nachspiel — CI-Rot auf Linux, Ursache gemessen, Orakel plattformgepinnt.** Der erste Release-CI-Lauf scheiterte 517/518: Das S21-Abwesenheits-Orakel pinnt Volljson-Digests, und einer wich auf Linux ab. Diagnose (zweiseitige Messung, identische Runtime-Version, Input-Puffer bit-identisch): `Math.pow` wird über die Plattform-Mathebibliothek aufgelöst und liefert zwischen Windows und Linux verschiedene letzte Bits (200k-Sample-Digest differiert), während exp/log/sin/cos/sqrt/atan2/hypot und exp(n·log x) bit-identisch sind. In der Engine bewegt das ausschließlich `fits` (Super-Gauss-`pow` im Modell + Jacobian) und fit-abgeleitete `metrics`-Einträge auf relativ 1e-12..1e-11; alle übrigen zwölf Result-Sektionen sind über die OS-Grenze bit-identisch, keine ausgewiesene gerundete Zahl bewegt sich (voller Messrekord: Gate-Spec 13.9). Fix verhältnismäßig statt Engine-Eingriff nach Release: die fünf Digests pro Plattform gepinnt (beide Spalten gemessen; Orakel bleibt auf beiden CI-Plattformen bitscharf, unbekannte Plattform übersprungen mit Meldung), Determinismus-Aussage in docs/theory ehrlich um den Plattform-Qualifier präzisiert; pow-freie Fit-Formulierung als v2.1-Backlog (würde jede gepinnte Digest-Basis neu takten). Headless-/Case-Suiten vergleichen plattformrobust und liefen auf Linux unverändert grün (v2.0-CI-Präzedenz).

**Verbleibend:** I (Gate-Spec §13 + Doku-Kurve; Inputs: SNR-Seed-Band 0b, D2-real-reachable-Korrektur, A-iid-vs-Lattice, B-N=40/74+X=0/74+20×12-Flag-Adjudikation, E-c(n)+PRNG-Artefakt+moved-σ_B-Ledger, F-Ceiling-Ledger+Fit-Capture-Grenze, D3-Fit-Fragilität+σ3-Adjudikation, H-Rank-1-Randfall, G-Legenden-Residual, G9-0.98-Doku, D1-theory:14-Blockliste, F7-theory:168-Qualifier, C-F9-Notiz) → J (Doku-Konsolidierung + G8-Guide-Absatz) → K (Version 2.0.0).

---

## S22 — Residuen-Diagnostik (v2.1.0)

**Status: Code gelandet (`8db3771` Engine + `7e8f062` UI), Doku-Stufe läuft.** Plan-Loop nach Muster: Entwurf am Code → Konvergenz-Vorstufe (9/9 Anker-Spot-Checks TRUE, 7 Findings R-50–R-56) → Mathe-Leg xhigh (6 Defects R-57–R-63, darunter eine invertierte Delta-IC-Vorzeichenkonvention im eigenen Entwurf) → unabhängiges Gesamtplan-Leg (20 Prämissen, 22 Findings R-64–R-78, 21 akzeptiert, 1 mit Beleg zurückgewiesen) → zwei Betreiber-Entscheide: **BIC/AICc GESTRICHEN** (exakt genestete Modelle + pixelbasiertes N ⇒ das Delta wiederholt nur die RMS-Reduktion; stattdessen trägt der gefittete Exponent n mit dokumentierten Deutungs-Bändern und at-boundary-Guard den Modellvergleich) und **ein Wurf in drei parallelen, datei-disjunkten Lanes** (Engine/UI/Fixture) gegen ein im Plan gepinntes Result-Schema statt UI-zuerst. Kanal-Matrix neu (Betreiber): Implementierungs-Drafts beim Implementierungs-Kanal, leichte Sachen beim Leicht-Kanal, Reviews beim Review-Paar — der Erst-Draft-Start über den bisherigen Physik-Kanal wurde vor Arbeitsbeginn gestoppt und umgeroutet. Verlauf: Engine-Draft stoppte ehrlich am Performance-Gate (+128 % auf 2048²; Ursache-Diagnose des Managers: der neue Statistik-Walk lief ZUSÄTZLICH zu zwei bestehenden Full-Res-Walks) → Ein-Walk-Faltung 437→361 ms → Review-Härtung final ~400 ms mit ausgewiesenem Kosten-Split (Rekord: Gate-Spec 13.10). Reviews: Engine 13 akzeptierte Findings (u. a. Degenerate-Fallback-Kanten ohne SG-maxAbs, ungetesteter Generic-Pfad, Auslöschungs-Risiko der höheren Momente), UI 17 akzeptierte Findings (3 HIGH: invertiertes Multi-Peak-Verdikt in der Qualitäts-Box, σ-Namenskollision, n-Deutung trotz unterdrücktem Wert) — alle gefixt, alle Gates danach grün (534/534 Unit, Repro 50/50 unbewegt = Additivitätsbeweis, Playwright 13/13, Cases 60/60, Headless). Die fünf Vollobjekt-Absence-Digests wurden ZWEIMAL zweiseitig neu gepinnt (win32 vom Implementierer, linux im WSL-Labor vom Manager). Review-Kanal-Notiz: das externe Review-Kontingent war erschöpft (2× resource_exhausted) — beide Reviews liefen ersatzweise über den hauseigenen Review-Kanal in getrennten frischen Sessions. Fixture-Lane: `flat_zero_noise` (konstanter Hintergrund, floor-applied Rauschskala) für den deaktivierten σ-Modus, vor Landung gegen den Analyzer verifiziert (`66f5c45`).

**Doc-Version:** 5.0, 2026-08-25.

# S20 — v2.0 Hardening Plan

**Datum:** 2026-08-20 (v1-Body) / 2026-08-23 (v3).
**Status:** PLAN-v3 — Exit-Gate erklärt (§8.4); Implementierung läuft ab Stufe 0b.
**LESEHINWEIS (verbindlich):** §0–§6 sind der konservierte v1-Body (Review-Trail, wird nicht inline editiert). **§7 (v2) und §8 (v3) sind bindend, wo sie §0–§6 widersprechen**; §8.3 listet die bekannten Stale-Stellen des v1-Bodys. Implementierer-Prompts werden aus v1-Body + §7 + §8 zusammen generiert.
**Grundlage:** `Plan/S18_CODEX_REVIEW_TRIAGE.md` §6–§9 (verifizierte Verdikte, konsolidierte Baustellenliste), Betreiber-Entscheid §4 (v2.0-Scope), `Plan/S18_GATE_CALIBRATION_SPEC.md` §10–§12.
**Routing-Ehrlichkeit:** Entwurf durch eine dedizierte Plan-Session (Claude Opus, Plan-Agent, read-only, 69 Tool-Läufe) mit eigenen Live-Messungen gegen die Module; die Messzahlen in §1/§3/§4 stammen aus diesen Läufen und aus den drei Verifikations-Scratch-Fundi (`opus-codex-verify{,2,3}`). Zwei im Auftrag vorgeschlagene Fix-Formeln wurden dabei messbasiert verworfen (§4 a Alt. 3, §4 b). Der Architekt (Orchestrierung-Manager-Session) hat den Entwurf unverändert als v1-Body übernommen; Adjudikation der Review-Findings folgt als §7-Revisions-Sektion.

---

## §0 Motivation und Faktenbasis

Die drei externen Codex-Physik-Reviews und die drei adversarialen Verifikations-Sessions sind abgeschlossen; verbindlich sind ausschließlich die Verdikte in `Plan/S18_CODEX_REVIEW_TRIAGE.md` §6 (F1–F8), §7 (V1–V6) und §8 (C1–C11) sowie die konsolidierte Baustellenliste §9 (P0/P1/P2/P3 plus explizite Nicht-Fixes). Das Strukturmuster hinter allen drei Release-Blockern ist in §8 „Querbefunde" 1 benannt: **die Ehrlichkeits-Instrumente sind am leisesten auf den schlimmsten Inputs** — der Coverage-Blindspot (F8+V5c), der Wing-Detektor-Reichweitenverlust (V6b), die mit σ_B aufgehende Alpha-Schwelle (V5a) und der bei invalider Stage A abschaltende Tier-Check (C6). Diese Plan-Session hat jede Prämisse am Code nachgezogen (Zeilenanker unten) und die entscheidenden Zahlen **neu gemessen**, weil zwei der im Auftrag vorgeschlagenen Fix-Formeln sich an der Messung als nicht tragfähig erweisen (§4 b, §4 f). Die Stufen unten sind so geschnitten, dass Gate-Verhalten **vor** der Re-Baseline landet und keine zwei gleichzeitig delegierten Stufen dieselbe Datei anfassen.

---

## §1 Verbindliche Invarianten (für jede Stufe)

**I-1 Release-Kurven-Pin.** `tests/unit/image-aperture.test.ts:686-710` (300×240, σ 11×6, A=100, 15 Seeds) muss SNR 100 = 15/15 und SNR 20 ≥ 13/15 halten. Heute gemessen (diese Session, gegen die Live-Module): **SNR 100 → 15/15**, thrMaj 3.000–3.091, thrMin exakt 3.000; **SNR 20 → 15/15**, thrMaj 14.273–15.578, thrMin 13.450–15.323. Die Dokumentationskurve `docs/theory/image_analysis.md:194` (15/15 · 14/15 · 13/15 · 13/15 bei SNR 100/50/30/20) und die §12-Pins (thrMaj 12.880, 80×5 → 12/12, pure-noise `detected === false`) sind Teil desselben Pins.

**I-2 Determinismus.** Identische (params, σ_B, ROI) → **strikt gleiche** (`===`) Schwellen; per-Realisierungs-Streams (`ALPHA_MC_SEED` / `ALPHA_MC_SEED_STRIDE`, `thresholds.ts:88-89`) bleiben unangetastet. Pin: `image-aperture.test.ts:798-807`.

**I-3 Bit-Identität auf sauberen Frames.** Wo eine Stufe Gate-Verhalten *nicht* absichtlich ändert, müssen alle bestehenden Orakel bit-identisch bleiben. Neue Rechenpfade werden deshalb konsequent hinter „nur wenn die auslösende Bedingung im Frame vorliegt" gelegt (z. B. Coverage nur bei `nonFiniteCount > 0`, siehe S-A).

**I-4 Wording-Gate.** `node scripts/check-scope.mjs` muss grün bleiben — keine Normvokabeln (`scripts/check-scope.mjs:70-90`), keine externen Runtime-Assets, kein Direktimport von `packages/*/src` aus `apps/web/src` (`scripts/check-scope.mjs:61-66`). Jede neue Warn-Message und jeder neue i18n-Key wird gegen diese Liste geprüft.

**I-5 Kein neuer Norm-/Standard-Anspruch.** Neue Warnungen sprechen ausschließlich über gemessene Zahlen dieses Bildes, nie über Konformität.

**I-6 HOLD-Disziplin.** Jede Stufe endet vor dem Commit mit HOLD; der Betreiber gibt frei. Kein Stufen-Merge ohne bestandenen Cross-Check des zugeordneten Kanals.

**I-7 Geteilte Append-only-Dateien (deklarierte Ausnahme von der Datei-Exklusivität).** `packages/image/src/thresholds.ts`, `packages/core/src/warnings.ts` (Code-Union) und `apps/web/src/i18n.ts` (Warn-Titel-Records) dürfen von mehreren Lanes berührt werden, **ausschließlich additiv** in einem eigenen, kommentierten Block bzw. als neuer Key. Wer einen *bestehenden* Konstantenwert ändert (z. B. `ABSORBED_POWER_MIN_FRACTION`), besitzt die Datei exklusiv in seinem Slot. Der HOLD-Report jeder Stufe nennt die hinzugefügten Keys/Konstanten namentlich.

**I-8 `fallbackAperture`-Spiegel.** Jede Erweiterung des Typs `ApertureAssessment` (`aperture.ts:1040-1140`) erzwingt eine Anpassung von `analyze.ts:333-397`. Deshalb sind aperture-formändernde Stufen zwingend seriell (Lane 1).

---

## §2 Stufenschnitt-Übersicht

| # | Stufe | Scope (Kurz) | Dateien (Hauptlast) | Größe | Kanal | depends-on |
|---|---|---|---|---|---|---|
| **A** | P0-1 Coverage-Gate Non-finite | Coverage-Block + Modell-Bias-Schätzer + neuer Suppression-Grund + FLOAT_SPECIALS-Text | `aperture.ts`, `analyze.ts`, `warnings.ts`, `thresholds.ts`⁺, `core/warnings.ts`⁺, `i18n.ts`⁺, 2 Test-Dateien | L | Opus impl · Grok (cursor xhigh) X-Check | — |
| **B** | P0-2 Honesty-Floor | Alpha-Schwellen-Sichtbarkeit (V5a), Wing-Proben-Degradation (V6b), Tier-Check-Überleben (C6) | `aperture.ts`, `analyze.ts`, `warnings.ts`, `thresholds.ts`⁺, `core/warnings.ts`⁺, `i18n.ts`⁺, 2 Test-Dateien | L | Opus impl · Grok X-Check | A |
| **C** | P0-3 UI Dark-Lane uint16 | dtype-Gleichheitsprüfung → float32-Konvertierung | `apps/web/src/main.ts`, `i18n.ts`⁺, e2e | S | Grok impl · Gemini Light-Defekt · Opus X-Check | — (parallel zu A) |
| **D1** | P1 Decode-Tags | F5 WhiteIsZero → Fehler, F6 Orientation → Fehler | `packages/image/src/decode.ts`, `image-decode.test.ts` | S | Orchestrierung-Worker (flash/max, mechanisch) · Grok X-Check | — |
| **D2** | P1 LM-Wedge-Guard | V4 relParam-Zusatzbedingung an Arm 1 | `packages/image/src/fit.ts`, `image-fit.test.ts` | S | Opus impl · Grok X-Check | — |
| **D3** | P1 suggestRoi-Padding | V1 σ-abgeleitetes Padding pro Achse + V6a Tie-Break | `packages/image/src/roi.ts`, `thresholds.ts`⁺, `image-roi.test.ts` | M | Opus impl · Grok X-Check | — |
| **E** | P1 Hintergrund-Statistik | C2 √(n/(n−3)) + Mindest-n, C3/C4-Klemmen, C5-Gradienten-Warnung, C10 API-Default | `background.ts`, `analyze.ts`, `warnings.ts`, `thresholds.ts`⁺, 2 Test-Dateien | M | Opus impl · Grok X-Check | B |
| **F** | P1 Gate-Feinschliff | F4 Floor auf Stage-B-Peak, V5b robuster peakCorr, F7 physisches q, Export `fitGeometryIsReleasable` | `aperture.ts`, `analyze.ts`, `warnings.ts`, `index.ts`, 3 Test-Dateien | M | Opus impl · Grok X-Check | E |
| **G** | P3 UI bg-Rect Overlay + Zeichenmodus | Overlay-Farbe/Legende/Export + Modus-Umschalter Mess-ROI ↔ Hintergrund-Rechteck auf der vorhandenen Griff-Kette | `main.ts`, `views/image.ts`, `state.ts`, `i18n.ts`, `image-view-functions.test.ts`, `analyzer.spec.ts` | L | Grok impl · Gemini Konvergenz · Opus X-Check | C |
| **H** | P1 UI ROI-aus-Fit-Guard | V3: `fitGeometryIsReleasable` konsultieren | `apps/web/src/main.ts` | S | Grok impl · Opus X-Check | F, G |
| **I** | Re-Baseline + Gate-Spec §13 | Kurven neu messen/pinnen, §13 schreiben, Referenz-Artefakte nachziehen | `Plan/S18_GATE_CALIBRATION_SPEC.md` (neu §13), `docs/theory/image_analysis.md`, `agents/verification/image_analyzer_cases.json`, `examples/expected-headless-summary.json`, Test-Pins | M | Opus impl · Grok X-Check | A,B,D3,E,F |
| **J** | P2 Doku-Konsolidierung | alle P2-Korrekturen aus Triage §9 | `docs/theory/image_analysis.md`, `docs/guide/image_analysis.md`, `docs/architecture/CONVENTIONS.md` | S | Manager-Handedit (deklariert) · Opus Review | I |
| **K** | Terminal: Version 1.1.0 → 2.0.0 | Versions-Artefakte + Wording-Gate + Vollsuite | `package.json`, `apps/web/index.html`, `landing.ts`, `chrome.ts`, `guide.ts`, Docs, `Plan/INDEX.md` | S | Manager-Handedit · Opus Verifikation | J |

⁺ = additiv nach I-7.

**Lane-Struktur (was gleichzeitig delegiert werden darf):**
- **Lane 1 (Gate-Kern, streng seriell):** A → B → E → F
- **Lane 2 (Engine-Peripherie, untereinander parallel):** D1 ‖ D2 ‖ D3 — disjunkt zu Lane 1 bis auf `thresholds.ts` (I-7)
- **Lane 3 (UI, seriell auf `main.ts`):** C → G → H (H zusätzlich nach F)
- **Lane 4 (Doku/Release, seriell, ganz zum Schluss):** I → J → K

Lane 1, Lane 2 und Lane 3 dürfen zeitgleich laufen. **Kein** Delegations-Slot mischt zwei Stufen derselben Lane.

---

## §3 Stufen im Detail

### Stufe A — P0-1: Coverage-Gate für nicht-finite Pixel in der Mess-Apertur

**Scope.** `packages/image/src/aperture.ts` (neuer Block + neuer Gate-Zweig), `analyze.ts` (nur `fallbackAperture`-Spiegel), `warnings.ts` (Text-Korrektur + neue Warnung), `thresholds.ts` (additiv), `packages/core/src/warnings.ts` (additiv), `apps/web/src/i18n.ts` (2 Titel-Keys), `tests/unit/image-aperture.test.ts`, `tests/unit/image-analyze.test.ts`.

**Prämissen (Zeilen selbst nachgelesen und verifiziert).**
- `aperture.ts:1162-1170` — der Peak-/Positivsummen-Scan überspringt nicht-finite Werte kommentarlos; nirgends wird gezählt, wie viel der Apertur überhaupt Daten trägt.
- `aperture.ts:232` (Residual-Gate) und `moments.ts` (Ellipsen-Momente) überspringen nicht-finite Werte ebenfalls; die Alpha-MC dagegen befüllt **jede** Gitterzelle (`aperture.ts:544-546`). Beobachtete Statistik und Null-Modell messen dadurch strukturell verschiedene Träger.
- `warnings.ts:106-114` — `IMAGE_FLOAT_SPECIALS` sagt wörtlich „every downstream statistic ignores them", was faktisch beruhigt, wo die Zahl bereits verfälscht ist.
- `aperture.ts:1192-1196` — `earlyGatesPassed` (Gates 1–4) ist der Ort, an dem die 6σ-Prüfellipse garantiert im ROI liegt; jede aperturbezogene Zusatzrechnung gehört hinter dieses Prädikat.
- `analyze.ts:333-397` — `fallbackAperture` spiegelt die vollständige `ApertureAssessment`-Form.

**Design (Kern, ausführliche Begründung in §4 a).** Neuer Block `ApertureAssessment.coverage`:
`aperturePixelCount`, `finitePixelCount`, `finiteFraction`, `modelBiasMajorPercent`, `modelBiasMinorPercent`, `high`.
Der Bias-Schätzer rastert das **gefittete Modell** über den ROI und berechnet `computeEllipseMoments` zweimal über die alpha-Apertur — einmal vollständig, einmal mit exakt der beobachteten Non-finite-Maske. Die relative d4-Differenz ist die vom Deckungsmuster verursachte Verzerrung. Nur ausgeführt, wenn im ROI überhaupt nicht-finite Pixel liegen **und** `earlyGatesPassed` — auf sauberen Frames also null Kosten und bit-identische Ausgabe (I-3).

**Akzeptanz-Orakel (Zahlen aus `opus-codex-verify/f8.mjs`, diese Session neu gefahren).**
Szene: 200×160, σ 11×6, θ=0.7, A=2000, σ_B=1, `rect-median` auf vier 12-px-Rändern, ROI 14/14/172/132. Baseline `d4SigmaMajorPx = 43.9408`, 7463 In-Ellipsen-Pixel.

| Muster | tote Px | Anteil | released d4 heute | Fehler | Modell-Bias (gemessen) | Soll nach A |
|---|---|---|---|---|---|---|
| random 1 / 5 / 10 / 30 / 50 % | 80…3734 | 0.7–49.7 % | 44.11 … 44.24 | ≤ **+0.68 %** | 0.373 / −0.011 / 0.129 / 0.097 / 0.677 % | **released, bit-identisch zu heute** |
| col ±2 px | 256 | **3.4 %** | 46.5440 | **+5.92 %** | **5.924 %** | suppressed `coverage_insufficient` |
| col ±5 px | 770 | 10.3 % | **53.1812** | **+21.03 %** | 21.031 % | suppressed |
| col ±10 px | 1619 | 21.7 % | 67.5159 | +53.65 % | 53.645 % | suppressed |
| flank u>1σ | 2942 | 39.4 % | 34.8959 | −20.58 % | −20.583 % | suppressed |
| flank u>2σ | 2178 | 29.2 % | 41.3989 | −5.79 % | −5.778 % | suppressed |

Der Schätzer trifft den wahren Release-Fehler auf drei Nachkommastellen (5.924 vs. 5.924; 21.031 vs. 21.029; 53.645 vs. 53.652; −20.583 vs. −20.584) — er ist kein Heuristik-Proxy, sondern der Fehler selbst. Zusatz-Orakel: V5c-Szene (NaN-Annulus 1.5–2.5σ, released −17.37 %) fällt in dieselbe Klasse; der 250/5007-Fall (Release aus 5 % finiten Apertur-Pixeln) wird zusätzlich vom `finiteFraction`-Arm gefangen.

**Regressions-Pins.** I-1 vollständig (die Kurven-Szenen tragen null nicht-finite Pixel → Pfad wird nicht betreten → Bit-Identität). `image-aperture.test.ts:669-684` (Poison außerhalb des ROI), `:686-710` (Kurve), `:747-808` (Feld-Pins), gesamte `image-analyze.test.ts`.

**Stop-and-Report.** (1) Wenn irgendein bestehendes Orakel unter A rot wird, obwohl seine Szene keine nicht-finiten Pixel hat → sofort HOLD, der Pfad wird betreten, wo er nicht darf. (2) Wenn `random 50 %` unter der gewählten Schwelle suppressed wird → Schwelle falsch, HOLD. (3) Wenn `col ±2 px` (3.4 %) nicht anspricht → Schwelle zu hoch, HOLD.

**Nicht in dieser Stufe.** Keine Änderung an der Alpha-MC (die Maske dem Null-Modell aufzuprägen ist ausdrücklich **nicht** die Lösung: beide Aperturen sind identisch korrumpiert, die beobachtete Delta bleibt klein — siehe §4 a). Kein Interpolieren/Reparieren toter Pixel. Keine Änderung an `diagnostics.nonFiniteCount` (bleibt frame-weit).

---

### Stufe B — P0-2: Honesty-Floor (V5a + V6b + C6)

**Scope.** `aperture.ts`, `analyze.ts`, `warnings.ts`, `thresholds.ts`⁺, `core/warnings.ts`⁺, `i18n.ts`⁺, `image-aperture.test.ts`, `image-analyze.test.ts`.

**Prämissen.**
- `aperture.ts:617-618` — `thresholdMajor/MinorPercent = Math.max(ALPHA_CONSISTENCY_MAX_PERCENT, ALPHA_MC_K * rms)`, **ohne obere Grenze**. Verifiziert bis 159 % (minor, Triage §7).
- `aperture.ts:641` — `failClosed = mcAttempted && mcRealizationCount < ALPHA_MC_MIN_VALID`; die einzige heutige Notbremse.
- `aperture.ts:888-904` — eine Sonde wird still per `continue` verworfen, wenn ihre Ellipse nicht vollständig im ROI liegt; `aperture.ts:944-963` meldet nur die **beste** Sonde, nirgends, welche Sonden fehlten.
- `analyze.ts:1130` — der Tier-Check läuft nur, wenn `startMomentsIfPlausible(stageA, roi) !== null`; Prädikat in `analyze.ts:461-493` (gültig, Centroid im ROI, `4*sigmaMajor < min(roiW, roiH)`).

**Neu gemessene Belege (diese Session).**
- *V5a-Halo-Szene* (`opus-codex-verify2/v5c.mjs`, Kern σ 8 + 1 %-Halo bei 4× Breite, In-Frame-Wahrheit d4 55.433): σ_B 0.5/5 → suppressed (thr 3.00); σ_B 20 → suppressed (thr 4.84); **σ_B 50 → released 33.68 (−39.2 %) bei thr 11.08 vs. Delta 9.36; σ_B 100 → released 33.19 (−40.1 %) bei thr 22.29 vs. Delta 6.33; σ_B 150 → released 33.24 (−40.0 %) bei thr 31.35 vs. Delta 0.28.**
- *Tier-Gap derselben Szene*: 108.4 / 147.5 / 178.0 % bei σ_B 50/100/150 — feuert nicht, weil die Stage-A-Rauschskala mitwächst.
- *V6b-Wing-Szene* (`opus-codex-verify2/v6.mjs`, 512², Kern σ 8×6, Halo 0.5 bei 8× Breite, rauschfrei): ROI 512/300/200 → Sonde 12, Excess 1.7296/1.287/0.6323 % → feuert; ROI 160 → Sonde 9, 0.3637 % → feuert knapp; ROI 140/120 → Sonde 6, 0.1792/0.1265 % → still (aber `TIER_DISAGREEMENT` feuert noch); **ROI 100 → Sonde 6, 0.0735 %, Warnliste leer, released d4 31.99.**
- *Sauberes Kontroll-Gegenstück ohne Halo*, gleiche ROI-Reihe: Excess **−0.0000 %** bei jeder ROI-Größe, Sonde 4.
- *C6* (`opus-codex-verify3/c6.test.ts`, 96×72, σ 6×4, A=10000, Rampe, rect-median auf vier Ecken): Slope 1.0 → `IMAGE_TIER_DISAGREEMENT` feuert; **Slope 2.0 und 5.0 → Stage A invalid, Tier-Check schweigt, released mit d4-Bias −0.21 % / −0.49 % und Centroid-Drift +0.23 px / +0.57 px**; einziges Signal ist `IMAGE_MOMENTS_UNDEFINED(info)`, das über die *diagnostische* Ebene spricht, nicht über die released Zahl.

**Design (drei additive Arme, kein Gate-Verhalten — Begründung §4 b/c/d).**
1. **V5a → Sichtbarkeit statt Cap.** Neue Warnung `IMAGE_ALPHA_GATE_WEAK` auf **released** Frames, wenn `max(thrMaj, thrMin) > ALPHA_GATE_WEAK_PERCENT`. Kandidat 10 (Kalibrierung in-Stufe). Text nennt beide Schwellen und beide Deltas und sagt, dass der Konsistenz-Test bei diesem Rauschniveau nicht diskriminiert.
2. **V6b → Sonden-Reichweite sichtbar + Boden absenken.** `absorbedPower` bekommt `availableProbeAlphas: number[]` und `maxAvailableProbeAlpha`. Neue INFO `IMAGE_WING_PROBE_REDUCED` auf released Frames, wenn 9σ und 12σ fehlten. Zusätzlich `ABSORBED_POWER_MIN_FRACTION` 0.003 → Kandidat 0.0005 (**exklusive Konstantenänderung**, Stufe B besitzt `thresholds.ts` in ihrem Slot).
3. **C6 → Nicht-Ausgewertet-Signal.** Neuer Ergebnis-Block `tierCheck: { evaluated, unavailableReason, gapMajorPercent, gapMinorPercent, thresholdMajorPercent, thresholdMinorPercent }` in `analyze.ts` plus INFO `IMAGE_TIER_CHECK_UNAVAILABLE`, wenn Stage B **released** und das Prädikat den Check blockiert, mit Grund („stage-A moments invalid" / „centroid outside the ROI" / „4·sigmaMajor exceeds the shorter ROI side").

**Akzeptanz-Orakel.**
- V5a: σ_B 50/100/150 der Halo-Szene bleiben released (bewusst, siehe §4 b), tragen aber alle drei `IMAGE_ALPHA_GATE_WEAK` mit thr 11.08 / 22.29 / 31.35; die 15 SNR-20-Seeds der Kurve dürfen die Warnung tragen (thr 14.3–15.6), **müssen** aber released bleiben.
- V6b: ROI 140 → Excess 0.1792 % > 0.05 % → `IMAGE_ABSORBED_POWER` feuert (heute still). ROI 120 → 0.1265 % → feuert. **ROI 100 → 0.0735 % → feuert; die Warnliste dieses Frames ist danach nicht mehr leer.** Saubere Kontrolle bei jeder ROI-Größe: −0.0000 % → **bleibt still** (0/74 auf dem sauberen Referenzsatz ist die harte Bedingung).
- V6b Sonden-INFO: ROI ≤ 140 → `IMAGE_WING_PROBE_REDUCED`; ROI ≥ 160 → still.
- C6: Slope 2.0 und 5.0 tragen `IMAGE_TIER_CHECK_UNAVAILABLE` mit Grund „stage-A moments invalid"; Slope 1.0 trägt weiterhin `IMAGE_TIER_DISAGREEMENT` und **nicht** das neue INFO.

**Regressions-Pins.** I-1 komplett unverändert (kein Arm ändert Release/Suppress). §11.6-Orakel `image-aperture.test.ts` F1a (Wing feuert, sauberer Strahl und reiner Flat-Offset nicht) und `image-analyze.test.ts` F1/F1-Kamera bleiben grün — die Absenkung des Bodens darf sie nur *stärker*, nie schwächer machen. `image-analyze.test.ts` F2-Orakel (WIDTH_SCATTER) unberührt.

**Stop-and-Report.** (1) Wenn die Absenkung von `ABSORBED_POWER_MIN_FRACTION` **auch nur einen** Fehlalarm auf dem 74-Szenen-Sauberkeitssatz erzeugt → Boden bleibt bei 0.003, nur Arm 2-INFO wird ausgeliefert, HOLD-Report nennt die Zahl. (2) Wenn `IMAGE_ALPHA_GATE_WEAK` bei Kandidat 10 auf 20×12 SNR 20 (gemessen thr 7.42–7.91) feuert → Kalibrierung falsch. (3) Wenn irgendein Arm eine `suppressionReason` verändert → Design-Bruch, HOLD.

**Nicht in dieser Stufe.** Kein harter Alpha-Cap mit fail-closed (§4 b: gemessen release-kurven-tötend). Kein Fallback-Stage-A über der 6σ-Box (§4 d: physikalisch wertlos). Keine Änderung an der Sonden-Liste `ABSORBED_POWER_PROBE_ALPHAS`.

---

### Stufe C — P0-3: UI-Dark-Lane uint16 → float32

**Scope.** `apps/web/src/main.ts`, `apps/web/src/i18n.ts`⁺, `tests/e2e/analyzer.spec.ts` (+ Fixture-Generator).

**Prämissen.**
- `decode.ts:245` — 16-bit-TIFF liefert immer `dtype: "uint16"` (`sampleFormat === 3 ? "float32" : bitsPerSample === 16 ? "uint16" : …`).
- `main.ts:1638` — das **Hauptbild** wird bedingungslos per `Float32Array.from(rawPixels)` konvertiert, unabhängig vom decodierten dtype.
- `main.ts:1878` — die Analyse fährt konsequent mit `dtype: "float32"`.
- `main.ts:1848` — die Dark-Lane verlangt dagegen `decoded.dtype !== "float32"` → **jedes normale uint16-Kamera-Dark wird abgelehnt**, mit fehlattribuierter Meldung („dimensions or data type do not match").
- `background.ts:674-676` — die Engine prüft zusätzlich `config.darkDtype !== image.dtype`; da die UI `image.dtype = "float32"` schickt, muss auch `darkDtype: "float32"` gesetzt werden.

**Design.** dtype-Gleichheitsprüfung an `main.ts:1848` streichen; Dimensionen weiterhin prüfen; `pixels: Array.from(decoded.pixels)` und `dtype: "float32"` speichern (`main.ts:1853-1863`). Fehlermeldung in zwei getrennte Texte splitten (Dimensionen vs. Decodierfehler), damit die Fehlattribuierung verschwindet. Präzisionsnotiz in den Code-Kommentar: uint8/uint16 sind in float32 exakt; uint32 > 2²⁴ verliert Präzision — identisch zum bereits bestehenden Hauptbild-Pfad, also keine neue Klasse von Verlust.

**Akzeptanz-Orakel.** e2e: ein **uint16**-TIFF-Paar (Bild + Dark, gleiche Maße) lädt, `darkError === null`, die Dark-Lane wird in der Analyse tatsächlich verwendet (Ergebnis unterscheidet sich vom `none`-Lauf), und ein Dark **falscher Dimension** wird weiterhin mit der Dimensions-Meldung abgelehnt. Fail-before: derselbe Test scheitert heute an `darkError !== null`.

**Regressions-Pins.** `tests/unit/image-background.test.ts` (dark-frame-Zweig) unverändert; `tests/e2e/analyzer.spec.ts` Bestand grün; keine Engine-Datei berührt.

**Stop-and-Report.** Wenn `background.ts` doch angefasst werden müsste (Engine lehnt weiter ab) → HOLD: dann ist die Annahme über `image.dtype` falsch und die Stufe wird neu geschnitten.

**Nicht in dieser Stufe.** Keine Skalierung/Normalisierung der Dark-Werte, keine Belichtungszeit-Prüfung (C8c ist REFUTED), keine Änderung am Dark-Picker-UI jenseits der Fehlermeldung.

---

### Stufe D1 — P1: TIFF-Tag-Semantik (F5, F6)

**Scope.** `packages/image/src/decode.ts`, `tests/unit/image-decode.test.ts`.

**Prämissen.** `decode.ts:192-195` akzeptiert `photometric` 0 (**WhiteIsZero**) und 1 gleichermaßen, invertiert aber nie → invertiertes Profil wird analysiert (F5: 100 % `nonpositive_amplitude`, aber alle Diagnostik-Anzeigen invertiert und der Suppression-Grund opak). `decode.ts:170-182` listet die typgeprüften Tags — **Tag 274 (Orientation) fehlt vollständig**, weder angewendet noch abgelehnt (F6: Achsen-Swap 55×60 µm → 30×110 µm bei Orientation 6/8 und anisotroper Pitch).

**Design.** Beides als **ehrlicher Block**, nicht als stille Reparatur — konsistent mit der bestehenden Decoder-Philosophie (`decode.ts:187-207`: komprimiert/tiled/palette/signed werden geblockt, nicht geraten): `photometric === 0` → Fehler „TIFF: WhiteIsZero (inverted) images are not supported — export with BlackIsZero"; Tag 274 vorhanden und ≠ 1 → Fehler mit genanntem Wert. Tag 274 = 1 (oder fehlend) passiert unverändert.

**Akzeptanz-Orakel.** Fixture mit `PhotometricInterpretation = 0` → `ok: false` mit der neuen Meldung (heute: `ok: true`, invertierte Analyse). Fixture mit Orientation 6 → `ok: false` (heute: still akzeptiert, dekodiert identisch zu 1). Orientation 1 und fehlender Tag → unverändert grün.

**Regressions-Pins.** Gesamte `image-decode.test.ts` (992 Zeilen).

**Stop-and-Report.** Wenn irgendein bestehendes Fixture `photometric = 0` trägt → HOLD, das wäre eine unbeabsichtigte Bestandsverletzung.

**Nicht in dieser Stufe.** Kein Anwenden (Invertieren/Rotieren) der Tags; keine Erweiterung des unterstützten TIFF-Subsets.

---

### Stufe D2 — P1: LM-Wedge-Guard (V4)

**Scope.** `packages/image/src/fit.ts`, `tests/unit/image-fit.test.ts`.

**Prämissen.** `fit.ts:1070-1078` — Arm 1 des Wedge-Exits ist `lastAcceptedRelCost !== null && lastAcceptedRelCost <= COST_REL_TOLERANCE`; er verlangt **keinen** kleinen Parameterschritt. Verdikt V4 ist **PARTIAL**: Semantik bestätigt, Erreichbarkeit widerlegt (618 Szenen, 24 Arm-1-Wedges, max relParam 1.04e-4 gegen 1.56e-2 nötig; die Bedingungen sind antagonistisch).

**Design.** Zusätzliche Konjunktion an Arm 1: der letzte akzeptierte relative Parameterschritt muss unter einer modul-privaten Konstante liegen (`fit.ts` hält seine Zahlen lokal, siehe `fit.ts:167-184`). Der Guard ist **frei** — nach der Messung ändert er auf keiner bekannten Szene ein Ergebnis; er schließt nur eine offene Tür.

**Akzeptanz-Orakel.** Die 618-Szenen-Sweep-Reproduktion muss **identische** Status auf allen Szenen liefern (0 Verhaltensänderung). Neues Orakel: ein synthetisch konstruierter Fall mit großem letzten Schritt bei winziger Kostenverbesserung wird nicht mehr als `converged` zertifiziert.

**Regressions-Pins.** `image-fit.test.ts` komplett, insbesondere die S18-R2-F3-Orakel (`Plan/S18_GATE_CALIBRATION_SPEC.md:952-953`): 20 Sub-Pixel-Phasen `converged`, Iterations-Cap meldet weiterhin `max_iterations`, pure-noise wird nie zertifiziert.

**Stop-and-Report.** Sobald **eine** Szene im Sweep ihren Status ändert → HOLD; V4 ist als „freier Guard" geplant, nicht als Verhaltensänderung.

**Nicht in dieser Stufe.** Keine Änderung an `WEDGE_COST_RELATIVE_FLOOR`, `WEDGE_GRADIENT_TOLERANCE` oder der Status-Semantik.

---

### Stufe D3 — P1: suggestRoi σ-abgeleitetes Padding (V1) + Tie-Break (V6a)

**Scope.** `packages/image/src/roi.ts`, `packages/image/src/thresholds.ts`⁺, `tests/unit/image-roi.test.ts`.

**Prämissen.**
- `roi.ts:77` — `paddingPx = options?.paddingPx ?? SUGGESTED_ROI_PADDING_PX`; `thresholds.ts:19-20` — `SUGGESTED_ROI_K = 4`, `SUGGESTED_ROI_PADDING_PX = 8`, ein **fester** 8-px-Rand unabhängig von der Strahlgröße.
- `roi.ts:186-193` — der Rand wird symmetrisch auf die Bounding-Box addiert und aufs Bild geklemmt.
- `aperture.ts:270-291` — das Clipping-Gate verlangt, dass die **6σ**-Prüfellipse mit ihren achsparallelen Halbausdehnungen vollständig im ROI liegt.
- `analyze.ts:144` — die Suggestion ist ausdrücklich informativ und wird nie automatisch angewendet; sie ändert also **keine** released Zahl, nur den Vorschlag.
- `roi.ts:132-137` / `:172-176` — Tie-Auflösung über kleinste (y, x) bzw. Seed-Reihenfolge; V6a: 1e-9 Counts verschieben den Vorschlag um 72 px.

**Neu gemessene Belege.** `opus-codex-verify2/v1b_boundary.mjs`: bei σ = 10 px braucht der heutige 4σ_B+8px-Vorschlag **A/σ_B ≥ 3.0e6**, damit die Halbseite 6σ erreicht; die Engine released erst ab A/σ_B = 1e7 (Halbseite 6.25σ). Bei A/σ_B = 1e4/1e5/1e6/3e6 → durchweg `aperture_clipped`. Bei σ = 3 px liegt die Grenze bei A/σ_B ≈ 3000.

**Design (Formel und Grenzfälle in §4 f).** Pro Achse: `sigmaEst_a = halfExtent_a / sqrt(2*ln(peakValueCounts / thresholdCounts))`, `pad_a = max(SUGGESTED_ROI_PADDING_PX, ceil(SUGGESTED_ROI_PAD_MARGIN * APERTURE_ALPHA_CHECK * sigmaEst_a - halfExtent_a))` mit Kandidat `SUGGESTED_ROI_PAD_MARGIN = 1.25`. Guards: `thresholdCounts > 0`, `peak/threshold > SUGGESTED_ROI_MIN_PEAK_RATIO` (Kandidat √e ≈ 1.6487), `sigmaEst` endlich und > 0 — sonst fester 8-px-Rand. Additiv exportiert: `paddingXPx`, `paddingYPx`, `sigmaEstXPx`, `sigmaEstYPx`; `paddingPx` behält seine heutige Bedeutung (Basis/Override). V6a: dritte Tie-Break-Klausel auf den kleinsten Seed-Index bei exakt gleicher Größe **und** gleichem Peak.

**Akzeptanz-Orakel.**
- Der 15/15-`aperture_clipped`-Fixpunktsatz aus `v1_suggest_apply.mjs` muss auf **0/15 aperture_clipped** kippen.
- σ = 10, A/σ_B = 1e4: heute `aperture_clipped` (Halbseite 4.80σ) → nach D3 released; die Halbseite jeder Suggestion muss ≥ 6.25 σ_fit sein.
- σ = 3, A/σ_B = 500/1000/1500: heute alle `aperture_clipped` → nach D3 released.
- Explizites `paddingPx` bleibt exakt: `image-roi.test.ts:53-60`, `:76-83`, `:123-128` unverändert grün.
- **Bewusste Orakel-Änderung:** `image-roi.test.ts:27-45` (flacher 8×5-Stempel, Wert 10, Schwelle 4). Ratio 2.5 → `sqrt(2·ln 2.5) = 1.354` → `sigmaEst_x = 4/1.354 = 2.95` → benötigt 22.1 → `pad_x = 19`. Die gepinnte Erwartung `rect = {x0:0, y0:0, width:20, height:16}` wird zur aufs Bild geklemmten Vollfläche `{0,0,30,20}`; `paddingPx === 8` (Zeile 43) bleibt gültig. Diese Änderung ist **absichtlich** und in Stufe I zu dokumentieren.

**Regressions-Pins.** `image-roi.test.ts` (259 Zeilen), `examples/expected-headless-summary.json` (enthält Suggestion-Felder → muss in Stufe I nachgezogen werden), `agents/verification/image_analyzer_cases.json`.

**Stop-and-Report.** (1) Wenn eine Suggestion auf einer sauberen Szene die Vollfläche wird, obwohl der Strahl klein ist (Symptom: `ratio` nahe 1 trotz gutem SNR) → Guard-Schwelle falsch, HOLD. (2) Wenn irgendeine **released Zahl** sich ändert → Design-Bruch (die Suggestion darf nichts releasen), HOLD.

**Nicht in dieser Stufe.** Kein Verschieben der Suggestion hinter den Fit (Backlog „Second-pass suggestion"). Keine Multi-Komponenten-Vereinigung. Keine Änderung an `SUGGESTED_ROI_K`.

---

### Stufe E — P1: Hintergrund-Statistik (C2, C3, C4, C5, C10)

**Scope.** `packages/image/src/background.ts`, `analyze.ts`, `warnings.ts`, `thresholds.ts`⁺, `tests/unit/image-background.test.ts`, `tests/unit/image-analyze.test.ts`.

**Prämissen.**
- C2: `background.ts:704-727` — die robuste Ebene wird auf ihren **eigenen** Referenzpixeln gefittet; 3 Freiheitsgrade werden verbraucht, σ_B deflationiert (verifiziert: 2×2-Rects −41.1 %, vier 2×2-Ecken −24.5 %). Richtung: Gates werden strenger, aber `peakToBackgroundNoise` und `d4Scatter` werden um Faktor 1.7 zu optimistisch exportiert.
- C3: `background.ts:694-702` (`rect-median`) und `:353-359` — außer „mindestens ein finiter Wert" existiert **kein** Mindest-n; ein 1×1-Rect auf einem Hot-Defekt ist gültig.
- C4: `background.ts:286-294` (`noiseFloor`) — bei n = 2 kollabiert der P10/P90-Float-Boden exakt auf 0; verifiziert: `[100,140]` liefert σ = 29.65 „mad" aus zwei Pixeln, warnungsfrei.
- C5: falsche Methodenwahl (rect-median auf Rampe) macht deterministische Struktur zu „Rauschen" (σ_B ≈ 332 auf rauschfreiem Fixture, Gates 4.2× entschärft). Breiten-Schaden ist **widerlegt** (−0.11 %); still falsch bleiben Centroid (+0.161 px) und `peakToBackgroundNoise` (58.4 auf rauschfreiem Bild).
- C10: `analyze.ts:696-709` — nur `input.backgroundSigmaRects` speist die σ_B-Referenz; `background.rects` tut es nicht. Die UI koppelt korrekt (`main.ts:1903-1905`), die API nicht.

**Design.** (a) C2: `fitRobustPlane` exportiert `effectiveSampleCount` und skaliert σ mit `sqrt(n/(n-3))`, mit hartem Mindest-n (Kandidat n ≥ 6, nicht n ≥ 4 — bei n = 4 explodiert der Faktor auf 2.0) und `RangeError` darunter (fällt in `analyze.ts:662-680` bereits sauber auf `none` + `IMAGE_BACKGROUND_DEGENERATE` zurück). (b) C3/C4: Mindest-Referenz-Stichprobe `BACKGROUND_MIN_REFERENCE_SAMPLES` (Kandidat 9); darunter `scaleSource: "floor"` erzwingen, was über `warnings.ts:213-225` automatisch `IMAGE_NOISE_SCALE_SUSPECT` auslöst. n = 2 darf nie „mad" melden. (c) C5: neue Warnung `IMAGE_BACKGROUND_GRADIENT_IN_REFERENCE`, wenn die Referenz-Rects bei Methode `rect-median` einen signifikanten linearen Trend tragen (Between-Rect-Konsistenz, C11c-Skizze). (d) C10: fehlt `backgroundSigmaRects` und ist die Methode `rect-median`/`robust-plane`, wird `config.rects` als σ_B-Referenz genutzt — Einzeiler in `analyze.ts:696`.

**Akzeptanz-Orakel.** C2: vier 2×2-Ecken → exportiertes σ steigt um den Faktor `sqrt(4·4/(16−3)) ≈ 1.109`… **Vorsicht, in-Stufe exakt nachmessen**: der verifizierte Referenzwert ist −24.5 % Deflation, die Korrektur muss diesen auf ≤ 5 % Restfehler drücken; 2×2-Einzelrect (n = 4) muss unter der Mindest-n-Regel **abgelehnt** werden. C3: 1×1-Rect → `scaleSource: "floor"` + `IMAGE_NOISE_SCALE_SUSPECT`. C4: `[100,140]` → nicht mehr σ = 29.65 „mad". C5: rauschfreies Rampen-Fixture (σ_B 332.10, Gates 4.2× relaxed, released 13.9840×9.9882) trägt danach die Gradienten-Warnung. C10: API-Aufruf mit `background.rects` und ohne `backgroundSigmaRects` liefert dasselbe σ_B wie der UI-Pfad (heute bis 1.9× Abweichung konstruierbar).

**Regressions-Pins + erwartete Kurvenwirkung.** `tests/unit/image-background.test.ts` (1011 Zeilen). **C2 ändert σ_B und damit alle nachgelagerten Schwellen für Szenen mit `robust-plane`.** Der Kurven-Orakel-Pfad ist immun (`image-aperture.test.ts:701` übergibt σ_B explizit an `assessAperture`), aber `image-analyze.test.ts`-Fälle mit Ebenen-Hintergrund verschieben sich. **Diese Stufe deklariert eine Verhaltensänderung** und liefert die neu gemessenen Zahlen an Stufe I; die zu aktualisierende Spec-Sektion ist das neue **§13**.

**Stop-and-Report.** (1) Wenn die Mindest-n-Regel den Vier-Ecken-Standardfall der UI (`main.ts:2860-2871`, ~12 % Seitenlänge pro Ecke) blockiert → Schwelle zu hoch, HOLD. (2) Wenn C2 die SNR-Kurve über den analyze-Pfad verschiebt → Zahlen dokumentieren, HOLD vor Commit.

**Nicht in dieser Stufe.** C1 (Smooth-Tail-Bias, Impact widerlegt), C7 (REFUTIERT), C8b/C8c (REFUTIERT), C9 (`<6σ`-Trigger — bewusst nach J als Doku-Randnotiz, nicht als Code), C11d (kosmetisch).

---

### Stufe F — P1: Gate-Feinschliff (F4, V5b, F7) + Prädikat-Export

**Scope.** `aperture.ts`, `analyze.ts`, `warnings.ts`, `packages/image/src/index.ts`, `tests/unit/image-aperture.test.ts`, `image-analyze.test.ts`, `image-moments.test.ts`.

**Prämissen.**
- F4: `aperture.ts:1160-1170` — `peakCorr` ist das **rohe** ROI-Maximum des korrigierten Felds; es speist `residualMaxAllowed` (`aperture.ts:158-160`) und `peakFloorCounts` (`aperture.ts:705`). Verifiziert: Breitenwirkung nur −0.2 %, aber **Verdikt-Flip SUPPRESSED↔RELEASED** zwischen B=0 und B=1000 auf dem Default-Pfad `bgMethod:"none"`.
- V5b: derselbe rohe Peak — ein Hot-Pixel weitet Residual- **und** Multi-Peak-Toleranz; verifiziert Kipp-Wert 4500 Counts auf 1000er-Peak, Ceiling exakt 50.0 bei Hot = 10 000, still unter Hot-Fraktion 1e-4.
- F7: `warnings.ts:264-284` liest `orientationContrastQ` aus `moments.ts:238` — reiner **Pixel**-Raum. Verifiziert: released physikalisches θ = 0.5439 rad ist bei Pitch 2/4 reines Eigen-Rauschen (q_phys = 2e-5 gegen q_px = 0.600).
- V3-Vorbereitung: `analyze.ts:580-599` — `fitGeometryIsReleasable` existiert und ist nicht exportiert (`index.ts:35-39` exportiert nur `analyzeImage` + Typen).

**Design.** F4: Floor auf den Stage-B-Peak (`peakCorr − params.backgroundCounts`, geklemmt auf > 0) für `peakFloorCounts` **und** `RESIDUAL_RMS_PEAK_FRACTION`-Arm; `peakCorr` selbst behält seine Definition als exportierte Messung. V5b: robuster Peak (Kandidat: Maximum des 3×3-Median-gefilterten Felds innerhalb des ROI, deterministisch, O(ROI)), verwendet **nur** für die Ceilings, nicht für den Export. F7: physisches q aus `mapMomentsToPhysical`-Sigmas in `analyze.ts` bilden und an `warnings.ts` durchreichen; ohne Kalibrierung bleibt der heutige Pixel-Pfad. Plus: `fitGeometryIsReleasable` aus `analyze.ts` exportieren und in `index.ts` re-exportieren (für Stufe H).

**Akzeptanz-Orakel.** F4: die B=0/B=1000-Paarszene liefert **denselben** Verdikt (heute Flip). V5b: Hot = 10 000 auf 1000er-Peak → Residual-Ceiling nicht mehr 50.0, Multi-Peak-Floor nicht mehr 1000; Kipp-Wert 4500 kippt nicht mehr. F7: Pitch 2/4-Szene mit q_px = 0.600 und q_phys = 2e-5 → `IMAGE_ORIENTATION_UNSTABLE` feuert (heute still).

**Regressions-Pins + erwartete Kurvenwirkung.** **Diese Stufe ändert Gate-Verhalten.** Der robuste Peak weicht auf verrauschten Szenen minimal vom rohen Maximum ab → `RESIDUAL_RMS_PEAK_FRACTION * peakCorr` verschiebt sich. Der Kurven-Orakel-Pfad muss neu gemessen werden; I-1 gilt hier als **„messen und begründen"**, nicht als Bit-Identität. Erwartung: 15/15 bzw. ≥ 13/15 bleiben, da der Residual-Ceiling auf diesen Szenen vom 2σ_B-Arm dominiert wird (`residualMaxAllowed` nimmt das Maximum beider Arme). Pins: F4-Orakel `image-aperture.test.ts` (Stage-B-Feld vs. Referenzimplementierung, Spec §11.6), F5-Orakel (withheld verdict), §12-Pin thrMaj 12.880.

**Stop-and-Report.** Sobald eine Kurven-Zelle **fällt** (SNR 100 < 15/15 oder SNR 20 < 13/15) → HOLD mit gemessener neuer Kurve; Entscheid über Weiterbau beim Betreiber.

**Nicht in dieser Stufe.** Keine Hot-Pixel-Reparatur im Bild. Kein Eingriff in `MULTI_PEAK_EVT_MARGIN` / `MULTI_PEAK_SEPARATION_WIDTH_FACTOR`. V6c-Instabilität ist REFUTIERT und bleibt draußen; der V6c-**Warn-Fallback** (Achsen-Warnungen ohne released Wert) wird bewusst in Stufe B/F **nicht** gebaut — Begründung siehe §5.

---

### Stufe G — P3: Hintergrund-Rechtecke sichtbar + Zeichenmodus

**Scope.** `apps/web/src/main.ts`, `apps/web/src/views/image.ts`, `apps/web/src/state.ts`, `apps/web/src/i18n.ts`, `tests/unit/image-view-functions.test.ts`, `tests/e2e/analyzer.spec.ts`.

**Prämissen (Betreiber-Labortest, Triage §4.2: bgRects nicht im Overlay sichtbar, nicht ziehbar, Drag bedient immer das Mess-ROI).**
- Zwei-Pass-Halo-Recorder: `main.ts:957-976` `paintOverlayStrokes` (alle Unterlagen 1.5× halb-transparent, dann alle Farbzüge) — der zu wiederverwendende Mechanismus.
- Overlay-Aufbau: `main.ts:1198-1268` `drawOverlay`, Strichliste ab `:1210`, ROI-Rechteck `:1224-1235`, Suggestion `:1212-1222`.
- Legende: `main.ts:1026-1058` `LegendItem` + `strokeLegendMark` (kennt bereits `mark: "rect"`), Zusammenstellung `:1060-1074`.
- Griff-Kette: `main.ts:766-795` (`resizeRoiRect`, `liveRoiRect`), `:797-826` (`hitRoiEdit`, inkl. der 0.98-Vollflächen-Regel für „create"), `:828-835` (`roiCursor`), `:837-865` (`drawRoiHandles`).
- Pointer-Zustandsmaschine: `main.ts:3502-3532` (down), `:3534-3556` (move), `:3558-3578` (up), Verdrahtung `:3724-3726`; Slop `:3439`; Bildkoordinaten `:3441-3455`.
- Rect-Editor (Zahlen-Eingabe): `views/image.ts:1244-1265`, `data-k`-Namen `bgRectX0-<i>` … dokumentiert in `views/image.ts:1186-1187`; Aktionen `img-bg-rect-add/remove/corners` (`main.ts:2860-2874`).
- Zustand: `state.ts:135` `bgRects: BgRect[]`, `:138` `roiMode`.

**Design.** (a) Neues Zustandsfeld `drawTarget: "roi" | "bg-rect"` in `state.ts` mit Default `"roi"`; Umschalter als Segment-Button (`segBtn`, wie `img-profile`) im ROI-Panel von `views/image.ts`. (b) `overlayFromResult` (`main.ts:905-949`) liefert zusätzlich `bgRects: OverlayRect[]` und `activeBgRectIndex`. (c) `drawOverlay` zeichnet jedes bgRect in eigener Farbe (Kandidat `#C58BF2`, deutlich getrennt von ROI `#6FA8F5`, Suggestion `#8FD3FF`, D4σ `#5CE1A0`, Fit `#F2B33D`) über denselben Zwei-Pass-Recorder; Griffe über `drawRoiHandles` **nur** für das aktive Rechteck im bg-Modus. (d) Die Pointer-Kette wird um eine Ziel-Auflösung erweitert: im bg-Modus trifft `hitRoiEdit` gegen die bgRect-Liste (Treffer gewinnt, sonst „create"), Commit in `onRoiPointerUp` schreibt in `S.img.bgRects[i]` statt in die ROI-Felder. (e) Legendeneintrag `mark: "rect"` mit eigener Farbe, nur wenn mindestens ein bgRect sichtbar ist (`roiBoundaryVisible`). (f) Export: bgRects landen im PNG-Overlay-Export automatisch (gleicher Canvas) und werden in `buildAnalysisSummaryJson` mitgeführt, falls dort noch nicht vorhanden — **in-Stufe prüfen**.

**Akzeptanz-Orakel.** Unit (`image-view-functions.test.ts`, Muster VF-24 „renderImageTab produziert Markup ohne undefined/NaN"): der Umschalter erscheint nur bei `bgMethod ∈ {rect-median, robust-plane}`; `renderImageTab` bleibt leckfrei in beiden Modi und beiden Sprachen. e2e (`analyzer.spec.ts`): Bild laden → Methode `rect-median` → „Ecken füllen" → **vier violette Rechtecke im Overlay sichtbar** (Canvas-Pixelprobe an einer Ecken-Kante) und Legendeneintrag vorhanden; Modus auf „Hintergrund-Rechteck" → Drag im Bildinneren erzeugt ein **fünftes** bgRect und **verändert die ROI-Felder nicht**; Modus zurück auf „Mess-ROI" → Drag verändert wieder ausschließlich das ROI. Fail-before: alle drei e2e-Assertions scheitern heute.

**Regressions-Pins.** Bestehende e2e-Suite (`tests/e2e/analyzer.spec.ts`, 156 Zeilen), `image-view-functions.test.ts` VF-01..VF-27, `image-view-export.test.ts`. Keine Engine-Datei, keine released Zahl.

**Stop-and-Report.** (1) Wenn der Modus-Umschalter die bestehende ROI-Drag-Interaktion in **irgendeinem** Pfad verändert (Regression in VF/e2e) → HOLD. (2) Wenn die neue Farbe im Dark-Theme unter der Halo-Unterlage nicht trennscharf ist (Gemini-Light-Defekt-Pass) → Farbe neu wählen, vor dem Opus-X-Check.

**Nicht in dieser Stufe.** Kein Rotieren von bgRects, keine Snap-/Raster-Hilfen, keine Änderung an der Zahlen-Eingabe in `views/image.ts:1244-1265` außer der Modus-Kopplung, keine Engine-Semantik.

---

### Stufe H — P1: ROI-aus-Fit-Guard (V3)

**Scope.** `apps/web/src/main.ts`.

**Prämissen.** `main.ts:719-758` `roiRectFromReleasedWidths` — der released-Zweig (`:726-744`) ist geschützt, der **Fit-Fallback** (`:745-757`) prüft nur `gauss.converged && gauss.params` und konsultiert `fitGeometryIsReleasable` nicht. Verifiziert (V3, alle vier Sub-Claims CONFIRMED): Pure-Noise-Frame → `converged` mit A = −1640 und Zentrum (−7309, 2000) → angewendetes 1×128-Rect in 2 von 40 Frames; der Vollflächen-Modus umgeht zusätzlich die Nicht-Schrumpf-Klammer (`main.ts:2913-2922`, `ROI_NON_SHRINK_MIN_AREA_RATIO = 0.85`, `main.ts:698`).

**Design.** Zwei-Zeilen-Fix: im Fit-Fallback zusätzlich das in Stufe F exportierte `fitGeometryIsReleasable(params, aktuellerROI)` verlangen; schlägt es fehl, liefert die Funktion `null` und der Knopf verschwindet (`views/image.ts:1299-1302` rendert ihn bereits konditional). Zusätzlich: die Nicht-Schrumpf-Klammer auch aus dem Vollflächen-Modus heraus greifen lassen, indem der Vollframe als aktuelles Rechteck gilt.

**Akzeptanz-Orakel.** Pure-Noise-40-Frames-Satz: **0/40** angewendete Degenerat-Rechtecke (heute 2/40); die 1×128-Reproduktion muss verschwinden. Gesunder Strahl: der Knopf verhält sich unverändert (identisches Rechteck wie heute).

**Regressions-Pins.** `image-view-functions.test.ts` VF-20..VF-23 (Suggestion-Delta, ROI-State-Key), e2e-Bestand.

**Stop-and-Report.** Wenn der Guard auf einem gesunden Strahl greift → Prädikat-Domäne falsch (ROI vs. Bild), HOLD.

**Nicht in dieser Stufe.** Keine Änderung an `ROI_FROM_D4_SEMI_AXIS_FACTOR` (1.5) / `ROI_FROM_SIGMA_SEMI_AXIS_FACTOR` (6) / `ROI_NON_SHRINK_MIN_AREA_RATIO` (0.85). V2 (kumulative Schrumpfspirale) ist PARTIAL mit widerlegter Spirale und bleibt draußen.

---

### Stufe I — Re-Baseline und Gate-Spec §13

**Scope.** `Plan/S18_GATE_CALIBRATION_SPEC.md` (neue Sektion **§13**, direkt hinter §12, das bei Zeile 974–991 endet), `docs/theory/image_analysis.md`, `agents/verification/image_analyzer_cases.json`, `examples/expected-headless-summary.json`, `docs/validation/reference_cases.md`, die in A/B/D3/E/F angepassten Test-Pins.

**Inhalt von §13 „v2.0 hardening — measured behaviour changes and re-pinned curves":**
1. Vollständige Neumessung der SNR-Kurve nach A+B+E+F, gegen den Ist-Stand dieser Session (SNR 100: 15/15, thrMaj 3.000–3.091, thrMin 3.000; SNR 20: 15/15, thrMaj 14.273–15.578, thrMin 13.450–15.323).
2. Neuer Suppression-Grund `coverage_insufficient` mit Reihenfolge-Position, Kalibrierungstabelle (F8-Tabelle oben) und der ausdrücklichen Aussage, dass zufällige Masken bis 50 % benign sind.
3. Die drei neuen Honesty-Warnungen aus B mit ihren gemessenen Auslöse- und Schweigezahlen.
4. Die geänderten Konstanten mit Vorher/Nachher und der Messung, gegen die sie kalibriert wurden.
5. Die bewusst geänderten Orakel (`image-roi.test.ts:27-45`) mit Vorher/Nachher-Rechteck.
6. Dokumentierte Grenzen, die **nicht** gefixt wurden, inkl. F3-Yield (38.7 % Falsch-Suppression bei nValid 39/64 bei A=5; 100 % bei A ≤ 3) und der V5a-Befund, dass ein reiner Schwellen-Cap die pathologische Halo-Szene nicht von einer legitimen Low-SNR-Szene trennen kann (Messtabelle aus §4 b).

**Akzeptanz.** `npm test`, `npm run typecheck`, `npm run typecheck:web`, `npm run verify:headless`, `npm run verify:cases` grün; jede in §13 genannte Zahl ist durch ein laufendes Orakel oder ein archiviertes Repro belegt.

**Stop-and-Report.** Jede Kurven-Zelle, die unter ihren §10/§12-Wert fällt, ohne dass §13 den Grund und den Betreiber-Entscheid enthält.

**Nicht in dieser Stufe.** Keine Code-Änderung außer Test-Pin-Zahlen.

---

### Stufe J — P2: Doku-Konsolidierung

**Scope und vollständige Fundstellenliste (alle selbst gelesen):**

| Datei:Zeile | Befund | Korrektur |
|---|---|---|
| `docs/theory/image_analysis.md:166` | „`\|true error\| <= 2x the exported scatter` on 96 percent" — für Shot-Noise **falsifiziert** (F2: exportierter d4Scatter 9.6–191× zu klein) | Geltungsbereich auf additiv-gaußsches Rauschen einschränken; Shot-Noise-Fall explizit als offene Grenze benennen |
| `docs/theory/image_analysis.md:42` | Anker-Drift: Text nennt „decile-derived value-level anchor", Code nutzt IQR + \|median\| (Orakel M4 pinnt 1700×-Verbesserung); zusätzlich „practically unreachable once residuals sit inside the anchor" — **widerlegt** (bimodaler Rim erreicht iterations = 50) | beide Sätze auf den Code-Stand ziehen |
| `docs/guide/image_analysis.md:29-38` | „not yet a control" für bgRects, robuste Ebene und suggestRoi — **stale**, alle drei sind verdrahtet (`views/image.ts:1244-1286`, `main.ts:2875-2903`) | Absatz streichen/ersetzen; nach Stufe G zusätzlich den Zeichenmodus beschreiben |
| `docs/theory/image_analysis.md` §12-Bereich | Instrumenten-Verlustzonen fehlen | neuer Absatz: Wing-Sonden-Reichweite vs. ROI-Größe (Messreihe aus Stufe B), Alpha-Schwellen-Aufweitung mit σ_B, Tier-Check-Nichtverfügbarkeit |
| `docs/theory/image_analysis.md:188` | „Not in the v1.1 release gate" | Versionsbezug (in K) |
| C9-Randnotiz | `<6σ`-Kurzseiten-Trigger ist auf released Frames **unerreichbar** (Clipping-Gate erzwingt min(ROI) ≥ 12σ_min+1; 336 Geometrien, 0 Ko-Okkurrenz) | als dokumentierte Grenze notieren statt Code-Fix |
| C11a-Randnotiz | huberDelta 134.5 bei Level 1e8 ≈ 17 ULP — vertretbar | als bewusst akzeptierter Randfall notieren |
| `docs/architecture/CONVENTIONS.md:3` | Versionsbezug | in K |

**Kanal.** Manager-Handedit (deklariert), danach Opus-Review gegen den Code. Keine Code-Datei.

**Stop-and-Report.** Wenn eine Korrektur eine Zahl braucht, die kein Orakel und kein archiviertes Repro belegt → nicht schreiben, HOLD.

---

### Stufe K — Terminal: Version 1.1.0 → 2.0.0

**Vollständiges Fundstellen-Inventar (selbst verifiziert — hier weicht der Auftrag von der Realität ab):**

| Fundstelle | Ist |
|---|---|
| `package.json:3` | `"version": "1.1.0"` |
| `apps/web/index.html:49` | `"softwareVersion": "1.1.0"` im JSON-LD-Block ab `:41` |
| `apps/web/src/landing.ts:167` | Pill `v1.1` |
| `apps/web/src/views/chrome.ts:33` | `v1.1 · HEADLESS CORE` |
| `apps/web/src/guide.ts:182` | `ModeForge v1.1` im Guide-Stand |
| `docs/architecture/CONVENTIONS.md:3` | „active through the v1.1 release (S18)" |
| `docs/theory/image_analysis.md:3` und `:188` | „(v1.1 release)" / „Not in the v1.1 release gate" |
| `docs/guide/image_analysis.md:37` | „If those controls land before v1.1 ships" (entfällt bereits durch J) |
| `Plan/INDEX.md` | Zeilen mit v1.1-Zielangabe |

**Korrektur zum Auftragstext:** JSON-LD existiert **nur einmal** — `grep -n "ld+json" apps/web/*.html` liefert ausschließlich `apps/web/index.html:41`. `guide.html` und `workbench.html` tragen keinen JSON-LD-Block. Ebenso tragen `examples/README.md` und `docs/validation/reference_cases.md` **keine** Versionszeichenkette (`grep` über `v1.1` / `1.1.0` liefert dort nichts) — sie stehen nur dann auf der Liste, wenn J/I sie inhaltlich anfasst.

**Akzeptanz (Vollsuite, alle grün).** `node scripts/check-scope.mjs`, `npm test`, `npm run typecheck`, `npm run typecheck:web`, `npm run verify:headless`, `npm run verify:cases`, `npx playwright test`. Zusätzlich: `grep -rn "1\.1\.0\|v1\.1"` über den Produktionsbaum liefert außerhalb von `Plan/` (historische Dokumente) keinen Treffer mehr.

**Stop-and-Report.** Jeder rote Suite-Lauf; jeder verbleibende v1.1-Treffer außerhalb `Plan/`.

**Nicht in dieser Stufe.** Keine funktionale Änderung, kein Commit ohne Betreiber-Freigabe.

---

## §4 Design-Entscheide

### (a) Coverage-Gate: neuer Suppression-Grund, Diskriminator ist ein Modell-Bias-Schätzer

**Datenlage.** Neu gemessen (F8-Szene): zufällige Masken sind bis 50 % toter Pixel benign (|Fehler| ≤ 0.68 %); eine **strukturierte** Spalte von nur 3.4 % erzeugt +5.92 %. Ein reiner Bruchteil-Schwellwert müsste bei ~3 % liegen und würde damit die harmlose 5-%-Zufallsmaske mit-suppressen — er ist kein Diskriminator.

**Alternativen.**
1. *Konservativer Bruchteil (z. B. 2 %).* Einfach, aber Yield-Verlust auf harmlosen Kamerabildern mit verstreuten Defekten. Verworfen als alleiniger Arm.
2. *Struktur-Heuristik (Clustergröße/Kontiguität der Maske).* Kalibrierpflichtig, nie beweisbar, unklarer Übergang.
3. *Maske dem MC-Null-Modell aufprägen.* **Physikalisch wirkungslos** — die Alpha-Statistik vergleicht die 4σ- gegen die 6σ-Apertur derselben Realisierung; eine zentrale Spalte korrumpiert beide gleich, die beobachtete Delta bleibt klein (gemessen: dMaj 0.159 % bei col ±2, 0.164 % bei col ±5, 0.194 % bei col ±10 — praktisch unverändert gegenüber der Baseline 0.158 %). Der Blindspot ist strukturell und wird durch eine bessere Schwelle nicht geschlossen.
4. **Modell-Bias-Schätzer (Empfehlung).** Das gefittete Modell wird zweimal über die alpha-Apertur momentiert — vollständig und mit exakt der beobachteten Maske. Die relative d4-Differenz **ist** der induzierte Fehler. Neu gemessen: 0.373/−0.011/0.129/0.097/0.677 % für die fünf Zufallsmasken; 5.924 / 21.031 / 53.645 % für die drei Spaltenmasken; −20.583 / −5.778 % für die beiden Flankenmasken — jeweils auf drei Nachkommastellen deckungsgleich mit dem tatsächlichen Release-Fehler.

**Empfehlung.** Arm 4 als **Gate** (neuer Grund `coverage_insufficient`, eingeordnet nach `aperture_clipped` und vor `alpha_inconsistent`, mit Kandidatschwelle `COVERAGE_BIAS_MAX_PERCENT = 1.0`) **plus** ein `finiteFraction`-Arm (Kandidat 0.5, deckt den 250/5007-Fall, in dem auch die Modell-Momente unzuverlässig werden) **plus** eine nachgeordnete Warnung `IMAGE_COVERAGE_LOSS` für released Frames mit messbarem, aber unterschwelligem Bias.

*Warum Suppression und nicht nur WARNING:* Bei `aperture_clipped` suppressed das System heute schon wegen eines strukturell **unbekannten** Fehlers. Hier ist der Fehler **bekannt und beziffert** (+21 %, +53 %). Eine Zahl freizugeben, deren Fehler man auf drei Nachkommastellen ausrechnen kann, wäre die dishonestste Variante im ganzen Katalog. Der WARNING-Arm bleibt für den Graubereich darunter erhalten, damit die Yield-Kosten begrenzt sind.

*Kosten und I-3:* Der Pfad wird nur betreten, wenn im ROI überhaupt nicht-finite Pixel liegen **und** Gates 1–4 bestanden sind. Auf jedem sauberen Frame ist die Ausgabe bit-identisch, die Laufzeit unverändert.

### (b) Alpha-Schwellen-Cap: die vorgeschlagene Formel ist durch Messung widerlegt

**Prüfung der Verifikator-Formel** `min(max(3, 2.2·nullRms), 3·ALPHA_CONSISTENCY_MAX_PERCENT)` = min(thr, 9) mit fail-closed darüber, gegen die Live-Module gemessen:

| Szenenfamilie (8–15 Seeds) | gemessener Schwellenbereich | released heute | unter Cap 9 + fail-closed |
|---|---|---|---|
| σ 11×6 SNR 100 (Kurven-Orakel) | 3.00–3.13 | 15/15 | 15/15 (unberührt) |
| **σ 11×6 SNR 20 (Kurven-Orakel)** | **13.45–15.58** | **15/15** | **0/15 — Orakel tot** |
| σ 8×6 SNR 20 | 17.92–22.09 | 8/8 | 0/8 |
| σ 20×12 SNR 20 | 7.42–7.91 | 8/8 | 8/8 |
| σ 5×3 SNR 20 | 45.31–69.86 | 8/8 | 0/8 |
| σ 3×1.5 SNR 20 | 104.94–982.86 | 6/8 | 0/8 |
| σ 3×1.5 SNR 15 | 129.01–828.50 | 5/8 | 0/8 |
| **V5a-Halo-Pathologie** | **11.08 / 22.29 / 31.35** | released bei −39.2 / −40.1 / −40.0 % | suppressed |

Zwei Schlüsse. Erstens: ein Cap bei 9 zerstört den gepinnten SNR-20-Release-Wert komplett und darüber hinaus zwei ganze legitime Geometriefamilien. Zweitens — und schwerwiegender: die pathologische Halo-Szene (11.1–31.4 %) liegt **mitten im Band** der sauberen σ 8×6-SNR-20-Szenen (17.9–22.1 %). Der Schwellenwert allein kann die beiden Fälle grundsätzlich nicht trennen. Jeder Cap, der die Pathologie fängt, tötet legitime Releases; jeder Cap, der die legitimen Releases schont, lässt die Pathologie durch.

**Empfehlung.** (i) **Kein** harter Cap als Gate in v2.0. (ii) Sichtbarkeit: `IMAGE_ALPHA_GATE_WEAK` auf released Frames oberhalb `ALPHA_GATE_WEAK_PERCENT` (Kandidat 10 — schweigt bei σ 11×6 SNR 100 und σ 20×12 SNR 20, spricht ab σ 11×6 SNR 20). Der Operator erfährt damit exakt das, was heute fehlt: *dieser Konsistenztest hat bei diesem Rauschen nichts geprüft.* (iii) Eine absolute Todes-Grenze `ALPHA_GATE_DEAD_PERCENT` (Kandidat 100 — dort dürfen die zwei Aperturen unter reinem Rauschen um einen Faktor 2 auseinanderlaufen) mit fail-closed ist **verteidigbar**, kostet aber messbar Yield in der σ 3×1.5-Familie (105–983 %). Sie geht deshalb in den benannten Backlog, es sei denn Stufe B misst, dass die dokumentierte Kurve unberührt bleibt; dann darf sie mit Betreiber-Freigabe und §13-Eintrag mit.

**Interaktion mit F3 (38.7 % Falsch-Suppression bei A = 5):** keine. Der F3-Yield-Verlust entsteht aus `nValid < ALPHA_MC_MIN_VALID` (`aperture.ts:641`), also auf dem **fail-closed**-Pfad, nicht am Schwellenwert. Ein Cap würde diesen Pfad nicht berühren; umgekehrt: das in (iii) diskutierte fail-closed **addiert** sich auf F3 und träfe genau dieselben marginalen Geometrien doppelt. Das ist das stärkste Einzelargument, (iii) nicht in v2.0 zu schieben.

### (c) Wing-Proben-Degradation: beides, mit klar getrennten Reichweiten

**Datenlage** (neu gemessen, §3 Stufe B). Die Sondenreichweite bricht bei ROI ≤ 140 auf 6σ ein, der Excess sinkt mit ihr (1.7296 → 0.3637 → 0.1792 → 0.1265 → 0.0735 %), während der Boden konstant bei 0.300 % steht. Das saubere Kontroll-Gegenstück liest bei **jeder** ROI-Größe −0.0000 %.

**Alternativen.**
1. *Nur INFO auf Sondenverlust.* Ehrlich, nie falsch-positiv, aber sagt nichts über den konkreten Frame — die Warnung feuert auf jedem engen ROI gleich, ob Halo oder nicht.
2. *Nur `ABSORBED_POWER_MIN_FRACTION` senken.* Fängt die drei stillen Fälle (0.1792 / 0.1265 / 0.0735 % > 0.05 %), wirkt aber **ausschließlich im rauscharmen Regime**: für σ_B > 0 dominiert der Rausch-Arm `3·σ_B·√n/modelPower` den Boden ohnehin. Ohne Arm 1 bleibt die Reichweitenminderung unsichtbar.
3. *`ABSORBED_POWER_MIN_FRACTION` an die Sondenreichweite koppeln.* Verlockend, aber es koppelt zwei unabhängige Größen und macht den Boden geometrieabhängig — schwer zu dokumentieren, schwer zu prüfen.

**Empfehlung: 1 + 2.** Die Falsch-Positiv-Sorge bei Arm 2 ist messtechnisch entschärft: nicht-gaußsche Strahlen, deren Ein-Gauß-Fit einen echten In-Apertur-Rest lässt, erreichen den released-Zustand gar nicht — gemessen `superG n=2 → residual_high`, `superG n=4 → residual_high`, `ring → fit_not_converged`; die Warnung ist an `releasedStageB !== null` gebunden (`analyze.ts:1114`). Der Boden schützt also nur noch gegen Fit-Restfehler auf released, näherungsweise gaußschen Strahlen — genau das, was der 74-Szenen-Satz misst. **Harte Bedingung: 0/74 Fehlalarme, sonst bleibt der Boden bei 0.003.**

**Nicht empfohlen:** die Halo-Erkennung bei ROI 100 „reparieren" wollen. Bei ROI 100 liegt der Halo größtenteils **außerhalb** des ROI — auch Stage A sieht ihn nicht (gemessen: Tier-Gap nur 6.7 %, obwohl das Prädikat erfüllt ist). Die released Zahl 31.99 ist gegenüber der **512er-Frame**-Wahrheit 54.97 um 41.8 % zu klein, gegenüber der ROI-Wahrheit aber nicht falsch. Das ehrliche Instrument ist die Aussage „Leistung könnte außerhalb des ROI liegen und die Sondenreichweite ist reduziert", nicht ein Gate.

### (d) Tier-Check-Überleben bei invalider Stage A

**Datenlage** (neu gemessen, C6-Repro): Slope 1.0 → Warnung feuert; Slope 2.0/5.0 → Stage A invalid → Check schweigt, Release läuft weiter (d4-Bias −0.21 / −0.49 %, Centroid +0.23 / +0.57 px). Einziges Restsignal ist `IMAGE_MOMENTS_UNDEFINED(info)` — eine Aussage über die *diagnostische* Ebene, nicht über die released Zahl.

**Wichtige Präzisierung gegen den Auftragstext:** die V6b-Stille bei ROI 100 hat **nicht** dieselbe Ursache. Dort ist das Prädikat erfüllt (4·σ_A = 34.1 < 100, `plausible = true`); der Gap ist schlicht klein (6.7 %). C6 und V6b teilen das Symptom, nicht den Mechanismus — beide dürfen nicht in einen Fix zusammengezogen werden.

**Alternativen.**
1. *Prädikat lockern und trotzdem vergleichen.* Verworfen: bei Slope 5 ist Stage A `indefinite_covariance` — es gibt keine Zahl zu vergleichen.
2. *Fallback-Stage-A über der released 6σ-Box.* Verworfen: die Domäne fiele fast mit der Stage-B-Apertur zusammen, der „Cross-Tier"-Gap kollabierte auf ein Trunkierungs-Artefakt. Das Instrument wäre Theater.
3. **Explizites Nicht-Ausgewertet-Signal (Empfehlung).** `tierCheck: { evaluated: false, unavailableReason }` im Ergebnis plus `IMAGE_TIER_CHECK_UNAVAILABLE` (info) auf released Frames. Kostet nichts, ändert kein Gate, und schließt die Ehrlichkeitslücke an genau der Stelle, an der sie besteht: der Operator erfährt, dass die released Zahl **ungeprüft** ist, statt zu glauben, sie sei geprüft und in Ordnung.

**Empfehlung: 3.** Zusätzlich in §13 dokumentieren, dass die Wurzelursache (Stage B repariert die Rest-Rampe nie, `tiltedBackground` in `fit.ts:146` / `:1239` existiert und wird vom einzigen Produktions-Callsite nicht genutzt) für v2.0 bewusst **nicht** gefixt wird: der maximale released Bias ist mit 0.49 % / +0.57 px gemessen und liegt unter jeder Release-Schwelle.

### (e) F3-Discard-Politik: benannter Backlog, nicht v2.0

Vier Gründe. (1) Das Verdikt ist **PARTIAL** mit ausdrücklichem „kein stiller Fehler, nur Yield-Verlust". (2) Der Mechanismus wurde vom Reviewer **doppelt fehlattribuiert**: das Discard-Prädikat ist `indefinite_covariance` (`moments.ts:202`), nicht Hintergrund-Dominanz, und der dominante Treiber ist das observed-seitige Null-Delta-fail-closed (92/116) — „Discards als obere Verteilungsschwanz zählen" adressiert damit den Neben-Mechanismus. (3) `ALPHA_MC_MIN_VALID` anzuheben macht fail-closed **häufiger**, also genau die falsche Richtung für den Yield. (4) Jede Änderung hier verschiebt die Release-Kurve auf exakt den marginalen Geometrien, für die §10 bereits eine dokumentierte Grenze führt („~15 % CV bei N=32"). **v2.0 liefert: eine §13-Zeile mit den gemessenen Zahlen (38.7 % bei nValid 39/64 bei A=5; 100 % bei A ≤ 3).**

### (f) suggestRoi-Padding: Formel tragfähig, drei Guards nötig, Ort ist die Engine

**Herleitung.** Die Maske ist `wert > k·σ_B` mit k = 4 (`thresholds.ts:19`). Auf der Hauptachse durch den Peak liegt die Maskenkante bei `A·exp(−r²/(2σ²)) = T`, also `r = σ·sqrt(2·ln(A/T))`. Die Inversion `sigmaEst = halfExtent / sqrt(2·ln(peak/threshold))` ist damit korrekt — sie liest genau die Größe, die dem festen 8-px-Rand fehlt.

**Grenzfall-Validierung.**
- *`threshold = 0` (σ_B = 0):* `ln(∞)` → `sigmaEst = 0` → Rand fällt auf 8 zurück. Formal harmlos (bei Schwelle 0 umfasst die Maske ohnehin nahezu den ganzen Träger), aber **explizit zu guarden**, sonst entsteht `NaN`/`Infinity` je nach Auswertungsreihenfolge.
- *`peak/threshold → 1⁺`:* `ln → 0⁺` → `sigmaEst → ∞` → Rand → Vollbild. Guard: `SUGGESTED_ROI_MIN_PEAK_RATIO` (Kandidat √e).
- *Flat-Top:* die Gauß-Inversion **über**schätzt σ. Konkret am gepinnten Fixture `image-roi.test.ts:27`: Stempel 8×5 mit Wert 10, Schwelle 4, Ratio 2.5 → `sigmaEst_x = 4/1.354 = 2.95` gegen die wahre Uniform-σ von 4/√3 = 2.31, also +28 %; das Ergebnisrechteck wird zur geklemmten Vollfläche. Überpadding ist die **sichere** Richtung (das Clipping-Gate wird großzügiger bedient, der Rand-σ_B-Referenzrahmen wandert weiter vom Strahl weg), aber es ist eine bewusste Orakel-Änderung, die dokumentiert werden muss.
- *Mehrere Komponenten:* unverändert gewinnt nur die größte (`roi.ts:172-176`); ein zweiter Strahl außerhalb der gepolsterten Box bleibt draußen. Kein Rückschritt; das Instrument dafür ist das Multi-Peak-Gate.
- *Rotiert/anisotrop:* die achsparallelen Halbausdehnungen der Bounding-Box sind exakt die Größen, die `evaluateClippingGate` (`aperture.ts:274-291`) testet — die **achsweise** Inversion ist deshalb die richtige Form, eine skalare wäre falsch.
- *`sigmaEst` degeneriert (0, NaN, negativ):* fester Rand.

**Ort.** **`roi.ts` (Engine)**, nicht die UI. Drei Gründe: (1) `analyze.ts:711-716` ruft `suggestRoi` und exportiert das Ergebnis in `roi.suggestion` — ein UI-Fix ließe den API-/Headless-Pfad kaputt; (2) `scripts/check-scope.mjs:61-66` verbietet `apps/web/src` den Direktimport von Physik-Paketen, eine UI-Reimplementierung wäre Physik im View-Layer; (3) die UI-Handler (`main.ts:2875-2903`) übernehmen das Rechteck wörtlich und sollen das auch weiter tun.

**Rückwärtskompatibilität.** Ein explizit übergebenes `paddingPx` behält exakte Override-Semantik; nur der Default-Pfad ändert sich. Damit bleiben `image-roi.test.ts:53-60`, `:76-83`, `:123-128` und auch `:43` (`paddingPx === 8`) grün — nur die Rechteck-Erwartung `:36` ändert sich.

---

## §5 Benannter Backlog (bewusste Verschiebungen)

**Explizit nicht gefixt (Verdikt REFUTIERT / vernachlässigbar / fundamental) — aus Triage §9:**
- **C7** (MC-σ/b ignoriert Common-Mode) — REFUTIERT; die Prämisse ist leer (MAD ist shift-invariant), und für korrelierte FPN ist σ/b zu **klein**, das Gate also über-streng, Gegenrichtung.
- **C8b** (Bias durch Rects auf Ausläufern) — Bias REFUTIERT, bit-identisch zur sauberen Referenz (Stage-B `B_eff = 0` kürzt die flache Über-Subtraktion exakt).
- **C8c** (Dark mit falscher Belichtung) — REFUTIERT, ≤ 0.02 pp; `TIER_DISAGREEMENT` feuert bereits dediziert.
- **V2** (kumulative Schrumpfspirale) — PARTIAL, Spirale widerlegt (Fixpunkte nach 1–3 Schritten, Ratios 0.9266 → 0.9615 → 1.000).
- **C1** (Smooth-Tail-Bias) — Zahlen exakt, Impact widerlegt: im gesamten releasenden Bereich Bias ≤ 1e-16 Counts.
- **V5d** (Partial-Block-Pooling) — Effekt 0.0004 %.
- **V6c-Instabilität** — REFUTIERT (Alpha-Deltas 0.13–2.17 % gegen Schwellen 3.0–4.7 %).
- **F1-Breiten-Konsequenz** — +0.14 % max über 27 released non-converged Fälle; der `IMAGE_BACKGROUND_*`-Warncode für `converged === false` ist als P1 gelistet, wird aber in v2.0 **nicht** gebaut: er hätte in Lane 1 einen weiteren seriellen Slot gekostet, bei einem Effekt von 0.14 %. → Backlog v2.1.

**v2.1-Kandidaten (bewusst verschoben, mit Begründung):**
1. **Poisson-/Gain-Term im MC (F2).** Der exportierte `d4Scatter` ist unter Shot-Noise 9.6–191× zu klein. v2.0 liefert nur die Doku-Korrektur (`theory:166`, Stufe J); das Rauschmodell bleibt additiv-gaußsch. Ein Gain-Term wäre eine Änderung an `evaluateAlphaConsistencyGate` und damit an jeder Schwelle im System.
2. **Harte Alpha-Todes-Grenze `ALPHA_GATE_DEAD_PERCENT`** (§4 b, Punkt iii) — messbarer Yield-Verlust auf der σ 3×1.5-Familie, addiert sich auf F3.
3. **F3-Discard-Politik** (§4 e) — Mechanismus fehlattribuiert, Yield-Richtung unklar.
4. **V2-Baseline-Anker für die ROI-Iteration** — optional, Spirale widerlegt; ein Anker auf das erste Rechteck würde die Fixpunkt-Suche stabilisieren, ist aber kein Defekt-Fix.
5. **C8a UI-Hinweis** (strahlförmige Hot-Corner ohne Laser released, 11.9831×7.9861 exakt reproduziert) — fundamentale Ein-Frame-Grenze; `NOISE_SCALE_SUSPECT(warning)` feuert bereits. Kandidat: ein UI-Satz „ein einzelner Frame kann eine strahlförmige Struktur nicht von einem Strahl unterscheiden".
6. **Second-pass suggestRoi hinter dem Fit** (§4 f) — genauer als die Masken-Inversion, aber Umordnung von `analyze.ts:711-716` gegenüber `:754-773`.
7. **`tiltedBackground` im Produktions-Fit** (C6-Wurzelursache) — max released Bias 0.49 %, Centroid +0.57 px.
8. **Adaptive Radial-Bin-Zahl** — dokumentierter Rest aus Spec §10 (Bin-1-Auflösungsgrenze, +12 % bei σ=2).

---

## §6 Risiken und Rollback

| Risiko | Wahrscheinlichkeit | Wirkung | Gegenmaßnahme |
|---|---|---|---|
| Stufe A verschiebt die Release-Kurve trotz Bedingungspfad | niedrig | I-1 gebrochen | Pfad hart an `nonFiniteCount > 0` **und** `earlyGatesPassed` binden; Kurven-Orakel als erster Test der Stufe; Stop-and-Report A-(1) |
| Stufe F (robuster peakCorr) verschiebt Residual-Ceiling auf Kurven-Szenen | **mittel** | Kurve ändert sich | Stufe F misst die Kurve **vor** dem Commit; auf `residualMaxAllowed` dominiert normalerweise der 2σ_B-Arm; HOLD mit gemessener Kurve bei jedem Rückgang |
| Stufe E (C2 √(n/(n−3))) ändert σ_B und damit alle Schwellen im analyze-Pfad | **hoch (beabsichtigt)** | Referenz-Artefakte verschieben sich | Als Verhaltensänderung deklariert; Zahlen wandern nach §13; `expected-headless-summary.json` und `image_analyzer_cases.json` in Stufe I nachziehen |
| Stufe D3 überpaddet Flat-Top-Szenen bis zur Vollfläche | mittel | Vorschlag wird nutzlos-groß | Bewusst akzeptiert (sichere Richtung), Guards + `clampedToImage`; falls in der Praxis störend: Backlog-Punkt 6 |
| Boden-Absenkung in B erzeugt Fehlalarme | niedrig (0/74 erwartet) | Ehrlichkeitsverlust in die Gegenrichtung | Harte 0/74-Bedingung, sonst nur Arm 1 |
| Lane-Kollision auf `thresholds.ts` / `i18n.ts` / `core/warnings.ts` | mittel | Merge-Konflikte | I-7: append-only mit benanntem Block; HOLD-Report listet die Keys |
| Neue `ApertureAssessment`-Felder brechen `fallbackAperture` | mittel | Typfehler / stille Null-Lücke | I-8: jede aperture-formändernde Stufe fasst `analyze.ts:333-397` zwingend mit an; `npm run typecheck` als Stufen-Gate |
| UI-Zeichenmodus bricht die bestehende ROI-Drag-Kette | mittel | Regression im Kernflow | Gemini-Light-Defekt-Pass vor dem Opus-X-Check; e2e-Assertion „Modus zurück → ROI verhält sich wie zuvor" |
| Arbeitsbaum ist bereits dirty (24 modifizierte Dateien, S17/S18) | gegeben | Vermischte Diffs | Jede Stufe committet nur ihre eigenen Dateien; der HOLD-Report nennt die Dateiliste; kein `git add -A` |

**Rollback-Strategie.** Jede Stufe ist ein eigener Commit hinter HOLD. Lane 1 ist seriell, also linear rückrollbar (F → E → B → A). Lane 2 und Lane 3 sind dateidisjunkt zu Lane 1 und einzeln revertierbar. Stufe I darf erst starten, wenn alle Gate-Stufen freigegeben sind; ein Revert einer Gate-Stufe **nach** I erzwingt eine Neumessung von §13. Stufe K ist rein mechanisch und jederzeit isoliert revertierbar.

**Oracle-Fundus (wiederverwendbar, Repo unberührt).**
`scratchpad/opus-codex-verify/`: `lib.mjs` (Szenen-Generatoren, mulberry32/Box-Muller identisch zur Produktion), `f8.mjs` (Coverage-Tabelle, Stufe A), `f4*.mjs` (Offset-Verdikt-Flip, Stufe F), `f3*.mjs` (Yield, Backlog), `f56.mjs`/`f5b.mjs` (TIFF-Tags, Stufe D1), `f7.mjs` (physisches q, Stufe F), `f2*.mjs` (Scatter unter Shot-Noise, Stufe J).
`scratchpad/opus-codex-verify2/`: `lib.mjs`, `v1_suggest_apply.mjs` + `v1b_boundary.mjs` (Stufe D3), `v3_edge.mjs`/`v3g_sweep.mjs`/`v3h_noise.mjs` (Stufe H), `v4_wedge.mjs`/`v4b_wedge_hunt.mjs` (Stufe D2), `v5.mjs`/`v5b.mjs`/`v5c.mjs` (Stufen A/B/F), `v6.mjs` (Stufe B, Wing-Sonden), `uiport.mjs` (UI-Portierung der ROI-Ableitung, Stufe H).
`scratchpad/opus-codex-verify3/`: `lib.ts`, `c234.test.ts` (Stufe E), `c5.test.ts` (Stufe E), `c6.test.ts` (Stufe B/D-Entscheid), `c8911.test.ts`, `c10b.test.ts` (Stufe E), `followup.test.ts`, `final.test.ts`.
Diese Skripte importieren die Live-Module per `file://` und schreiben nichts ins Repo; sie sind als Fail-before/Pass-after-Orakel jeder Stufe direkt lauffähig (Node 24, `node --test` für die `.test.ts`).

---

---

## §7 Cross-Review-Revisionen (v2 — verbindlich über v1)

**Review-Verlauf (Drei-Legs, alle unabhängig, anti-anchored Peer-Brief, alle NEEDS-REVISION):**

| Leg | Modell (Routing-Nachweis) | Verdikt | Findings |
|---|---|---|---|
| 1 | Codex **gpt-5.6-sol, xhigh** (CLI-Echo; Betreiber-Effort-Direktive) | NEEDS-REVISION | C-R01..C-R30 (12 HIGH / 17 MED / 1 LOW) |
| 2 | **Gemini 3.1 Pro (High)** via Zweit-Reviewer-Kanal (Selbstauskunft im Report) | NEEDS-REVISION | G-F1 HIGH, G-F2 LOW; 10 Prämissen-Spot-Checks TRUE |
| 3 | **Claude Opus 5** frisches Agent-Leg (Session-Effort max; Agent-Tool bietet keinen xhigh-Regler — ehrlich vermerkt) | NEEDS-REVISION | O-R01..O-R30 (6 HIGH / 17 MED / 7 LOW), ~35 Code-Reads + Closed-Form-Nachrechnungen |

**Kanonische R-Reihe:** O-R01..O-R30 werden unverändert zur kanonischen Reihe **R-01..R-30**; Gemini- und Codex-Findings sind eingemappt (Spalte „auch"), Codex-eigenständige Findings werden **R-31..R-45** angehängt. Wo v2 v1 widerspricht, gilt v2.

### 7.1 Adjudikation R-01..R-30 (Opus-Reihe; Architekten-Entscheid je Zeile)

| R | Sev | auch | Entscheid | Verbindliche Revision |
|---|---|---|---|---|
| R-01 | HIGH | C-R07 | **angenommen** | `finiteFraction`-Kandidat 0.5 gestrichen; Arm wird aus der Berechenbarkeitsgrenze der Modell-Momente abgeleitet (Startkandidat 0.2) und in der Stufe-A-Kalibrierkampagne (≥8 Seeds Random-Familie) gemessen, bevor gepinnt wird. Der random-50%-Pflicht-Release-Fall darf nie auf einer Suppressions-Kante liegen (Mindestabstand Faktor 2). |
| R-02 | HIGH | — | **angenommen** | Robuster Peak wird σ-bewusst (Guard `robustPeak ≥ c·rawPeak`, c aus σ∈{1,1.5,2,3}-Kalibrierung) statt naivem 3×3-Median; Stufe-F-Akzeptanz erhält σ≤2-px-Release-Szenen. |
| R-03 | HIGH | C-R25 | **angenommen** | `views/image.ts` in Stufe-H-Scope; Button-Render und Klick-Handler teilen EIN Eligibility-Ergebnis; Orakel: Knopf **abwesend** (nicht nur wirkungslos) auf dem Pure-Noise-Satz. |
| R-04 | HIGH | C-R24 | **angenommen** | Vollframe-als-current-Addendum ersatzlos gestrichen; der V3-Bypass ist durch den Geometrie-Guard (R-09-Revision) neutralisiert. Vollframe-Ausnahme der Klammer bleibt wie heute dokumentiert. |
| R-05 | HIGH | C-R11 | **angenommen** | V6a-Tie-Break aus D3 **gestrichen** → benannter Backlog (korrekte Mechanik: relative Peak-Äquivalenz-Toleranz oder Massen-Statistik; kein exakter-Tie-Fix, der Code-Kommentar roi.ts:170 behält recht). |
| R-06 | HIGH | — | **angenommen** | `COVERAGE_BIAS_MAX_PERCENT` wird nicht aus einer Szene gesetzt: Stufe-A-Kalibrierkampagne = 74er-Clean-Set + ≥10 Seeds Random-Masken + asymmetrische Masken (R-12) + Pedestal (R-29); Schwelle = gemessenes Clean-Maximum × dokumentierte Marge, §11.7-Stil. Bis die Kampagne steht, kein Gate-Pin. |
| R-07 | MED | C-R17 | **angenommen** | `packages/core/src/warnings.ts` + `apps/web/src/i18n.ts` in Stufe-E-Scope (I-7 additiv); Audit-Regel: jede Stufe mit neuem Code prüft die Union. |
| R-08 | MED | C-R20 | **angenommen** | `coverage_insufficient` bekommt Owner für die Nutzer-Oberfläche: Reason-Label-Map `views/image.ts:512-523` + i18n-Keys in Stufe A; Guide-Enumerationen (guide.ts:52/:121, docs/guide) in Stufe J-Fundstellenliste. |
| R-09 | MED | C-R26 | **angenommen, schärfere Variante** | Kein UI-Import des Prädikats: `analyze.ts` exportiert das Verdikt als **Result-Feld** (`fits.gauss2d.geometryReleasable: boolean`, additiv) in Stufe F; Stufe H konsumiert Daten statt Physik. `packages/api`-Barrel unberührt. |
| R-10 | MED | C-R29, C-R27 | **angenommen, Politikwechsel** | Rot-Fenster abgeschafft: **jede verhaltensändernde Stufe zieht ihre direkt betroffenen Pins/Referenz-Artefakte selbst nach** (`image_analyzer_cases.json`, `expected-headless-summary.json`, betroffene Test-Zahlen) — `npm test` ist nach JEDER Stufe grün (HOLD-kompatibel). Stufe I behält integrierte Cross-Stage-Neumessung + §13. D3-Pin-Liste korrigiert (headless-summary trägt keine Suggestion-Felder). Zusätzlich R-43. |
| R-11 | MED | **G-F1**, C-R02 | **angenommen** (3-fach konvergent) | Lane-Regel präzisiert: Während Stufe B ihren `thresholds.ts`-Exklusiv-Slot hält, darf Lane 2 nur D1/D2 fahren; **D3 ist nach B serialisiert**. Rollback-Aussage „Lane 2/3 dateidisjunkt" gestrichen; geteilte Dateien (I-7-Liste) machen Stufen-Reverts ordnungsgebunden. |
| R-12 | MED | C-R06 | **angenommen** | Schätzer wird als modell-konditionierte Sensitivität geführt; Kalibrierkampagne enthält ≥1 asymmetrische Maske (einseitige Spalte, randnaher Block) und releasable Non-Gauss-Fälle; degradiert die Übereinstimmung → Stop-and-Report + Schwellen-Verbreiterung oder WARNING-only-Downgrade. |
| R-13 | MED | — | **angenommen** | Trigger und Maske hart auf das **`corrected`-Feld** gepinnt (Stage-B-Feld ist ROI-exterior-NaN-maskiert; I-3 würde sonst kollabieren). Erstes Stufen-Orakel prüft genau das. |
| R-14 | MED | — | **angenommen** | 0/74-Bedingung ersetzt/ergänzt durch noise-free-Sweep σ∈{1,1.5,2,3,6,11} × Subpixel-Phasen für den `ABSORBED_POWER_MIN_FRACTION`-Boden; `image_analysis_gauss.headless.json` (σ=1, σ_B=0, warningCount-Pin 4) explizit in die Akzeptanz. |
| R-15 | MED | — | **teilweise** | Warnung bleibt (die Aussage „Test hatte keine Trennschärfe" ist auch auf legitimen Low-SNR-Releases wahr und gehört dorthin), aber: Severity **INFO** statt WARNING, Text präzisiert, Firing-Rate auf dem 74er-Set gemessen und in §13 dokumentiert. Kein Zweitsignal-Koppel (hätte genau die R-33-Diskriminierungs-Illusion wieder eingebaut). |
| R-16 | MED | C-R14 | **angenommen** | `√(n/(n−3))` ersetzt durch **trace-basierte Korrektur** `σ̂·√(n/(n−tr(H)))` (Leverage h_i existiert, background.ts:496-509); Codex-Zusatz beachtet: Kalibrierung erfolgt am tatsächlichen Skalenschätzer (MAD/IQR nach IRLS), in-Stufe an BEIDEN verifizierten Fixtures (−41.1 % / −24.5 %) auf ≤5 % Rest gemessen. |
| R-17 | MED | — | **angenommen** | Ein Mindest-n-Regime statt zwei: degrade-and-flag (`scaleSource:"floor"` + `IMAGE_NOISE_SCALE_SUSPECT`), Ebenen-Korrektur bleibt erhalten; `RangeError` nur für geometrisch Unfittbares (bestehende Guards). 6≤n<9-Zone damit definiert. Ergänzt durch R-37. |
| R-18 | MED | G-F2 | **angenommen** | D3-Akzeptanz erhält Non-Gauss-Familie (Super-Gauß n=2/4, Flat-Top, Ring) bei A/σ_B ≥ 1e4; Padding erhält **Floor auf Masken-Extent** (pad ≥ β·halfExtent, β in-Stufe kalibriert) gegen das nachgerechnete Unter-Padding bei hoher Dynamik; sigmaEst-Finiteness-Guards explizit (G-F2). |
| R-19 | MED | — | **angenommen** | Akzeptanz-Kriterium: „≥ 6.25 σ_fit **oder** an der bindenden Bildkante geklemmt"; Rand-Strahl-Orakel ergänzt (ehrliche `aperture_clipped`-Suppression bleibt dort korrekt). |
| R-20 | MED | C-R13 | **angenommen** | D2: Kandidat der neuen Konstante benannt (**1e-3**, ~10× über gemessenem Max 1.04e-4, ~15× unter nötigem Schritt 1.56e-2), `lastAcceptedRelParam`-Tracking als Implementierungsdetail festgeschrieben; Status-Sweep auf `fitGauss1d`/`fitSuperGauss2d` ausgeweitet; Sweep versioniert (R-32). |
| R-21 | MED | — | **angenommen** | dtype-Gleichheit der **decoded** dtypes bleibt als Guard (uint8-vs-uint16-Mismatch), beide Lanes casten nach float32; kombiniert mit R-35. |
| R-22 | MED | — | **angenommen** | Invariante: `drawTarget` fällt auf `"roi"` zurück, sobald der bg-Rect-Editor nicht gerendert wird; Unit-Pin + e2e-Übergang (Methode→none→Drag editiert ROI). |
| R-23 | MED | — | **angenommen** | Kurven-Orakel wird **vor Stufe F** um σ_B=2 (SNR 50) und σ_B≈3.33 (SNR 30) erweitert (Stufe 0b), sonst wären zwei Zellen der Doku-Kurve ungepinnt. |
| R-24 | LOW | — | **angenommen** | `paddingXPx`/`paddingYPx` werden autoritativ dokumentiert, `paddingPx` als Basis umbenannt/beschrieben; `clampedToImage`-Semantik nach der Änderung neu bewertet und dokumentiert. |
| R-25 | LOW | — | **angenommen** | I-8 ergänzt: `fallbackAperture` behält auf dem null-params-Pfad die **rohen** Formeln (bewusst, dokumentiert) — Stufe F schreibt den Intent als Kommentar + Pin fest. |
| R-26 | LOW | — | **angenommen** | `orientationContrastQPhysical` wird zusätzlich exportiert; Warnung zitiert das Feld, das sie testet. |
| R-27 | LOW | C-R03 | **angenommen** | Depends-on korrigiert: J hängt zusätzlich an G; K hängt zusätzlich an C, D1, D2, G, H (All-Code-Barriere). |
| R-28 | LOW | C-R23 | **angenommen** | bgRects-Export entschieden: expliziter Export-Kontext-Parameter (Signaturänderung `buildAnalysisSummaryJson`), `image-view-export.test.ts` in G-Scope; PNG-Overlay ohnehin. |
| R-29 | LOW | — | **angenommen** | Schätzer rastert **Beam-Term only** (Stage-B-Semantik); Pedestal-Szene in die Kalibrierkampagne. |
| R-30 | LOW | — | **angenommen** | Non-Finite-Erkennung in die bestehende Peak-Schleife gefaltet (ein Branch); Kostenaussage präzisiert. |

### 7.2 Adjudikation Codex-eigenständiger Findings (R-31..R-45)

| R | Sev | Quelle | Entscheid | Verbindliche Revision |
|---|---|---|---|---|
| R-31 | HIGH | C-R01 | **angenommen** | **Neue Stufe 0a: S18-Baseline-Commit.** Der gesamte S18-Stand (25 modifiziert, 53 untracked inkl. packages/image komplett) wird VOR jeder S20-Stufe als sauberer Baseline-Commit gelandet (nach Betreiber-Freigabe; Orchestrierung-Feedback-Memos in agents/ ausgenommen wie geplant). Ohne Baseline sind Stufen-Commits/-Reverts nicht scope-treu. |
| R-32 | HIGH | C-R04 | **angenommen** | **Neue Stufe 0b: Orakel-Korpus versionieren.** Die Repro-Skripte aus den drei Verifikations-Scratch-Verzeichnissen werden als deterministische, `node --test`-fähige Fixtures nach `agents/verification/s20-repros/` portiert (Teil der Baseline; Kommandos + Erwartungswerte dokumentiert). §6-Oracle-Fundus-Absatz wird auf die versionierten Pfade umgestellt. Zusätzlich: SNR-50/30-Orakel (R-23) hier. |
| R-33 | HIGH | C-R05 | **teilweise — Betreiber-Entscheid** | Codex' Sachverhalt stimmt: Stufe B lässt die −40 %-Halo-Fälle released (mit Sichtbarkeits-INFO). Die §4b-Messung zeigt aber, dass fail-closed am Schwellenwert legitime Familien tötet (0/15-Kurven-Orakel) und die Pathologie nicht trennscharf ist. **Der Release-Contract ist Betreiber-Entscheid**: Option (a) Sichtbarkeit (Plan-Empfehlung, kein Yield-Verlust) vs. (b) zusätzlich `ALPHA_GATE_DEAD_PERCENT=100`-Todesgrenze (fängt σ_B≳150-Extreme, kostet die σ3×1.5-Familie). B wird als „P0-2-Mitigation (Sichtbarkeit); Contract-Verschärfung optional per Betreiber" etikettiert. |
| R-34 | MED | C-R08 | **angenommen** | Stufe-A-Akzeptanz erhält Laufzeit-/Speicher-Pin für einen maximalgroßen early-gates-passed Frame mit 1 NaN (Schätzer ist O(Apertur), aber der Pin gehört ins Orakel). |
| R-35 | HIGH | C-R09 | **angenommen** | Dark-Lane: Cast über `Float32Array.from` (nicht `Array.from`) — bit-identische float32-Repräsentation beider Lanes; uint32>2²⁴-Paritäts-Orakel; kombiniert mit R-21 (decoded-dtype-Guard bleibt). |
| R-36 | MED | C-R10 | **angenommen** | `views/image.ts` in Stufe-C-Scope; `darkError` als getypte Fehlerart (Dimension vs. Decode) gerendert; zweisprachige Tests beider Fälle. |
| R-37 | MED | C-R15 | **angenommen** | Mindest-Stichprobe **degradiert die Methode** (reject → `none`-Fallback + Warncode), nicht nur die Skalen-Beschriftung — ein 1×1-Offset wird also nicht mehr angewendet; erwartetes Verhalten (corrected, method, sigma, source, warning) vollständig gepinnt. Ersetzt die schwächere v1-Formulierung von E(b). |
| R-38 | MED | C-R16 | **angenommen** | C5-Trend-Warnung bekommt spezifizierte Statistik (normalisierter Between-Rect-Trend gegen In-Rect-Streuung), Schwelle mit FP-Budget und Negativ-Kontrollen (flat-noisy, ungleiche Rects, harmloser Offset, Beam-Tail, echter Gradient). |
| R-39 | MED | C-R18 | **angenommen** | Robuster Peak: Rand-/Non-Finite-Nachbar-Semantik definiert (finite-only Median, Kanten-Fenster geklemmt); nach Stufe F werden ALLE Stufe-A-Coverage-Fixtures re-run (Interaktion released-random-Masken × Median-Peak); schmale-σ-Pins ergänzt (mit R-02). |
| R-40 | MED | C-R19 | **angenommen** | `tierCheck.unavailableReason` als diskriminierte Union; Akzeptanz testet alle drei Unavailable-Zweige + evaluated-below-threshold + disagreement. |
| R-41 | MED | C-R21 | **angenommen** | Stufe G: bg-Rect-Modus erzwingt (oder bietet prominent) die Vollbild-Ansicht — im Default-Closeup wären Ecken-Rechtecke unsichtbar/uneditierbar; e2e: analyzed-closeup → Modus → Ecken sichtbar/editierbar + PNG-Export. |
| R-42 | MED | C-R22 | **angenommen** | G-Akzeptanz deckt Select/Move/Edge-Corner-Resize/Overlap-Präzedenz/Removal/Methoden-Reset ab, nicht nur Create; Active-Index-Semantik spezifiziert. |
| R-43 | MED | C-R27 | **angenommen** | Nach Stufe E wird der komplette D3-Apply-Korpus (0/15-clipped-Ziel) für `none`/`rect-median`/`robust-plane` erneut gefahren (σ_B-Konsument!); Eintrag in E-Akzeptanz. |
| R-44 | MED | C-R28 | **angenommen** | suggestRoi nutzt robusten Komponenten-Peak (Hot-Pixel würde σEst verkleinern → wieder clipped); Hot-Pixel-, Rotations-, Subpixel- und Guard-Grenz-Fixtures mit exakter Erwartung in D3. |
| R-45 | LOW | C-R30, C-R12 | **angenommen** | Stufe K inventarisiert auch `package-lock.json` (Root-Versionen, heute 1.0.0) mit Gleichheits-Validierung auf 2.0.0; Stufe D1 nutzt `expectTagType(274, "Orientation", [3])` + Count-1-Validierung + Malformed-Fixtures. |

### 7.3 Stufenschnitt nach v2

- **Neu: Stufe 0a** (S18-Baseline-Commit, Betreiber-Freigabe erforderlich) → **Stufe 0b** (Orakel-Korpus `agents/verification/s20-repros/` + SNR-50/30-Kurven-Orakel). Beide vor allen anderen Stufen.
- **Stufe A** erhält eine Kalibrierkampagne als Schritt 0 (Clean-Set + Multi-Seed-Random + asymmetrisch + Pedestal + Non-Gauss-releasable), bevor Schwellen gepinnt werden; Trigger-Feld `corrected`; Reason-Oberfläche (R-08); Laufzeit-Pin (R-34).
- **D3 nach B serialisiert** (R-11); V6a raus (R-05); Non-Gauss-Familie + Masken-Extent-Floor + robuster Komponenten-Peak rein (R-18/R-44).
- **Stufe C**: decoded-dtype-Guard bleibt, Float32Array-Cast, `views/image.ts` im Scope (R-21/R-35/R-36).
- **Stufe F**: σ-bewusster robuster Peak (R-02/R-39), Result-Feld statt Prädikat-Export (R-09), fallbackAperture-Intent (R-25), q-Physik-Export (R-26).
- **Stufe H**: Eligibility geteilt, Knopf-Abwesenheits-Orakel, Vollframe-Addendum gestrichen (R-03/R-04).
- **Artefakt-Ownership**: jede verhaltensändernde Stufe pinnt ihre Artefakte selbst; Suite nach jeder Stufe grün (R-10); D3-Re-Run nach E (R-43).
- **Depends-on**: J += G; K += C, D1, D2, G, H (R-27).

### 7.4 Betreiber-Entscheide (2026-08-23, beide gefallen)

2. **R-33: ENTSCHIEDEN — Option (a) Sichtbarkeit ohne Gate.** Der Release-Contract bleibt; die INFO-Meldung (R-15-Fassung) trägt die Ehrlichkeit. `ALPHA_GATE_DEAD_PERCENT` bleibt v2.1-Backlog-Kandidat.

### 7.5 Status nach v2

NEEDS-REVISION aller drei Legs eingearbeitet (45 kanonische R-Findings: 43 angenommen, R-15 teilweise, R-33 per Betreiber Option a). §7.4 entschieden. **Delta-Re-Review-Runde läuft** (Betreiber-Zuschnitt: ZWEI Legs — frisches Opus-Leg + Codex gpt-5.6-sol xhigh — auf §7/v2 als letzte Prüfung vor der Implementierung); bei PASS starten die Implementierungs-Delegationen nach Lane-Plan v2.

---

## §8 Delta-Re-Review-Revisionen (v3 — verbindlich über v2 und v1)

**Review-Verlauf Runde 2 (Delta auf §7; Betreiber-Zuschnitt zwei Legs):**

| Leg | Modell (Routing-Nachweis) | Verdikt | Findings |
|---|---|---|---|
| 1 | Codex **gpt-5.6-sol xhigh** (CLI-Echo) | NEEDS-REVISION | CX-D01..D08 (3 HIGH / 4 MED / 1 LOW) |
| 2 | **Claude Opus 5** frisches Agent-Leg (Session-Effort; kein xhigh-Regler — vermerkt) | NEEDS-REVISION | OP-D01..D16 (5 HIGH / 7 MED / 4 LOW); 10 Spot-Checks der §7-Kernmechanismen TRUE (inkl. Baseline `9db4fbd` vollständig, R-09/R-13-Mechanik, E-Kurven-Immunität, 0b-Korpora auf Platte vorhanden) |

Verbatim-Archive beider Runden: `Plan/S20_PLAN_REVIEW_R1_LEGS.md` (Runde 1, drei Legs) und `Plan/S20_PLAN_REVIEW_R2_DELTA.md` (Runde 2, zwei Legs) — R-57.

### 8.1 Adjudikation (kanonische Reihe R-46..R-61; alle angenommen außer wo vermerkt)

| R | Sev | Quellen | Verbindliche Revision |
|---|---|---|---|
| R-46 | HIGH | CX-D01 + OP-D02 (konvergent, beide mit Herleitung) | **R-16-Formel ersetzt — sie war algebraisch leer** (Σh_i = tr(H) = 3 exakt beim 3-Parameter-Design; „trace-basiert" ≡ √(n/(n−3))). Neue bindende Fassung: **empirisch kalibrierte Korrektur c(n, Layout)** am tatsächlichen Skalenschätzer (MAD/IQR auf IRLS-Huber-Residuen), hergeleitet in Stufe E per Schritt-0-Messkampagne über die Referenz-Layouts (Einzel-Rect, Ecken-Cluster, Rand-Ring; Huber-ψ-effektive-DoF als Startansatz); Akzeptanz bleibt hart: ≤5 % Restfehler auf beiden verifizierten Fixtures **soweit deren n zulässig ist** (vgl. R-47). |
| R-47 | HIGH | CX-D03 + OP-D01 (konvergent) | **R-17/R-37-Konflikt aufgelöst — EIN Regime:** `n < BACKGROUND_MIN_REFERENCE_SAMPLES` ⇒ die METHODE degradiert zu `none` (kein Offset/keine Ebene wird angewendet) + `scaleSource:"floor"` + `IMAGE_NOISE_SCALE_SUSPECT`. R-17-Satz „Ebenen-Korrektur bleibt erhalten" ist gestrichen; `RangeError` bleibt nur für geometrisch Unfittbares. Stufe E liefert die von Codex geforderte **Methode×n-Wahrheitstabelle** (corrected, method, sigma, source, warning, Fallback) als Pin-Satz. R-16-Kalibrier-Fixtures laufen nur auf zulässigen n (das 2×2-Einzel-Rect ist Reject-Fall, nicht Kalibrier-Ziel). |
| R-48 | HIGH | CX-D04 + OP-D04 (konvergent) | **E depends-on += D3.** Lane 1 wird **A → B → D3 → E → F** (D3 auf dem kritischen Pfad); §2-Spalte gilt als entsprechend korrigiert. R-43-Korpus-Re-Run ist damit an E's Position ausführbar; E re-pinnt die vom σ_B-Wechsel bewegten D3-Zahlen. |
| R-49 | HIGH | CX-D02 (PARTIAL — Korpora existieren, Codex-Sandbox sah das Session-Scratchpad nicht; von OP verifiziert „on disk, portable") + OP-D09 + OP-D12 | **0b präzisiert:** eigener Commit **nach** 0a (R-32-Wortlaut „Teil der Baseline" korrigiert); Ziel `tests/repro-s20/` mit eigenem npm-Skript **`verify:s20repros`** (bewusst nicht im `npm test`-Glob — MC-Langläufer), das in der Akzeptanz JEDER Stufe namentlich läuft; Quell-Inventar + Erwartungswerte im 0b-HOLD-Report dokumentiert. |
| R-50 | HIGH | OP-D03 | **Neue Kollision entschärft:** `apps/web/src/views/image.ts` kommt auf die I-7-Liste **nur für additive Map-/Label-Einträge** (Reason-Label-Map, neue Zeilen); strukturelle Edits besitzen exklusiv (Stufe G). Damit sind A- (R-08), C- (R-36) und G-Berührungen geordnet; A‖C bleibt zulässig. |
| R-51 | HIGH | OP-D05 | **Robust-Peak-Guard neu spezifiziert:** σ-Bewusstsein über die **gefittete Geometrie am Callsite** (`fit.params`): 3×3-Median-Peak nur wenn `sigma_minor ≥ MEDIAN_PEAK_MIN_SIGMA` (kalibriert in F, Kandidat 2.5 px); darunter Modell-Peak (`A + B_fit`, deterministisch) für die Ceilings. Fallback-Aktion explizit: nie stiller Rückfall auf rawPeak. V5b-Orakel („Kipp-Wert 4500 kippt nicht mehr") bleibt bindend; das degenerierte Ratio-Guard-Design (`robustPeak ≥ c·rawPeak`) ist gestrichen. |
| R-52 | MED | CX-D06 + OP-D06 | `apps/web/src/state.ts` in Stufe-C-Scope: decodedDtype des Hauptbilds wird persistiert (Gleichheits-Guard R-21 braucht ihn); `darkError` als getypter Kontrakt (Dimension vs. Decode), diskriminiert statt String. |
| R-53 | MED | CX-D07 | Stufe-H-Scope += `tests/unit/image-view-functions.test.ts` + Pure-Noise-Fixture (Owner des „Knopf abwesend"-Orakels). |
| R-54 | MED | CX-D05 + OP-D07 | Kalibrier-Population des Coverage-Gates präzisiert: das Maximum stammt aus der **benignen Random-Masken-Familie über den Clean-Szenen** (multi-seed); das 74er-Set selbst ist die I-3-No-Entry-/Bit-Identitäts-Kontrolle (liefert konstruktionsbedingt null Bias-Samples). Separations-Anforderung: dokumentierter Abstand zwischen benignem Maximum und kleinstem strukturierten Positiv (col ±2 = 5.92 %). |
| R-55 | MED | OP-D08 | **I-1 auf alle vier Kurven-Zellen ausgeweitet** (SNR 100/50/30/20 = 15/14/13/13 gemäß Doku); Stufe-F-Stop-and-Report wacht über alle vier; die 0b-Orakel-Erweiterung (R-23) liefert die fehlenden zwei Zellen. |
| R-56 | MED | OP-D10 | Artefakt-Ownership konkretisiert: `examples/expected-headless-summary.json` + `agents/verification/image_analyzer_cases.json` stehen in den Scope-Zeilen von A, B, E, F. Notiert: `warningCount` im Headless-Pin ist severity-blind — B's neue INFOs bewegen ihn; B re-pinnt. |
| R-57 | MED | OP-D11 | **Leg-Reports archiviert** (`S20_PLAN_REVIEW_R1_LEGS.md`, `S20_PLAN_REVIEW_R2_DELTA.md`, verbatim) + Severity-Rekonziliation: Leg-HIGHs, die kanonisch unter HIGH landeten (G-F1→R-11 MED, C-R03→R-27 LOW u. a.), sind dort einzeln begründet (Konsolidierung unter dem jeweils schärfer gefassten Opus-Finding bzw. Einzeiler-Charakter des Fixes; Severity bewertet den Plan-Schaden, nicht die Leg-Rhetorik). |
| R-58 | LOW | OP-D13 | Stale-Folgen von R-09 bereinigt: `packages/image/src/index.ts` aus F-Scope gestrichen; H konsumiert `fits.gauss2d.geometryReleasable` (Analyse-ROI-Verdikt — korrekte Paarung mit den Fit-Params). |
| R-59 | LOW | OP-D14 + CX-D08 | v1-Body bleibt unangetastet (Trail); stattdessen Kopf-LESEHINWEIS (erledigt) + diese Stale-Liste §8.3. Header-Statuszeile aktualisiert (Metadatum, kein Body-Edit). |
| R-60 | LOW | OP-D15 | „ersetzt/ergänzt" entschieden: **ergänzt** — 0/74 bleibt der harte Rollback-Trigger für die `ABSORBED_POWER_MIN_FRACTION`-Absenkung; der noise-free-σ-Sweep kommt hinzu. |
| R-61 | LOW | OP-D16 | R-41 festgelegt: bg-Rect-Modus **erzwingt** die Vollbild-Ansicht (ein e2e-Orakel); R-44 verweist auf die R-39-Robust-Peak-Semantik (finite-only, geklemmtes Fenster) statt eigener Definition. |

### 8.2 Spot-Check-Bestätigungen der Runde 2 (beide Legs)

Baseline `9db4fbd` vollständig verifiziert (87 Dateien, +28 842/−89, Ausschlüsse korrekt); R-09-Result-Feld-Mechanik am Code bestätigt (api-Barrel bleibt unberührt); R-13-corrected-Trigger bestätigt (Stage-B-Feld exterior-NaN); R-33 konsistent geschlossen; E-Kurven-Immunität bestätigt (Orakel übergibt σ_B explizit); 0b-Korpora vorhanden und portierbar; R-35/R-45-Orakel ausführbar.

### 8.3 Bekannte Stale-Stellen des v1-Bodys (bewusst nicht inline editiert)

D3-Titel/-Prämissen nennen noch V6a (gestrichen per R-05); Stufe-H-Design trägt noch das Vollframe-Addendum (gestrichen per R-04); Stufe B nennt `IMAGE_ALPHA_GATE_WEAK` „Warnung" (INFO per R-15); F-Scope nennt `index.ts` (gestrichen per R-58); §2-Tabelle zeigt den v1-Stufenschnitt (operativ ist §7.3 + R-48-Lane). Implementierer-Prompts zitieren §7/§8 als Übersteuerung.

### 8.4 Exit-Gate-Erklärung (Architekten-Entscheid mit Betreiber-Mandat)

Beide Delta-Legs meldeten NEEDS-REVISION; **alle** Delta-HIGHs sind durch die eindeutigen Revisionen R-46..R-51 geschlossen, die MED/LOW-Punkte durch R-52..R-61. Es verbleiben keine offenen Design-Fragen — nur stufeninterne Kalibrier-Schritte mit harten, vorab fixierten Akzeptanzen (R-46-c(n)-Kampagne in E, R-51-σ-Grenze in F, R-54-Population in A). Der Betreiber hat genau eine letzte Check-Runde vor der Implementierung angeordnet („auf gehts"); gemäß Skill-Exit-Klausel (bewusst benannte Deferrals statt weiterer Vollrunden) wird das Exit-Gate hiermit erklärt. **Implementierung startet mit Stufe 0b.**

**Doc-Version:** 3.0, 2026-08-23. Status: PLAN-v3, Exit-Gate erklärt; Stufe 0a erledigt (`9db4fbd`), Stufe 0b in Delegation.

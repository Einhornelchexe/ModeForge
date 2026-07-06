# S13 Teil B - Beamline-gekoppelter Field-Tab mit Auswerteposition: Ergebnis

**Datum:** 2026-07-05.
**Status:** Implementierung + Dev-Verifikation; **HOLD vor Commit**.
**Auftrag:** Field-Modus optional an den realen Beamline-Aufbau koppeln, mit frei eintragbarer Auswerteposition (Betreiber-Spec vom 2026-07-04: Umschalter mit Default synchronisiert, Komponenten-Chips + freie z-Eingabe, bestehender Stil, N-Cap nutzerseitig bis 128).
**Verweis:** `Plan/S13_CORE_VERIFICATION_RESULT.md` (Teil A), `docs/theory/field_mode.md`, `docs/architecture/CONVENTIONS.md` Regel 10.

---

## 0. Verdikt zuerst

**Der Field-Tab propagiert jetzt standardmaessig das skalare Feld durch den aktuellen Strahlengang und liest es an jeder gewuenschten z-Ebene aus** — |E|^2-Bild, Leistung, Momente, Kreuzcheck gegen die paraxiale Envelope an derselben Ebene, plus Sampling-Warnungen pro Probe-Ebene. Der 1:1-Design-Playground bleibt als zweiter Modus unveraendert erhalten. Kern-Nachweis der Korrektheit: Das Aufsplitten der Propagation an Probe-Ebenen reproduziert den End-Radius des bestehenden `field-beamline`-Beispiels **bit-identisch** (0.106430686077 mm), und Probe-Radien in Freistrecke/Slab/nach Linse treffen die analytischen Orakel.

---

## 1. Orchestrierung-Plan-Trail (Auftrag: weitestgehend das Hybrid-Planungsrezept, der Orchestrierungs-Workflow)

Hybrid-Planung nach Rezept: **3 DeepSeek-Plan-Drafts** (`Plan-Draft-Lauf`, deepseek-v4-pro @ high) aus verschiedenen Winkeln — UI-Integration, Korrektheit/Risiken, Tests/Gates — fuer zusammen **~0.040 USD**; Budget vorher frisch gesetzt (soft 0.30 / hard 0.80, reset).

Manager-Grounding gegen das Repo (Draft-Behauptungen geprueft):

1. Draft 2 behauptete O(N^4)-DFT-Kosten → **bestaetigt** per Read von `packages/field/src/scalar-field.ts` (voller Vierfach-Loop in `dft2`); Konsequenz: N-Cap 128 mit deutlichem Hinweis, Default bleibt 48.
2. Verifier-Mechanik (deepEqual + `--print-summary`-Regeneration) → bestaetigt; `probeCount` sauber ergaenzbar.
3. `propagateFresnel` pur (kein Mutieren) → bestaetigt; Beyond-End-Fortsetzung korrekt.

Manager-Synthese: Draft 1 lieferte das UI-Geruest (abgewandelt: N/dx/Methode werden zwischen beiden Modi GETEILT statt dupliziert), Draft 2 die uebernommenen Korrektheitspunkte (Sampling-Warnungen pro Probe-Ebene mit zMm-Tag, Glas-/Element-Konventionshinweis in der UI, achsgetrennter Kreuzcheck, ehrlicher 128er-Hinweis), Draft 3 den Testplan (eigenes Test-File mit analytischen Orakeln, `probeCount` im Verifier, neues Beispiel; Playwright ad-hoc statt e2e-Framework, da das Repo keines hat — bewusste Abweichung vom Draft). Worker-Implementierung von `.ts` bleibt durch die Orchestrierung-Write-Policy blockiert (S12-Trail); Implementierung daher Manager-seitig entlang des synthetisierten Plans.

---

## 2. Diff - was gebaut wurde

API (`packages/api/src/index.ts`):

- `FieldBeamlineJobInput.probesZmm?: number[]` + `FieldBeamlineProbeResult` (= PlaneSummary + `image`); Ergebnisfeld `probes` (leer bei Weglassen — rueckwaertskompatibel).
- Komponenten-Walk refaktoriert zu `componentFieldSteps` (Phasen-/Blenden-Transforms + Propagationsspannen physisch/optisch) + `propagateSpan`, das Spannen an Probe-Positionen exakt teilt; Konventionen: physisches z, in Glas reduzierter Weg t/n anteilig, Probe an Element-Ebene misst direkt dahinter, Probes hinter dem Ende laufen im Freiraum weiter (finalPlane/image bleiben die Ebene nach der letzten Komponente).
- Sampling-Warnungen zusaetzlich **pro Probe-Ebene** (gegen die eigenen Momente, mit `zMm`-Tag); ungueltige Probes -> `INVALID_INPUT`-Warning statt stillem Verwerfen.

UI (`apps/web`):

- Field-Tab-Umschalter `Project beamline` (Default) | `Source playground` (`src/views/field.ts`, `fld-mode`); Playground unveraendert.
- Beamline-Modus: EBENEN-Chips (SOURCE + jede Komponente mit End-z) fuellen die freie **AUSWERTE-EBENE z**-Eingabe (leer = Ende des Strahlengangs); Grid N (Clamp 8..128), dx mit **AUTO dx** (Gitter fasst den groessten Envelope-Radius bis zur Auswerte-Ebene, Lookup im densifizierten Core-Resultat — keine Physik in der UI), Methode; Run startet `field-beamline` mit `probesZmm: [0, z]`.
- Ergebnisse: Kacheln POWER IN / LEISTUNG @ z / TRANSMISSION / MOMENT Rx/Ry, Kreuzcheck-Karte an der Probe-Ebene (x- und y-Achse getrennt, blauer Blenden-Hinweis wie im Design), |E|^2-Canvases Eingangs- und Auswerte-Ebene, Warnungsliste inkl. Probe-zMm.
- `src/state.ts` (mode/bz/resB), `src/main.ts` (Aktionen `fld-mode`/`fld-chip`/`fld-auto-dx`/`run-field-beamline`, Key `bz`, Canvas-Dispatch je Modus, Playground-Clamp 96->128), `src/i18n.ts` (10 neue Keys EN/DE, extentCap-Text ehrlich zu O(N^4)).

Tests/Gates/Doku:

- `tests/unit/field-beamline-probes.test.ts` (6 Tests, analytische Orakel): Freistrecken-Probes vs w(z) (<8 %), Monotonie, Leistungserhaltung (1e-9), Slab-Probe trifft t/n-Reduktion (und schlaegt den Vakuum-Vergleich), Konvergenz hinter Duennlinse, Beyond-End, Invalid-Probe-Warning, Rueckwaertskompatibilitaet.
- `scripts/verify-headless.mjs`: `probeCount` im field-beamline-Summary; neues Beispiel `examples/field-beamline-probes.headless.json`; `expected-headless-summary.json` regeneriert — Diff geprueft: Bestandseintraege unveraendert bis auf `probeCount: 0`, Probes-Beispiel liefert bit-identischen End-Radius zum probelosen Beispiel.
- `docs/theory/field_mode.md` Abschnitt "Probe Planes (S13B)" (6 Konventionen); `docs/architecture/CONVENTIONS.md` Regel 10 an die Zwei-Modi-Realitaet angepasst (Betreiber-genehmigte Evolution der Design-Quelle).

## 3. Dev-Runtime-Verifikation

| Gate | Ergebnis |
|---|---|
| `npm.cmd run typecheck` / `typecheck:web` | PASS / PASS |
| `npm.cmd test` | PASS, 61/61 (55 Bestand + 6 neue Probe-Tests) |
| `npm.cmd run verify:headless` | PASS, 2 Projekte und 6 Jobs |
| `npm.cmd run verify:cases` | PASS, 52/52 |
| `npm.cmd run check:scope` | PASS |
| `npm.cmd run build:web` | PASS |

Playwright (Dev-Server, Desktop):

| Check | Ergebnis |
|---|---|
| Beamline-Modus ist Default; Umschalter aktiv | PASS |
| Chips SOURCE/window/drift-1/L1/to-sample mit korrekten z (0/2/82/87/207) | PASS |
| AUTO dx liefert 0.0871 (6*maxEnvelope/48) | PASS |
| Chip-Klick fuellt z (87); freie Eingabe 150 erscheint im Ebenen-Titel | PASS |
| Canvases nonzero an Ende/Probe; Beugungs-Nebenkeulen an z=207 sichtbar | PASS |
| Kreuzcheck-Karte an z=207 mit ehrlichem Delta 34.36 % + Blenden-Hinweis; FIELD_SAMPLING_LOW mit z-Tag | PASS |
| Playground-Modus laeuft unveraendert; keine Page-Errors | PASS |

## 4. Grenzen (ehrlich)

1. Linsen wirken als paraxiale Phasenmasken (Duennlinse exakt, Dicklinse EFL-Naeherung + t/n) — Aberrationen nicht modelliert (Fast-Note gilt weiter).
2. M2>1/Moment-Beams nur approximiert (`UNSUPPORTED_PROFILE_PROPAGATION`-Warnung erscheint in der UI-Warnungsliste).
3. O(N^4)-DFT: N=128 kostet Sekunden pro Propagationssegment; der Hinweistext sagt das offen. FFT-Upgrade bleibt als Verbesserungspunkt notiert (wie dn/dlambda aus Teil A).

## 5. Nachtrag 2026-07-05: Fortschrittsbalken + Web Worker (Betreiber-Wunsch)

Auf Betreiber-Wunsch ergaenzt (Orchestrierungs-Workflow-Stil: 1 Plan-Draft deepseek-v4-pro/high ~0.012 USD zu Worker-/Vite-/Scope-Fallstricken, Manager-Grounding von tsconfig/check-scope/Build, Implementierung Manager-seitig):

- `packages/api`: optionaler `onProgress({done,total})`-Hook auf beiden Feld-Jobs; `field-beamline` zaehlt die Propagationssegmente exakt vor (gleiche Split-Arithmetik wie der Lauf: Spannen + Probe-Splits + Beyond-End).
- `apps/web/src/field-worker.ts`: Feld-Jobs laufen in einem Vite-Module-Worker — **die UI friert nicht mehr ein**; Progress via postMessage, Token-Guard gegen ueberholte Laeufe, Sync-Fallback wenn Worker-Konstruktion scheitert.
- UI: determinierter Balken unter dem Run-Button in beiden Modi ("segment x/y · p%", Design-Stil).
- Verifikation: typecheck/typecheck:web/test 61/61/check:scope/build (Worker-Chunk emittiert) PASS; Playwright-Live-Sampling zeigt 0/4 -> 1/4 25 % -> 2/4 50 % -> 3/4 75 % bei N=112 (~20 s Gesamtlauf) bei durchgehend reaktionsfaehiger UI; Playground-Lauf ueber den Worker ebenfalls PASS.

## 6. Handoff

Am 2026-07-05 vom Betreiber freigegeben ("Pushe darfst du auch erstmal alles auf main") und auf `origin/main` gepusht. Veroeffentlichung des Projekts bleibt bewusst zurueckgestellt, bis das Qualitaetsmass des Betreibers erreicht ist; naechster groesserer Schritt laut Betreiber-Entscheid: Option 1 (echte Flaechen-Sag-Phasenmasken) nach FFT-Upgrade.

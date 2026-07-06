# S14 - FFT-Upgrade + Option 1 (echte Flaechen-Sag-Phasenmasken): Ergebnis

**Datum:** 2026-07-05.
**Status:** implementiert, verifiziert, auf main committet und gepusht (Push-Freigabe des Betreibers vom 2026-07-05).
**Auftrag:** "starte fft + option 1 mit das Hybrid-Planungsrezept" (Betreiber, 2026-07-05); Entscheidungsgrundlage: Option 1 statt Voll-POP (Betreiber-Einschaetzung + Manager-Analyse).
**Verweis:** `docs/theory/field_mode.md` (Abschnitte Fast Transform, Real-Sag Surface Phase), `tests/unit/field-fft.test.ts`, `tests/unit/field-sag.test.ts`.

---

## 0. Verdikt zuerst

**Beides steht.** (1) Die naive O(N^4)-DFT ist durch eine separable schnelle Transformation ersetzt: Radix-2-FFT fuer Zweierpotenzen, Cache-Twiddle-DFT pro Zeile/Spalte fuer alle anderen N — **N=128 in ~5 ms, N=256 in ~14 ms statt Sekunden**, verifiziert gegen eine unabhaengig im Test nachgebaute Referenz-DFT auf <1e-10 (auch ungerade N), Leistung erhalten auf 1e-12, **alle bestehenden 12-stelligen Regressions-Baselines unveraendert reproduziert** (keine Regeneration noetig). (2) `field-beamline` kann Dicklinsen jetzt mit der **exakten sphaerischen Flaechengeometrie** rechnen (`surfacePhase: "real-sag"`, Default bleibt `ideal`): Phase phi(r) = k0*(n1-n2)*sag(r) je Flaeche + interner reduzierter Weg t/n; damit wird sag-getriebene sphaerische Aberration aus der echten Verschreibung (inkl. ZMX-importierter Linsen) sichtbar.

## 1. Orchestrierung-Plan-Trail

- 2 `Plan-Draft-Lauf`-Drafts (deepseek-v4-pro; FFT-Algorithmik @high, Sag-Physik/Orakel @max) fuer zusammen ~0.02 USD; auf den dritten Winkel (Integration/Gates) wurde bewusst verzichtet — in dieser Session bereits zweimal gegroundet (S13B, Progress-Worker).
- Grounding: O(N^4)-Vierfachloop bestaetigt; `applyThinLensPhase`-Vorzeichen (-pi r^2/(lambda f)) passt zur Sag-Vorzeichenkette; `dft2` hat genau 4 Aufrufer in den beiden Propagatoren; Frequenzordnung/Unitaritaet der neuen Transformation kontraktgleich.
- **Zwei Draft-Fehler vom Manager korrigiert (Judgment-Schritt des Rezepts):**
  1. Das vorgeschlagene Orientierungs-Asymmetrie-Orakel (plano-konvex gedreht = weniger Aberration) ist in der Thin-Element-Naeherung **physikalisch falsch** — bei t->0 ist die Sag-Phasensumme orientierungsunabhaengig; TEA erfasst nur die sag-getriebene, nicht die einfallswinkel-getriebene Aberration. Als Modellgrenze dokumentiert statt als Test eingebaut.
  2. Fokusebenen-Orakel sind auf Single-Grid-TF-Propagation nicht aufloesbar (Spot in µm vs. Gitter in mm); ersetzt durch exakte Masken-Orakel + Konvergenz gegen die analytische Envelope.

## 2. Verifikations-Orakel (Task-A-Stil)

| Orakel | Ergebnis |
|---|---|
| FFT vs. unabhaengige Referenz-DFT (n=16/12/33, Zufallsfelder) | PASS, <1e-10 rel |
| Leistungserhaltung Zufallsfelder (pow2 + ungerade) | PASS, <1e-12 |
| Bestehende Baselines (verify:headless 12-stellig, verify:cases 52) | PASS, unveraendert |
| Sag-Maske vs. analytisches sag(r) (positive und negative R) | PASS, <1e-9 rad |
| Flaechenpaar paraxial == ideale Duennlinse; Residuum bei grossem r == modell-eigener r^4-Term | PASS, <2 % |
| Real-Sag vs. analytische Envelope bei niedriger NA (Bikonvex R+-50, t5) | PASS, 0.19 % — **und schlaegt den ideal-Modus (8 %)**: die Sag-Kette traegt die korrekten Hauptebenen, der Einzel-EFL-Mask am Frontvertex nicht |
| Sampling-Guard (Aliasing am Aperturrand, Hemisphaeren-Clamp) | PASS, feuert/schweigt wie spezifiziert |

## 3. Diff (Kurzform)

- `packages/field/src/scalar-field.ts`: dft2 intern ersetzt (Radix-2 + Twiddle-Cache, Float64Array-Scratch, Kontrakt unveraendert); neu `applySphericalSurfacePhase`, `surfacePhaseSamplingWarnings`.
- `packages/api/src/index.ts`: `surfacePhase?: "ideal" | "real-sag"` auf `FieldBeamlineJobInput`; Dicklinsen-Steps im real-sag-Modus = Flaeche1 + t/n + Flaeche2; per-Flaeche Sampling-Warnings mit componentId.
- `apps/web`: FLAECHEN-PHASE-Select im Beamline-Feldmodus (Default ideal) + TEA-Hinweis (EN/DE); extentCap-Text an FFT-Realitaet angepasst.
- `tests/unit/field-fft.test.ts` (4 Tests) + `tests/unit/field-sag.test.ts` (4 Tests); `docs/theory/field_mode.md` um beide Abschnitte erweitert.

## 4. Gates

typecheck / typecheck:web PASS · **69/69 Tests** · verify:headless 2 Projekte + 6 Jobs PASS (unveraendert) · verify:cases 52/52 PASS · check:scope PASS · build:web PASS · Browser-Lauf real-sag im Beamline-Modus PASS (Hinweis + ehrliche Sampling-Warnungen sichtbar, keine Page-Errors).

## 5. Grenzen / Folgepunkte

1. TEA-Grenze dokumentiert (keine Einfallswinkel-Aberrationen, keine Orientierungsasymmetrie bei t->0) — fuer "wie schlimm ist meine echte Singlett-Flaeche" tauglich, kein POP-Ersatz.
2. Duenn-/Zylinderlinsen bleiben ideal (per Definition); ZMX-Mehrflaechenstapel flaechenweise = dokumentierter Hook.
3. N-Cap 128 koennte mit FFT problemlos auf 256 steigen — Betreiber-Entscheid offen.
4. Der konservative Rand-Sampling-Guard warnt auch, wenn nur energiearme Randbereiche aliasen; moegliche Verfeinerung: Guard an beam-relevantem Radius statt Aperturrand.

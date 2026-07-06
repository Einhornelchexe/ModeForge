# S15 - surface-stack Beamline-Komponente: Ergebnis

**Datum:** 2026-07-05.
**Status:** implementiert, verifiziert, auf main committet und gepusht (stehende Push-Freigabe).
**Auftrag:** "gruenes licht setzte S15 mit das Hybrid-Planungsrezept und der Orchestrierungs-Workflow" (Betreiber, 2026-07-05) — ZMX-Mehrflaechenstapel als vollwertige Beamline-Komponente in Fast- und Feld-Modus.
**Verweis:** `docs/theory/imports.md` (Beamline Embedding), `docs/theory/field_mode.md` Abschnitt Real-Sag Punkt 6, `tests/unit/surface-stack-component.test.ts`.

---

## 0. Verdikt zuerst

**Jede sequentielle ZMX-Verschreibung ist jetzt rechenbar.** Der Import-Tab bettet beliebige geparste Stapel (>= 2 Flaechen) als neue Komponente `surface-stack` in den Strahlengang ein (Singlets behalten den Dicklinsen-Pfad). Fast Mode nutzt die volle Stapel-ABCD (`surfaceStackMatrix`), der Feld-Modus laeuft im real-sag-Modus **Flaeche fuer Flaeche** — inklusive Glas-Glas-Kittflaechen ueber den Indexsprung, per-Flaechen-Aperturen und reduzierten Wegen je Medium. Die E2E-Reise (unbekanntes Glas -> blockiert -> AGF-Katalog adoptieren -> erneut parsen -> in den Strahlengang -> Envelope + Feld real-sag) funktioniert im Browser ohne Fehler; das Beispiel-Kittglied zeigt sich als `ZMX1 · 3 surf · EFL 54.18` mit aufgeloesten Katalog-Indizes (S-LAH64 n=1.7877).

## 1. Orchestrierung-Plan-Trail

3 `Plan-Draft-Lauf`-Drafts (~0.05 USD; Contract/Validation @high, Feld-Physik/Orakel @high, UI/Integration @high — letzterer endete `needs_more_context`, lieferte aber im Rohoutput einen verwertbaren Plan; fehlender Kontext waren nur Index-Re-Exports, kein Re-Run). Grounding-Kernbefund: **`surfaceStackMatrix` propagiert auch das `thicknessAfter` der letzten Flaeche** -> Embedding-Policy: letzte Flaeche muss `t = 0` und `n = 1` tragen (Validation erzwingt es, der Import mappt entsprechend; Rest-DISZ gehoert in eine folgende Freistrecke). Manager-Synthese ergaenzte u. a. den Apertur-Margin-Pfad (engste per-Flaechen-Apertur) und die Ideal-Modus-Kollabierung (EFL + ein reduzierter Weg + engste Apertur, konsistent zur Dicklinsen-Crudeness).

## 2. Diff (Kurzform)

- `packages/core`: `BeamlineComponent` + `surface-stack` (Flaechenliste mit radiusMm/thicknessAfterMm/refractiveIndexAfter/apertureRadiusMm?/materialAfter?); Runtime-Validation (>= 2 Flaechen, Radius endlich-nichtnull-oder-Infinity, t >= 0, n > 0, letzte Flaeche n=1 und t=0). Additiver Kind unter Version 0.1 (alte Dateien unveraendert gueltig; Dateien mit Stacks werden von aelteren Builds als unbekannter Discriminator abgelehnt — dokumentierte Policy).
- `packages/optics`: `stackOpticFromComponent`-Mapping; `simulateBeamline` (Matrix, Laenge = Summe t, Apertur-Reserve ueber engste Flaechen-Apertur mit `APERTURE_MARGIN_LOW`).
- `packages/api`: Feld-Steps real-sag Flaeche-fuer-Flaeche (deltaN deckt Kittflaechen ab) bzw. ideal kollabiert; per-Flaechen-Sampling-Guards mit Envelope-Radius am Stapel-Eintritt; `surfaceStackComponentCard` als UI-Helfer.
- `apps/web`: Import-Button fuer Nicht-Singlets (`add-imported-stack`), Chip-Untertitel `N surf · EFL`, Komponenten-Karte mit EFL/BFL/FFL, Read-only-Flaechentabelle im Editor, Plot-Silhouette mit inneren Kittflaechenlinien, Stack-Apertur im Plot, Laengen-Helfer vereinheitlicht; i18n `surfWord` EN/DE.
- `examples/doublet-stack.modeforge.json` + Expected-Summary-Regeneration (nur neuer Eintrag, Bestand unveraendert); `docs/theory/imports.md` + `field_mode.md` nachgezogen.

## 3. Verifikations-Orakel

| Orakel | Ergebnis |
|---|---|
| Validation-Matrix (6 Ablehnfaelle + Akzeptanz Kittglied) | PASS |
| Fast-Mode-Verdrahtung: Komponenten-Matrix == paraxialCard, det(Luft-Luft) == 1, Laenge 6.5 mm, Margin-Warning bei enger Kittflaeche | PASS |
| Projekt-JSON-Roundtrip mit Stack | PASS |
| **2-Flaechen-Stack == Dicklinsen-Komponente im Feld (ideal UND real-sag)** | PASS, < 1e-12 |
| Kittglied real-sag vs. analytische Envelope bei niedriger NA | PASS, < 1 % |
| Glas-Glas-Sag-Phase (1.8 -> 1.74) vs. analytisch | PASS, < 1e-9 rad |
| Probe innerhalb des ersten Glaselements (reduzierter Weg) | PASS |

## 4. Gates

typecheck / typecheck:web PASS · **76/76 Tests** · verify:headless 3 Projekte + 6 Jobs PASS (Expected: nur neuer Doublet-Eintrag, 0 Bestandsaenderungen) · verify:cases 52/52 · check:scope PASS · build:web PASS · Playwright-E2E (Import-Resolver-Reise -> Beamline -> Feld real-sag) PASS ohne Page-Errors.

## 5. Grenzen / Folgepunkte

1. Editor zeigt Stapel-Flaechen read-only (Aenderungen via Re-Import) — bewusste v1-Entscheidung.
2. TEA-Grenzen aus S14 gelten unveraendert (keine Einfallswinkel-Aberrationen); chromatische Effekte nur ueber manuellen lambda-Wechsel.
3. Aeltere Builds lehnen Projektdateien mit Stacks ab (additive Erweiterung unter 0.1, dokumentiert).

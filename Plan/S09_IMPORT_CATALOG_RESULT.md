# ModeForge S09 Import Catalog Result

**Datum:** 2026-07-02.
**Status:** HOLD vor Commit, S09 Headless-Kernel geschlossen.
**Auftrag:** `Plan/HEADLESS_PHASES v1.md` S09 - Import, Catalog, Material Library.
**Verweis:** `docs/theory/imports.md`, `Plan/INDEX.md`.

---

## 0. Verdikt zuerst

**S09 liefert einen lokalen, lizenzsauberen Import- und Catalog-Kernel: konservativer ZMX-Subset-Parser, AGF-Materialparser, Material-/Lens-Pack-Vertraege und keine stille Materialsubstitution.** Importierte SurfaceStacks werden nur erzeugt, wenn Materialien aufloesbar sind.

---

## 1. Diff-Scope

**Neue Artefakte:**
- `packages/catalog/package.json`
- `packages/catalog/src/index.ts`
- `packages/catalog/src/agf-parser.ts`
- `packages/catalog/src/packs.ts`
- `packages/catalog/src/zmx-parser.ts`
- `docs/theory/imports.md`
- `tests/unit/catalog.test.ts`

**Nicht geaendert:**
- kein `apps/web`
- keine UI-Komponenten
- keine proprietaeren Vendor-Daten
- keine neuen Dependencies

---

## 2. Inhalt

Der erste Import-Slice liefert:

- `parseZmxSequential(text, options)`.
- `parseAgfCatalog(text)`.
- `CatalogImportResult<T>`.
- `MaterialPack`, `LensPack`.
- `validateMaterialPack(pack)`, `validateLensPack(pack)`.
- `materialsFromPacks(packs)`.

ZMX-Subset:

- `SURF`
- `CURV`
- `RADIUS`
- `DISZ`
- `GLAS`
- `DIAM`

AGF-Subset:

- `NM`
- `CD` mit sechs Sellmeier-Koeffizienten.

---

## 3. Verifikation

| Gate | Ergebnis | Evidenz |
|---|---|---|
| TypeScript | PASS | `npm.cmd run typecheck` -> Exit 0. |
| Unit Tests | PASS | `npm.cmd test` -> 50 Tests, 50 pass, 0 fail. |
| Scope-Check | PASS | `npm.cmd run check:scope` -> `scope ok: no UI app exists before S12`. |
| Headless Examples | PASS | `npm.cmd run verify:headless` -> `headless ok: 2 projects and 4 jobs verified against expected summaries`. |

---

## 4. Abschlussstand S09

Erfuellt sind die S09-Gates: ZMX/AGF lokal, unresolved materials ohne Substitution, validierbarer SurfaceStack bei bekannten Materialien, Material-/Lens-Pack-Schemas mit Source-/License-Metadaten und Integration in `runHeadlessJob`.

Deferred bleiben vollstaendige Vendor-Syntax, Coatings und spezifische Converter fuer proprietaere Kataloge.

**Doc-Version:** 1.1, 2026-07-02.

# ModeForge Import Notes

**Status:** S09 draft, headless only.
**Datum:** 2026-07-02.

## Scope

The first import layer parses user-supplied text locally. It does not bundle proprietary vendor catalogs.

## ZMX Sequential Subset

The S09 parser supports a conservative sequential-surface subset:

- `SURF`
- `CURV`
- `RADIUS`
- `DISZ`
- `GLAS`
- `DIAM`

Unknown materials are not silently substituted. If a material cannot be resolved, the parser returns `ok: false`, a `MATERIAL_UNKNOWN` warning, and the unresolved material names.

## AGF Subset

The S09 AGF parser supports:

- `NM` material-name lines,
- `CD` coefficient lines with six Sellmeier coefficients.

The output is a local `MaterialModel[]` that can be passed to the ZMX parser.

## Local Packs

`MaterialPack` and `LensPack` are runtime-validated local data contracts. Each pack carries source metadata (`sourceName`, optional `license`, `citation`, `url`) so imported/user data can remain license-explicit without bundling proprietary catalogs.

`materialsFromPacks` propagates pack-level license/citation metadata onto material entries when the material does not override it.

## Deferred

Full Zemax syntax, multi-configuration files, coating data, and vendor-specific pack converters are deferred until the catalog layer is broader.


## Beamline Embedding (S15)

Any parsed sequential prescription with >= 2 surfaces can be added to the beamline as a `surface-stack` component (singlets keep the dedicated thick-lens path). Embedding policy: the component sits in air — the last surface is stored with `thicknessAfterMm = 0` and `refractiveIndexAfter = 1`; a trailing DISZ from the prescription belongs to a following free-space component. Fast Mode uses the full stack ABCD (`surfaceStackMatrix`); the aperture margin check uses the tightest per-surface aperture.

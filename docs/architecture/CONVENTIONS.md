# ModeForge Architecture Conventions

**Status:** active through the v2.1 release (S18 feature line + S20 hardening + S22 residual diagnostics). S12 v2's 1:1 implementation of the "Frontend design V3 masterplan" Claude Design project remains the baseline layout contract; S18 adds the browser-local image analyzer as a sixth workbench tab under the same rules (see Rule 3's documented exception and Rule 11 below).

## Build Scope

S00-S11 built the calculation and headless API basis:

- definitions,
- unit conventions,
- data contracts,
- core physics,
- validation fixtures,
- tests,
- headless examples/API contracts,
- optimizer/import/measured-beam/field computation modules,
- `field-beamline` API coupling for real beamline layout field rendering.

S12 starts the Claude Design UI handoff. `apps/web` may exist from S12 onward, but it remains a static browser app that renders API results instead of duplicating physics.

## Layer Rules

1. UI code must not implement physics formulas.
2. UI code must call `packages/api` for computation and must not import physics packages such as `packages/optics`, `packages/field`, `packages/pulses`, or `packages/optimizer` directly.
3. Core packages must not depend on React, the DOM, browser globals, or UI state. Documented exception: `packages/image/src/decode.ts` uses the Web Streams `DecompressionStream` global to inflate PNG data (available in Node >= 18 and in every target browser); this is the only browser-global dependency permitted in a core package, and it is confined to PNG decoding.
4. Worker-facing APIs exchange typed input and result objects.
5. Every formula must have a test or reference case.
6. Public fields use explicit unit suffixes such as `radiusMm`, `wavelengthUm`, `powerW`, and `energyJ`. The image analyzer adds `...Px` (pixel-space lengths/coordinates) and `...Counts` (raw or corrected detector intensity) to the same convention.
7. Static hosting remains the default architecture; no backend is required for core calculations.
8. The production web build must self-host fonts from the repository and must not load Google Fonts or external runtime CDNs.
9. `apps/web` must not copy Claude Design prototype runtime files such as `support.js` or `modeforge-core.js`.
10. The Field tab has two modes (S13B, operator-approved evolution of the Claude Design source): the default "Project beamline" mode propagates the scalar field through the CURRENT beamline via the `field-beamline` job with `probesZmm` (free evaluation plane plus component quick-select, |E|² image grids and moments provided by the API, cross-check against the densified paraxial envelope), and the "Source playground" mode keeps the designed `field-fresnel` playground unchanged. Grid N is user-chosen up to 128 with an honest DFT-runtime hint; the UI still computes no physics.
11. The Analyzer tab (S18, operator-approved addition) adds a sixth workbench tab for browser-local single-image beam-profile analysis (TIFF/PNG import, background correction, ROI, moment/profile fits). `packages/image` is a self-contained calculation domain — it only reuses warning/validation/unit vocabulary from `packages/core` — and is reached exclusively through `packages/api`'s `image-analysis` job, like every other physics package; the UI still computes no physics.

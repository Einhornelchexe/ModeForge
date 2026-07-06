# PLAN v3.md — ModeForge Open-Source Laser Beamline Tool

Working title: **Open Lens**  
Recommended public name: **ModeForge** or **OpenBeamline**  
Project type: Open-source, browser-hosted web tool with a strict **UI / Core / Worker / Optional Backend** architecture for laser beamline design, beam-profile propagation, mode visualization, telescope/focus optimization, surface-stack/thick-lens modeling, catalog lens import, material/dispersion handling, and pulsed-laser parameter estimation.

**Version 3 architecture decision:** ModeForge should not start as a classical client/server application. The first serious implementation should be a static web app with a browser-local physics core, Web Workers for expensive jobs, local storage for user data, and an optional server backend only later if accounts, cloud saves, collaboration, or heavy remote computation become necessary.

---

## 1. Core positioning

This project should **not** be scoped as another Gaussian-beam calculator.

The goal is:

> Build an open-source web tool for realistic laser-beamline planning: spatial beam profiles, thick lenses and imported catalog optics, telescope optimization, M² beams, higher modes, astigmatism, material dispersion, and pulsed-laser quantities.

The tool should sit between:

- simple Gaussian web calculators,
- full optical CAD/raytracing tools,
- numerical Fourier-optics libraries,
- laboratory notebook calculations.

It should be useful for students, optical labs, laser developers, and experimental physicists who want quick but physically honest beamline estimates.

---

## 2. Non-goals

The tool should **not** try to become a full Zemax/OpticStudio replacement.

Do **not** claim full support for:

- arbitrary lens aberrations,
- complete real-lens image quality,
- full non-paraxial vector optics,
- full thermal lensing,
- complete nonlinear pulse propagation,
- complete CAD import/export,
- full Zemax/OpticStudio parity,
- automatic scraping or redistribution of proprietary vendor catalog data,
- full coating phase / coating performance modeling,
- tolerance analysis at professional optical-design depth,
- exact damage-threshold certification.

Instead, the tool should be clear about its simulation regime.

Core philosophy:

> Fast where analytical models are valid. Honest where they are not.

---

## 3. Simulation modes

The tool should expose separate simulation modes instead of pretending that one model covers everything.

### 3.1 Fast Mode

Purpose: quick paraxial beamline calculation.

Physics:

- ABCD matrices,
- Gaussian q-parameter,
- thick-lens and surface-stack paraxial matrices,
- M²-modified beam propagation,
- separate x/y axes for astigmatism.

Good for:

- Gaussian beams,
- elliptical Gaussian beams,
- M² input beams,
- telescope design,
- focus-position estimates,
- beam-diameter estimates,
- first-order thick-lens calculations.

Limitations:

- no diffraction from apertures,
- no real aberration modeling,
- no mode coupling,
- no clipping propagation except warning metrics,
- no full field propagation.

---

### 3.2 Moment Mode

Purpose: represent real measured beams via second moments.

Physics:

- D4σ beam width,
- beam parameter product,
- M² in x/y,
- separate propagation of second-moment envelopes,
- astigmatic waist locations.

Inputs:

- measured beam radius or D4σ diameter,
- divergence,
- M²,
- wavelength,
- x/y asymmetry,
- waist locations in x/y,
- optional imported measurement points.

Good for:

- real imperfect laser beams,
- diode/fiber beams,
- astigmatic beams,
- lab measurements,
- comparing theory to camera data.

Limitations:

- does not know the exact intensity distribution,
- cannot predict fine structure,
- cannot predict mode coupling,
- cannot model diffraction artifacts.

---

### 3.3 Field Mode

Purpose: simulate arbitrary transverse fields when the analytical model is no longer enough.

Physics:

- scalar Fourier optics,
- Fresnel propagation,
- angular-spectrum propagation,
- aperture diffraction,
- phase masks,
- imported complex fields or intensity profiles.

Good for:

- top-hat beams,
- super-Gaussian beams,
- apertures,
- clipping,
- phase masks,
- qualitative diffraction,
- custom profiles,
- mode decomposition later.

Limitations:

- slower than Fast Mode,
- grid-size dependent,
- requires sampling warnings,
- scalar approximation unless a future vector module is added.

---

### 3.4 Pulse Mode

Purpose: calculate pulsed-laser quantities coupled to spatial beam propagation.

Physics:

- pulse energy,
- peak power,
- fluence,
- peak intensity,
- pulse-shape correction factors,
- transform-limited bandwidth estimate,
- material-resolved dispersion estimates,
- optional GDD accumulation through imported or manually defined glass paths.

Good for:

- femtosecond/picosecond/nanosecond laser estimates,
- fluence at focus,
- intensity at focus,
- pulse-energy conversion,
- rough dispersion checks through thick glass elements.

Limitations:

- no full nonlinear propagation initially,
- no self-phase modulation initially,
- no filamentation,
- no full ultrafast pulse compressor design.

---

## 4. Beam/profile models

The tool should distinguish between **profile shape** and **beam quality**.

M² is not itself a profile. It is a propagation-quality parameter. Therefore, a beam can be:

- Gaussian with M² = 1,
- elliptical Gaussian with Mx² and My²,
- super-Gaussian with an assigned effective M²,
- measured-profile beam with extracted second moments,
- ideal HG/LG mode with known mode order and Gouy phase.

### 4.1 Must-have profiles

| Profile | Parameters | Simulation modes |
|---|---|---|
| Gaussian TEM00 | wavelength, waist, waist position, power | Fast, Moment, Field |
| Elliptical Gaussian | wx, wy, z0x, z0y, Mx², My² | Fast, Moment, Field |
| M² beam | M² or Mx²/My², waist or divergence | Fast, Moment |
| Super-Gaussian | order n, radius, power | Field, approximate Fast later |
| Top-hat | radius/diameter, power, edge model | Field, approximate fluence model |
| Hermite-Gaussian HGmn | m, n, waist, phase | Fast envelope, Field visualization |
| Laguerre-Gaussian LGpl | p, l, waist, phase/OAM | Fast envelope, Field visualization |

### 4.2 Later profiles

| Profile | Priority | Notes |
|---|---:|---|
| Bessel beam | later | useful but not first release |
| Airy beam | later | niche |
| measured CSV profile | high later | very useful for lab data |
| uploaded camera image | high later | requires calibration and background handling |
| arbitrary complex field | later | advanced Field Mode feature |

---

## 5. Optical components

### 5.1 Core components

| Component | Required fields | Notes |
|---|---|---|
| Free space | length, medium index | ABCD and Field propagation |
| Thin lens | focal length, aperture | reference model |
| Thick spherical lens | R1, R2, thickness, material/n, aperture | main USP |
| Surface-stack optic | ordered surfaces, radii, thicknesses, materials, apertures | basis for imported catalog optics |
| Curved refractive surface | R, n1, n2 | building block for thick lenses and catalog optics |
| Plane window/slab | thickness, material/n, tilt optional later | common lab element |
| Mirror | curvature/focal length, incidence angle later | useful for cavities/telescopes |
| Spherical mirror | radius, aperture | ABCD element |
| Cylindrical lens | focal length, axis, aperture | astigmatism/telescope design |
| Aperture/iris | diameter, shape, position | warning in Fast Mode, physical in Field Mode |

### 5.2 Later components

| Component | Priority | Notes |
|---|---:|---|
| Beam splitter | medium, thickness, angle | lab relevance |
| Prism | material, apex angle | dispersion later |
| Grating | groove density, angle | pulse/stretching later |
| Nonlinear crystal | length, material, aperture | initially only dispersion/geometry |
| Thermal lens | focal length or dn/dT model | advanced |
| Fiber output | MFD, NA, wavelength | very useful practical input model |

---

## 6. Surface-stack and thick-lens model

Thick lenses and imported catalog optics should be modeled as ordered refractive-surface stacks, not only as focal lengths.

The simple `ThickLens` component is a convenient UI wrapper around a general `SurfaceStackOptic`.

### 6.1 Thick spherical lens input

Required input:

- first surface radius `R1`,
- second surface radius `R2`,
- center thickness `d`,
- material or refractive index `n(lambda)`,
- wavelength `lambda`,
- clear aperture,
- optional material model.

Outputs:

- ABCD matrix,
- effective focal length,
- front focal length,
- back focal length,
- principal plane positions,
- waist position after lens,
- waist radius after lens,
- beam diameter at requested z positions,
- clipping warning.

Label clearly:

> Thick lens, paraxial model. Aberrations are not included in Fast Mode.

### 6.2 General surface-stack optic

Internal representation:

```ts
type SurfaceStackOptic = {
  id: string;
  name?: string;
  vendor?: string;
  partNumber?: string;
  source: "manual" | "modeforge-json" | "zmx-import" | "catalog-pack";
  surfaces: OpticalSurface[];
  warnings: ImportWarning[];
};

type OpticalSurface = {
  radiusMm: number | "Infinity";
  thicknessAfterMm: number;
  materialAfter: string;      // e.g. AIR, N-BK7, FUSED_SILICA
  apertureRadiusMm?: number;
  conic?: number;
  asphereCoefficients?: number[];
  supportedInFastMode: boolean;
};
```

Fast Mode only needs the paraxial part of the surface stack:

- surface curvature/radius,
- refractive index before and after each surface,
- propagation thickness through each material,
- aperture radius for clipping warnings.

The surface-stack model allows:

- singlets,
- achromats,
- windows/slabs,
- cemented multi-element lenses,
- imported vendor lenses,
- later raytrace or field extensions without changing the public data model.

### 6.3 Supported and unsupported surface types

First supported import target:

- spherical sequential surfaces,
- plane surfaces,
- cemented interfaces,
- simple apertures/semi-diameters,
- material names and wavelengths.

Allowed but degraded:

- conic/asphere data are stored as metadata,
- paraxial curvature is used in Fast/Moment Mode,
- warning: aberrations from aspheric terms are not modeled yet.

Initially unsupported:

- non-sequential geometry,
- full CAD solids,
- coating phase models,
- diffraction gratings as Zemax surfaces,
- full tolerance data,
- full off-axis image-quality analysis.

---

## 7. Catalog import and material/dispersion system

This should become a major practical feature, but it must stay compatible with static GitHub hosting.

Core idea:

> Use `.zmx` files for lens geometry and material names. Resolve refractive index and dispersion through an internal material system, optional lazy-loaded material packs, and user-supplied `.agf` catalogs.

Do not build a Zemax clone. Build a trustworthy vendor-prescription importer for paraxial beamline and pulse calculations.

### 7.1 Required optical data

For ModeForge calculations, the required data are limited and physically well-defined.

| Quantity | Needed for | Primary source |
|---|---|---|
| surface radii / curvature | ABCD/surface-stack optics | `.zmx` or manual input |
| surface order | multi-element optics | `.zmx` |
| thickness / spacing | propagation through glass/air | `.zmx` |
| material name | material lookup | `.zmx` |
| refractive index `n(lambda)` | thick-lens / surface refraction | material database or `.agf` |
| dispersion / GVD / GDD | Pulse Mode | material database or `.agf` |
| aperture / semi-diameter | clipping warnings | `.zmx` or manual input |
| catalog EFL/BFL | validation | `.zmx`, datasheet, or optional manual metadata |

Not required for the first serious version:

- MTF,
- spot diagrams,
- full aberration coefficients as active physics,
- manufacturing tolerances,
- coating phase,
- non-sequential optical behavior.

### 7.2 Import sources

#### ZMX lens prescription import

The user can upload a vendor `.zmx` file locally in the browser.

The importer should:

- parse sequential surfaces,
- extract radii/curvatures,
- extract thicknesses,
- extract material names,
- extract apertures/semi-diameters,
- extract wavelengths where available,
- store conic/asphere terms as metadata,
- create a `SurfaceStackOptic`,
- compute paraxial EFL/BFL/FFL from the imported stack,
- show all extracted values before the optic is accepted.

The app should never silently trust an imported file. It should always display an import summary and warnings.

#### AGF glass catalog import

The user can upload a Zemax-style `.agf` glass catalog locally in the browser.

The importer should:

- parse glass names,
- parse dispersion formula type,
- parse coefficients,
- parse wavelength validity range if available,
- parse reference metadata where available,
- register materials in the local material resolver,
- store imported materials in browser storage.

This is the clean fallback for vendor-specific or uncommon glasses.

#### Built-in material core pack

ModeForge should ship with a compact built-in material pack for common lab materials.

Initial target materials:

- AIR,
- N-BK7 / BK7 aliases,
- Fused Silica / UVFS aliases,
- CaF2,
- MgF2,
- N-SF11,
- N-BK10,
- N-LASF9 or similar high-index glass,
- Sapphire,
- YAG,
- optional water.

The core pack should be small enough to load with the main app.

#### Optional material packs

Larger material sets should be lazy-loaded only when needed.

Possible packs:

- `schott-common-pack`,
- `ohara-common-pack`,
- `infrared-materials-pack`,
- `crystals-pack`,
- `full-refractiveindex-pack` as an optional advanced download only.

Do not load a huge raw material database during initial page load.

### 7.3 Material resolver

The material resolver maps vendor names to internal material models.

Examples:

```text
N-BK7        -> schott_n_bk7
BK7          -> schott_n_bk7 or generic_bk7
F_SILICA     -> fused_silica
FUSED SILICA -> fused_silica
UVFS         -> fused_silica_uv_grade
AIR          -> air
```

Resolver order:

1. exact match in user-imported AGF materials,
2. exact match in built-in materials,
3. alias match,
4. optional material pack search,
5. user-selected substitute,
6. manual material entry,
7. fail with clear warning.

The resolver should never silently replace a material with an approximate equivalent without showing the user.

### 7.4 Material model

Internal material representation:

```ts
type MaterialModel = {
  id: string;
  displayName: string;
  aliases: string[];
  source: "builtin" | "agf-import" | "manual" | "optional-pack";
  formula: "constant-n" | "sellmeier" | "schott" | "conrady" | "tabulated";
  coefficients?: number[];
  table?: { wavelengthUm: number; n: number; k?: number }[];
  wavelengthRangeUm?: [number, number];
  referenceTemperatureC?: number;
  citation?: string;
  license?: string;
};
```

Required material functions:

```ts
n(material, lambdaUm): number
dn_dlambda(material, lambdaUm): number
d2n_dlambda2(material, lambdaUm): number
gvd(material, lambdaUm): number
gdd(material, lambdaUm, thicknessMm): number
```

Warnings:

- wavelength outside validity range,
- material approximated by alias,
- material substituted by user,
- dispersion disabled because only constant `n` is known,
- AGF formula type unsupported,
- temperature dependence ignored.

### 7.5 GitHub Pages compatibility

Hard constraint:

> ModeForge must remain usable as a static website hosted from GitHub Pages or an equivalent static host.

Therefore:

- no required backend,
- no required database server,
- no secret API keys,
- no mandatory live vendor scraping,
- no huge raw material database in the main JavaScript bundle,
- all imports must work from local files in the browser,
- large parsing jobs should run in Web Workers,
- user-imported materials should be cached in IndexedDB/local browser storage,
- optional material packs should be lazy-loaded only when requested.

Recommended loading model:

```text
Initial page load:
- UI
- physics core
- ZMX parser
- compact material core pack
- alias index

On demand:
- optional material packs
- user-uploaded AGF catalogs
- user-uploaded ZMX prescriptions
- advanced full database pack
```

This keeps the app fast, static, and open-source while still allowing serious material handling.

### 7.6 Build-time material conversion

Do not parse large upstream YAML material databases at runtime.

Instead:

```text
upstream material data
        ↓ build script
filter useful transparent optical materials
normalize names and aliases
convert formulas/tables to compact ModeForge JSON
validate n(lambda) against reference values
        ↓
small runtime material packs
```

The runtime app should consume compact JSON, not large raw research-data trees.

### 7.7 User experience

Import flow:

```text
Upload ZMX
  ↓
Parse surfaces
  ↓
Resolve materials
  ↓
Show import card
  ↓
Compute EFL/BFL/FFL and material path
  ↓
Show warnings
  ↓
User confirms optic
  ↓
Use optic in beamline/optimizer/pulse mode
```

Import card should show:

- vendor/part number if available,
- surface table,
- radius,
- thickness,
- material,
- aperture,
- material match confidence,
- refractive index at current wavelength,
- computed EFL/BFL/FFL,
- catalog EFL/BFL if available,
- warnings.

Missing material flow:

```text
Material not found: S-FPL53

Options:
1. Upload AGF catalog
2. Load optional material pack
3. Choose substitute material
4. Enter manual Sellmeier coefficients
5. Continue with constant n and dispersion disabled
```

### 7.8 Legal and open-source hygiene

- Do not bundle proprietary vendor catalogs unless the license is explicit.
- Prefer open material sources for built-in packs.
- Keep source citation and license metadata attached to each material.
- User-uploaded vendor files remain local and are not redistributed by ModeForge.
- The app may provide import functionality without shipping the vendor catalog itself.
- Donation links are acceptable, but the physics core should remain open and reproducible.

---

## 8. Telescope and focus optimizer

This should be a flagship feature.

### 8.1 User goals

The user should be able to choose an optimization target:

- target waist radius,
- target diameter at a plane,
- target focus position,
- target collimation,
- target divergence,
- target fluence/intensity at focus,
- target magnification,
- minimize beam size at sample,
- avoid aperture clipping.

### 8.2 User constraints

Possible constraints:

- allowed lens list,
- allowed focal lengths,
- only thick lenses,
- only available lab lenses,
- minimum distance between lenses,
- maximum total beamline length,
- minimum clear aperture margin,
- fixed input and output planes,
- fixed first lens position,
- no focus before sample,
- avoid exceeding fluence/intensity limit.

### 8.3 Output table

The optimizer should return ranked solutions:

| Rank | L1 | L2 | Distance | Focus position | Waist | Mismatch | Warnings |
|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 50 mm | 150 mm | 203 mm | 310 mm | 48 µm | 1.2 % | OK |
| 2 | 75 mm | 200 mm | 276 mm | 305 mm | 52 µm | 3.8 % | aperture margin low |

### 8.4 Sensitivity analysis

Useful practical output:

- effect of ±0.5 mm lens shift,
- effect of ±1 mm lens shift,
- effect of ±1 % focal-length uncertainty,
- effect of M² uncertainty,
- effect of input beam-radius uncertainty.

This is high-value for lab use.

---

## 9. Pulsed-laser fields

### 9.1 Required inputs

| Field | Meaning |
|---|---|
| wavelength | central wavelength |
| average power | measured average power |
| repetition rate | pulses per second |
| pulse duration | FWHM or rms duration |
| pulse shape | Gaussian, sech², rectangular |
| beam/profile | coupled from spatial engine |
| focus position | from beamline calculation |
| material path | optional glass path for dispersion |

### 9.2 Derived quantities

- pulse energy,
- peak power,
- fluence,
- peak intensity,
- average intensity,
- transform-limited bandwidth estimate,
- GDD through glass elements,
- rough pulse broadening estimate.

### 9.3 Warnings

Warn if:

- pulse duration definition is ambiguous,
- transform limit is assumed,
- peak-power formula ignores pulse shape,
- fluence exceeds user-defined threshold,
- intensity estimate is based on ideal profile,
- nonlinear effects are likely but not modeled.

---

## 10. Main UI panels

### 10.1 Beam input panel

Fields:

- wavelength,
- unit system,
- profile type,
- power or energy,
- waist radius/diameter,
- waist position,
- divergence,
- M² or Mx²/My²,
- ellipticity,
- pulse toggle,
- pulse parameters.

### 10.2 Beamline panel

Fields:

- component list,
- z positions,
- component type,
- editable parameters,
- lens material,
- aperture,
- notes.

### 10.3 Output panel

Plots:

- beam radius/diameter vs z,
- x/y beam envelopes,
- optical component positions,
- waist locations,
- intensity profile,
- phase profile for modes,
- pulse intensity/fluence at selected planes.

Tables:

- final waist,
- final divergence,
- Rayleigh length,
- M²,
- BPP,
- EFL/BFL/FFL,
- principal planes,
- ABCD matrix,
- clipping margins,
- pulse quantities.

### 10.4 Optimizer panel

Fields:

- target quantity,
- target plane,
- allowed lenses,
- constraints,
- ranking metric,
- sensitivity analysis toggle.

---

## 11. Validation strategy

Validation should be treated as a core feature, not an afterthought.

### 11.1 Unit tests

Test against analytical reference cases:

- free-space Gaussian propagation,
- thin-lens transformation,
- collimated beam through lens,
- thick-lens effective focal length,
- plane slab ABCD matrix,
- HG/LG normalization,
- pulse-energy conversion,
- peak-power shape factors.

### 11.2 Cross-check tests

Cross-check selected Fast Mode cases against known optics libraries or independent scripts.

### 11.3 Numerical sanity checks

Warn or fail if:

- negative beam radius appears,
- matrix determinant is physically inconsistent,
- sampling in Field Mode is insufficient,
- aperture is smaller than beam diameter,
- paraxial angle is too large,
- units are inconsistent.

---

## 12. Roadmap

## Stage 0 — Mathematical core and architecture

Goal: build a reliable core library before UI polish.

Deliverables:

- unit system,
- q-parameter engine,
- M² propagation model,
- ABCD matrix library,
- thick-lens and surface-stack matrix engine,
- material model interface,
- compact core material pack,
- pulse quantity functions,
- JSON schema,
- validation tests.

---

## Stage 1 — Real Beam Calculator

Goal: useful first public web version.

Features:

- Gaussian beam,
- elliptical Gaussian beam,
- M² beam,
- HG/LG ideal modes,
- super-Gaussian and top-hat profile visualization,
- free space,
- thin lens,
- thick spherical lens,
- slab/window,
- surface-stack backend for future catalog import,
- compact material core pack for common glasses,
- aperture warning,
- pulsed-laser calculator,
- beam diameter vs z plot,
- intensity profile plot,
- phase profile for modes,
- JSON import/export.

This stage should already feel substantially more useful than a normal Gaussian-beam calculator.

---

## Stage 2 — Telescope and focus optimizer

Goal: make it a real lab-design tool.

Features:

- two-lens telescope optimizer,
- Kepler/Galilei options,
- thick-lens-aware optimization,
- target waist,
- target position,
- target diameter,
- target fluence/intensity,
- available-lens list,
- imported surface-stack lenses where validated,
- solution ranking,
- sensitivity to lens shifts,
- aperture/clipping margin.

This is probably the strongest practical feature.

---

## Stage 3 — Astigmatic and measured beams

Goal: support real beam imperfections.

Features:

- qx/qy propagation,
- Mx²/My²,
- different waist positions in x/y,
- cylindrical lenses,
- astigmatic telescope design,
- import measured beam-width points,
- fit waist, divergence, M²,
- compare measurement to model.

This connects directly to real laser diagnostics.

---

## Stage 4 — Field Mode

Goal: simulate beams where analytical propagation is not enough.

Features:

- FFT/Fresnel propagation,
- angular-spectrum propagation,
- apertures as physical masks,
- clipping diffraction,
- phase masks,
- custom transverse profiles,
- imported CSV/image intensity profile,
- HG/LG field propagation,
- grid/sampling diagnostics.

This stage makes top-hat, super-Gaussian, aperture effects, and mode fields physically meaningful.

---

## Stage 5 — Lab library and practical workflow

Goal: make the tool convenient in actual labs.

Features:

- user lens library,
- ZMX catalog lens import,
- AGF glass catalog import,
- material database,
- material alias resolver,
- Sellmeier/Schott/tabulated dispersion,
- lazy-loaded material packs,
- common laser presets,
- fiber output presets via MFD/NA,
- saved projects,
- shareable links,
- export report as PDF/Markdown,
- export as Python snippet,
- optional GitHub examples gallery.

---

## Stage 6 — Advanced modules

Optional future modules:

- thermal lens placeholder model,
- resonator/cavity mode calculator,
- basic nonlinear-crystal geometry,
- GDD/chirp module,
- grating/prism compressor estimates,
- mode decomposition,
- vector-field module,
- GPU acceleration for Field Mode.

---

## 13. Suggested technical architecture

### 13.1 Architecture decision

ModeForge should be built as a **frontend + browser-local computation core**, not as a classical frontend/backend web app in the first release.

Recommended architecture:

```text
ModeForge
│
├─ UI / frontend
│    └─ layout, panels, plots, interaction, import dialogs
│
├─ domain core
│    └─ units, beam models, ABCD optics, surface stacks, materials, pulses
│
├─ worker layer
│    └─ ZMX/AGF parsing, optimizer sweeps, large material-pack loading, later FFT jobs
│
└─ optional server backend later
     └─ accounts, cloud save, collaboration, public gallery, server-side reports, heavy compute
```

Hard rule:

> The frontend is not allowed to implement physics. It may only construct validated input objects, call the core API, and render returned results.

This keeps the tool scientifically testable, GitHub-Pages compatible, and much easier to build with AI assistance.

### 13.2 Why not a required backend at the start?

A mandatory backend would immediately add avoidable complexity:

- hosting and deployment costs,
- database design,
- authentication,
- privacy and security issues,
- API/version compatibility,
- server maintenance,
- loss of pure static-hosting compatibility.

The first implementation should therefore require:

- no server,
- no database,
- no API keys,
- no mandatory login,
- no live vendor scraping,
- no hidden server-side physics logic.

A later backend is acceptable, but only as an optional convenience layer. The physics core should remain open, local, reproducible, and independently testable.

### 13.3 Repository structure

Recommended monorepo structure:

```text
modeforge/
  apps/
    web/                    # Claude/UI area: app shell, panels, plots, interaction

  packages/
    core/                   # shared types, units, schemas, validation utilities
    beams/                  # Gaussian, elliptical, M², HG/LG, moment beam models
    optics/                 # ABCD matrices, thin lens, thick lens, surface-stack engine
    materials/              # Sellmeier/Schott/tabulated models, aliases, dispersion
    catalog/                # ZMX and AGF importers, catalog-object normalization
    pulses/                 # pulse energy, peak power, fluence, intensity, GDD
    optimizer/              # telescope/focus optimizer, sensitivity analysis
    field/                  # FFT/Fresnel/angular-spectrum propagation later
    worker-api/             # browser-worker interface around expensive calculations
    validation/             # analytical reference cases and reusable test fixtures

  docs/
    theory/                 # equations, assumptions, sign conventions, derivations
    examples/               # worked beamline examples
    validation/             # comparison cases and numerical tolerances
    architecture/           # data contracts, module boundaries, AI workflow rules

  tests/
    unit/
    integration/
    regression/

  examples/
    beamlines/
    materials/
    imports/
```

The package names should reflect physical responsibility, not UI panels. For example, `packages/optics` owns lens matrices; `apps/web` only asks for lens results.

### 13.4 Layer responsibilities

#### UI / frontend layer

Responsible for:

- page layout,
- input forms,
- beamline editor,
- component inspector,
- import dialogs,
- warnings display,
- plots and visualization,
- responsive design,
- user interaction,
- local project save/load UX.

Not responsible for:

- beam propagation formulas,
- lens equations,
- refractive-index calculation,
- pulse formulas,
- optimization physics,
- unit conversion logic beyond display formatting.

Good UI call:

```ts
const result = simulateBeamline(input);
```

Bad UI code:

```ts
const zR = Math.PI * w0 ** 2 / lambda;
```

The second example is dangerous because it spreads physics logic into React components and makes validation almost impossible.

#### Domain core layer

Responsible for:

- physical models,
- unit-safe data structures,
- numerical algorithms,
- warnings,
- validation rules,
- deterministic outputs,
- pure functions without UI dependencies.

The domain core should be usable from:

- the web app,
- unit tests,
- validation scripts,
- future CLI tools,
- future server backend,
- future WASM/worker wrappers.

#### Worker layer

Responsible for expensive or blocking browser-local jobs:

- parsing large `.zmx` files,
- parsing `.agf` catalogs,
- resolving large material packs,
- running telescope optimizer sweeps,
- running sensitivity analyses,
- later Field Mode FFT/Fresnel propagation,
- later image/CSV field imports.

Workers should return normal typed result objects. The UI should not know the internal numerical implementation.

#### Optional backend layer

A backend may be added later for:

- user accounts,
- cloud project storage,
- public example gallery,
- collaboration,
- server-side PDF/Markdown report generation,
- heavy remote Field Mode jobs,
- project sharing beyond encoded URLs.

The backend must not become required for the core calculator. ModeForge should stay useful offline or from a static host.

### 13.5 Core API contracts

The UI should call stable API functions rather than importing low-level formulas directly.

```ts
simulateBeamline(input: BeamlineInput): BeamlineResult
optimizeTelescope(input: OptimizationInput): OptimizationResult[]
propagateField(input: FieldInput): FieldResult
calculatePulse(input: PulseInput): PulseResult

importZmx(input: File | string): SurfaceStackOptic
importAgf(input: File | string): MaterialCatalog
resolveMaterial(name: string, lambdaUm: number): MaterialResolution

validateBeamlineInput(input: unknown): ValidationResult<BeamlineInput>
validateOptimizationInput(input: unknown): ValidationResult<OptimizationInput>
```

The most important shared data contracts:

```ts
type ModeForgeProject = {
  version: string;
  beam: BeamInput;
  beamline: BeamlineComponent[];
  materials?: MaterialCatalogRef[];
  pulses?: PulseInput;
  optimizer?: OptimizationInput;
  display?: DisplayPreferences;
};
```

```ts
type BeamlineResult = {
  zGridMm: number[];
  envelope: {
    radiusXmm: number[];
    radiusYmm?: number[];
    diameterXmm: number[];
    diameterYmm?: number[];
  };
  waists: WaistResult[];
  components: ComponentResult[];
  matrices: MatrixResult[];
  pulse?: PulseResult;
  warnings: SimulationWarning[];
};
```

```ts
type SimulationWarning = {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  componentId?: string;
  zMm?: number;
};
```

These contracts should be treated as a public interface. Claude can design beautiful UI against them without touching the physics.

### 13.6 Suggested stack

Frontend:

- TypeScript,
- React + Vite or Next.js static export, or SvelteKit with static adapter,
- Tailwind/shadcn or equivalent component system,
- Plotly, D3, Observable Plot, or custom SVG/Canvas plots,
- WebGL later for Field Mode visualization.

Core:

- TypeScript for browser-native calculations,
- pure functions as much as possible,
- no React dependency,
- no DOM dependency,
- schema validation with Zod or similar,
- optional Python scripts only for independent validation and reference generation,
- optional WASM later for FFT-heavy Field Mode.

Browser-local infrastructure:

- Web Workers for large parsing and optimization jobs,
- IndexedDB for user-imported catalogs and saved local projects,
- localStorage only for small UI preferences,
- lazy-loaded material packs,
- static JSON packs generated at build time.

Testing:

- unit tests for every optical element,
- parser tests for ZMX and AGF samples,
- material-dispersion regression tests,
- snapshot tests for known beamline examples,
- numerical tolerance tests,
- integration tests from UI input object to output object,
- validation docs with equations and reference values.

### 13.7 AI-assisted development split

The project is well suited for a two-model workflow, but only if the boundaries are strict.

| Area | Primary builder | Reason |
|---|---|---|
| Physics formulas | ChatGPT | derivations, assumptions, edge cases, sign conventions |
| TypeScript core | ChatGPT | numerical implementation and tests |
| Unit tests and validation | ChatGPT | analytical reference cases and tolerances |
| Type definitions and schemas | ChatGPT | stable data contracts for the whole app |
| UI layout | Claude | strong visual/component design |
| Interaction design | Claude | panels, dialogs, editor workflows |
| Plots and visual polish | Claude | readable visualization and UX |
| Final physics review | ChatGPT | catch hidden formulas and unit mistakes |

Hard AI workflow rules:

1. Claude may build UI components, but not physical formulas.
2. ChatGPT should define the data contracts before Claude builds the UI.
3. All UI-visible values should come from `BeamlineResult`, `PulseResult`, `OptimizationResult`, or import result objects.
4. Radius, diameter, FWHM, `1/e²`, rms, and D4σ definitions must be explicit in the data model.
5. Every formula implemented by ChatGPT must have at least one test or reference example.
6. Every warning shown by the UI must originate from the core or worker result, not from ad-hoc UI guessing.
7. If Claude needs a new value for visualization, it should request a new field in the result contract instead of recomputing it.

### 13.8 Recommended development workflow

#### Step 1 — Core first

Build the smallest trustworthy core:

- unit system,
- Gaussian q-parameter propagation,
- free-space matrix,
- thin-lens matrix,
- thick-lens matrix,
- basic material model,
- pulse energy and fluence functions,
- warnings and validation types.

No serious UI polish before this works.

#### Step 2 — Stable JSON contracts

Define:

- `BeamInput`,
- `BeamlineComponent`,
- `BeamlineInput`,
- `BeamlineResult`,
- `PulseInput`,
- `PulseResult`,
- `SimulationWarning`,
- `ModeForgeProject`.

These should be versioned early because they become the contract between ChatGPT-built physics and Claude-built UI.

#### Step 3 — Minimal UI shell

Claude builds:

- beam input panel,
- beamline component list,
- result panel,
- envelope plot,
- warning cards,
- JSON import/export.

At this stage, the UI can be visually simple but should already feel coherent.

#### Step 4 — Optimizer and imports

Add:

- telescope optimizer,
- sensitivity analysis,
- surface-stack engine,
- ZMX import,
- AGF import,
- material resolver,
- IndexedDB caching.

Run these through Web Workers when needed.

#### Step 5 — Field Mode later

Do not start with Field Mode. It is numerically more fragile and should only be added after the analytical core is stable.

Field Mode needs:

- grid sampling diagnostics,
- FFT reference tests,
- aperture/clipping tests,
- energy normalization checks,
- UI warnings for invalid sampling.

### 13.9 Static-hosting compatibility

ModeForge must remain deployable on GitHub Pages or another static host.

Therefore:

```text
Allowed in first release:
- static frontend bundle
- TypeScript core in browser
- Web Workers
- IndexedDB
- local file uploads
- lazy-loaded static JSON material packs
- encoded share URLs

Not allowed as requirement:
- server database
- mandatory login
- server-only calculations
- proprietary hosted catalog scraping
- secret keys
- paid API dependency
```

A static architecture is not a compromise here. For this type of optical calculator, it is actually the cleanest architecture because the user can verify the physics and keep vendor files local.

### 13.10 Backend upgrade path

If the project grows, add a backend only as an optional layer:

```text
Phase A: Pure static app
- GitHub Pages
- local projects
- JSON import/export
- browser-local calculations

Phase B: Optional cloud convenience
- user accounts
- saved projects
- public examples
- comments/community examples

Phase C: Optional heavy compute
- server-side report rendering
- large Field Mode jobs
- batch optimizer jobs
```

The rule remains:

> The open-source local core must always be able to reproduce the main calculator results without a server.

---

## 14. Naming notes

### 14.1 Open Lens

Strengths:

- simple,
- clearly optical,
- open-source signal,
- easy to understand,
- good for a lab-facing project.

Weaknesses:

- very generic,
- likely difficult for search/SEO,
- close to existing `OpenLens` naming in software,
- could be confused with lens-design tools rather than laser beamline tools,
- focuses on lenses, while the tool is broader: beams, modes, pulses, telescopes.

Verdict:

> **Open Lens is a good working title, but probably not the strongest final project name.**

Better use it as a subtitle or concept:

> ModeForge — an open lens into laser beamlines

or

> OpenBeamline — open-source laser beamline design

### 14.2 Stronger name candidates

| Name | Score | Reason |
|---|---:|---|
| ModeForge | 9/10 | best for modes + design + optimization |
| BeamForge | 8.5/10 | strong, broad, engineering feel |
| OpenBeamline | 8.5/10 | clear, open-source, lab-oriented |
| ModeScope | 8/10 | good for profiles/modes/diagnostics |
| CausticLab | 7.5/10 | physically elegant, but less obvious |
| PulseBeam | 7/10 | good only if pulsed lasers dominate |
| qForge | 6.5/10 | elegant but too Gaussian/q-parameter-centric |
| Open Lens | 6.5/10 | nice but too generic and already name-adjacent |

Recommended final names:

1. **ModeForge**
2. **OpenBeamline**
3. **BeamForge**

Best full title:

> **ModeForge — Open-source laser beamline and mode design**

Alternative if open-source branding is more important:

> **OpenBeamline — open-source laser beamline design for modes, lenses, and pulses**

---

## 15. First public release definition

A credible first public release should include:

- Gaussian beam,
- elliptical Gaussian beam,
- M² beam input,
- HG/LG ideal mode visualization,
- super-Gaussian/top-hat profile visualization,
- free-space propagation,
- thin lens,
- thick spherical lens,
- slab/window,
- surface-stack backend for future catalog import,
- compact material core pack for common glasses,
- aperture warning,
- pulse-energy/fluence/intensity calculator,
- telescope calculator,
- beamline plot,
- profile plot,
- JSON import/export,
- experimental ZMX import for simple spherical surface stacks,
- theory documentation,
- validation examples.

This is the minimum version that justifies the project as more than a Gaussian calculator.

---

## 16. Open-source positioning and portfolio value

ModeForge should be public, technically serious, and useful enough to strengthen the author's scientific/software profile.

Recommended positioning:

- fully open-source physics core,
- public validation examples,
- transparent limitations,
- readable theory documentation,
- clean project README with screenshots and examples,
- optional website footer with GitHub link, LinkedIn/profile link, and small donation link such as Buy Me a Coffee,
- no paywall for the core calculator,
- no hidden server-side physics logic.

The project should be credible as:

- a practical lab tool,
- a physics/software portfolio project,
- a possible community contribution point for optics students and labs.

Donation/support links should be framed as optional support, not as a requirement to use the tool.

---

## 17. Core motto

> Not a Gaussian calculator. Not a Zemax clone.  
> A practical open-source laser beamline tool for real beams, modes, lenses, telescopes, imported optics, and pulses.

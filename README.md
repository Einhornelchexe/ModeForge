# ModeForge

**Design laser beamlines in your browser — with honest physics.**

ModeForge is a free, open-source laser beamline workbench that runs entirely in your browser: no install, no sign-up, no server compute. It propagates real laser beams — Gaussian, elliptical/astigmatic, or measured M² beams — through lenses, windows and apertures, and tells you honestly when its approximations stop being trustworthy.

**Live:** https://modeforge.rholabs.de/

## The questions it answers

The everyday laser-lab questions that usually end up in throwaway spreadsheets or an expensive license:

1. **Will my beam clip anywhere?** — paraxial ABCD envelope with per-component aperture margins.
2. **Is the fluence at the sample above the damage threshold?** — pulse energy, peak power, fluence and intensity at the exit plane (Gaussian, sech², rectangular).
3. **Which two lenses from the drawer build this relay?** — grid-search optimizer with aperture/separation constraints and sensitivity analysis.
4. **What is my M² from this caustic scan?** — ISO-style least-squares fit of w²(z), adoptable as beam source.
5. **When does diffraction start to matter?** — scalar field propagation (FFT Fresnel / angular spectrum) through the *actual* beamline, read out at any z plane, cross-checked against the paraxial envelope.

Plus: ZMX/AGF import (any sequential prescription — cemented doublets included — with honest material resolution: unknown glasses block, nothing is silently substituted), and a real-surface phase mode that makes sag-driven spherical aberration of the true prescription visible.

## Verified physics, honestly bounded

Trust is the product here, so the physics is treated accordingly:

- **Warnings first.** Every result carries machine-readable warnings — aperture margins, sampling limits, validity ranges. Nothing fails silently, and unsupported geometry (aspheres, tilts, mirrors in ZMX files) blocks the import instead of importing something wrong.
- **Independently verified core.** Every calculation domain (Gaussian/ABCD optics, thick lenses & Sellmeier materials, pulse energetics, beam-width conventions & M² fitting, scalar field propagation) was audited against independent textbook derivations produced by separate AI agents, with every discrepancy resolved by hand calculation. Result: zero formula errors; the audit trail lives in [`agents/verification/`](agents/verification/).
- **Permanent regression gates.** `npm run verify:cases` replays 60 independently derived reference cases against the physics packages; `npm run verify:headless` pins example projects to 12-significant-digit expected results; `npm test` runs 81 unit tests with analytic oracles.
- **Honest limits, in writing.** Paraxial ABCD in Fast Mode (no aberrations); the field mode's real-sag surfaces are a thin-element approximation (sag-driven spherical aberration yes, incidence-angle aberrations no); one wavelength per run. See [`docs/theory/`](docs/theory/) for the exact conventions and boundaries.

## Quickstart

Use it online: **https://modeforge.rholabs.de/** — or run it locally:

```bash
npm install
npm run dev:web        # workbench at http://127.0.0.1:5173
```

Verification gates:

```bash
npm test               # 81 unit tests (analytic oracles)
npm run verify:cases   # 60 independently derived physics reference cases
npm run verify:headless
npm run check:scope    # UI/physics boundary + no external runtime assets
```

Architecture in one line: all physics lives in headless TypeScript packages (`packages/*`) behind a typed API; the web app (`apps/web`) renders API results and computes nothing itself — enforced by a scope gate. Projects are versioned, diffable JSON files.

## How this was built

This project was **human-directed and AI-orchestrated**: the architecture, physics decisions, quality bar and every acceptance call came from a human; the code was written by AI agents under a custom orchestration layer (private, not part of this repository) that coordinates a strong manager model with inexpensive worker models.

What made the output trustworthy is the verification methodology rather than any single model:

1. **Design-first** — the UI was designed as a real prototype first, then implemented 1:1 against it.
2. **Contracts and gates before features** — typed data contracts, runtime validation, scope gates and regression suites were built before and alongside every feature.
3. **Adversarial verification** — for each physics domain, multiple independent agents derived the textbook physics from scratch (without looking at the implementation), produced numeric reference cases, and every mismatch was triaged by hand until it was attributable: in all audited cases the implementation was exact and the discrepancies were agent-side rounding or convention slips. Those reference cases now run as a permanent gate.
4. **Honest failure modes** — model limits (thin-element approximation, paraxial regime, sampling) are documented and surfaced as warnings in the product itself, not hidden.

The development trail — phase documents, verification reports and reference cases — ships in this repository ([`Plan/`](Plan/), [`agents/verification/`](agents/verification/)).

## License

[MIT](LICENSE) © 2026 Patrick Feix (Rho-Labs)

ModeForge is a computation and learning tool for paraxial beam optics. Results are approximations and not a substitute for full wave-optics analysis or a laser-safety assessment.

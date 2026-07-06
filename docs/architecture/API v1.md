# ModeForge Headless API v1

**Status:** S07 headless contract, HOLD vor Commit.
**Datum:** 2026-07-02.

## Boundary

The headless API is the stable computation surface that the later Claude Design UI may call. It must not import React, DOM globals, browser-only state, or UI components.

## Public Entry Points

- `projectToBeamlineInput(project)` converts `ModeForgeProject` to `BeamlineInput`.
- `runModeForgeProject(project)` returns `HeadlessRunResult`.
- `runModeForgeProjectJson(json)` parses, validates, runs, and returns `ValidationResult<HeadlessRunResult>`.
- `runHeadlessJob(input)` runs versioned headless jobs for beamline, optimizer, import, measured-beam, and field slices.
- `runHeadlessJobJson(json)` parses a headless job and returns `ValidationResult<HeadlessJobResult>`.

## Result Contract

`HeadlessRunResult` contains:

- `version`: currently `"0.1"`.
- `beamline`: a `BeamlineResult` produced by `packages/optics`.
- `warnings`: global warnings copied from `beamline.warnings`.

`HeadlessJobResult` is a discriminated result union:

- `modeforge-project`
- `two-lens-optimizer`
- `zmx-import`
- `agf-import`
- `measured-beam-fit`
- `field-fresnel`

Field jobs accept `method: "fresnel" | "angular-spectrum"` and return power, moment radii, and typed warnings.

## CLI Contract

`scripts/run-headless.mjs <project.modeforge.json|job.headless.json> [output.json]` prints or writes a JSON `ValidationResult`.

Input dispatch:

- `.modeforge.json` or any JSON without `kind`: `runModeForgeProjectJson`.
- JSON with `kind`: `runHeadlessJobJson`.

Exit codes:

- `0`: project parsed and ran successfully.
- `1`: validation or simulation returned an error result.
- `2`: command usage error.

## Fixture Contract

`scripts/verify-headless.mjs` runs all `examples/*.modeforge.json` and `examples/*.headless.json`, then compares stable result summaries against `examples/expected-headless-summary.json`.

## UI Rule

The future UI may render `HeadlessRunResult` and `HeadlessJobResult`, but must not recompute physical quantities already present in the result.

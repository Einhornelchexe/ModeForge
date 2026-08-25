# ModeForge Headless Examples

These JSON files are S07 headless fixtures. They are not UI data and do not require `apps/web`.

Run one example:

```powershell
node scripts/run-headless.mjs examples/basic-gaussian.modeforge.json
```

Job fixtures (`*.headless.json`) cover every headless job kind, including the browser-local image analyzer: `image_analysis_gauss.headless.json` runs the `image-analysis` job (`kind: "image-analysis"`) against a small synthetic Gaussian frame.

Verify all examples:

```powershell
npm.cmd run verify:headless
```

The verifier compares stable result summaries against `examples/expected-headless-summary.json`.

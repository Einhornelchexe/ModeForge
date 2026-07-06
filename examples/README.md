# ModeForge Headless Examples

These JSON files are S07 headless fixtures. They are not UI data and do not require `apps/web`.

Run one example:

```powershell
node scripts/run-headless.mjs examples/basic-gaussian.modeforge.json
```

Verify all examples:

```powershell
npm.cmd run verify:headless
```

The verifier compares stable result summaries against `examples/expected-headless-summary.json`.

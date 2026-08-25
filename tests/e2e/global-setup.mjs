// Playwright globalSetup entry (must be a file path in the config, not an
// inline function): regenerates the deterministic binary TIFF fixtures so no
// binary is committed to the repo.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function globalSetup() {
  const script = fileURLToPath(new URL("./fixtures/generate-fixtures.mjs", import.meta.url));
  execFileSync(process.execPath, [script], { stdio: "inherit" });
}

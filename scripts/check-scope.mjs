import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import assert from "node:assert/strict";
import { join } from "node:path";

assert.equal(existsSync("apps/web"), true, "S12 requires the Claude Design web app under apps/web.");

const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".ts", ".tsx", ".txt"]);
const blockedRuntimeNeedles = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "unpkg.com",
  "cdn.jsdelivr.net",
  "jsdelivr.net",
];
const blockedFileNames = new Set(["modeforge-core.js", "support.js"]);
const externalRuntimePatterns = [
  /<script\b[^>]*\bsrc=["']https?:\/\//i,
  /<link\b[^>]*rel=["'][^"']*stylesheet[^"']*["'][^>]*href=["']https?:\/\//i,
  /@import\s+(?:url\()?["']?https?:\/\//i,
];
const directPhysicsImportPattern =
  /from\s+["'][^"']*packages\/(beams|catalog|core|field|materials|optics|optimizer|pulses)\/src\//;

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

for (const file of walk("apps/web")) {
  const normalized = file.replaceAll("\\", "/");
  const name = normalized.split("/").at(-1);
  assert.equal(blockedFileNames.has(name), false, `apps/web must not copy Claude Design runtime file ${name}`);
  const suffix = name.includes(".") ? `.${name.split(".").at(-1)}` : "";
  if (!textExtensions.has(suffix)) continue;
  const text = readFileSync(file, "utf8");
  for (const needle of blockedRuntimeNeedles) {
    assert.equal(text.includes(needle), false, `apps/web must not reference ${needle}`);
  }
  for (const pattern of externalRuntimePatterns) {
    assert.equal(pattern.test(text), false, `apps/web must not load external runtime assets in ${normalized}`);
  }
  if (normalized.startsWith("apps/web/src/")) {
    assert.equal(
      directPhysicsImportPattern.test(text),
      false,
      `apps/web/src must call packages/api instead of importing physics packages directly: ${normalized}`,
    );
  }
}

console.log("scope ok: S12 web app uses local assets and API-only physics boundary");

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import assert from "node:assert/strict";
import { join } from "node:path";

assert.equal(existsSync("apps/web"), true, "S12 requires the Claude Design web app under apps/web.");

const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml"]);
const excludedDirectoryNames = new Set(["node_modules", "dist", "coverage", ".git", ".vite", ".vite-temp", "Plan", "agents"]);
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
  /from\s+["'][^"']*packages\/(beams|catalog|core|field|image|materials|optics|optimizer|pulses)\/src\//;

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (excludedDirectoryNames.has(entry)) continue;
      files.push(...walk(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

function normalizePath(file) {
  return file.replaceAll("\\", "/");
}

function fileSuffix(name) {
  return name.includes(".") ? `.${name.split(".").at(-1)}` : "";
}

for (const file of walk("apps/web")) {
  const normalized = normalizePath(file);
  const name = normalized.split("/").at(-1);
  assert.equal(blockedFileNames.has(name), false, `apps/web must not copy Claude Design runtime file ${name}`);
  const suffix = fileSuffix(name);
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

// Restricted wording gate: product surfaces must not carry standards references.
// This file is excluded from its own scan below because it contains the pattern
// literals.
const restrictedWordingPatterns = [
  { label: "upper-triple", regex: /\bISO\b/ }, // case-SENSITIVE, no i flag
  { label: "standard-number", regex: /\b11146\b/ },
  { label: "standard-number-joined", regex: /ISO[- ]?11146/i },
  { label: "din-pair", regex: /\bDIN[- ]EN\b/i },
  { label: "norm-adjective", regex: /\bnorm[- ]?(konform|gerecht)\w*/i },
  { label: "iso-adjective", regex: /\biso[- ]?konform\w*/i },
  { label: "iso-noun", regex: /\biso[- ]norm\w*/i },
  { label: "compliant-pair", regex: /\b(norm|standards?)[- ]?compliant/i },
  { label: "normative", regex: /\bnormativ\w*/i },
  { label: "norm-fulfil", regex: /\bnormerf\w*/i },
  { label: "laser-safety-number", regex: /\bIEC[- ]?60825\b/i },
];

// Expected hits on the current repository; the release hardening pass S18f
// empties this list except for the impressum entry.
const restrictedWordingAllowlist = [
  { path: "packages/api/src/index.ts", label: "upper-triple", expected: 4 },
  { path: "tests/unit/field-modes.test.ts", label: "upper-triple", expected: 2 },
  { path: "README.md", label: "upper-triple", expected: 1 },
  { path: "apps/web/impressum.html", label: "norm-adjective", expected: 1 },
];

const restrictedWordingScanRoots = ["packages", "apps", "docs", "examples", "tests", "scripts"];
const restrictedWordingScanFiles = ["README.md", "LICENSE", "package.json"];
const restrictedWordingScanPaths = [];
for (const root of restrictedWordingScanRoots) {
  if (existsSync(root)) restrictedWordingScanPaths.push(...walk(root));
}
for (const file of restrictedWordingScanFiles) {
  if (existsSync(file)) restrictedWordingScanPaths.push(file);
}

for (const file of restrictedWordingScanPaths) {
  const normalized = normalizePath(file);
  // Self-exclusion: this script contains the pattern literals.
  if (normalized === "scripts/check-scope.mjs") continue;
  const name = normalized.split("/").at(-1);
  const suffix = fileSuffix(name);
  // Explicitly listed files (README.md, LICENSE, package.json) are always
  // scanned, even when extensionless — the suffix filter only gates the
  // directory walks.
  if (!textExtensions.has(suffix) && !restrictedWordingScanFiles.includes(normalized)) continue;
  const text = readFileSync(file, "utf8");
  for (const { label, regex } of restrictedWordingPatterns) {
    const matcher = new RegExp(regex.source, regex.flags.includes("i") ? "gi" : "g");
    const count = (text.match(matcher) || []).length;
    const allowed = restrictedWordingAllowlist.find((entry) => entry.path === normalized && entry.label === label);
    if (allowed) {
      // Count is pinned in BOTH directions: fewer hits than expected means a
      // stale allowlist entry that must be removed (S18f empties this list).
      assert.equal(
        count,
        allowed.expected,
        `restricted wording: ${normalized} [${label}] found ${count}, expected ${allowed.expected} (stale allowlist entries must be removed)`,
      );
      continue;
    }
    if (count === 0) continue;
    assert.fail(
      `restricted wording: ${normalized} [${label}] has ${count} match(es); product surfaces must not carry standards references`,
    );
  }
}

console.log("scope ok: web assets local, physics via api only, restricted wording clean");

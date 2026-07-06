import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));

test("S12 scaffold exposes core and web workspaces", () => {
  assert.equal(rootPackage.name, "modeforge");
  assert.deepEqual(rootPackage.workspaces, ["packages/*", "apps/*"]);
  assert.equal(existsSync("apps/web"), true);
  assert.equal(typeof rootPackage.scripts["dev:web"], "string");
  assert.equal(typeof rootPackage.scripts["build:web"], "string");
  assert.equal(typeof rootPackage.scripts["typecheck:web"], "string");
});

test("architecture conventions record S12 UI boundary", () => {
  const conventions = readFileSync("docs/architecture/CONVENTIONS.md", "utf8");
  assert.match(conventions, /S12/);
  assert.match(conventions, /Claude Design/);
  assert.match(conventions, /UI code must not implement physics formulas/);
  assert.match(conventions, /Google Fonts/);
});

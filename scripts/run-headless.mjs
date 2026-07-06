import { readFile, writeFile } from "node:fs/promises";
import { runHeadlessJobJson, runModeForgeProjectJson } from "../packages/api/src/index.ts";

const [, , inputPath, outputPath] = process.argv;

if (!inputPath) {
  console.error("usage: node scripts/run-headless.mjs <project.modeforge.json> [output.json]");
  process.exitCode = 2;
} else {
  try {
    const json = await readFile(inputPath, "utf8");
    const parsed = JSON.parse(json);
    const result = parsed && typeof parsed === "object" && "kind" in parsed ? runHeadlessJobJson(json) : runModeForgeProjectJson(json);
    const output = JSON.stringify(result, null, 2);
    if (outputPath) {
      await writeFile(outputPath, `${output}\n`, "utf8");
    } else {
      console.log(output);
    }
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

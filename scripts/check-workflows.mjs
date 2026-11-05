#!/usr/bin/env node
/**
 * Keeps two rules across .github/workflows and .github/actions:
 *
 *   - Third-party actions are pinned to a full commit SHA. Dependabot's
 *     github-actions entry keeps the pins current.
 *   - `run:` scripts contain no `${{ }}` expressions. Pass values through
 *     `env:` and read them as shell variables.
 *
 * Usage: node scripts/check-workflows.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function yamlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return yamlFiles(path);
    return /\.ya?ml$/.test(entry.name) ? [path] : [];
  });
}

const indentOf = (line) => line.length - line.trimStart().length;

function check(path) {
  const problems = [];
  const lines = readFileSync(path, "utf8").split("\n");
  let runIndent = null; // Column of the `run` key while inside its script.

  lines.forEach((line, index) => {
    const where = `${relative(root, path)}:${index + 1}`;
    if (runIndent !== null && line.trim() !== "" && indentOf(line) <= runIndent) runIndent = null;

    const run = runIndent === null ? /^(\s*(?:-\s+)?)run\s*:/.exec(line) : null;
    if (run) runIndent = run[1].length;
    if (runIndent !== null && line.includes("${{")) {
      problems.push(`${where}: expression inside a run script; pass it through env`);
    }

    const uses = runIndent === null ? /^\s*(?:-\s+)?uses\s*:\s*["']?([^"'\s#]+)/.exec(line) : null;
    if (uses && !uses[1].startsWith("./") && !/@[0-9a-f]{40}$/.test(uses[1])) {
      problems.push(`${where}: ${uses[1]} is not pinned to a full commit SHA`);
    }
  });
  return problems;
}

const problems = yamlFiles(join(root, ".github")).flatMap(check);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("Workflows OK.");

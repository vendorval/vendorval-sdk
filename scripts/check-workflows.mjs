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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

const root = fileURLToPath(new URL("..", import.meta.url));

function yamlFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return yamlFiles(path);
    return /\.ya?ml$/.test(entry.name) ? [path] : [];
  });
}

const mapping = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function check(path) {
  const problems = [];
  const file = relative(root, path);
  let document;
  try {
    document = load(readFileSync(path, "utf8"), { filename: file });
  } catch (error) {
    return [`${file}: YAML could not be read: ${error.message}`];
  }
  if (!mapping(document)) return [`${file}: expected a YAML mapping`];

  const checkUses = (value, where) => {
    if (typeof value !== "string") problems.push(`${where}: uses must name an action or reusable workflow`);
    else if (!value.startsWith("./") && !/@[0-9a-f]{40}$/.test(value)) {
      problems.push(`${where}: ${value} is not pinned to a full commit SHA`);
    }
  };
  const checkSteps = (steps, where) => {
    if (!Array.isArray(steps)) { problems.push(`${where}: expected a step sequence`); return; }
    for (const [index, step] of steps.entries()) {
      const at = `${where}[${index}]`;
      if (!mapping(step)) { problems.push(`${at}: expected a step mapping`); continue; }
      if (Object.hasOwn(step, "uses")) checkUses(step.uses, `${at}.uses`);
      if (Object.hasOwn(step, "run")) {
        if (typeof step.run !== "string") problems.push(`${at}.run: expected a script string`);
        else if (step.run.includes("${{")) problems.push(`${at}.run: expression inside a run script; pass it through env`);
      }
    }
  };

  if (Object.hasOwn(document, "jobs")) {
    if (!mapping(document.jobs)) problems.push(`${file}:jobs: expected a job mapping`);
    else for (const [id, job] of Object.entries(document.jobs)) {
      const at = `${file}:jobs.${id}`;
      if (!mapping(job)) { problems.push(`${at}: expected a job mapping`); continue; }
      if (Object.hasOwn(job, "uses")) checkUses(job.uses, `${at}.uses`);
      if (Object.hasOwn(job, "steps")) checkSteps(job.steps, `${at}.steps`);
    }
  }
  if (mapping(document.runs) && document.runs.using === "composite") {
    checkSteps(document.runs.steps, `${file}:runs.steps`);
  }
  return problems;
}

const files = [
  ...yamlFiles(join(root, ".github", "workflows")),
  ...yamlFiles(join(root, ".github", "actions")).filter((path) => /^action\.ya?ml$/.test(basename(path))),
];
const problems = files.flatMap(check);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("Workflows OK.");

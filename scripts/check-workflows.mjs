#!/usr/bin/env node
/**
 * Keeps these rules across .github/workflows and .github/actions:
 *
 *   - Third-party actions are pinned to a full commit SHA. Dependabot's
 *     github-actions entry keeps the pins current.
 *   - `run:` scripts contain no `${{ }}` expressions. Pass values through
 *     `env:` and read them as shell variables.
 *   - Jobs run on our own runners: no GitHub-hosted label (ubuntu-*,
 *     windows-*, macos-*) in `runs-on`, also not as an expression fallback.
 *     The single exception is HOSTED_JOBS below.
 *   - `npm publish` runs only in the excepted npm publish job, and that job
 *     stays on its GitHub-hosted runner behind its environment with OIDC.
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

// GitHub-hosted runner labels. Matched anywhere in a runs-on value, so a
// hosted fallback inside an expression is caught too.
const HOSTED_LABEL = /\b(?:ubuntu|windows|macos)-[0-9a-z.-]+/i;

// The only jobs allowed on a GitHub-hosted runner (Dominik Ottenbreit,
// 2026-11-25). npm Trusted Publishing (OIDC, used with --provenance instead of
// an NPM_TOKEN) supports only cloud-hosted runners:
// https://docs.npmjs.com/trusted-publishers/#supported-cicd-providers
const HOSTED_JOBS = new Map([
  [
    ".github/workflows/release-node.yml:publish",
    { runsOn: "ubuntu-latest", environment: "npm", reason: "npm Trusted Publishing supports only GitHub-hosted runners" },
  ],
]);

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
  const runsOnLabels = (value) => {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(runsOnLabels);
    // A runner group name is our own choice, not a label: check only labels.
    if (mapping(value)) return value.labels === undefined ? [] : runsOnLabels(value.labels);
    return [String(value)];
  };
  const matrixStrings = (value) => {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(matrixStrings);
    if (mapping(value)) return Object.values(value).flatMap(matrixStrings);
    return [];
  };
  const runsNpmPublish = (steps) =>
    Array.isArray(steps) && steps.some((step) => mapping(step) && typeof step.run === "string" && /\bnpm\s+publish\b/.test(step.run));
  const checkRunner = (id, job, at) => {
    const exception = HOSTED_JOBS.get(`${file}:${id}`);
    if (exception) {
      if (job["runs-on"] !== exception.runsOn) {
        problems.push(`${at}.runs-on: must be ${exception.runsOn} (${exception.reason})`);
      }
      if (job.environment !== exception.environment) {
        problems.push(`${at}.environment: must be ${exception.environment}`);
      }
      if (!mapping(job.permissions) || job.permissions["id-token"] !== "write") {
        problems.push(`${at}.permissions: must grant id-token: write for OIDC publishing`);
      }
      return;
    }
    if (runsNpmPublish(job.steps)) {
      problems.push(`${at}: npm publish belongs only in the npm publish job of release-node.yml`);
    }
    // A renamed or moved npm job loses the exception and is then caught here.
    if (!Object.hasOwn(job, "runs-on")) return;
    const labels = runsOnLabels(job["runs-on"]);
    // runs-on: ${{ matrix.x }} resolves to the matrix values: check them too.
    if (labels.some((label) => label.includes("matrix.")) && mapping(job.strategy)) {
      labels.push(...matrixStrings(job.strategy.matrix));
    }
    for (const label of labels) {
      const hosted = label.match(HOSTED_LABEL);
      if (hosted) problems.push(`${at}.runs-on: ${hosted[0]} is a GitHub-hosted runner; use our own runners (vars.LINUX_RUNNER || 'beast', ...)`);
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
      checkRunner(id, job, at);
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

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const fixtures: string[] = [];
const expression = "$" + "{{ github.event.pull_request.title }}";
const secretExpression = "$" + "{{ secrets.EXAMPLE }}";

function checkWorkflow(lines: string[], file = ".github/workflows/fixture.yml") {
  const root = mkdtempSync(join(tmpdir(), "sdk-workflow-check-"));
  fixtures.push(root);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  // The real checker resolves its build-time parser from the installed workspace.
  symlinkSync(new URL("../../../node_modules", import.meta.url), join(root, "node_modules"), "dir");
  const script = join(root, "scripts", "check-workflows.mjs");
  // Execute the actual checker source against a disposable tree, not a copy of its logic.
  copyFileSync(new URL("../../../scripts/check-workflows.mjs", import.meta.url), script);
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), lines.join("\n") + "\n");
  return spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 5_000 });
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("workflow checker against real fixture files", () => {
  it("checks action pins in flow-style steps", () => {
    const result = checkWorkflow(["jobs:", "  check:", "    steps:", "      - { uses: actions/checkout@v4 }"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not pinned to a full commit SHA");
  });

  it("checks script expressions in flow-style steps", () => {
    const result = checkWorkflow(["jobs:", "  check:", "    steps:", `      - { run: 'echo ${expression}' }`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expression inside a run script");
  });

  it("allows pinned flow-style steps with expressions passed through env", () => {
    const result = checkWorkflow([
      "jobs:", "  check:", "    steps:",
      `      - { uses: actions/checkout@${"a".repeat(40)} }`,
      `      - { run: 'echo "$TOKEN"', env: { TOKEN: '${secretExpression}' } }`,
    ]);
    expect(result.status).toBe(0);
  });

  it("checks a flow-style job and step collection", () => {
    const result = checkWorkflow([`jobs: { check: { steps: [{ run: 'echo ${expression}' }] } }`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expression inside a run script");
  });

  it.each([
    ["run", `run: 'echo ${expression}'`, "expression inside a run script"],
    ["uses", "uses: actions/checkout@v4", "not pinned to a full commit SHA"],
  ])("checks composite action flow-style %s steps", (_name, step, diagnostic) => {
    const result = checkWorkflow([`runs: { using: composite, steps: [{ ${step} }] }`], ".github/actions/fixture/action.yml");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(diagnostic);
  });

  it("checks flow-style reusable workflow calls", () => {
    const result = checkWorkflow(["jobs: { check: { uses: example/repo/.github/workflows/reuse.yml@main } }"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not pinned to a full commit SHA");
  });

  it("allows a pinned flow-style reusable workflow call", () => {
    const result = checkWorkflow([`jobs: { check: { uses: example/repo/.github/workflows/reuse.yml@${"a".repeat(40)} } }`]);
    expect(result.status).toBe(0);
  });

  it.each(['"run"', "'run'"])("checks scripts under a quoted YAML key %s", (key) => {
    const result = checkWorkflow([
      "jobs:", "  check:", "    steps:", `      - ${key}: |`,
      `          echo "${expression}"`,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expression inside a run script");
  });

  it.each(['"uses"', "'uses'"])("checks action pins under a quoted YAML key %s", (key) => {
    const result = checkWorkflow([
      "jobs:", "  check:", "    steps:", `      - ${key}: actions/checkout@v4`,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not pinned to a full commit SHA");
  });
  it("rejects an interpolated expression after a heredoc line that resembles a run key", () => {
    const result = checkWorkflow([
      "jobs:", "  check:", "    steps:", "      - run: |",
      "          cat <<'EOF'", "          run: example", "          EOF",
      `          echo "${expression}"`,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expression inside a run script");
  });

  it("still rejects ordinary script interpolation", () => {
    const result = checkWorkflow([
      "jobs:", "  check:", "    steps:", "      - run: |",
      `          echo "${expression}"`,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expression inside a run script");
  });

  it("allows step environment expressions after a run key", () => {
    const result = checkWorkflow([
      "jobs:", "  check:", "    steps:", "      - run: echo \"$TOKEN\"",
      "        env:", `          TOKEN: ${secretExpression}`,
    ]);
    expect(result.status).toBe(0);
  });

  it("does not interpret action-like heredoc text as an action reference", () => {
    const result = checkWorkflow([
      "jobs:", "  check:", "    steps:", "      - run: |",
      "          cat <<'EOF'", "          uses: example", "          EOF",
    ]);
    expect(result.status).toBe(0);
  });
});

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const fixtures: string[] = [];
const expression = "$" + "{{ github.event.pull_request.title }}";
const secretExpression = "$" + "{{ secrets.EXAMPLE }}";

function checkWorkflow(lines: string[]) {
  const root = mkdtempSync(join(tmpdir(), "sdk-workflow-check-"));
  fixtures.push(root);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  const script = join(root, "scripts", "check-workflows.mjs");
  // Execute the actual checker source against a disposable tree, not a copy of its logic.
  copyFileSync(new URL("../../../scripts/check-workflows.mjs", import.meta.url), script);
  writeFileSync(join(root, ".github", "workflows", "fixture.yml"), lines.join("\n") + "\n");
  return spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 5_000 });
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("workflow checker against real fixture files", () => {
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

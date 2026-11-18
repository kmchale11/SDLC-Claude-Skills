// End-to-end: drive a throwaway project through tests → build → verify → ship
// with the real CLI and hook, the way the skills do.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins", "sdlc", "scripts");
const CHANGE = "add-shout";

function project() {
  const root = mkdtempSync(join(tmpdir(), "sdlc-flow-"));
  const files = {
    "package.json": JSON.stringify({ name: "p", type: "module", scripts: { test: "node --test test/*.test.mjs" } }),
    "src/greet.mjs": 'export const greet = (n) => `Hello, ${n}`;\n',
    "test/greet.test.mjs":
      'import { test } from "node:test"; import assert from "node:assert/strict";\n' +
      'import { greet } from "../src/greet.mjs";\n' +
      'test("greet.says-hello", () => assert.equal(greet("Ann"), "Hello, Ann"));\n',
    [`openspec/changes/${CHANGE}/.openspec.yaml`]: "schema: spec-driven\n",
    [`openspec/changes/${CHANGE}/proposal.md`]: "## Why\nPeople want to shout.\n## What Changes\n- Add shout.\n## Capabilities\n### Modified Capabilities\n- `greet`\n## Impact\nsrc/greet.mjs\n",
    [`openspec/changes/${CHANGE}/specs/greet/spec.md`]:
      "## ADDED Requirements\n\n### Requirement: Shout\nThe system SHALL return the greeting in upper case when asked to shout.\n\n" +
      "#### Scenario: Shouts the greeting\n- **WHEN** shout is called with Ann\n- **THEN** the result is HELLO, ANN\n",
    [`openspec/changes/${CHANGE}/design.md`]: "## Context\nAdd `shout` to src/greet.mjs.\n",
    [`openspec/changes/${CHANGE}/test-plan.md`]:
      "# Test Plan\n\n## Traceability\n\n| Test ID | Scenario | Level | Test file | Before |\n|---|---|---|---|---|\n" +
      "| `greet.shouts-the-greeting` | greet › Shout › Shouts the greeting | unit | test/shout.test.mjs | red |\n\n## Not automated\n\nNone.\n",
    [`openspec/changes/${CHANGE}/tasks.md`]:
      "# Tasks\n\n## 1. Failing tests\n\n- [ ] 1.1 Write greet.shouts-the-greeting\n\n## 2. Build\n\n- [ ] 2.1 Implement shout; turns greet.shouts-the-greeting green\n",
  };
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return root;
}

// Keep the user's global tools (openspec among them) off PATH so the test
// doesn't depend on what is installed; node, npm and a shell remain.
// NODE_TEST_CONTEXT is dropped too: a nested `node --test` that inherits it
// reports to this runner and always exits 0.
const { NODE_TEST_CONTEXT: _ignored, ...parentEnv } = process.env;
const env = { ...parentEnv, PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(":"), OPENSPEC_TELEMETRY: "0" };

function sdlc(root, ...args) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, "sdlc.mjs"), ...args], { cwd: root, env, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

function hook(root, tool_name, tool_input) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, "guard.mjs")], {
    cwd: root, env: { ...env, CLAUDE_PROJECT_DIR: root }, encoding: "utf8",
    input: JSON.stringify({ tool_name, tool_input, cwd: root }),
  });
  return { code: r.status, err: r.stderr };
}

const writeTests = (root) =>
  writeFileSync(join(root, "test/shout.test.mjs"),
    'import { test } from "node:test"; import assert from "node:assert/strict";\n' +
    'import { shout } from "../src/greet.mjs";\n' +
    'test("greet.shouts-the-greeting", () => assert.equal(shout("Ann"), "HELLO, ANN"));\n');

const tick = (root, n) => {
  const p = join(root, `openspec/changes/${CHANGE}/tasks.md`);
  writeFileSync(p, readFileSync(p, "utf8").replace(`- [ ] ${n}`, `- [x] ${n}`));
};

test("happy path: red, build, green, ship", () => {
  const root = project();
  assert.equal(sdlc(root, "init").code, 0);
  assert.equal(JSON.parse(readFileSync(join(root, ".sdlc/config.json"), "utf8")).testCommand, "npm test");

  assert.equal(sdlc(root, "start", "tests", CHANGE).code, 0);

  // Before any test is written the red check fails.
  assert.notEqual(sdlc(root, "red", CHANGE).code, 0);

  // The hook blocks source edits during the tests stage, with exit code 2.
  const h = hook(root, "Write", { file_path: join(root, "src/greet.mjs"), content: "x" });
  assert.equal(h.code, 2);
  assert.match(h.err, /SDLC guard/);

  writeTests(root);
  tick(root, "1.1");
  const red = sdlc(root, "red", CHANGE);
  assert.equal(red.code, 0, red.out);

  // Build can't start without the red check; here it has passed.
  assert.equal(sdlc(root, "start", "build", CHANGE).code, 0);
  assert.equal(hook(root, "Edit", { file_path: join(root, "test/shout.test.mjs") }).code, 2);
  assert.equal(hook(root, "Edit", { file_path: join(root, "src/greet.mjs") }).code, 0);

  writeFileSync(join(root, "src/greet.mjs"),
    'export const greet = (n) => `Hello, ${n}`;\nexport const shout = (n) => greet(n).toUpperCase();\n');
  tick(root, "2.1");
  const green = sdlc(root, "green", CHANGE);
  assert.equal(green.code, 0, green.out);

  assert.equal(sdlc(root, "start", "verify", CHANGE).code, 0);
  assert.equal(sdlc(root, "start", "ship", CHANGE).code, 0);
  assert.equal(sdlc(root, "end").code, 0);
  assert.equal(hook(root, "Write", { file_path: join(root, "src/greet.mjs") }).code, 0);
});

test("red check fails when source changes during the tests stage", () => {
  const root = project();
  sdlc(root, "init");
  sdlc(root, "start", "tests", CHANGE);
  writeTests(root);
  writeFileSync(join(root, "src/greet.mjs"), "export const shout = () => 'HELLO, ANN';\n");
  const r = sdlc(root, "red", CHANGE);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /Source changed/);
});

test("red check rejects a suite that fails for reasons unrelated to the new tests", () => {
  const root = project();
  sdlc(root, "init", "--test-cmd", "node -e \"process.exit(1)\"");
  sdlc(root, "start", "tests", CHANGE);
  writeTests(root);
  const r = sdlc(root, "red", CHANGE);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /names none of the new tests/);
});

test("build can't start before the red check passes", () => {
  const root = project();
  sdlc(root, "init");
  sdlc(root, "start", "tests", CHANGE);
  const r = sdlc(root, "start", "build", CHANGE);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /red check/i);
});

test("green check catches an edited frozen test and unfinished tasks", () => {
  const root = project();
  sdlc(root, "init");
  sdlc(root, "start", "tests", CHANGE);
  writeTests(root);
  tick(root, "1.1");
  assert.equal(sdlc(root, "red", CHANGE).code, 0);
  sdlc(root, "start", "build", CHANGE);
  // Cheat: weaken the test instead of implementing.
  writeFileSync(join(root, "test/shout.test.mjs"), 'import { test } from "node:test";\ntest("greet.shouts-the-greeting", () => {});\n');
  const r = sdlc(root, "green", CHANGE);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /Frozen tests changed/);
  assert.match(r.out, /Unfinished tasks/);
  assert.notEqual(sdlc(root, "start", "ship", CHANGE).code, 0);
});

test("green check catches edits to approved spec artifacts", () => {
  const root = project();
  sdlc(root, "init");
  sdlc(root, "start", "tests", CHANGE);
  writeTests(root);
  tick(root, "1.1");
  sdlc(root, "red", CHANGE);
  sdlc(root, "start", "build", CHANGE);
  writeFileSync(join(root, "src/greet.mjs"), 'export const greet = (n) => `Hello, ${n}`;\nexport const shout = (n) => greet(n).toUpperCase();\n');
  tick(root, "2.1");
  writeFileSync(join(root, `openspec/changes/${CHANGE}/test-plan.md`), "# rewritten\n");
  const r = sdlc(root, "green", CHANGE);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /Approved spec artifacts changed/);
});

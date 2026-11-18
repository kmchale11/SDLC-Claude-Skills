#!/usr/bin/env node
// Stage manager for the sdlc plugin. The skills call this; people rarely need to.
//
//   sdlc.mjs init [--src a,b] [--tests a,b] [--test-cmd "..."] [--typecheck-cmd "..."]
//   sdlc.mjs start <propose|tests|build|verify|ship> <change> [--force]
//   sdlc.mjs red <change>      failing tests written, nothing else touched
//   sdlc.mjs green <change>    tests untouched, all tasks done, suite green
//   sdlc.mjs status
//   sdlc.mjs end               leave the current stage (guards switch off)
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkChange, readPlan } from "./check-test-plan.mjs";
import {
  CHANGE_NAME, DEFAULT_CONFIG, STAGES, diffSnapshot, isTestFile, loadConfig, loadState,
  projectDir, saveConfig, saveState, snapshot, statePath,
} from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, "..");

const VALUE_FLAGS = new Set(["--src", "--tests", "--test-cmd", "--typecheck-cmd"]);
const root = projectDir();
const [cmd, ...rest] = process.argv.slice(2);
const { flags, positional } = parseArgs(rest);

const commands = { init, start, red, green, status, end };
if (!commands[cmd]) {
  console.error("Usage: sdlc.mjs <init|start|red|green|status|end> ...");
  process.exit(2);
}
await commands[cmd]();

// ───────────────────────────────────────────────────────────────────────────

function init() {
  const existing = existsSync(join(root, ".sdlc", "config.json"));
  const config = existing ? loadConfig(root) : detectConfig();
  if (flags["--src"]) config.srcDirs = list(flags["--src"]);
  if (flags["--tests"]) config.testDirs = list(flags["--tests"]);
  if (flags["--test-cmd"]) config.testCommand = flags["--test-cmd"];
  if (flags["--typecheck-cmd"] !== undefined) config.typecheckCommand = flags["--typecheck-cmd"];
  saveConfig(root, config);

  // Local-only files stay out of git; config.json is shared.
  const gi = join(root, ".gitignore");
  const lines = [".sdlc/state.json", ".sdlc/reviews/"];
  const current = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  const missing = lines.filter((l) => !current.split("\n").includes(l));
  if (missing.length) appendFileSync(gi, (current && !current.endsWith("\n") ? "\n" : "") + missing.join("\n") + "\n");

  // Install the test-first schema and make it the project default.
  if (existsSync(join(root, "openspec"))) {
    cpSync(join(PLUGIN_ROOT, "schema", "spec-driven-tdd"), join(root, "openspec", "schemas", "spec-driven-tdd"), { recursive: true });
    const cfg = join(root, "openspec", "config.yaml");
    const text = existsSync(cfg) ? readFileSync(cfg, "utf8") : "";
    const next = /^schema:/m.test(text) ? text.replace(/^schema:.*$/m, "schema: spec-driven-tdd") : `schema: spec-driven-tdd\n${text}`;
    writeFileSync(cfg, next);
    console.log("Installed schema spec-driven-tdd and set it as the project default.");
  } else {
    console.log("No openspec/ folder yet: run `openspec init --tools claude`, then run this again.");
  }
  console.log(`Wrote .sdlc/config.json:\n${JSON.stringify(config, null, 2)}`);
}

function detectConfig() {
  const config = { ...DEFAULT_CONFIG };
  const has = (p) => existsSync(join(root, p));
  const src = ["src", "lib", "app", "pkg"].filter(has);
  const tests = ["test", "tests", "__tests__", "spec"].filter(has);
  if (src.length) config.srcDirs = src;
  if (tests.length) config.testDirs = tests;
  if (has("package.json")) {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    config.testCommand = "npm test";
    if (pkg.scripts?.typecheck) config.typecheckCommand = "npm run typecheck";
  } else if (has("pyproject.toml") || has("pytest.ini")) {
    config.testCommand = "pytest -q";
  } else if (has("go.mod")) {
    config.testCommand = "go test ./...";
    config.srcDirs = ["."];
    config.testDirs = ["."];
  }
  return config;
}

function start() {
  const [stage, change] = positional;
  if (!STAGES.includes(stage)) fail(`Stage must be one of: ${STAGES.join(", ")}`);
  if (!change || !CHANGE_NAME.test(change)) fail("Give the change name in kebab-case, e.g. add-max-length");

  const config = loadConfig(root);
  const prev = loadState(root);
  const same = prev?.change === change ? prev : {};
  const changeDir = join(root, "openspec", "changes", change);
  if (stage !== "propose" && !existsSync(changeDir)) fail(`openspec/changes/${change} does not exist`);

  const state = { ...same, change, stage };
  if (stage === "tests") {
    state.srcSnapshot = snapshot(root, config.srcDirs, (p) => !isTestFile(config, p));
    state.testSnapshot = snapshot(root, config.testDirs);
    delete state.redOk; delete state.greenOk; delete state.frozenTests;
  }
  if (stage === "build") {
    if (!same.redOk && !flags["--force"]) fail(`Run the red check first: the failing tests for ${change} have not been confirmed. (--force to skip)`);
    state.frozenTests = snapshot(root, config.testDirs, (p) => isTestFile(config, p));
    state.changeSnapshot = snapshot(root, [`openspec/changes/${change}`], (p) => !p.endsWith("/tasks.md"));
    delete state.greenOk;
  }
  if (stage === "ship" && !same.greenOk && !flags["--force"]) {
    fail(`Run the green check first: ${change} has not passed it. (--force to skip)`);
  }
  saveState(root, state);
  console.log(`Stage: ${stage} · change: ${change}`);
}

function red() {
  const { state, config, change } = requireStage("tests");
  const problems = [];

  const srcChanged = diffSnapshot(root, state.srcSnapshot || {}, config.srcDirs, { keep: (p) => !isTestFile(config, p) });
  if (srcChanged.length) problems.push(`Source changed during the test-first stage:\n    ${srcChanged.join("\n    ")}`);

  const testChanged = diffSnapshot(root, state.testSnapshot || {}, config.testDirs);
  if (testChanged.length === 0) problems.push("No test files were written or changed.");

  problems.push(...checkChange(root, change, { tests: true }));

  if (problems.length === 0) {
    const run = sh(config.testCommand);
    // A test that fails to import names only its file, so accept either.
    const rows = readPlan(root, change)?.rows || [];
    const markers = rows.flatMap((r) => [r.id, r.file]).filter(Boolean);
    if (run.ok) {
      problems.push("The test suite passes, so the new tests prove nothing yet. They must fail before implementation.");
    } else if (markers.length && !markers.some((m) => run.out.includes(m))) {
      // Guards against a "red" that is really a broken runner or a missing tool.
      problems.push(`The suite failed, but its output names none of the new tests or their files. Check that "${config.testCommand}" runs them:\n${tail(run.out, 15)}`);
    } else {
      console.log(`Suite fails as expected:\n${tail(run.out, 25)}`);
    }
  }

  if (problems.length) {
    saveState(root, { ...state, redOk: false });
    fail(`Red check failed for ${change}:\n  - ${problems.join("\n  - ")}`);
  }
  saveState(root, { ...state, redOk: true });
  console.log(`✓ Red check passed for ${change}: new tests fail and no source changed.`);
}

function green() {
  const { state, config, change } = requireStage("build", "verify", "ship");
  const problems = [];

  const testsChanged = diffSnapshot(root, state.frozenTests || {}, config.testDirs, {
    includeAdded: false, keep: (p) => isTestFile(config, p),
  });
  if (testsChanged.length) problems.push(`Frozen tests changed:\n    ${testsChanged.join("\n    ")}`);

  const artifacts = diffSnapshot(root, state.changeSnapshot || {}, [`openspec/changes/${change}`], {
    keep: (p) => !p.endsWith("/tasks.md"),
  });
  if (artifacts.length) problems.push(`Approved spec artifacts changed:\n    ${artifacts.join("\n    ")}`);

  const tasksPath = join(root, "openspec", "changes", change, "tasks.md");
  if (existsSync(tasksPath)) {
    const open = readFileSync(tasksPath, "utf8").split("\n").filter((l) => /^\s*- \[ \]/.test(l));
    if (open.length) problems.push(`Unfinished tasks:\n    ${open.map((l) => l.trim()).join("\n    ")}`);
  }

  problems.push(...checkChange(root, change, { tests: true }));

  const run = sh(config.testCommand);
  if (!run.ok) problems.push(`Test suite fails:\n${tail(run.out, 25)}`);
  if (config.typecheckCommand) {
    const tc = sh(config.typecheckCommand);
    if (!tc.ok) problems.push(`Typecheck fails:\n${tail(tc.out, 15)}`);
  }
  if (which("openspec")) {
    const v = sh(`openspec validate "${change}" --strict --no-interactive`);
    if (!v.ok) problems.push(`openspec validate fails:\n${tail(v.out, 15)}`);
  }

  if (problems.length) {
    saveState(root, { ...state, greenOk: false });
    fail(`Green check failed for ${change}:\n  - ${problems.join("\n  - ")}`);
  }
  saveState(root, { ...state, greenOk: true });
  console.log(`✓ Green check passed for ${change}: tests untouched, tasks done, suite green.`);
}

function status() {
  const state = loadState(root);
  const config = loadConfig(root);
  if (!state?.stage) console.log("No active stage. Guards are off (except: no merging, no force-push, no push to main).");
  else {
    console.log(`Change: ${state.change}\nStage: ${state.stage}`);
    if (state.redOk !== undefined) console.log(`Red check: ${state.redOk ? "passed" : "failed"}`);
    if (state.greenOk !== undefined) console.log(`Green check: ${state.greenOk ? "passed" : "failed"}`);
    if (state.frozenTests) console.log(`Frozen test files: ${Object.keys(state.frozenTests).length}`);
  }
  console.log(`Source: ${config.srcDirs.join(", ")} · Tests: ${config.testDirs.join(", ")} · Test command: ${config.testCommand}`);
}

function end() {
  if (existsSync(statePath(root))) rmSync(statePath(root));
  console.log("Left the current stage. Guards are off.");
}

// ───────────────────────────────────────────────────────────────────────────

function requireStage(...allowed) {
  const state = loadState(root);
  const change = positional[0] || state?.change;
  if (!state?.stage || state.change !== change) fail(`No active stage for ${change || "a change"}. Start one with the /sdlc skills.`);
  if (!allowed.includes(state.stage)) fail(`This check runs in the ${allowed.join("/")} stage; current stage is ${state.stage}.`);
  return { state, config: loadConfig(root), change };
}

function sh(command) {
  const r = spawnSync(command, { cwd: root, shell: true, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return { ok: r.status === 0, out: `${r.stdout || ""}${r.stderr || ""}` };
}

function which(bin) {
  return spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf8" }).status === 0;
}

function tail(text, n) {
  return text.trim().split("\n").slice(-n).map((l) => `      ${l}`).join("\n");
}

function list(v) {
  return String(v).split(",").map((s) => s.trim()).filter(Boolean);
}

function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) { positional.push(a); continue; }
    const eq = a.indexOf("=");
    if (eq > 0) flags[a.slice(0, eq)] = a.slice(eq + 1);
    else if (VALUE_FLAGS.has(a)) flags[a] = args[++i] ?? "";
    else flags[a] = true;
  }
  return { flags, positional };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

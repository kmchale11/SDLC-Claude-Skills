#!/usr/bin/env node
// Checks that a change's test-plan.md maps every spec scenario to a test ID,
// and (with --tests) that every test ID appears in a test file.
//
// Usage: node check-test-plan.mjs <change-name> [--tests]
//        node check-test-plan.mjs --all [--tests]
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isTestFile, loadConfig, projectDir, toRel, walk } from "./lib.mjs";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

export function listActiveChanges(root) {
  const dir = join(root, "openspec", "changes");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => d !== "archive" && statSync(join(dir, d)).isDirectory());
}

export function readScenarios(root, name) {
  const scenarios = [];
  for (const file of walk(join(root, "openspec", "changes", name, "specs"), (p) => p.endsWith(".md"))) {
    let section = "";
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const h2 = line.match(/^##\s+(\w+)/);
      if (h2) section = h2[1].toUpperCase();
      const s = line.match(/^####\s+Scenario:\s*(.+?)\s*$/);
      if (s && section !== "REMOVED" && section !== "RENAMED") {
        scenarios.push({ name: s[1], file: relative(root, file) });
      }
    }
  }
  return scenarios;
}

export function readPlan(root, name) {
  const planPath = join(root, "openspec", "changes", name, "test-plan.md");
  if (!existsSync(planPath)) return null;
  const plan = readFileSync(planPath, "utf8");
  const rows = [];
  let inTable = false;
  for (const line of plan.split("\n")) {
    if (/^##\s+Traceability/i.test(line)) { inTable = true; continue; }
    if (/^##\s/.test(line)) inTable = false;
    if (!inTable || !line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 4 || /^:?-+:?$/.test(cells[0]) || /^test id$/i.test(cells[0])) continue;
    rows.push({ id: cells[0].replace(/`/g, ""), scenario: cells[1], file: (cells[3] || "").replace(/`/g, "") });
  }
  const notAutomated = (plan.split(/^##\s+Not automated/im)[1] || "").split(/^##\s/m)[0];
  return { rows, notAutomated };
}

export function checkChange(root, name, { tests = false } = {}) {
  const dir = join(root, "openspec", "changes", name);
  if (!existsSync(dir)) return [`change folder openspec/changes/${name} not found`];
  const meta = join(dir, ".openspec.yaml");
  if (existsSync(meta) && /^\s*skip_specs:\s*true/m.test(readFileSync(meta, "utf8"))) return [];

  const scenarios = readScenarios(root, name);
  const plan = readPlan(root, name);
  if (!plan) return ["test-plan.md is missing"];

  const problems = [];
  if (scenarios.length === 0) problems.push("no scenarios found in the delta specs");

  const seen = new Set();
  for (const row of plan.rows) {
    if (!ID_PATTERN.test(row.id)) problems.push(`test ID "${row.id}" is not in capability.scenario-id form`);
    if (seen.has(row.id)) problems.push(`test ID "${row.id}" is used twice`);
    seen.add(row.id);
  }

  const norm = (s) => s.toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
  for (const sc of scenarios) {
    const n = norm(sc.name);
    const mapped = plan.rows.filter((r) => norm(r.scenario).includes(n));
    if (mapped.length === 0 && !norm(plan.notAutomated).includes(n)) {
      problems.push(`scenario "${sc.name}" (${sc.file}) has no row in test-plan.md`);
    }
    if (mapped.length > 1) problems.push(`scenario "${sc.name}" is mapped more than once`);
  }

  if (tests) {
    const config = loadConfig(root);
    const files = config.testDirs.flatMap((d) =>
      walk(join(root, d), (p) => isTestFile(config, toRel(root, p) || "")),
    );
    const source = files.map((f) => readFileSync(f, "utf8")).join("\n");
    for (const row of plan.rows) {
      if (row.id && !source.includes(row.id)) {
        problems.push(`no test file under ${config.testDirs.join(", ")} mentions "${row.id}"`);
      }
    }
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  const root = projectDir();
  const tests = args.includes("--tests");
  const names = args.includes("--all") ? listActiveChanges(root) : args.filter((a) => !a.startsWith("--"));
  if (names.length === 0) {
    if (args.includes("--all")) return console.log("No active changes to check.");
    console.error("Usage: check-test-plan.mjs <change-name> [--tests] | --all [--tests]");
    process.exit(2);
  }
  let failed = false;
  for (const name of names) {
    const problems = checkChange(root, name, { tests });
    if (problems.length) {
      failed = true;
      console.error(`✗ ${name}`);
      for (const p of problems) console.error(`  - ${p}`);
    } else {
      console.log(`✓ ${name}: every scenario maps to a test${tests ? " that exists" : ""}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

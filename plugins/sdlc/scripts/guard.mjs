#!/usr/bin/env node
// PreToolUse hook: enforces what each SDLC stage may change.
// Reads the hook payload on stdin. Exit 0 allows the call; exit 2 blocks it
// and the message on stderr goes back to Claude.
//
// The stage lives in .sdlc/state.json and is changed only by scripts/sdlc.mjs.
// With no active stage, the guard allows everything except the always-on rules
// (no merging PRs, no force-pushes, no pushing to main).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig, loadState, projectDir, toRel, within } from "./lib.mjs";

const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
// Commands that can rewrite a file named anywhere in them.
const WRITERS = /(\bsed\s+(-[a-zA-Z]*i|--in-place)|\bperl\s+-[a-zA-Z]*i|\btee\b|\brm\b|\bmv\b|\bcp\b|\btruncate\b|\bgit\s+(checkout|restore|rm|mv)\b|\bunlink\b)/;

/** True if the command could write to `path` (a file, or a dir ending in "/"). */
function writesTo(cmd, path) {
  const p = escape(path);
  if (new RegExp(`>>?\\s*['"]?(\\./)?${p}`).test(cmd)) return true; // redirect into it
  return WRITERS.test(cmd) && new RegExp(`(^|[\\s'"=])(\\./)?${p}`).test(cmd);
}

const NEXT = {
  propose: "Planning only. When the spec is reviewed, the user runs /sdlc:tests.",
  tests: "Only tests and the change's tasks.md may change while writing failing tests. The user runs /sdlc:build next.",
  build: "Tests written in the test-first stage and approved spec artifacts are frozen. If one is wrong, stop and tell the user; the fix goes through the spec.",
  verify: "The verify stage is read-only apart from the review file.",
  ship: "Code is frozen while shipping. Run /sdlc:build again to change it.",
};

/** Returns a reason string to block, or null to allow. */
export function decide({ root, config, state, tool, input }) {
  const stage = state?.stage;
  const change = state?.change;

  if (tool === "Bash") return decideBash({ config, state, command: String(input?.command || "") });
  if (!EDIT_TOOLS.has(tool)) return null;

  const rel = toRel(root, input?.file_path || input?.notebook_path);
  if (!rel) return null; // outside the project: not ours to police

  if (stage && (rel === ".sdlc/state.json" || rel === ".sdlc/config.json")) {
    return `${rel} is managed by the sdlc plugin. Use the /sdlc skills to change stage.`;
  }
  if (!stage) return null;

  const changeDir = `openspec/changes/${change}`;
  const tasks = `${changeDir}/tasks.md`;
  const inTests = config.testDirs.some((d) => within(rel, d));
  const inSrc = config.srcDirs.some((d) => within(rel, d));

  switch (stage) {
    case "propose":
      if (within(rel, "openspec")) return null;
      return `Stage "propose" for ${change}: only files under openspec/ may change, not ${rel}. ${NEXT.propose}`;

    case "tests":
      if (inTests || rel === tasks) return null;
      return `Stage "tests" for ${change}: ${rel} is not a test file. ${NEXT.tests}`;

    case "build":
      if (state.frozenTests && rel in state.frozenTests) {
        return `Stage "build" for ${change}: ${rel} holds tests from the test-first stage and is frozen. ${NEXT.build}`;
      }
      if (within(rel, "openspec/specs")) {
        return `Stage "build": openspec/specs/ changes only by archiving. ${NEXT.build}`;
      }
      if (within(rel, changeDir) && rel !== tasks) {
        return `Stage "build" for ${change}: ${rel} is an approved spec artifact; only tasks.md checkboxes may change. ${NEXT.build}`;
      }
      return null;

    case "verify":
      if (within(rel, ".sdlc/reviews")) return null;
      return `Stage "verify" for ${change}: ${rel} cannot change. ${NEXT.verify}`;

    case "ship":
      if (inSrc || inTests) return `Stage "ship" for ${change}: ${rel} cannot change. ${NEXT.ship}`;
      return null;

    default:
      return null;
  }
}

export function decideBash({ config, state, command }) {
  const cmd = command.replace(/\s+/g, " ");

  // Always on: a human merges, and history on main is never rewritten by an agent.
  if (/\bgh\s+pr\s+merge\b/.test(cmd)) return "Agents never merge pull requests. Ask the user to review and merge it.";
  if (/\bgit\s+push\b/.test(cmd) && /(\s--force\b|\s-f\b|\s--force-with-lease\b|\s\+\S)/.test(cmd)) {
    return "Force-pushing is blocked by the sdlc plugin.";
  }
  if (/\bgit\s+push\b[^;&|]*\s(\S*:)?(main|master)\b/.test(cmd)) {
    return "Pushing to main is blocked. Push a branch and open a pull request.";
  }

  const stage = state?.stage;
  if (!stage) return null;

  if (/\.sdlc\/(state|config)\.json/.test(cmd) && !/sdlc\.mjs/.test(cmd)) {
    return "The sdlc state is managed by the plugin's scripts. Use the /sdlc skills to change stage.";
  }

  if (stage === "build" && state.frozenTests) {
    const hit = Object.keys(state.frozenTests).find((p) => writesTo(cmd, p));
    if (hit) return `Stage "build": ${hit} is frozen. ${NEXT.build}`;
  }
  if (stage === "tests") {
    const hit = config.srcDirs.find((d) => writesTo(cmd, `${d.replace(/\/+$/, "")}/`));
    if (hit) return `Stage "tests": no changes under ${hit}/ until the build stage. ${NEXT.tests}`;
  }
  if (stage === "verify" && /\bgit\s+(commit|push|reset|checkout|restore|stash|rebase|merge)\b/.test(cmd)) {
    return `Stage "verify": git changes are blocked. ${NEXT.verify}`;
  }
  return null;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function main() {
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    process.exit(0); // never break the session on a malformed payload
  }
  const root = projectDir(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd());
  const reason = decide({
    root,
    config: loadConfig(root),
    state: loadState(root),
    tool: payload.tool_name,
    input: payload.tool_input || {},
  });
  if (reason) {
    process.stderr.write(`SDLC guard: ${reason}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

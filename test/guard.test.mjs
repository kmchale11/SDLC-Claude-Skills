import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "../plugins/sdlc/scripts/guard.mjs";
import { DEFAULT_CONFIG } from "../plugins/sdlc/scripts/lib.mjs";

const root = "/repo";
const config = { ...DEFAULT_CONFIG, srcDirs: ["src"], testDirs: ["test"] };
const write = (file_path) => ({ tool: "Write", input: { file_path } });
const bash = (command) => ({ tool: "Bash", input: { command } });
const run = (state, call) => decide({ root, config, state, ...call });
const blocked = (state, call) => assert.match(run(state, call) ?? "", /./, `expected block: ${JSON.stringify(call)}`);
const allowed = (state, call) => assert.equal(run(state, call), null, `expected allow: ${JSON.stringify(call)}`);

test("no active stage: edits are allowed", () => {
  allowed(null, write("/repo/src/a.ts"));
  allowed(null, write("/repo/.sdlc/config.json"));
});

test("always on: no merging, no force-push, no push to main", () => {
  blocked(null, bash("gh pr merge 12 --squash"));
  blocked(null, bash("git push --force origin change/x"));
  blocked(null, bash("git push -f"));
  blocked(null, bash("git push origin main"));
  blocked(null, bash("git push origin HEAD:main"));
  allowed(null, bash("git push -u origin change/maintain-cache"));
  allowed(null, bash("npm test"));
});

test("propose: only openspec/ may change", () => {
  const s = { stage: "propose", change: "add-x" };
  allowed(s, write("/repo/openspec/changes/add-x/proposal.md"));
  blocked(s, write("/repo/src/a.ts"));
  blocked(s, write("/repo/test/a.test.ts"));
});

test("tests: only tests and tasks.md may change", () => {
  const s = { stage: "tests", change: "add-x" };
  allowed(s, write("/repo/test/a.test.ts"));
  allowed(s, write("/repo/openspec/changes/add-x/tasks.md"));
  blocked(s, write("/repo/src/a.ts"));
  blocked(s, write("/repo/openspec/changes/add-x/specs/x/spec.md"));
  blocked(s, bash("echo 'export const x = 1' > src/a.ts"));
  blocked(s, bash("sed -i 's/a/b/' src/a.ts"));
  allowed(s, bash("npm test 2>&1 | grep src/"));
});

test("build: frozen tests and approved artifacts are locked", () => {
  const s = { stage: "build", change: "add-x", frozenTests: { "test/a.test.ts": "h" } };
  allowed(s, write("/repo/src/a.ts"));
  allowed(s, write("/repo/test/new-helper.test.ts"));
  allowed(s, write("/repo/openspec/changes/add-x/tasks.md"));
  blocked(s, write("/repo/test/a.test.ts"));
  blocked(s, { tool: "Edit", input: { file_path: "test/a.test.ts" } });
  blocked(s, write("/repo/openspec/changes/add-x/test-plan.md"));
  blocked(s, write("/repo/openspec/specs/slug/spec.md"));
  blocked(s, bash("sed -i 's/toBe/not.toBe/' test/a.test.ts"));
  blocked(s, bash("git checkout -- test/a.test.ts"));
  blocked(s, bash("cat x > ./test/a.test.ts"));
  allowed(s, bash("npx vitest run test/a.test.ts"));
});

test("verify: read-only except the review", () => {
  const s = { stage: "verify", change: "add-x" };
  allowed(s, write("/repo/.sdlc/reviews/add-x.md"));
  blocked(s, write("/repo/src/a.ts"));
  blocked(s, bash("git commit -am fix"));
  allowed(s, bash("git diff main...HEAD"));
});

test("ship: code is frozen", () => {
  const s = { stage: "ship", change: "add-x" };
  blocked(s, write("/repo/src/a.ts"));
  blocked(s, write("/repo/test/a.test.ts"));
  allowed(s, write("/repo/openspec/changes/add-x/proposal.md"));
});

test("state files cannot be edited while a stage is active", () => {
  const s = { stage: "build", change: "add-x" };
  blocked(s, write("/repo/.sdlc/state.json"));
  blocked(s, bash("echo '{}' > .sdlc/state.json"));
  allowed(s, bash('node "/plugins/sdlc/scripts/sdlc.mjs" status'));
});

test("files outside the project are not policed", () => {
  allowed({ stage: "propose", change: "add-x" }, write("/tmp/scratch.txt"));
});

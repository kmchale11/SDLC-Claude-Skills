---
name: init
description: Set up the agentic SDLC in the current project - OpenSpec, the test-first spec-driven-tdd schema, and the stage guards. Use when the user wants to start using the sdlc plugin in a repository.
disable-model-invocation: true
---

# Set up the agentic SDLC

Prepare this repository so changes can flow through
propose → tests → build → verify → ship → archive.

## Steps

1. **OpenSpec CLI.** Run `openspec --version`. If it is missing, tell the user
   it is needed and ask before installing it globally with
   `npm install -g @fission-ai/openspec@latest`.

2. **OpenSpec in the repo.** If there is no `openspec/` folder, run
   `openspec init --tools claude`. This also installs OpenSpec's own skills
   (`openspec-propose`, `openspec-apply-change`, `openspec-verify-change`, …),
   which the sdlc skills build on.

3. **sdlc config.** Run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/sdlc.mjs" init
   ```

   It detects source and test folders and the test command, writes
   `.sdlc/config.json`, installs the `spec-driven-tdd` schema into
   `openspec/schemas/`, makes it the project default, and git-ignores the
   local state files.

4. **Confirm with the user.** Show the detected `srcDirs`, `testDirs`,
   `testCommand` and `typecheckCommand`, and ask whether they are right. Fix
   any with, for example:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/sdlc.mjs" init --src src,lib --tests test --test-cmd "npm test" --typecheck-cmd "npm run typecheck"
   ```

5. **Project context (optional).** Offer to add a short `context:` block to
   `openspec/config.yaml` with constraints agents can't infer from the code
   (supported platforms, where tests live, naming rules).

6. **Finish** with one line: the repo is ready, and the next step is
   `/sdlc:propose <what you want to build>`.

---
name: build
description: Implement an approved OpenSpec change until its failing tests pass, without editing those tests or the approved spec. Run only after the tests stage has passed its red check.
argument-hint: <change-name>
disable-model-invocation: true
---

# Stage 3 · Build

Change: $ARGUMENTS

From here the tests written in the previous stage are frozen. The guard
blocks edits to them, to `openspec/specs/`, and to the change's artifacts
other than the `tasks.md` checkboxes.

## Steps

1. **Start the stage.** It refuses to start until the red check has passed.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/sdlc.mjs" start build <change>
   ```

2. **Implement** with the `openspec-apply-change` skill, starting at task
   group 2 (group 1 is done). For each task:
   - write only enough code to turn the test IDs it names green,
   - run the project's test command,
   - tick the checkbox.

   Don't add behavior no scenario asks for.

3. **If a frozen test looks wrong**, don't work around it. Stop and explain to
   the user which scenario it covers and why it seems wrong. The fix is a spec
   change: the user can revise the change and rerun `/sdlc:tests`.

4. **Run the green check** and fix what it reports:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/sdlc.mjs" green <change>
   ```

   It passes when the frozen tests are untouched, the approved artifacts are
   unchanged, every task is ticked, the suite and typecheck pass, and
   `openspec validate --strict` passes.

5. **Commit** if this is a git repo: `git commit -am "feat(<change>): implement approved spec"`,
   adding any new source files first.

6. **Report** what you built and any judgement calls, then stop. The next step
   is the user's: `/sdlc:verify <change>`.

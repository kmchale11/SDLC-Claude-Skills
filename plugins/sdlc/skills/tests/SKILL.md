---
name: tests
description: Write the failing tests for an approved OpenSpec change, one per scenario in its test plan, before any implementation exists. Run only after the user has reviewed the spec.
argument-hint: <change-name>
disable-model-invocation: true
---

# Stage 2 · Failing tests

Change: $ARGUMENTS

The user has approved the spec. Your job is to prove each scenario with a test
that fails now. The guard blocks changes to source folders during this stage.

## Steps

1. **Start the stage.** If no change name was given, use the only active one
   from `openspec list`, or ask.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/sdlc.mjs" start tests <change>
   ```

2. **Read** the change's `proposal.md`, delta specs, `design.md`,
   `test-plan.md` and `tasks.md`, and the project's existing tests to match
   their style, runner and layout.

3. **Write the tests** listed in `test-plan.md`, in the files it names:
   - Each test's name contains its test ID exactly as written in the plan.
   - Assert the scenario's THEN outcome, as observable behavior. Don't assert
     on internal helpers that the design merely suggests.
   - If the code under test doesn't exist yet, import it from where the design
     says it will live. Do not create it, not even a stub.
   - Do only task group 1. Leave every other task alone.

4. **Run the red check** and fix anything it reports, changing only tests:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/sdlc.mjs" red <change>
   ```

   It passes only when every scenario has a test, the suite fails, and no
   source file changed. A test must fail for the right reason: an assertion
   or a missing export, never a syntax error in the test itself.

5. **Tick** the group 1 checkboxes in `tasks.md`.

6. **Commit** if this is a git repo, adding only the test files you wrote and
   `tasks.md`:
   `git commit -m "test(<change>): failing tests from the test plan"`.

7. **Report** which tests fail and why, then stop. The next step is the
   user's: `/sdlc:build <change>`.

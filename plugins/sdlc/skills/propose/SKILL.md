---
name: propose
description: Turn an idea, bug or issue into an OpenSpec change - proposal, specs with WHEN/THEN scenarios, design, a test plan mapping every scenario to a test ID, and tasks. Planning only, no code. Use when the user wants to start a new feature or fix through the SDLC.
argument-hint: <what you want to build>
---

# Stage 1 · Propose

Request: $ARGUMENTS

You are planning, not building. The sdlc guard blocks every file change
outside `openspec/` during this stage.

## Steps

1. **Check setup.** If `.sdlc/config.json` or `openspec/` is missing, tell the
   user to run `/sdlc:init` first and stop.

2. **Understand the request.** Read the relevant existing specs
   (`openspec list --specs`, then `openspec show <id> --type spec`) and the
   code they describe. If anything that would change scope, observable
   behavior or acceptance criteria is unclear, ask the user now. Keep
   questions few and specific.

3. **Name the change** in kebab-case for the work (for example
   `add-max-length`), then start the stage:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/sdlc.mjs" start propose <name>
   ```

4. **Write the artifacts** with the `openspec-propose` skill, using that name.
   The project's `spec-driven-tdd` schema asks for five artifacts in order:
   proposal, specs, design, test-plan, tasks. If the OpenSpec skills aren't
   installed, run `openspec new change <name>` and then, for each artifact,
   follow `openspec instructions <artifact> --change <name>`.

5. **Check them:**

   ```bash
   openspec validate <name> --strict
   node "${CLAUDE_PLUGIN_ROOT}/scripts/check-test-plan.mjs" <name>
   ```

   Fix every error and warning.

6. **Hand over for review.** Summarise for the user:
   - the problem and what is in and out of scope, in two or three lines,
   - each scenario in one line,
   - anything you assumed.

   Then stop and say: review `openspec/changes/<name>/`, and when you're
   happy, run `/sdlc:tests <name>`. Do not start the next stage yourself.

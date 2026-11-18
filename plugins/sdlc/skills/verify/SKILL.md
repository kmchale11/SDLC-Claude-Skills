---
name: verify
description: Have an independent reviewer subagent, which never saw the build, check an implemented OpenSpec change against its approved spec and test plan and return PASS or FAIL.
argument-hint: <change-name>
disable-model-invocation: true
---

# Stage 4 · Verify

Change: $ARGUMENTS

The review must come from a reviewer that did not write the code, so you
delegate it rather than reviewing yourself.

## Steps

1. **Start the stage.** Writes are blocked except to `.sdlc/reviews/`.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/sdlc.mjs" start verify <change>
   ```

2. **Find the base** for the diff: `git merge-base HEAD origin/main`, falling
   back to `main`, then to the first commit of this change.

3. **Delegate** to the `sdlc:spec-verifier` subagent. Give it only the change
   name and the base ref. Don't pass your own summary of the work: the point
   is a fresh view.

4. **Read** `.sdlc/reviews/<change>.md` when it finishes and show the user the
   verdict and the findings.

5. **Next step:**
   - On **PASS**: the user runs `/sdlc:ship <change>`.
   - On **FAIL**: list what has to change. The user runs `/sdlc:build <change>`
     to fix it, or revises the spec if the review shows the spec is wrong.

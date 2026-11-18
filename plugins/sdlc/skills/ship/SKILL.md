---
name: ship
description: Push a verified OpenSpec change on its own branch and open a pull request for a human to review and merge. Run after the verify stage passes.
argument-hint: <change-name>
disable-model-invocation: true
---

# Stage 5 · Ship

Change: $ARGUMENTS

You open the pull request. A human merges it: the guard blocks `gh pr merge`,
force-pushes and pushes to `main`.

## Steps

1. **Start the stage.** It refuses to start until the green check has passed.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/sdlc.mjs" start ship <change>
   ```

2. **Branch.** If the current branch is `main` or `master`, create and switch
   to `change/<change>`; the commits come with you.

3. **Commit** anything left from the change that isn't committed yet. Don't
   commit `.sdlc/state.json` or `.sdlc/reviews/`.

4. **Push** with `git push -u origin <branch>`.

5. **Open the PR** with `gh pr create` if the GitHub CLI is available.
   - **Title:** `feat(<change>): <one-line summary>`
   - **Body:** what changed and why (from the proposal), each scenario as a
     checklist line, the verify verdict from `.sdlc/reviews/<change>.md`, and
     a note that the first commit holds the failing tests written before the
     code.

   Without `gh`, give the user the compare URL instead.

6. **Report** the PR link. After it is merged, the user runs
   `/sdlc:archive <change>`.

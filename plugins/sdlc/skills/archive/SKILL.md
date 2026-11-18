---
name: archive
description: After a change's pull request is merged, archive the OpenSpec change so its delta specs become the project's current specs, then end the SDLC run.
argument-hint: <change-name>
disable-model-invocation: true
---

# Stage 6 · Archive

Change: $ARGUMENTS

## Steps

1. **Check it merged.** With `gh`, run `gh pr view change/<change> --json state`
   and continue only if it says `MERGED`. Without `gh`, ask the user to
   confirm.

2. **Update main:** `git switch main && git pull --ff-only`.

3. **Archive and validate:**

   ```bash
   openspec archive <change> --yes
   openspec validate --all --strict
   ```

4. **Open a small PR** for the spec update, since pushing to `main` directly
   is blocked:
   - create branch `archive/<change>`,
   - commit `openspec/` with `chore(openspec): archive <change>`,
   - push it and open the PR with `gh pr create`.

5. **End the run:**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/sdlc.mjs" end
   ```

6. **Report** that the specs in `openspec/specs/` now include this change,
   with the PR link.

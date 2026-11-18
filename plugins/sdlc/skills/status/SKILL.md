---
name: status
description: Show where work stands in the agentic SDLC - the active change, its stage, whether the red and green checks passed, and the next command to run. Use when the user asks what stage they are at or what to do next.
---

# SDLC status

Run both and summarise in a few lines:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sdlc.mjs" status
openspec list
```

Then give the one next command, from this table:

| Current stage | Check state | Next |
|---|---|---|
| none | — | `/sdlc:propose <idea>` |
| propose | — | review the spec, then `/sdlc:tests <change>` |
| tests | red not passed | finish the tests, run the red check |
| tests | red passed | `/sdlc:build <change>` |
| build | green not passed | finish the build, run the green check |
| build | green passed | `/sdlc:verify <change>` |
| verify | — | read the review; PASS → `/sdlc:ship`, FAIL → `/sdlc:build` |
| ship | — | merge the PR, then `/sdlc:archive <change>` |

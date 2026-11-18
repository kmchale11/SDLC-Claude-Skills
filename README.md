# SDLC Claude Skills

A Claude Code plugin that runs spec-driven, test-first delivery as a set of
skills, with hooks that enforce each stage's rules.

You decide **what** to build and **whether it ships**. Claude writes the spec,
the failing tests, the code and the pull request, and an independent reviewer
checks the result against the spec.

```
/sdlc:propose → you review → /sdlc:tests → /sdlc:build → /sdlc:verify → /sdlc:ship → you merge → /sdlc:archive
   spec only      the spec     must fail     tests frozen   fresh reviewer   opens PR                    specs updated
```

Built on [OpenSpec](https://github.com/Fission-AI/OpenSpec). Pairs with
[Agentic-SDLC](https://github.com/kmchale11/Agentic-SDLC), which runs the same
pipeline in GitHub Actions.

## Install

In Claude Code:

```
/plugin marketplace add kmchale11/SDLC-Claude-Skills
/plugin install sdlc@sdlc-skills
```

Or from your shell:

```bash
claude plugin marketplace add kmchale11/SDLC-Claude-Skills
claude plugin install sdlc@sdlc-skills
```

You also need Node 20+ and the OpenSpec CLI (`npm install -g @fission-ai/openspec`).
Then, in your project, run `/sdlc:init`.

## The skills

| Skill | Stage | What happens | Who can start it |
|---|---|---|---|
| `/sdlc:init` | — | Sets up OpenSpec, the `spec-driven-tdd` schema and `.sdlc/config.json` | You |
| `/sdlc:propose <idea>` | propose | Writes proposal, specs, design, a test plan mapping each scenario to a test ID, and tasks. No code | You or Claude |
| `/sdlc:tests <change>` | tests | Writes a failing test per scenario, then runs the **red check** | You |
| `/sdlc:build <change>` | build | Implements until green, then runs the **green check** | You |
| `/sdlc:verify <change>` | verify | The `spec-verifier` subagent, which never saw the build, writes a PASS/FAIL review | You |
| `/sdlc:ship <change>` | ship | Pushes a branch and opens the PR | You |
| `/sdlc:archive <change>` | — | After merge, folds the change into `openspec/specs/` | You |
| `/sdlc:status` | — | Where things stand and the next command | You or Claude |

Every stage after propose is user-only, so Claude can't move work forward
without you.

## What's enforced

Three layers, from soft to hard:

**1. Skills** tell Claude what each stage is for.

**2. A PreToolUse hook** blocks file edits and shell commands that break the
current stage's rules, and tells Claude why:

| Stage | Claude can change | Blocked |
|---|---|---|
| propose | `openspec/` | everything else |
| tests | test folders, the change's `tasks.md` | source code, spec artifacts |
| build | source, new test files, `tasks.md` | the tests written in the tests stage, `openspec/specs/`, approved artifacts |
| verify | `.sdlc/reviews/` | everything else, and git changes |
| ship | git, `openspec/` | source and tests |
| any | — | `gh pr merge`, force-pushes, pushing to `main` |

**3. Checks the next stage depends on:**
- **Red check:**
  - every scenario has a test,
  - the suite fails, and the failure output names the new tests or their files (so a broken runner doesn't count as red),
  - no source file changed.

  `build` won't start until it passes.
- **Green check:**
  - frozen tests are byte-for-byte unchanged,
  - approved artifacts are unchanged,
  - all tasks are ticked,
  - suite, typecheck and `openspec validate --strict` pass.

  `ship` won't start until it passes.

### Limits

The hook catches direct edits and the common shell writers (`>`, `sed -i`,
`rm`, `git checkout`, …), but a determined agent could still get around a
pattern match. The checks compare file hashes, so they catch changes however
they were made. For a hard guarantee on shared branches, run the same gates
in CI. That is what [Agentic-SDLC](https://github.com/kmchale11/Agentic-SDLC)
is for.

## Configuration

`.sdlc/config.json`, written by `/sdlc:init` and committed:

```json
{
  "srcDirs": ["src"],
  "testDirs": ["test"],
  "testCommand": "npm test",
  "typecheckCommand": "npm run typecheck",
  "testFilePattern": "\\.(test|spec)\\.[cm]?[jt]sx?$|_test\\.(py|go)$|^test_.*\\.py$"
}
```

`.sdlc/state.json` (the current stage) and `.sdlc/reviews/` are local and git-ignored.

## Repository layout

```
.claude-plugin/marketplace.json     marketplace "sdlc-skills"
plugins/sdlc/
  .claude-plugin/plugin.json
  skills/<stage>/SKILL.md           one skill per stage
  agents/spec-verifier.md           independent reviewer subagent
  hooks/hooks.json                  PreToolUse guard
  scripts/sdlc.mjs                  stage state, red and green checks
  scripts/guard.mjs                 the hook
  scripts/check-test-plan.mjs       scenario → test traceability
  schema/spec-driven-tdd/           OpenSpec schema with the test-plan artifact
test/                               guard unit tests and an end-to-end flow
```

## Development

```bash
npm test          # guard rules and a full propose→ship flow in a temp project
npm run validate  # claude plugin validate, for the plugin and the marketplace
claude --plugin-dir ./plugins/sdlc   # try local edits without installing
```

# openspec-forge

A **Forge-flavored, governed AI-SDLC** add-on for [OpenSpec](https://github.com/Fission-AI/OpenSpec):
richer artifacts (BRD/PRD/UI-UX/RTM/work-orders), a compliance + quality **gate** (UU PDP, ISO 27001,
SonarQube), and Confluence / JIRA / GitHub integration — layered on top of `openspec init` with
**no changes to OpenSpec's core** (it's a custom schema + companion scripts).

## Install

Run from your project root, **after** `openspec init`:

```bash
# bash / zsh
curl -fsSL https://raw.githubusercontent.com/c0d3beat/openspec-forge/main/install.sh | bash

# PowerShell
irm https://raw.githubusercontent.com/c0d3beat/openspec-forge/main/install.ps1 | iex

# or via npx, straight from GitHub (no npm publish involved)
npx github:c0d3beat/openspec-forge

# or inspect first, then run
git clone --depth 1 https://github.com/c0d3beat/openspec-forge
node openspec-forge/install.mjs --dir .
```

Requires **Node ≥18** and that you've already run `openspec init` in the project.
Pin a version with `FORGE_REF=v1.0.0` (bash) or `$env:FORGE_REF='v1.0.0'` (PowerShell).

## What the installer does

- Copies `openspec/forge/` + `openspec/schemas/forge-workorder/` + `openspec/schemas/forge-epic/` into your project.
- **Safely seeds** `openspec/config.yaml` and `.env` (only if absent) and appends kit lines to `.gitignore` (idempotent).
- Records the version in `openspec/forge/.forge-version` and runs `forge doctor`.

Re-run any time to **update**:

```bash
node openspec/forge/../../openspec-forge/install.mjs --update   # or re-run the one-liner
```

`--update` replaces the kit **code** (scripts, `lib/`, schema templates) but **preserves your config**
(`connections.yaml`, `controls/*`, the design-system rubric, `.env`, `config.yaml`). `--force` overwrites everything.

## After installing

- Edit `openspec/forge/connections.yaml` (JIRA/Confluence/GitHub/SonarQube) and fill `.env`.
- Read the **[end-to-end tutorial](openspec/forge/TUTORIAL.md)**, then **`openspec/forge/README.md`** (command reference) and **`openspec/forge/DESIGN.md`** (the full design).
- `alias forge='node openspec/forge/forge.mjs'`, then `forge doctor`.

## Workflows

Two tools work together: **OpenSpec's `/opsx:*`** slash commands (run in Claude Code) author the artifacts,
and **`forge`** (companion scripts) does the integrations + the gate. They're wired via
`openspec/config.yaml`'s apply-guidance, so during `/opsx:apply` the agent automatically runs `forge gate`
before building and `forge pr` after.

> Shorthand: `alias forge='node openspec/forge/forge.mjs'`

### The `forge` command surface

| Command | What it does |
|---|---|
| `forge doctor [--check-connectivity]` | Readiness preflight — per-integration config/token/CLI |
| `forge gate --change <id>` | Run the advisory gate (the 8 checks below) |
| `forge scan --workorder <id> [--pr <n>]` | SonarQube CE scan → `.forge/sonar.json` |
| `forge sync confluence <publish\|check\|read-comments> --workorder <id>` | Publish docs for review, read the `approved` label, pull reviewer comments |
| `forge sync jira <story\|epic\|transition> [--workorder\|--epic <id>] [--to <status>]` | JIRA tracking (Story/Epic + status) |
| `forge preview <recommend\|mockup\|shot> --epic <id>` | Recommend a design system from PRD/BRD + scaffold a single-page app mockup + render one screenshot |
| `forge rtm` | (Re)generate the Requirements Traceability Matrix (`openspec/forge/rtm.md`) |
| `forge pr --workorder <id> [--scan]` | gate → branch → commit → push → open PR (Sonar summary in the body) |

All integration commands support `--dry-run` and offline `--result-file <mock.json>`; flip to real REST/git calls by filling `.env` and dropping those flags (`forge doctor` shows what's ready).

### Two tiers: Epic → Work Orders

A **feature = an Epic** (planning docs) that decomposes into **Work Orders = user stories**, each its own OpenSpec
change built one at a time on its own branch/PR.

### 1. Plan a feature (the Epic)

```bash
openspec new change my-feature --schema forge-epic
# in Claude Code:  /opsx:propose my-feature
#   → authors brd → prd → ux-design → capabilities → compliance → work-orders
forge preview recommend --epic my-feature            # design system from the PRD/BRD (rationale + runner-up)
forge preview mockup    --epic my-feature            # single-page app-shell mockup in the chosen system
forge preview shot      --epic my-feature            # render ONE screenshot (auto-embedded in Confluence on publish)
forge sync confluence publish --workorder my-feature # publish docs; reviewers approve in Confluence
forge sync jira epic --epic my-feature               # create the JIRA Epic
```

### 2. Build a work order (one at a time)

```bash
openspec new change wo-101-login --schema forge-workorder
# in Claude Code:  /opsx:propose wo-101-login
#   → authors story + specs (tag controls e.g. "(control: PDP-CONSENT)") + tasks
forge sync confluence publish --workorder wo-101-login          # get it approved in Confluence
forge sync jira story --workorder wo-101-login --epic PROJ-1    # JIRA Story; key written back into story.md

# in Claude Code:  /opsx:apply wo-101-login
#   apply-guidance makes the agent: run `forge gate` → build ONLY this work order on branch forge/<KEY>
#   → `forge scan` (SonarQube) → `forge pr` (opens the PR)

forge rtm                                                       # refresh the traceability matrix
#   → review + merge the PR on GitHub (a human decision on Free)
openspec archive wo-101-login                                   # fold specs into openspec/specs/, JIRA → Done
```

Repeat step 2 per work order.

### The gate (advisory on GitHub Free; a human still clicks merge)

`forge gate --change <id>` runs 8 checks — a work order goes green only when all pass:

```
change-exists · artifacts-present · openspec-validate · rtm-present
sonar-quality-gate · confluence-approval (strict re-approval) · jira-sync · compliance-controls (UU PDP + ISO 27001)
```

Governance is **front-loaded** (docs approved in Confluence before build) and **advisory** at the PR (results posted for review). For a hard, merge-blocking gate, add GitHub Pro's required status checks later — the schema/scripts don't change.

**New here? Walk the full example in [`openspec/forge/TUTORIAL.md`](openspec/forge/TUTORIAL.md)** — idea → shipped, governed feature, end to end. For the design rationale and lifecycle diagram, see `openspec/forge/DESIGN.md` (§13 lifecycle, §19 roadmap).

## Security note

The one-liners pipe a remote script to your shell. If that's a concern, use the **clone-and-run** path above
(inspect `install.mjs` first), and pin `FORGE_REF` to a tagged release.

## License

MIT

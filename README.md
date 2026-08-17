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
- Read **`openspec/forge/README.md`** (day-to-day usage) and **`openspec/forge/DESIGN.md`** (the full design).
- `alias forge='node openspec/forge/forge.mjs'`, then `forge doctor`.

## Security note

The one-liners pipe a remote script to your shell. If that's a concern, use the **clone-and-run** path above
(inspect `install.mjs` first), and pin `FORGE_REF` to a tagged release.

## License

MIT

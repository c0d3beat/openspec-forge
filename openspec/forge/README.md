# Forge companion kit

Adapts OpenSpec into a Forge-flavored, governed AI-SDLC **without changing OpenSpec's `src/`**.
The authoritative design is in [DESIGN.md](./DESIGN.md).

## Contents (Phases 1–8)

- `../schemas/forge-workorder/` — the work-order schema (one user story = one OpenSpec change), kept close
  to `spec-driven` so native `openspec validate` applies.
- `connections.yaml` — non-secret hosts/keys for Confluence/JIRA/GitHub/SonarQube (tokens go in `.env`).
- `config.sample.yaml` — sample target-project `openspec/config.yaml` (context + rules + `operations.apply.guidance`).
- `forge.mjs` — dispatcher: `forge gate | scan | pr`.
- `gate.mjs` — the advisory gate: artifacts present + `openspec validate` + RTM + SonarQube quality gate.
  Confluence approval / JIRA / compliance checks land in later phases.
- `scan-sonar.mjs` — SonarQube CE scan into an ephemeral per-PR project → `<change>/.forge/sonar.json`
  (`--result-file` for offline/CI ingest, `--dry-run`, `--cleanup`).
- `sync-github.mjs` — gate → branch → commit → push → PR (`gh`), PR body carries the Sonar summary.
- `sync-confluence.mjs` — publish story.md for review; read the `approved` label; `read-comments` feedback loop; strict re-approval via content hash.
- `sync-jira.mjs` — create/update JIRA Story/Epic (tracking only), write keys back into story.md, transition status.
- `build-rtm.mjs` — assemble `rtm.md` (requirement → WO → control → JIRA → Confluence → Sonar → branch).
- `../schemas/forge-epic/` — the epic (feature) tier: `brd → prd → ux-design → capabilities → compliance → work-orders`.
- `controls/` — compliance control catalogs: `uu-pdp.yaml`, `iso-27001.yaml` (extensible: gdpr, corp-policy).
- `preview.mjs` + `ui/design-system-rubric.mjs` — recommend a React design system from PRD/BRD + scaffold a Storybook.
- `doctor.mjs` — readiness preflight (`forge doctor`): per-integration config/token/CLI → LIVE-READY vs offline-only.
- `.env.example`, `gitignore.sample` — secrets template + gitignore lines.
- `lib/` — `connections.mjs`, `sonar.mjs`, `confluence.mjs`, `jira.mjs`, `controls.mjs` (per-domain readers).

> Add `.forge/` and `.scannerwork/` to your `.gitignore` — they are scan caches, not committed artifacts.

## Phase 1 quickstart

```bash
# 1. Scaffold a work order (its own change)
openspec new change wo-101-remember-me --schema forge-workorder

# 2. Author story.md, specs/<capability>/spec.md, tasks.md (the agent does this,
#    guided by `openspec instructions <artifact> --change wo-101-remember-me --json`)

# 3. Check state / run the gate
openspec status --change wo-101-remember-me
node openspec/forge/gate.mjs --change wo-101-remember-me
```

`gate.mjs` invokes the OpenSpec CLI via `OPENSPEC_BIN` (default `openspec`). For a source checkout:

```bash
OPENSPEC_BIN=/path/to/OpenSpec/bin/openspec.js node openspec/forge/gate.mjs --change wo-101-remember-me
```

## Roadmap

See DESIGN.md §19. **All 8 phases are built and verified offline.** The live API paths (GitHub/JIRA/Confluence/SonarQube)
are coded but exercised via `--result-file`/`--dry-run`; flip them on in a real environment (see below).

## Going live

1. Run `forge doctor --root <project>` (add `--check-connectivity`) — it reports what's configured vs missing per integration.
2. Copy `.env.example` → `.env` and fill tokens (`GITHUB_TOKEN`, `SONAR_TOKEN`, `JIRA_*`, `CONFLUENCE_*`); add the `gitignore.sample` lines to your `.gitignore`.
3. Install the CLIs `doctor` shows as absent (`gh`, `sonar-scanner`) and stand up the local SonarQube.
4. Drop the offline flags (`--result-file`, `--dry-run`) — the same code then performs real REST/git calls.
5. Optional: **GitHub Pro** makes the gate a *required* status check (hard merge-block); until then the merge stays a human decision.

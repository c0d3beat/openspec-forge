# Forge companion kit

Adapts OpenSpec into a Forge-flavored, governed AI-SDLC **without changing OpenSpec's `src/`**.
The authoritative design is in [DESIGN.md](./DESIGN.md).

## Contents (Phases 1–8)

- `../schemas/forge-workorder/` — the work-order schema (one user story = one OpenSpec change): artifacts
  `story · specs · test-cases · design · tasks`, kept close to `spec-driven` so native `openspec validate` applies.
  `test-cases` = QA (functional/UAT) cases derived from the scenarios; QA signs off in Confluence (gates propose completion).
- `connections.yaml` — non-secret hosts/keys for Confluence/JIRA/GitHub/SonarQube (tokens go in `.env`).
- `config.sample.yaml` — sample target-project `openspec/config.yaml` (context + rules + `operations.apply.guidance`).
- `forge.mjs` — dispatcher: `doctor · gate · scan · rtm · preview · start · pr · done · adopt · sync confluence · sync jira`
  (**the agent** runs these via apply-guidance; the user never invokes `forge` directly).
- `gate.mjs` — the advisory gate, **8 checks**: change-exists · artifacts-present · openspec-validate · rtm-present ·
  sonar-quality-gate · confluence-approval (strict re-approval) · jira-sync · compliance-controls (UU PDP + ISO 27001).
- `scan-sonar.mjs` — SonarQube CE scan into an ephemeral per-PR project → `<change>/.forge/sonar.json`
  (`--result-file` for offline/CI ingest, `--dry-run`, `--cleanup`).
- `sync-github.mjs` — `start`: fetch origin + create/align `forge/<KEY>` from the latest remote (remote = source of truth) before building.
  `pr`: gate → branch → commit → push → PR (`gh`), PR body carries the Sonar summary, moves JIRA → In Review.
  `done`: verify the PR is **merged** (via `gh pr view` / REST pulls API) → transition JIRA → Done (refuses if not merged; `--result-file`/`--assume-merged` for offline).
- `adopt.mjs` — **handoff reconnect**: after a fresh clone, rebuild the gitignored `.forge/` (Confluence page IDs + approval, JIRA link/status) from the systems of record — Confluence pages found **by title** (no duplicates), JIRA Story by the key in story.md (or Epic by summary). `--result-file` for offline, `--dry-run` to preview.
- `sync-confluence.mjs` — publish **any doc** (brd/prd/ux-design/…/story) as its **own** Confluence page (publish state keyed per-document under `.forge/confluence.json`), embed the UX mockup screenshot, read the `approved` label, `read-comments` feedback loop, strict re-approval via content hash.
- `sync-jira.mjs` — create/update JIRA Story/Epic (tracking only), write keys back into story.md, transition status
  (**To Do → In Progress → In Review → Done**; In Progress at apply start, In Review set by `forge pr`, Done via `forge done` after it verifies the PR is merged);
  `qa` action files a JIRA issue per **failing** QA test case (`--list` to read them) — a workflow separate from the build Story.
- `build-rtm.mjs` — assemble `rtm.md` (requirement → WO → control → JIRA → Confluence → Sonar → branch).
- `../schemas/forge-epic/` — the epic (feature) tier: `brd → prd → ux-design → capabilities → compliance → work-orders`.
- `controls/` — compliance control catalogs: `uu-pdp.yaml`, `iso-27001.yaml` (extensible: gdpr, corp-policy).
- `preview.mjs` + `ui/design-system-rubric.mjs` — recommend a React design system from PRD/BRD, scaffold a **single-page app-shell mockup**, and render one screenshot.
- `doctor.mjs` — readiness preflight (`forge doctor`): per-integration config/token/CLI → LIVE-READY vs offline-only.
- `.env.example`, `gitignore.sample` — secrets template + gitignore lines.
- `lib/` — `connections.mjs`, `sonar.mjs`, `confluence.mjs`, `jira.mjs`, `controls.mjs` (per-domain readers).
- `hooks/pre-commit.mjs` — enforcement backstop: on a `forge/<key>` branch it runs the gate and **blocks the commit** until it passes (the installer wires it into `.git/hooks/pre-commit`; skip with `--no-hook`, bypass a single commit with `git commit --no-verify`).

> Add `.forge/` and `.scannerwork/` to your `.gitignore` — they are scan caches, not committed artifacts.

## Phase 1 quickstart

> In normal use the **agent** runs `forge` for you (wired through `openspec/config.yaml` apply-guidance) — you only type `/opsx:propose` and `/opsx:apply`. The raw invocations below are for kit development/debugging.

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
5. The installer's git **`pre-commit` hook** already blocks commits on `forge/*` branches until the gate passes (a real local block, bypassable with `--no-verify`).
6. Optional: **GitHub Pro** makes the gate a *required* status check (server-side hard merge-block); until then the merge stays a human decision.

## Handoff (a developer leaves, another continues)

Almost everything travels in git — artifacts, living specs, the RTM, and the JIRA key committed in each
`story.md` — and the durable truth lives in Confluence / JIRA / GitHub. Only the gitignored `.forge/` cache
(page IDs, approval, JIRA status, Sonar) is machine-local, and it's **reconstructable**.

The new developer only: clones the repo, gets JIRA/Confluence/GitHub access, and fills `.env`. Then **tell the
agent it's a handoff** ("I'm taking over `<id>`" / "I just cloned this"), or simply run `/opsx:apply <id>` — the
agent reconnects on its own (it never asks you to run forge). Guided by `config.yaml`, it runs `forge doctor`,
`forge adopt` (rebuild `.forge/` from the systems of record — reconnecting to the **existing** Confluence pages
**by title**, no duplicates), `forge rtm`, and `forge start` (check out the branch from the latest remote), then continues.
The apply-guidance also **auto-detects** a fresh clone (missing `.forge/` + a committed JIRA key) and adopts before the gate.

Uncommitted work that was never pushed can't be recovered — the departing dev should run `forge pr` (or push) before leaving.

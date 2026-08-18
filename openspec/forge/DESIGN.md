# Forge-Flavored OpenSpec — Design Document

| | |
|---|---|
| **Status** | **Built + verified offline** — no edits to OpenSpec `src/` |
| **Date** | 2026-08-17 (rev. 2026-08-18) |
| **Constraint** | **No edits to OpenSpec's `src/`.** Everything is a custom schema + companion assets + config. |
| **Target** | A governed, intent-aware AI-SDLC on top of OpenSpec, inspired by Opsera Forge — Tiers 1 (rich artifacts + traceability) and 2 (governance), on GitHub **Free** + private, fully local. |
| **Decisions** | All 10 open decisions resolved 2026-08-17 (see §17). Coding agent: **Claude Code**. Compliance: **UU PDP + ISO 27001**. |
| **Progress** | **All 8 phases built + verified (offline).** P1 schema+gate · P2 GitHub PR · P3 SonarQube CE · P4 Confluence · P5 JIRA+Epic tier+RTM · P6 compliance catalogs+gate · P7 UI/UX recommendation + single-page mockup + screenshot · P8 readiness (`forge doctor`, `.env.example`, gitignore, going-live). All 8 gate checks live. **Since built (rev. 2026-08-18):** Confluence publishes **one page per document** (state keyed per-doc); the **agent auto-drives every `forge` command** (the user types only `/opsx:propose` + `/opsx:apply`, no `forge` alias); approval is a **hard gate** — apply-guidance runs `sync confluence check` → `gate` and the agent writes no code until it passes, backed by a git **`pre-commit` hook**. The live API round-trips are coded but exercised offline via `--result-file`/`--dry-run` — flip on in a real environment with tokens (README "Going live"). OpenSpec `src/` untouched throughout. |

---

## 1. Summary

This document specifies how to make OpenSpec behave like **Opsera Forge** — an intent- and context-aware "software factory" that takes an idea through governed, spec-driven development to reviewed code — **without modifying OpenSpec's source code**. OpenSpec remains the orchestration/tracking/approval backbone; the AI coding agent is the executor; and Confluence, JIRA, GitHub, and a local SonarQube are integrated **via their REST APIs** through companion scripts.

The core realization from the feasibility study: OpenSpec is a filesystem-native CLI that *structures* an agent's work and *never calls an LLM itself*. So Forge's developer-facing behavior can be reproduced by (a) a **custom schema** that defines the richer artifact set and its dependency graph, (b) **companion Node scripts** that talk to the external systems and act as the compliance/quality **gate**, and (c) **config** that injects persistent context, policy, and rules into every artifact.

## 2. Goals & Non-Goals

**Goals**
- Reproduce Forge's developer workflow: intent → BRD/PRD → UI/UX (with design-system choice + preview) → specs → work orders (user stories with personas) → per-story build → reviewed code.
- Governance: documents reviewed & approved before build; regulatory/corporate compliance (e.g., **UU PDP**) enforced as controls; traceability from requirement → control → code.
- Integrations via API (not MCP): **Confluence** (spec/template review & approval), **JIRA** (tracking only), **GitHub** (code review via branch + PR), **SonarQube Community Edition** (SAST/quality, self-hosted).
- Work orders built **one at a time on user instruction**, each on its own branch/PR.
- **Zero changes to OpenSpec `src/`.**

**Non-Goals**
- No hosted SaaS control plane / web app / system-of-record (that would be a platform, not a fork).
- No reverse-engineering of legacy code into specs, and no static-analysis "ForgeScore" engine in the CLI (both would require the CLI to call models / analyze source, breaking OpenSpec's design).
- No MCP server (explicitly chosen: direct REST APIs instead).
- No Day-2 production monitoring.
- No hard, tamper-proof merge enforcement on the current tier (see §14 — Free tier is advisory; a documented upgrade path exists).

## 3. Background

- **Opsera Forge** (launched Apr 2026): a governed AI-SDLC that captures intent as a living, machine-readable spec, enforces context and policy on every agentic action via **auditable Work Orders**, produces PRD/BRD/architecture/RTM/work-orders, scores health (ForgeScore), and orchestrates coding assistants (Cursor/Copilot/Claude) — as a hosted platform.
- **OpenSpec** (`@fission-ai/openspec`): an open-source CLI for spec-driven development. A change is a folder of Markdown artifacts (`proposal → specs → design → tasks`) defined by an external **schema** (an artifact DAG). The CLI answers `--json` queries (`status`, `instructions`, …) that AI-tool "skills" consume; the agent writes the files. Specs are plain Markdown with **delta** requirements (`## ADDED/MODIFIED/REMOVED/RENAMED`) that merge into `openspec/specs/` on archive.
- **Prior study**: see the memory note `forge-flavored-openspec` and the OpenSpec architecture study conducted 2026-08-17.

## 4. Design Principles & Constraints

1. **OpenSpec core is read-only.** Only add: custom schemas (`openspec/schemas/`), companion assets (`openspec/forge/`), and project config (`openspec/config.yaml`). This keeps OpenSpec upgradable.
2. **CLI structures, agent executes, scripts integrate.** OpenSpec provides state/instructions; the agent authors artifacts and drives git/APIs per instructions; companion scripts centralize API calls and the gate.
3. **Local & agent-driven. No GitHub Actions.** Everything runs on the developer's machine (the local SonarQube can't be reached by GitHub-hosted runners anyway). Single-developer model: the **remote git is the source of truth** — the agent runs `forge start` at each build to fetch origin and align the work-order branch to the latest remote before writing code.
4. **Integrate via REST APIs, not MCP.**
5. **Three enforcement strengths:** *advisory* (schema/config injected into the agent) < *verified* (`openspec validate`) < *hard-gated* (external gate). On GitHub Free + private, the merge cannot be hard-blocked, so enforcement is **front-loaded** (approve before build) + **advisory** at the PR.
6. **One source of truth per concern** (see §5).

## 5. Source-of-Truth Model

| Concern | Owner | Notes |
|---|---|---|
| Document/artifact content | **Git repo** (OpenSpec artifacts) | Versioned, agent-authored, what the build consumes |
| Approval / review status | **Confluence** (docs) & **human PR review** (code) | Where humans sign off |
| Work tracking / progress | **JIRA** (Stories/Epics) | Tracking only, not review |
| Code & code review | **GitHub** (branch + PR) | Free tier = remote + review UI |
| Security/quality findings | **SonarQube CE** (local) | Surfaced into the PR by a script |
| Traceability + enforcement | **RTM + `gate.mjs`** | The referee that reads all of the above |

**Flow direction:** content flows repo → Confluence/JIRA (publish); status flows Confluence/JIRA/Sonar → gate (read-only). Prose docs (BRD/PRD/UX) may round-trip (edit in Confluence, snapshot back to repo on approval); structured artifacts (specs, work orders) stay repo-mastered and are published read-only for sign-off.

## 6. System Architecture

### 6.1 Layers
```
Authoring      custom schemas (forge-epic, forge-workorder) + templates + control catalogs
   │
Projection     OpenSpec generates the agent's skills/commands from those schemas (native)
   │
Runtime        agent runs the workflow locally → drives git + Confluence/JIRA/GitHub/Sonar
               via companion scripts; gate.mjs referees; OpenSpec tracks state
```

### 6.2 Repository additions (nothing under `src/`)
```
openspec/
  config.yaml                      # schema default, context (by-design), rules (policy), operations.*.guidance
  schemas/
    forge-epic/                    # feature/epic planning schema
      schema.yaml
      templates/{brd,prd,ux-design,compliance,work-orders,rtm}.md
    forge-workorder/               # per-work-order (story) schema — kept close to spec-driven
      schema.yaml
      templates/{story,spec,design,tasks}.md
  forge/
    DESIGN.md                      # this document
    connections.yaml               # non-secret hosts/keys (editable SonarQube host, JIRA/Confluence base URLs, GH repo)
    controls/
      uu-pdp.yaml                  # compliance control catalog (first regime)
      # gdpr.yaml, iso-27001.yaml, corp-policy.yaml (later)
    ui/
      design-system-rubric.mjs    # PRD/BRD → design-system recommendation rubric
    lib/                           # shared helpers (api clients, md↔ADF/storage converters, hashing)
    forge.mjs                      # companion CLI entrypoint — the agent runs it (doctor|gate|scan|rtm|preview|pr|sync …)
    sync-confluence.mjs            # one page per document (state keyed per-doc in <change>/.forge/confluence.json)
    sync-jira.mjs
    sync-github.mjs
    scan-sonar.mjs
    preview.mjs
    gate.mjs
    doctor.mjs                     # readiness preflight
    build-rtm.mjs
    hooks/pre-commit.mjs           # gate enforcement (installer wires it into .git/hooks/pre-commit)
.env                               # secrets (gitignored): SONAR_TOKEN, JIRA_TOKEN, CONFLUENCE_TOKEN, GITHUB_TOKEN
.git/hooks/pre-commit              # installed by the installer → blocks commits on forge/* until the gate passes (bypassable with --no-verify)
```

### 6.3 Component responsibilities
- **Schemas** define *what artifacts exist* and their dependency order; **templates** define each artifact's structure + `instruction` (the authoritative guidance the agent follows).
- **`config.yaml`** injects persistent `context` (tech stack, privacy-by-design) and per-artifact `rules` (policy) into every artifact — Forge's "Context Integrity."
- **Companion scripts** own all external API calls (idempotent upserts keyed by stored IDs) and the gate logic.
- **OpenSpec CLI** provides `status`/`instructions`/`validate`/`archive` and the generated skills — unchanged.

## 7. The Artifact Model

### 7.1 Two tiers: Epic and Work Order
- An **Epic** = a feature/"mission." It holds the shared planning docs and decomposes into work orders. Modeled as an OpenSpec change using the `forge-epic` schema. **It does not carry archivable spec deltas** (to avoid duplication) — specs live at the work-order level.
- A **Work Order** = a user story. Each is **its own OpenSpec change** (decision "A1") using the `forge-workorder` schema, built one at a time, on its own branch/PR, mapped to a JIRA Story.

Mapping: Epic ↔ JIRA **Epic**; Work Order ↔ JIRA **Story** ↔ GitHub branch/PR ↔ SonarQube ephemeral project.

### 7.2 `forge-epic` schema (DAG)
```
brd ──► prd ──► ux-design ──► work-orders ──► rtm
          │         ▲              ▲
          └──► specs(feature) ─────┘
                    │
              compliance(DPIA)
```
| Artifact | generates | requires | Purpose (template highlights) |
|---|---|---|---|
| `brd` | `brd.md` | — | Business context, objectives, stakeholders, success metrics, constraints |
| `prd` | `prd.md` | brd | Product requirements, scope, personas, journeys, non-functional needs |
| `ux-design` | `ux-design.md` (+ `ux-preview/`) | prd, brd | **Design-system recommendation** (§10) + component inventory + a11y; single-page app mockup |
| `specs` | `specs/**/*.md` | prd | Feature-level capability specs (decomposed into WO deltas later) |
| `compliance` | `compliance.md` | prd, specs | DPIA + control mapping (§11); **always present, with reviewer-approved "N/A – no personal data" path** |
| `work-orders` | `work-orders/*.md` | specs, ux-design, compliance | Breakdown into user stories (persona + acceptance criteria); one file per WO |
| `rtm` | `rtm.md` | work-orders | Traceability index: requirement → WO → control → JIRA key → PR |

Epic `apply` phase = **not code**: "publish approved docs to Confluence, create JIRA Epic + Stories, scaffold work-order changes." Guidance-driven; no spec archive.

> **As built (Phase 5):** the epic uses a prose **`capabilities`** artifact instead of `specs/**` — so it carries no archivable deltas (those live in the work-order changes; an epic's `.openspec.yaml` sets `skip_specs: true`) — and the **RTM is generated tooling** (`forge rtm` → `openspec/forge/rtm.md`), not an authored artifact. Final epic artifacts: `brd → prd → ux-design → capabilities → compliance → work-orders`.

### 7.3 `forge-workorder` schema (DAG)
```
story ──► specs ──► test-cases ──► design ──► tasks ──► [apply/build]
             └───────────────────────┘  (design optional)
```
| Artifact | generates | requires | Purpose |
|---|---|---|---|
| `story` | `story.md` | — | User story ("As a **[persona]**, I want … so that …") + acceptance criteria + links to Epic + JIRA key |
| `specs` | `specs/**/*.md` | story | The delta requirements/scenarios this WO implements (acceptance criteria as `#### Scenario:`) |
| `test-cases` | `test-cases.md` | specs | **QA (functional/UAT) cases** derived from the scenarios; QA signs off in Confluence (gates propose completion). Human QA — distinct from unit tests (SonarQube) |
| `design` | `design.md` | story | Optional technical design (conditional) |
| `tasks` | `tasks.md` | specs, design | Implementation checklist (checkbox-tracked) |
| apply | — (`tracks: tasks.md`) | tasks | Build **only this WO** → branch `forge/<KEY>` → PR → Sonar scan |

Kept intentionally close to OpenSpec's built-in `spec-driven` schema so **native `openspec validate`** (delta format, scenarios, task numbering) applies to work-order changes.

### 7.4 Why work-order = its own change (A1)
Makes "build one at a time," per-story branch/PR/scan, and JIRA Story mapping **native** rather than advisory. Trade-off to manage: two WOs editing the same capability's spec can conflict at sync/archive → sequence them, or run `openspec` sync between. Shared feature docs live at the Epic level (Confluence).

## 8. Configuration & Connections

**`openspec/config.yaml`** (OpenSpec-native, injected into artifacts):
- `schema: forge-epic` (default for new epics).
- `context:` tech stack (frontend/backend/database) + **privacy-by-design** and coding standards, plus a **FORGE AUTOMATION** block (the agent runs every `forge` command itself; the user never types `forge`), an **APPROVAL IS A HARD GATE** block (do not write code until `confluence-approval` is ✓), and a **DECISIONS-TO-CONFIRM** block: the agent **asks the user for the tech stack** (frontend/backend/database) if it isn't clearly stated, and **always asks the user to choose the design system** (with a ranked recommendation) in the UX phase — never assuming either.
- `rules:` per-artifact policy, e.g. `specs:` "any feature processing personal data MUST state lawful basis, consent, retention, and data-subject rights."
- `operations.apply.guidance:` "implement only the named work order; **first refresh the Confluence approval (`forge sync confluence check`), then run `forge gate` — and STOP, writing no code, unless it passes (especially `confluence-approval`)**; set the JIRA story to In Progress; then build, `forge scan`, `forge pr` (which sets In Review), and stop." `operations.archive.guidance:` after merge, transition the JIRA story to Done, then archive (fold specs into openspec/specs/).

**`openspec/forge/connections.yaml`** (committed, non-secret): hosts/keys only.
```yaml
confluence: { baseUrl: https://your.atlassian.net/wiki, space: FORGE }
jira:       { baseUrl: https://your.atlassian.net, project: FORGE }
github:     { repo: org/app, defaultBranchPrefix: forge/ }
sonarqube:  { host: http://localhost:9000, projectBase: app }   # editable local host
```
**Secrets** via `.env` / environment (never committed): `SONAR_TOKEN`, `JIRA_TOKEN`, `CONFLUENCE_TOKEN`, `GITHUB_TOKEN`. Every script reads `host + token` the same uniform way; pointing at a different local SonarQube = editing `sonarqube.host` (or `SONAR_HOST_URL` override).

## 9. Integrations

### 9.1 Confluence — spec/template review & approval
- `sync-confluence.mjs` publishes prose docs (BRD/PRD/UX) as pages (markdown → Confluence storage format), and embeds the **UI mockup screenshot** on the UX page. Structured artifacts (specs, work orders) are published read-only for sign-off. **Each document gets its own page** — publish state is a map keyed per-document (`<change>/.forge/confluence.json`), so an epic's BRD/PRD/UX/compliance/work-orders each become a distinct page/title, signed off independently (legacy single-doc state auto-migrates).
- **Approval signal:** a page **status/label `approved`** — `gate.mjs` reads that label.
- **Content authority stays in the repo (read-only publish).** Reviewers do not edit content in Confluence; they **comment and approve**. A **comment-feedback loop** closes the gap: `forge sync confluence --read-comments` pulls page comments so the agent folds reviewer feedback into the repo-mastered doc, then re-publishes. Under strict re-approval (§17), re-publishing a changed doc clears its `approved` label and it must be signed off again.

### 9.2 JIRA — tracking only
- `sync-jira.mjs` creates/updates the **Epic** and per-WO **Stories** (persona/story/acceptance in the description; markdown → ADF), and writes the returned **issue keys back** into the artifacts + RTM (the durable link). Idempotent upsert by key.
- JIRA status = *progress/tracking*, not the source of approval. Statuses: **To Do → In Progress → In Review → Done** — "To Do" on Story creation; "In Progress" when a work order's `/opsx:apply` starts (agent transitions before building); **"In Review" is set by `forge pr` after the branch is committed + pushed and the PR opened**; "Done" is set by **`forge done`, which first verifies the PR is actually merged** (gh/REST) — run at archive, after review + merge. Approval is NOT a JIRA status — it lives in Confluence (§9.1) and is read by the gate.
- **QA-defect workflow — separate from the build Story.** `forge sync jira qa --workorder <id>` files a JIRA issue (type `Bug`, label `qa` — both configurable in `connections.yaml`) per **failing** QA test case, linked to the Story; `--list` prints them so the agent can read the defects and fix the code on the same branch. A distinct loop from the build; QA results are **tracked, never gated** (§12).

### 9.3 GitHub — code review (Free + private)
- **Single-developer model — the remote is the source of truth.** `forge start --workorder <id>` runs at build start: it `git fetch origin` and creates/aligns `forge/<KEY>` from the latest remote (from `origin/<KEY>` if the work-order branch exists there, else `origin/<base>`), so a build never starts on a stale local base. It refuses on an uncommitted-dirty tree (`--force` to discard and match remote) and falls back to the local base when offline. Nothing else fetches/pulls; the only other network git op is `git push` in `forge pr`.
- `sync-github.mjs`: branch `forge/<KEY>`, commit, push, `gh pr create` (title carries the JIRA key), and **post the SonarQube result** as a PR comment + a `Sonar Quality Gate` commit status (surface **C2**; SARIF inline annotations / **C1** are dropped — they need GitHub Advanced Security, unavailable on Free/private).
- Review happens on the PR. On Free + private, required checks/branch protection are unavailable, so the status is **informational** (see §14).
- `forge done --workorder <id>` closes the loop: it **verifies the PR is merged** (`gh pr view`, or the REST pulls API via `GITHUB_TOKEN`) and only then transitions the JIRA Story to Done — so Done reflects a real merge, not an assertion. Offline it accepts `--result-file <pr.json>`; `--assume-merged` is an explicit unverified override.

### 9.4 SonarQube Community Edition (local)
- CE has **no branch/PR analysis**. `scan-sonar.mjs` therefore scans each WO PR into an **ephemeral project** `projectKey=<projectBase>-pr-<n>`, reads the quality gate + issues via the Web API (`/api/qualitygates/project_status`, `/api/issues/search`), hands them to `sync-github.mjs`, and **deletes the ephemeral project on PR close**.
- A separate **stable project scans `main`** post-merge for trend/health (a lightweight ForgeScore-like signal from Sonar's own metrics).

## 10. UI/UX Design Phase

- **Framework:** React. **Allowed design systems (top 5):**

  | Design system | Package | Root Provider (mockup) |
  |---|---|---|
  | Material Design (MUI) | `@mui/material` | `ThemeProvider` + `createTheme` |
  | Ant Design | `antd` | `ConfigProvider` |
  | Fluent UI (Fluent Design) | `@fluentui/react-components` | `FluentProvider` |
  | Chakra UI | `@chakra-ui/react` | `ChakraProvider` |
  | Mantine | `@mantine/core` | `MantineProvider` |

  Honorable mentions to add later: Carbon (IBM), shadcn/ui (copy-paste Radix+Tailwind — different scaffolding).

- **Recommendation (intent-driven):** the `ux-design` artifact reads PRD/BRD and scores the 5 against `ui/design-system-rubric.mjs` (archetype, brand, component complexity, accessibility, i18n/RTL, theming depth, ecosystem maturity, performance), then writes a **"Design System Recommendation"** section (recommended + confidence + rationale citing PRD/BRD + runner-up + tradeoffs). The agent **always presents the ranked options + its recommendation and asks the user to pick or confirm** before building the mockup — it never silently auto-selects. Cost caveat noted: MUI X advanced grids/pickers are paid.
- **Preview:** `forge preview mockup` scaffolds ONE single-page Vite app — an app shell (sidebar, top menu, content table, buttons, modal) in the chosen system; the agent rebuilds `src/App.jsx` into the real shell per `ux-design.md`. Regenerate under `--system <other>` to compare.
- **Review/approval (Free path):** `forge preview shot` renders the one mockup page to a **single screenshot** (system Chrome/Edge headless; Playwright fallback) → `sync-confluence.mjs` embeds it on the Confluence UX page (+ attaches the self-contained HTML) → visual approval there. No hosting required.
- The chosen system is recorded in `config.yaml`, so every WO build stays consistent.
- **Fidelity note:** the mockup is a **prototype for approval** (one assembled page for look-and-feel); the real implementation happens in the work-order build. Keep the mockup a reference, not the source of truth.

## 11. Governance & Compliance

A regulation/policy is decomposed into **controls**, each in one of three enforceability classes:

| Class | Example (UU PDP) | Enforced by |
|---|---|---|
| **Auto-checkable** | PII fields tagged; retention defined; DPIA present & approved; no PII in logs | `gate.mjs` + SonarQube |
| **Human-attested** | lawful basis appropriate; consent truly informed; transfer safeguard adequate | Confluence approval by a DPO/compliance reviewer |
| **Guidance (by-design)** | data minimization, purpose limitation | `config.yaml` context/rules injected into artifacts |

**Control catalogs** in `openspec/forge/controls/` — **two active regimes: `uu-pdp.yaml` and `iso-27001.yaml`** (each control: `id`, `article`/`clause`, `description`, `class`, `check`, `severity`; a requirement/WO tags which catalogs apply). **UU PDP** controls: lawful basis, explicit consent, sensitive-data safeguards, data-subject rights (access/rectify/erase/port/object), retention & deletion, cross-border transfer, privacy-by-design, security/encryption, no-PII-in-logs (Sonar), DPIA for high-risk. **ISO/IEC 27001:2022** — only the **engineering-relevant Annex A subset** applies in the pipeline: A.8.25 secure development lifecycle, A.8.26 application security requirements, A.8.27 secure engineering principles, A.8.28 secure coding, A.8.29 security testing, A.8.24 cryptography, A.8.15 logging, A.8.8 technical-vulnerability management, A.5.15 access control (org-level ISMS clauses are out of scope — same engineering-vs-organizational boundary as UU PDP). Many ISO controls are **auto-checkable via SonarQube** (secure coding, vulnerabilities, security testing), so ISO 27001 leans on the gate more than UU PDP does. The framework still extends to `gdpr.yaml`/`corp-policy.yaml` later.

The `compliance` artifact holds the DPIA + control mapping, always present, with an explicit **reviewer-approved "N/A – no personal data"** path (mirrors OpenSpec's `skip_specs`, since the DAG can't express conditional requirements). RTM links each requirement → control → evidence (PR) → approver = the audit trail; it also links each requirement to its **QA test cases + results** (human-executed acceptance evidence, supporting ISO 27001 A.8.29 security/acceptance testing).

**Honest boundaries:** (a) the pipeline enforces engineering/product privacy-by-design + evidence, **not** organizational obligations (breach notification within ~3×24h, DPO appointment, RoPA) — those are documented, not executed; (b) it is a **compliance aid, not legal assurance** — the DPO/legal sign-off remains the authority; (c) on Free tier, compliance enforcement inherits the advisory ceiling (§14) — the strongest argument for the hard-gate upgrade.

## 12. The Gate (`gate.mjs`)

The referee, run before build (locally by the agent) and at the PR. `forge gate --change <id>` runs **8 checks**:

`change-exists · artifacts-present · openspec-validate · rtm-present · sonar-quality-gate · confluence-approval (strict re-approval) · jira-sync · compliance-controls (UU PDP + ISO 27001)`

**Pre-build (front-loaded):** *confluence-approval* — required docs (for a work order: **story.md + test-cases.md**) are **Approved** and repo content == the approved snapshot (content hash), so nothing builds from unapproved edits or unapproved QA cases; *compliance-controls* — all **auto** controls satisfied, all **attested** controls approved, DPIA substantive or N/A-approved.
**Per work order:** *change-exists* + *artifacts-present* (story, specs, **test-cases**, tasks); *openspec-validate* passes for the WO change; *rtm-present* (requirement → WO → control → JIRA key → PR); *sonar-quality-gate* = pass (from the ephemeral project); *jira-sync* — the Story key is written back. Human PR review is the final, out-of-band approval. **QA *execution* results are not a gate check** (tracked in JIRA/RTM, per the resolved decision).

Because the gate reads the **cached** approval in `.forge/confluence.json`, `/opsx:apply` runs `forge sync confluence check` **first** to pull the latest `approved` label, then `forge gate` — so a just-granted approval is picked up.

**Result & enforcement:** pass/fail with a report. On Free tier this is enforced three ways before merge — the agent **hard-stops** in apply-guidance (writes no code unless the gate passes), a git **`pre-commit` hook** blocks commits on `forge/*` branches until it passes, and `forge pr` refuses to open a PR otherwise — and the result is **posted to the PR**. It still cannot block the human merge button (§14).

## 13. End-to-End Lifecycle
```
EPIC (forge-epic change)
  /opsx:propose → BRD → PRD → UI/UX (recommend design system + single-page mockup screenshot)
                → feature specs → compliance(DPIA) → work-orders → RTM        [repo]
  sync-confluence → publish docs + UX screenshots
     → 👤 review/approve in Confluence (docs, DPIA, compliance)
     → agent reads reviewer comments (forge sync confluence --read-comments) → revises repo docs → re-publish → re-approve (loops until approved)
  sync-jira → create Epic + Stories; keys → RTM

WORK ORDER (forge-workorder change, one at a time)
  /opsx:apply WO-101
    → forge sync confluence check (refresh approval) → gate.mjs (8 checks): Confluence-approved + snapshot + specs valid + RTM + Sonar + compliance  → else STOP (agent writes no code; the git pre-commit hook also blocks the commit)
    → JIRA Story → In Progress → forge start (fetch origin; forge/WO-101 from latest remote) → implement tasks → commit
    → scan-sonar (ephemeral project) → forge pr: push + gh pr create (links Story) → JIRA Story → In Review → posts quality-gate comment + status
    → 👤 code review on the PR;  gate posts per-PR status (advisory on Free)
    → merge → delete ephemeral Sonar project → forge done (verifies merge) → JIRA Story → Done
  openspec archive (WO) → delta specs fold into openspec/specs/
```

## 14. Enforcement Model & Upgrade Path

| Tier | What you get | Requires |
|---|---|---|
| **Current: Free + private + local (chosen)** | Front-loaded approval (approve docs before build) + agent **hard-stops** on an unapproved WO (apply-guidance) + a git **`pre-commit` hook** blocks commits on `forge/*` until the gate passes + `forge pr` refuses otherwise + advisory PR status (Sonar/validate/RTM visible). **Merge is an explicit human decision** (the gate informs; a person clicks merge). | nothing |
| **GitHub Pro (~$4/mo)** | Required status checks + rulesets on private repos → the gate becomes a **hard merge block** | Pro plan |
| **Self-hosted runner / CI** | Server-side, tamper-resistant re-checks (reach the local Sonar from the same network) | a runner |
| **Team/Enterprise + Code Security** | C1 SARIF inline code-scanning annotations | paid GHAS |

For **legal compliance** specifically, the advisory ceiling is the weakest point (auditors expect enforced + evidenced controls) — the primary reason to consider **GitHub Pro** later. The schema/scripts do not change across tiers; only whether the check is *required* vs *informational*.

## 15. Security Considerations
- **Secrets** (`SONAR_TOKEN`, `JIRA_TOKEN`, `CONFLUENCE_TOKEN`, `GITHUB_TOKEN`) in `.env` / env only; never in `connections.yaml` or artifacts. Least-privilege scopes.
- Companion scripts validate/escape content pushed to external systems (markdown → ADF/storage conversion).
- Agent auto-approval of `gh`/`node`/`sonar-scanner` is governed by the **coding tool's** settings (e.g., `.claude/settings.json`), not OpenSpec — a per-environment concern.
- No PII in logs or in artifacts committed to the repo (a UU-PDP control, Sonar-checked).

## 16. Companion CLI (`forge.mjs`) — command surface

The **agent** runs these via `node openspec/forge/forge.mjs …` (wired through apply-guidance); the user never invokes `forge` directly.
```
forge doctor [--check-connectivity]                 readiness preflight per integration
forge gate --change <id> [--pr <n>]                 run all 8 gate checks; exit non-zero on failure
forge scan --workorder <id> [--pr <n>]              Sonar CE scan → ephemeral per-PR project → quality gate
forge rtm                                           (re)generate the RTM (openspec/forge/rtm.md)
forge preview <recommend|mockup|shot> --epic <id>   design-system pick + single-page mockup + one screenshot
forge sync confluence <publish|check|read-comments> --workorder <id> [--change <e> --doc <f>.md]
                                                    publish each doc as its own page; read the `approved` label; pull comments
forge sync jira <story|epic|transition|qa> [--workorder|--epic <id>] [--to <status>] [--list]
                                                    upsert Epic/Story + write keys back; `qa` files/reads QA-defect issues (separate workflow)
forge start --workorder <id> [--base main] [--force]   fetch origin + align forge/<KEY> to the latest remote (remote = source of truth)
forge pr --workorder <id> [--scan]                  gate → branch → commit → push → open PR (+ Sonar status); JIRA → In Review
forge done --workorder <id> [--result-file <pr.json>]   verify the PR is MERGED (gh/REST) → transition JIRA → Done
```
All are plain Node + REST; none touch OpenSpec `src/`. Every integration command also supports `--dry-run` / `--result-file <mock.json>` for offline runs.

## 17. Resolved Decisions & Remaining Risks

**Resolved (2026-08-17):**
1. **Feature structure** = two-tier: an **Epic** change + each **work order = its own change** (A1).
2. **Coding agent** = **Claude Code** (OpenSpec generates its skills; `gh`/`node`/`sonar-scanner` auto-approved via `.claude/settings.json`).
3. **Repo topology** = **per-project kit**: the `forge` schemas + `openspec/forge/` live in each target app's repo (where `openspec/` lives); this OpenSpec clone is the reference/dev copy.
4. **Confluence approval signal** = a page **status/label `approved`** (gate reads the label).
5. **JIRA** = Epic + Story issue types; statuses **To Do → In Progress → In Review → Done** (In Progress at `/opsx:apply` start, **In Review set by `forge pr` after commit+push**, **Done set by `forge done` which verifies the merge**; approval is not a JIRA status — it lives in Confluence). *(Revised 2026-08-18 from the earlier To Do→Approved→In Progress→Done.)*
6. **Prose docs** = **read-only publish (repo-mastered)** + a **comment-feedback loop**: the agent reads Confluence comments (`--read-comments`), revises the repo doc, and re-publishes. Content authority never leaves the repo.
7. **Work-order approval** = **Confluence sign-off** (JIRA stays tracking-only).
8. **Enforcement** = **GitHub Free, advisory**; the **PR merge is an explicit human decision** (gate informs, human merges). Hard gating (Pro) deferred.
9. **Compliance regimes** = **UU PDP + ISO 27001** (two control catalogs; ISO limited to the engineering-relevant Annex A subset, largely Sonar-checkable).
10. **Re-approval on change** = **strict**: any change to an artifact after approval invalidates it (content hash) and requires fresh sign-off.

**Remaining risks (technical, not open decisions):**
- Markdown ↔ ADF / Confluence-storage conversion fidelity — known, solved-but-real.
- Parallel spec-delta conflicts between WOs on the same capability — sequence or sync.
- Preview ↔ build drift — the mockup is a prototype; rebuild for real in work orders (don't treat the mockup as source of truth).
- Largest build items: the UI/UX preview, the sync scripts, and the gate.

## 18. Non-Goals (recap)
Hosted platform, MCP server, legacy reverse-engineering, static-analysis ForgeScore in-CLI, Day-2 monitoring, tamper-proof enforcement on Free, and any change to OpenSpec `src/`.

## 19. Phased Implementation Roadmap
1. **Foundation** — `forge-workorder` schema (close to spec-driven) + `connections.yaml` + `.env` + `gate.mjs` skeleton (validate + RTM only). Prove one WO change end-to-end locally.
2. **GitHub flow** — `sync-github.mjs` (branch/PR) + local one-WO-at-a-time apply guidance.
3. **SonarQube** — `scan-sonar.mjs` (ephemeral per-PR project) + PR comment/status (C2) + quality gate in `gate.mjs`.
4. **Confluence** — `sync-confluence.mjs` publish + approval read + snapshot-back; gate reads approval.
5. **JIRA** — `sync-jira.mjs` Epic/Story upsert + key write-back; `forge-epic` schema + `rtm.md`.
6. **Compliance** — `controls/uu-pdp.yaml` + `controls/iso-27001.yaml` + `compliance` artifact + gate control checks + config rules/context.
7. **UI/UX** — `ui/design-system-rubric.mjs` + `ux-design` recommendation + `preview.mjs` (single-page app mockup + screenshot → Confluence).
8. **Hardening** — visual-regression, idempotency, error handling; evaluate GitHub Pro for hard gating.

## 20. Appendix — example shapes

**`schemas/forge-workorder/schema.yaml` (excerpt)**
```yaml
name: forge-workorder
version: 1
description: One work order (user story) built on its own branch/PR
artifacts:
  - id: story
    generates: story.md
    template: story.md
    requires: []
    instruction: |
      Write a user story: "As a <persona>, I want <capability>, so that <benefit>."
      Include acceptance criteria and the linked Epic + JIRA key.
  - id: specs
    generates: "specs/**/*.md"
    template: spec.md
    requires: [story]
  - id: design
    generates: design.md
    template: design.md
    requires: [story]
  - id: tasks
    generates: tasks.md
    template: tasks.md
    requires: [specs, design]
apply:
  requires: [tasks]
  tracks: tasks.md
  instruction: |
    Implement ONLY this work order. Run `forge gate`. Open its PR. Then stop.
```

**`controls/uu-pdp.yaml` (excerpt)**
```yaml
regime: UU PDP (Law 27/2022)
controls:
  - id: PDP-LAWFUL-BASIS
    article: "Art. 20"
    description: A valid lawful basis is recorded for each processing activity.
    class: attested
    severity: error
  - id: PDP-NO-PII-IN-LOGS
    description: Personal data must not be written to logs.
    class: auto
    check: sonar:rule=pii-in-logs
    severity: error
  - id: PDP-DPIA
    article: "Art. 34"
    description: High-risk processing has an approved DPIA.
    class: attested
    severity: error
```

**`controls/iso-27001.yaml` (excerpt)**
```yaml
regime: ISO/IEC 27001:2022 (engineering-relevant Annex A subset)
controls:
  - id: ISO-A8.28-SECURE-CODING
    clause: "A.8.28"
    description: Secure coding principles are applied.
    class: auto
    check: sonar:qualityGate
    severity: error
  - id: ISO-A8.8-VULN-MGMT
    clause: "A.8.8"
    description: No known high/critical vulnerabilities in code or dependencies.
    class: auto
    check: sonar:security
    severity: error
  - id: ISO-A8.24-CRYPTO
    clause: "A.8.24"
    description: Approved cryptography is used for data in transit and at rest.
    class: attested
    severity: error
```

**`ui/design-system-rubric.mjs` (excerpt)**
```yaml
weights: { archetype: 3, brand: 2, complexity: 2, accessibility: 2, i18n: 1, ecosystem: 1 }
signals:
  archetype:
    dashboard_crud: ant-design
    material_consumer: mui
    ms_ecosystem: fluent
    custom_brand: [chakra, mantine]
```

**RTM row (`rtm.md`)**

| Requirement | Work Order | Control(s) | JIRA | PR | Status |
|---|---|---|---|---|---|
| REQ-3 consent capture | WO-101 | PDP-CONSENT | FORGE-42 | #128 | in-review |

---

*End of design document. All eight phases are built and verified offline; no OpenSpec source files were modified.*

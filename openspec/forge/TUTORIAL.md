# End-to-End Tutorial — from idea to shipped, governed feature

This walks the **entire** Forge-flavored OpenSpec workflow with one running example:
a self-service **"Data Export"** feature (users download their personal data — a
UU PDP / GDPR data-portability right). It touches personal data (so compliance
lights up) and has a UI (so the design-system flow lights up).

Legend: 👤 you · 🤖 agent (Claude Code, via `/opsx:*`) · ⚙️ `forge` (the agent runs it as `node openspec/forge/forge.mjs …`) · 🌐 Confluence / JIRA / GitHub / SonarQube.

> **You only ever type two commands: `/opsx:propose` (plan a feature / author a work order until it's approved) and `/opsx:apply` (build one approved work order).** Everything marked ⚙️ `forge` below is run *by the agent* under the hood — shown short, for readability, so you can see what's happening. Your only other actions are human sign-offs: **approve** pages in Confluence and **merge** the PR in GitHub.

---

## Flow at a glance

```mermaid
flowchart TD
  idea(["💡 Idea"]) --> explore["/opsx:explore"]
  explore --> epicNew["openspec new change --schema forge-epic"]

  subgraph EPIC["📦 Epic — plan the feature (agent authors artifacts)"]
    direction TB
    brd["brd.md"] --> prd["prd.md"]
    prd --> ux["ux-design.md — forge preview recommend → mockup → shot"]
    prd --> caps["capabilities.md"]
    caps --> comp["compliance.md (DPIA)"]
    ux --> wos["work-orders.md"]
    caps --> wos
    comp --> wos
  end
  epicNew --> brd

  wos --> pubE["forge sync confluence publish — one page per doc (+ mockup shot)"]
  pubE --> apprE{"🌐 Confluence approved?"}
  apprE -- no --> reviseE["read-comments → revise → re-publish"]
  reviseE --> pubE
  apprE -- yes --> jiraE["forge sync jira epic → JIRA Epic"]
  jiraE --> loop{{"for each work order"}}

  subgraph WO["🧩 Work Order — built one at a time"]
    direction TB
    woNew["openspec new change --schema forge-workorder"] --> propose["/opsx:propose — story + specs(+controls) + test-cases + tasks"]
    propose --> pubW["publish → approve (story + QA test cases)"]
    pubW --> jiraW["forge sync jira story (key → story.md)"]
    jiraW --> apply["/opsx:apply"]
    apply --> refresh["⚙️ sync confluence check → forge gate"]
    refresh --> gate{"8 checks pass? approval ✓?"}
    gate -- no --> fix["fix / get approval"]
    fix --> gate
    gate -- yes --> build["build on forge branch → forge scan → forge pr"]
    build --> review{"🌐 GitHub PR merged?"}
    review -- no --> build
    review -- yes --> archive["openspec archive → specs updated"]
  end
  loop --> woNew
  archive --> more{"more work orders?"}
  more -- yes --> loop
  more -- no --> done(["✅ Shipped code + updated specs + RTM + governance evidence"])
```

---

## 0. One-time setup

```bash
npm install -g @fission-ai/openspec         # base CLI
cd my-app && openspec init                   # 👤 pick "Claude Code"
curl -fsSL https://raw.githubusercontent.com/c0d3beat/openspec-forge/main/install.sh | bash   # add the kit (+ a gate pre-commit hook)
$EDITOR openspec/forge/connections.yaml      # 👤 your JIRA/Confluence/GitHub/SonarQube hosts
cp openspec/forge/.env.example .env && $EDITOR .env   # 👤 tokens
forge doctor                                  # ⚙️ confirms what's LIVE-READY vs offline-only
```

---

## 1. Ideation — think it through

You have a fuzzy idea: *"let users export their data."* Start with OpenSpec's no-stakes thinking partner:

```
👤 /opsx:explore
🤖 What are we exploring?
👤 Self-service data export — users download everything we hold on them.
🤖 That's a data-portability capability (UU PDP Art. 5 / GDPR Art. 20). Key questions:
   which formats? auth/consent? async generation for large accounts? retention of the export file?
   Shall I shape it into an Epic?
👤 Yes.
```

Ideation crystallized into a **feature** → that's an **Epic**.

---

## 2. Plan the feature (the Epic)

```bash
👤 /opsx:propose data-export
```

🤖 The agent scaffolds the `forge-epic` change (`openspec new change data-export --schema forge-epic`) and authors its artifacts in dependency order (guided by the `forge-epic` schema). As it finishes each doc it also drives the ⚙️ `forge` preview/publish steps shown in §3–§5 automatically — they're broken out below so you can see them:

```
openspec/changes/data-export/
├── brd.md           # business intent: reduce support tickets, meet portability obligations
├── prd.md           # scope, personas (Account Owner), journeys, NFRs (WCAG AA, i18n)
├── ux-design.md     # design-system recommendation + component inventory
├── capabilities.md  # prose: "Export request", "Export generation & delivery"
├── compliance.md    # DPIA: personal data = YES → tagged controls
└── work-orders.md   # the build queue (the stories)
```

A peek at `compliance.md` (the DPIA is substantive because this touches personal data):

```markdown
## DPIA
- Personal data processed? YES — full profile + activity export.
- Lawful basis: legal obligation (data-portability right). Retention: export files purged after 7 days.
## Control Mapping
| Control | Applies? | How satisfied |
| PDP-DATA-SUBJECT-RIGHTS | yes | this feature *is* the portability right |
| PDP-CONSENT | yes | re-auth before an export runs |
| ISO-A8.24-CRYPTO | yes | export encrypted at rest + signed download URL |
```

And `work-orders.md` — the queue, built one at a time:

```markdown
- [ ] wo-export-request  — As an Account Owner, I want to request an export …
- [ ] wo-export-deliver  — As an Account Owner, I want to download my finished export …
```

---

## 3. Choose the UI — recommended from the plan

```bash
🤖 forge preview recommend --epic data-export
```
```
⚙️ recommended: MUI (Material Design)  [@mui/material]   confidence: medium
   runner-up:   Ant Design
   scores:      mui=8   ant-design=6   fluent=3   chakra=2   mantine=2
   rationale:   archetype(+3) · complexity/data-grid(+2) · accessibility/WCAG(+2) · i18n(+1)
```
```bash
🤖 forge preview mockup --epic data-export       # ⚙️ scaffolds a single-page app-shell mockup (MUI) under ux-preview/
🤖 rebuilds src/App.jsx as the real Data-Export shell (sidebar, records table, export modal) per ux-design.md
🤖 forge preview shot --epic data-export         # ⚙️ renders ONE screenshot → ux-preview/mockup.png (system browser)
```

Record the decision in `ux-design.md`. (Prefer Ant Design instead? `forge preview mockup --epic data-export --system ant-design` and re-shoot.)

---

## 4. Review & approve the plan (Confluence)

Content stays in the repo; Confluence is where humans review + sign off.

```bash
🤖 forge sync confluence publish --change data-export --doc prd.md        # 🌐 each doc → its OWN page (repeat for brd/ux-design/compliance/work-orders)
```
🌐 **You and other reviewers approve in Confluence:** the PM reviews the PRD; the **DPO reviews the DPIA** and adds the `approved` label; UX approves the **mockup screenshot** embedded on the ux-design page. Each document is a distinct page, so they're signed off independently.

If reviewers leave comments:
```bash
🤖 forge sync confluence read-comments --change data-export
🤖 folds the feedback into the repo docs → re-publishes (which clears `approved`, forcing fresh sign-off — strict re-approval)
```

---

## 5. Track the work (JIRA)

```bash
🤖 forge sync jira epic --epic data-export        # 🌐 creates Epic PROJ-1
```

---

## 6. Build a work order — one at a time

Take the first story. **This is the core loop; you repeat it per work order.**

```mermaid
sequenceDiagram
  actor Dev as 👤 You
  participant CC as 🤖 Claude Code
  participant F as ⚙️ forge
  participant CF as 🌐 Confluence
  participant J as 🌐 JIRA
  participant S as 🌐 SonarQube
  participant GH as 🌐 GitHub
  Dev->>CC: /opsx:propose wo-…
  CC->>CC: author story + specs(+controls) + test-cases + tasks
  CC->>F: forge sync confluence publish (one page per doc)
  F->>CF: publish doc (+ mockup screenshot)
  CF-->>Dev: you add the "approved" label
  CC->>F: forge sync jira story
  F->>J: create Story (key written to story.md)
  Dev->>CC: /opsx:apply
  CC->>F: forge sync confluence check (refresh approval)
  CC->>F: forge gate (pre-build, 8 checks)
  F-->>CC: PASS — else STOP (no code; pre-commit hook also blocks)
  CC->>J: story → In Progress
  CC->>F: forge start
  F->>GH: fetch origin → branch from latest
  CC->>CC: build on the synced branch
  CC->>F: forge scan
  F->>S: analyze → quality gate
  CC->>F: forge pr
  F->>GH: push branch + open PR (Sonar summary in body)
  F->>J: story → In Review
  Dev->>GH: review + merge (human decision)
  CC->>F: forge done
  F->>GH: verify PR merged?
  GH-->>F: MERGED
  F->>J: story → Done
  CC->>CC: openspec archive
```

```bash
👤 /opsx:propose wo-export-request
```
🤖 scaffolds the `forge-workorder` change (`openspec new change wo-export-request --schema forge-workorder`) and authors `story.md` (persona + acceptance criteria), `specs/**` (delta requirements with WHEN/THEN scenarios, **tagging controls**), **`test-cases.md`** (QA/UAT cases derived from those scenarios — for human QA, distinct from the unit tests the build+Sonar handle), and `tasks.md`:

```markdown
### Requirement: Request a data export
The system SHALL let an authenticated user request an export of their personal data
after re-authentication (control: PDP-CONSENT, ISO-A8.24-CRYPTO).

#### Scenario: Owner requests an export
- **WHEN** the owner confirms their password and clicks "Export my data"
- **THEN** an encrypted export job is queued and the owner is notified on completion
```

Get it approved + tracked:
```bash
🤖 forge sync confluence publish --workorder wo-export-request --doc story.md        # 🌐 → you approve the plan
🤖 forge sync confluence publish --workorder wo-export-request --doc test-cases.md   # 🌐 → QA approves (gates /opsx:propose completion)
🤖 forge sync jira story --workorder wo-export-request --epic PROJ-1   # 🌐 Story PROJ-2; key written into story.md
```

Now implement — **the agent does the rest via apply-guidance**:
```bash
👤 /opsx:apply wo-export-request
```
```
🤖 refreshes approval ⚙️ forge sync confluence check, then runs ⚙️ forge gate → verifies docs are approved BEFORE building … PASS
🤖 (if approval is missing it STOPS, names the page that needs the `approved` label, writes NO code — a git pre-commit hook also blocks the commit)
🤖 moves JIRA PROJ-2 → In Progress, runs ⚙️ forge start (fetches origin, cuts forge/PROJ-2 from the latest remote — remote is source of truth), implements ONLY this work order, checks off tasks
🤖 runs ⚙️ forge scan   → 🌐 SonarQube (ephemeral per-PR project) → quality gate
🤖 runs ⚙️ forge pr     → 🌐 pushes the branch + opens the GitHub PR (Sonar summary in the body) → moves PROJ-2 → In Review
🤖 stops (does not start another work order)
```

Refresh traceability and confirm the gate:
```bash
🤖 forge rtm
🤖 forge gate --change wo-export-request
```
```
⚙️  ✓ change-exists   ✓ artifacts-present  ✓ openspec-validate  ✓ rtm-present
    ✓ sonar-quality-gate   ✓ confluence-approval   ✓ jira-sync   ✓ compliance-controls
    GATE: PASS  (advisory — on GitHub Free the merge is a human decision)
```

---

## 7. Review & merge (GitHub)

🌐 On the PR a human reviews the diff, the posted **Sonar quality gate**, and the compliance status.
When satisfied, **they click merge** (on GitHub Free this is the human decision; the gate informed it).

🌐 QA now **executes** the approved test cases. A failing case is filed as a JIRA `qa` defect (a workflow separate from the build):
```bash
🤖 forge sync jira qa --workorder wo-export-request          # files a JIRA issue per failing case (linked to the Story)
🤖 forge sync jira qa --workorder wo-export-request --list   # agent reads open QA defects → fixes on the SAME branch → pushes
```
QA results are tracked, not gated — they never block archiving, but resolve open defects before you call it done. Then:
```bash
🤖 forge done --workorder wo-export-request   # verifies the PR is MERGED (gh/REST), then sets JIRA PROJ-2 → Done (refuses if not merged)
👤 openspec archive wo-export-request         # folds the delta specs into openspec/specs/
```

---

## 8. Repeat, then the feature is done

Repeat step 6–7 for `wo-export-deliver`. When the last work order is merged and archived, run:

```bash
🤖 forge rtm
```
```
| Work Order         | Requirement                | Controls                      | JIRA              | Confluence | Sonar | Branch          |
| wo-export-request  | Request a data export      | PDP-CONSENT, ISO-A8.24-CRYPTO | PROJ-2 (Done)     | approved   | OK    | forge/PROJ-2    |
| wo-export-deliver  | Download a finished export | ISO-A8.24-CRYPTO              | PROJ-3 (Done)     | approved   | OK    | forge/PROJ-3    |
```

---

## 9. The end product — what "done" looks like

- **Shipped code** — merged PRs, one per reviewed work order.
- **Living specs** — `openspec/specs/` now describes the export capability as built.
- **Traceability** — `rtm.md` links every requirement → work order → compliance control → JIRA → approval → Sonar → branch. Hand this to an auditor.
- **Governance evidence** — DPIA approved by the DPO in Confluence; UU PDP + ISO 27001 controls satisfied and recorded; every build gated on approval + quality + compliance.
- **Tracking** — JIRA Epic PROJ-1 and its Stories all Done.

From a fuzzy idea to enterprise-ready, auditable code — and OpenSpec's core was never modified.

---

## Notes

- **Offline vs live.** Every `forge sync`/`scan`/`pr` runs offline via `--dry-run` / `--result-file <mock.json>` for dry runs and demos; drop those flags (and fill `.env`) to hit the real services. `forge doctor` shows readiness.
- **Enforcement tier.** On GitHub Free the gate is *advisory at the merge button*, but building is still gated three ways: the agent hard-stops in apply-guidance unless `forge gate` passes (approval green), a git **`pre-commit` hook** blocks commits on `forge/*` branches until the gate passes, and `forge pr` refuses to open a PR otherwise. The human still clicks merge (the posted Sonar/gate status informs it). For a *server-side* hard block, add GitHub Pro's required status checks — no schema/script changes needed.
- **Repo sync (single-developer).** The remote is the source of truth. `forge start` runs automatically at build start (apply-guidance): it fetches origin and cuts/aligns the work-order branch from the latest remote, so every build is on current code (e.g. it picks up the previous work order's just-merged PR). It refuses on a dirty tree (`--force` to override) and falls back to the local base when offline.
- **QA test cases vs unit tests.** `test-cases.md` holds human QA / UAT cases (derived from the scenarios); unit and integration tests are the build's job, enforced by the SonarQube quality gate. QA **sign-off** on the test-cases page gates `/opsx:propose` completion (and the build); QA **execution** results are tracked (JIRA `qa` issues + the RTM Test Cases column), not gated — a failing case is a defect the agent fixes on the same branch.
- **Deeper docs.** `openspec/forge/README.md` (command reference) and `openspec/forge/DESIGN.md` (§13 lifecycle, §17 decisions, §19 roadmap).

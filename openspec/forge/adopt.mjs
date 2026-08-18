#!/usr/bin/env node
/**
 * Forge adopt — reconnect `.forge/` to the systems of record after a fresh clone (handoff).
 *
 * `.forge/` (page IDs, approval cache, JIRA status, Sonar) is gitignored, so a developer who
 * clones the repo has the artifacts but not the links. `adopt` rebuilds `.forge/` from the
 * authoritative systems, so the gate stops false-negatives ("not published"/"no JIRA") and the
 * next `forge sync/publish` reconnects instead of creating duplicates.
 *
 *   --workorder <id>   reconnect a work order: Confluence pages by title (story/test-cases/design),
 *                      JIRA Story by the key committed in story.md.
 *   --epic <id>        reconnect an epic: Confluence pages by title (brd/prd/ux-design/…),
 *                      JIRA Epic by summary (best-effort).
 *
 * Confluence pages are found BY TITLE (`[<id>] <H1>`) — the same title `publish` writes — so no
 * stored pageId is needed. Approval is re-read from the page's `approved` label. The GitHub PR
 * state is reported (informational; the branch lives on the remote). Sonar is re-derivable — run
 * `forge scan`. After adopt, run `forge rtm`.
 *
 * Offline/CI: --result-file <bundle.json> ingests pre-fetched data; --dry-run prints the calls.
 * Env: CONFLUENCE_TOKEN (+ CONFLUENCE_EMAIL), JIRA_TOKEN (+ JIRA_EMAIL), CONFLUENCE_BASE_URL/JIRA_BASE_URL.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readConnections } from './lib/connections.mjs';
import { writeConfluenceState, hashDoc } from './lib/confluence.mjs';
import { jiraStatePath } from './lib/jira.mjs';

const trimSlash = (s) => s.replace(/\/$/, '');
const WO_DOCS = ['story.md', 'test-cases.md', 'design.md'];
const EPIC_DOCS = ['brd.md', 'prd.md', 'ux-design.md', 'capabilities.md', 'compliance.md', 'work-orders.md'];

function parseArgs(argv) {
  const a = { root: process.cwd(), dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--workorder' || x === '--change') a.workorder = argv[++i];
    else if (x === '--epic') a.epic = argv[++i];
    else if (x === '--root') a.root = path.resolve(argv[++i]);
    else if (x === '--result-file') a.resultFile = path.resolve(argv[++i]);
    else if (x === '--dry-run') a.dryRun = true;
    else if (x === '-h' || x === '--help') a.help = true;
  }
  return a;
}

const basicOrBearer = (token, email) => (email ? 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64') : `Bearer ${token}`);
const confluenceAuth = () => (process.env.CONFLUENCE_TOKEN ? basicOrBearer(process.env.CONFLUENCE_TOKEN, process.env.CONFLUENCE_EMAIL) : null);
const jiraAuth = () => (process.env.JIRA_TOKEN ? basicOrBearer(process.env.JIRA_TOKEN, process.env.JIRA_EMAIL) : null);

async function getJson(url, auth) {
  const res = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
function commandExists(bin) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(finder, [bin], { encoding: 'utf8' }).status === 0;
}
function pageTitle(changeDir, doc, id) {
  const p = path.join(changeDir, doc);
  const h1 = existsSync(p) ? (readFileSync(p, 'utf8').match(/^#\s+(?:Work Order:\s*)?(.+)$/m) || [])[1] : null;
  return `[${id}] ${(h1 && h1.trim()) || doc.replace(/\.md$/, '')}`;
}
function storyKey(changeDir) {
  const p = path.join(changeDir, 'story.md');
  if (!existsSync(p)) return null;
  return (readFileSync(p, 'utf8').match(/JIRA:\s*([A-Z][A-Z0-9]+-\d+)/) || [])[1] || null;
}
function writeJira(changeDir, state) {
  const p = jiraStatePath(changeDir);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2) + '\n');
  return p;
}
const hasApprovedLabel = (raw) => (raw.results || raw.labels || raw || []).map((l) => (typeof l === 'string' ? l : l.name || l.label)).includes('approved');

async function main() {
  const a = parseArgs(process.argv);
  const isEpic = !!a.epic && !a.workorder;
  const id = a.workorder || a.epic;
  if (a.help || !id) {
    console.error('Usage: node openspec/forge/adopt.mjs --workorder <id> | --epic <id> [--root <p>] [--result-file <bundle.json>] [--dry-run]');
    process.exit(a.help ? 0 : 2);
  }
  const root = a.root;
  const changeDir = path.join(root, 'openspec', 'changes', id);
  if (!existsSync(changeDir)) { console.error(`change not found: ${changeDir}`); process.exit(1); }

  const conn = readConnections(root);
  const cBase = process.env.CONFLUENCE_BASE_URL || conn.confluence?.baseUrl || 'https://your-org.atlassian.net/wiki';
  const space = conn.confluence?.space || 'FORGE';
  const jBase = process.env.JIRA_BASE_URL || conn.jira?.baseUrl || 'https://your-org.atlassian.net';
  const project = conn.jira?.project || 'FORGE';
  const docs = (isEpic ? EPIC_DOCS : WO_DOCS).filter((d) => existsSync(path.join(changeDir, d)));
  const bundle = a.resultFile ? JSON.parse(readFileSync(a.resultFile, 'utf8')) : null;

  console.log(`\nForge adopt — ${isEpic ? 'epic' : 'work order'} ${id}   (reconnect .forge/ from the systems of record)`);
  console.log(`  confluence: ${cBase}  space=${space}`);
  console.log(`  jira:       ${jBase}  project=${project}`);
  console.log(`  docs:       ${docs.join(', ') || '(none found)'}`);

  // ---- Confluence: reconnect each published doc BY TITLE ----
  let reconnected = 0;
  for (const doc of docs) {
    const title = pageTitle(changeDir, doc, id);
    if (a.dryRun) {
      console.log(`  [plan] GET ${trimSlash(cBase)}/rest/api/content?spaceKey=${space}&title=${encodeURIComponent(title)}  → then GET .../<id>/label`);
      continue;
    }
    let found = null, approved = false;
    if (bundle) {
      const b = bundle.confluence?.[doc];
      if (b) { found = { id: b.pageId, url: b.url, version: b.version }; approved = !!b.approved; }
    } else if (confluenceAuth()) {
      try {
        const res = await getJson(`${trimSlash(cBase)}/rest/api/content?spaceKey=${encodeURIComponent(space)}&title=${encodeURIComponent(title)}&expand=version`, confluenceAuth());
        const hit = (res.results || []).find((r) => r.title === title) || (res.results || [])[0];
        if (hit) {
          found = { id: hit.id, url: `${trimSlash(cBase)}${hit._links?.webui || ''}`, version: hit.version?.number };
          try { approved = hasApprovedLabel(await getJson(`${trimSlash(cBase)}/rest/api/content/${hit.id}/label`, confluenceAuth())); } catch { /* labels optional */ }
        }
      } catch (e) { console.log(`  · Confluence lookup failed for ${doc}: ${e.message}`); }
    } else { console.log('  · no CONFLUENCE_TOKEN — skipping Confluence (set the token, or use --result-file)'); break; }

    if (found?.id) {
      // publishedHash = the doc AS IT IS NOW: the `approved` label is the source of truth; we trust
      // current content as the approved baseline (the original snapshot hash was lost with .forge/).
      writeConfluenceState(changeDir, doc, {
        pageId: found.id, url: found.url, title, doc, version: found.version || 1,
        publishedHash: hashDoc(changeDir, doc), approved, adoptedAt: new Date().toISOString(),
      });
      console.log(`  ✓ ${doc} → page ${found.id}  (approved: ${approved})`);
      reconnected++;
    } else if (!a.dryRun) {
      console.log(`  · ${doc} → no matching page (never published?) — skipped`);
    }
  }

  // ---- JIRA: reconnect the Story (by key in story.md) or the Epic (by summary) ----
  if (a.dryRun) {
    console.log(isEpic
      ? `  [plan] GET ${trimSlash(jBase)}/rest/api/3/search?jql=project=${project} AND issuetype=Epic AND summary~"${id}"`
      : `  [plan] GET ${trimSlash(jBase)}/rest/api/3/issue/<key-from-story.md>?fields=summary,status`);
  } else if (bundle?.jira?.key) {
    const j = bundle.jira;
    writeJira(changeDir, { key: j.key, url: j.url || `${trimSlash(jBase)}/browse/${j.key}`, type: isEpic ? 'Epic' : 'Story', status: j.status || 'To Do', summary: j.summary || id, adoptedAt: new Date().toISOString() });
    console.log(`  ✓ JIRA ${j.key} (${j.status || '?'})`);
  } else if (jiraAuth()) {
    try {
      if (isEpic) {
        const jql = `project=${project} AND issuetype=Epic AND summary ~ "${id}"`;
        const res = await getJson(`${trimSlash(jBase)}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=summary,status&maxResults=10`, jiraAuth());
        const hit = (res.issues || []).find((i) => (i.fields?.summary || '').startsWith(`${id}:`)) || (res.issues || [])[0];
        if (hit) { writeJira(changeDir, { key: hit.key, url: `${trimSlash(jBase)}/browse/${hit.key}`, type: 'Epic', status: hit.fields?.status?.name || 'To Do', summary: hit.fields?.summary, adoptedAt: new Date().toISOString() }); console.log(`  ✓ JIRA Epic ${hit.key} (${hit.fields?.status?.name})`); }
        else console.log(`  · no JIRA Epic matched "${id}" — relink manually`);
      } else {
        const key = storyKey(changeDir);
        if (!key) console.log('  · no JIRA key in story.md — nothing to reconnect (run `forge sync jira story`)');
        else {
          const issue = await getJson(`${trimSlash(jBase)}/rest/api/3/issue/${key}?fields=summary,status`, jiraAuth());
          writeJira(changeDir, { key: issue.key || key, url: `${trimSlash(jBase)}/browse/${key}`, type: 'Story', status: issue.fields?.status?.name || 'To Do', summary: issue.fields?.summary, adoptedAt: new Date().toISOString() });
          console.log(`  ✓ JIRA Story ${key} (${issue.fields?.status?.name})`);
        }
      }
    } catch (e) { console.log(`  · JIRA reconnect failed: ${e.message}`); }
  } else {
    console.log('  · no JIRA_TOKEN — skipping JIRA (set the token, or use --result-file)');
  }

  // ---- GitHub: report the PR/merge state (informational; the branch is on the remote) ----
  const key = isEpic ? null : storyKey(changeDir);
  if (!a.dryRun && key && commandExists('gh')) {
    const branch = `${conn.github?.branchPrefix || 'forge/'}${key}`;
    const r = spawnSync('gh', ['pr', 'view', branch, '--json', 'state,url'], { cwd: root, encoding: 'utf8' });
    if (r.status === 0) { try { const pr = JSON.parse(r.stdout); console.log(`  ℹ GitHub PR ${branch}: ${pr.state}  ${pr.url || ''}`); } catch { /* */ } }
    else console.log(`  ℹ no PR found for ${branch} (unmerged/undeleted, or not pushed yet)`);
  }

  console.log(`\n  reconnected ${reconnected} Confluence page(s). Next: \`forge rtm\` (rebuild the matrix) · \`forge scan\` (refresh Sonar) · \`forge gate\`.\n`);
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });

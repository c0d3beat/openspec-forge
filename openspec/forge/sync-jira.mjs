#!/usr/bin/env node
/**
 * Forge JIRA sync — Phase 5. JIRA is TRACKING ONLY (approval lives in Confluence).
 *
 *   story       create/update a Story for a work order; write the key back into story.md + .forge/jira.json
 *   epic        create/update the Epic for a feature (from the epic change dir)
 *   transition  move a Story through: To Do -> In Progress -> In Review -> Done
 *
 * JIRA tracks progress only (approval lives in Confluence). In Progress = /opsx:apply start;
 * In Review = set by `forge pr` after branch commit + push; Done = after PR review + merge (at archive).
 * Offline/CI: --result-file ingests a captured response; --dry-run prints the calls.
 * Env: JIRA_TOKEN (+ JIRA_EMAIL for Atlassian Cloud basic auth), JIRA_BASE_URL (overrides connections).
 *
 * NOTE: markdown->ADF here is minimal (headings + paragraphs); a proper converter is a hardening step.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { readConnections } from './lib/connections.mjs';
import { jiraStatePath, readJiraState, jiraQaStatePath, readJiraQaState } from './lib/jira.mjs';

function parseArgs(argv) {
  const a = { action: argv[2], root: process.cwd(), dryRun: false };
  for (let i = 3; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--workorder' || x === '--change') a.workorder = argv[++i];
    else if (x === '--epic') a.epic = argv[++i];
    else if (x === '--to') a.to = argv[++i];
    else if (x === '--root') a.root = path.resolve(argv[++i]);
    else if (x === '--result-file') a.resultFile = path.resolve(argv[++i]);
    else if (x === '--dry-run') a.dryRun = true;
    else if (x === '--list') a.list = true;
    else if (x === '-h' || x === '--help') a.help = true;
  }
  return a;
}

const trimSlash = (s) => s.replace(/\/$/, '');
function authHeader() {
  const t = process.env.JIRA_TOKEN;
  if (!t) return null;
  const e = process.env.JIRA_EMAIL;
  return e ? 'Basic ' + Buffer.from(`${e}:${t}`).toString('base64') : `Bearer ${t}`;
}
function docTitle(changeDir, fallback) {
  const p = path.join(changeDir, 'story.md');
  const t = existsSync(p) ? (readFileSync(p, 'utf8').match(/^#\s+(?:Work Order:\s*)?(.+)$/m) || [])[1] : null;
  return (t && t.trim()) || fallback;
}
function mdToAdf(md) {
  const content = [];
  for (const raw of md.split(/\n{2,}/)) {
    const b = raw.trim();
    if (!b) continue;
    const h = b.match(/^(#{1,6})\s+(.+)$/);
    if (h) content.push({ type: 'heading', attrs: { level: Math.min(h[1].length, 6) }, content: [{ type: 'text', text: h[2].trim() }] });
    else content.push({ type: 'paragraph', content: [{ type: 'text', text: b.replace(/\s*\n\s*/g, ' ') }] });
  }
  return { version: 1, type: 'doc', content: content.length ? content : [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }] };
}
function writeState(changeDir, state) {
  const p = jiraStatePath(changeDir);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2) + '\n');
  return p;
}
function linkKeyIntoStory(changeDir, key) {
  const p = path.join(changeDir, 'story.md');
  if (!existsSync(p)) return;
  const c = readFileSync(p, 'utf8');
  if (/^\s*-?\s*JIRA:/m.test(c)) writeFileSync(p, c.replace(/^(\s*-?\s*JIRA:).*$/m, `$1 ${key}`));
}
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.status === 204 ? {} : res.json();
}

function parseTestCases(md) {
  const heads = [...md.matchAll(/^###\s+(TC-[^\s:]+):?\s*(.*)$/gm)];
  const out = [];
  for (let i = 0; i < heads.length; i++) {
    const m = heads[i];
    const block = md.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : md.length).trim();
    const result = ((block.match(/^-?\s*\*\*Result:\*\*\s*(.+)$/m) || [])[1] || 'Not Run').trim();
    out.push({ tcid: m[1], title: (m[2] || '').trim() || m[1], result, block });
  }
  return out;
}
function writeQaState(changeDir, state) {
  const p = jiraQaStatePath(changeDir);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2) + '\n');
  return p;
}
/**
 * QA-defect workflow — SEPARATE from the build Story. Files one JIRA issue per FAILING
 * test case in test-cases.md (idempotent by TC id); `--list` prints tracked issues so the
 * agent can read them and fix the code on the work-order branch (a pass distinct from the build).
 */
async function runQa({ a, base, project, conn, changeDir, prev }) {
  const qaType = conn.jira?.qaIssueType || 'Bug';
  const qaLabel = conn.jira?.qaLabel || 'qa';
  const state = readJiraQaState(changeDir);
  console.log(`\nForge JIRA qa — ${a.workorder}   (workflow: ${qaType}/${qaLabel}, separate from build Story ${prev?.key || '—'})`);

  if (a.list) {
    const entries = Object.entries(state);
    if (!entries.length) { console.log('  no QA issues tracked yet'); return; }
    for (const [tcid, v] of entries) console.log(`   • ${tcid}  ${v.key}  [${v.status || '?'}]  ${v.summary || ''}  ${v.url || ''}`);
    console.log('\n  (read these, fix the code on the work-order branch, then push — a separate pass from the build)');
    return;
  }

  const tcPath = path.join(changeDir, 'test-cases.md');
  if (!existsSync(tcPath)) { console.error('  no test-cases.md — author QA test cases first'); process.exit(1); }
  const failing = parseTestCases(readFileSync(tcPath, 'utf8')).filter((c) => /^fail/i.test(c.result));
  if (!failing.length) { console.log('  no failing QA test cases — nothing to file'); return; }
  console.log(`  ${failing.length} failing case(s)`);

  const ingest = a.resultFile ? JSON.parse(readFileSync(a.resultFile, 'utf8')) : null; // { "TC-1": { key, url }, ... }
  let changed = false;
  for (const c of failing) {
    if (state[c.tcid]) { console.log(`   · ${c.tcid} already filed -> ${state[c.tcid].key}`); continue; }
    const summary = `[QA] ${prev?.key ? prev.key + ' ' : ''}${c.tcid}: ${c.title}`;
    if (ingest && ingest[c.tcid]) {
      state[c.tcid] = { key: ingest[c.tcid].key, url: ingest[c.tcid].url || '', status: 'To Do', summary };
      changed = true; console.log(`   ingested ${state[c.tcid].key} for ${c.tcid}`); continue;
    }
    if (a.dryRun || !authHeader()) {
      console.log(`   [plan] POST ${trimSlash(base)}/rest/api/3/issue   { type: ${qaType}, labels: [${qaLabel}], summary: "${summary}" }`);
      if (prev?.key) console.log(`   [plan] POST .../issueLink   Relates: <new> -> ${prev.key}`);
      continue;
    }
    const fields = { project: { key: project }, issuetype: { name: qaType }, summary, description: mdToAdf(c.block), labels: [qaLabel] };
    const resp = await api('POST', `${trimSlash(base)}/rest/api/3/issue`, { fields });
    const key = resp.key, url = `${trimSlash(base)}/browse/${key}`;
    state[c.tcid] = { key, url, status: 'To Do', summary }; changed = true;
    if (prev?.key) { try { await api('POST', `${trimSlash(base)}/rest/api/3/issueLink`, { type: { name: 'Relates' }, inwardIssue: { key }, outwardIssue: { key: prev.key } }); } catch { /* link best-effort */ } }
    console.log(`   created ${key} for ${c.tcid}   (${url})`);
  }
  if (changed) console.log(`  wrote ${writeQaState(changeDir, state)}`);
}

async function main() {
  const a = parseArgs(process.argv);
  const actions = ['story', 'epic', 'transition', 'qa'];
  if (a.help || !actions.includes(a.action)) {
    console.error(`Usage: node openspec/forge/sync-jira.mjs <${actions.join('|')}> [--workorder <id>|--epic <id>] [--to <status>] [--list] [--root <p>] [--result-file <json>] [--dry-run]`);
    process.exit(a.help ? 0 : 2);
  }
  const root = a.root;
  const conn = readConnections(root);
  const base = process.env.JIRA_BASE_URL || conn.jira?.baseUrl || 'https://your-org.atlassian.net';
  const project = conn.jira?.project || 'FORGE';

  const isEpic = a.action === 'epic';
  const id = isEpic ? a.epic : a.workorder;
  if (!id) { console.error(`  --${isEpic ? 'epic' : 'workorder'} required`); process.exit(2); }
  const changeDir = path.join(root, 'openspec', 'changes', id);
  if (!existsSync(changeDir)) { console.error(`change not found: ${changeDir}`); process.exit(1); }
  const issuetype = isEpic ? 'Epic' : 'Story';
  const summary = `${id}: ${docTitle(changeDir, id)}`;
  const prev = readJiraState(changeDir);

  if (a.action === 'qa') { await runQa({ a, base, project, conn, changeDir, prev }); return; }

  console.log(`\nForge JIRA ${a.action} — ${id}`);
  console.log(`  base:    ${base}`);
  console.log(`  project: ${project}   type: ${issuetype}`);

  if (a.action === 'transition') {
    if (!prev?.key) { console.error('  no linked issue — run `forge sync jira story` first'); process.exit(1); }
    if (!a.to) { console.error('  --to <status> required'); process.exit(2); }
    if (a.dryRun || !authHeader()) {
      console.log(`  [plan] GET  ${trimSlash(base)}/rest/api/3/issue/${prev.key}/transitions`);
      console.log(`  [plan] POST ${trimSlash(base)}/rest/api/3/issue/${prev.key}/transitions   -> "${a.to}"`);
      writeState(changeDir, { ...prev, status: a.to, updatedAt: new Date().toISOString() });
      console.log(`  (recorded status "${a.to}" locally)`);
      process.exit(0);
    }
    const tr = await api('GET', `${trimSlash(base)}/rest/api/3/issue/${prev.key}/transitions`);
    const t = (tr.transitions || []).find((t) => (t.to?.name || t.name || '').toLowerCase() === a.to.toLowerCase());
    if (!t) { console.error(`  no transition to "${a.to}" (available: ${(tr.transitions || []).map((x) => x.name).join(', ')})`); process.exit(1); }
    await api('POST', `${trimSlash(base)}/rest/api/3/issue/${prev.key}/transitions`, { transition: { id: t.id } });
    writeState(changeDir, { ...prev, status: a.to, updatedAt: new Date().toISOString() });
    console.log(`  transitioned ${prev.key} -> ${a.to}`);
    process.exit(0);
  }

  // story / epic: create or update
  const descFile = isEpic
    ? ['prd.md', 'brd.md'].map((f) => path.join(changeDir, f)).find(existsSync)
    : path.join(changeDir, 'story.md');
  const description = descFile && existsSync(descFile) ? mdToAdf(readFileSync(descFile, 'utf8')) : mdToAdf(summary);
  const fields = { project: { key: project }, issuetype: { name: issuetype }, summary, description };
  if (!isEpic && a.epic) fields.parent = { key: a.epic };

  if (a.resultFile) {
    const resp = JSON.parse(readFileSync(a.resultFile, 'utf8'));
    const key = resp.key;
    const url = `${trimSlash(base)}/browse/${key}`;
    const state = { key, url, type: issuetype, status: prev?.status || 'To Do', summary, ...(a.epic && !isEpic ? { epicKey: a.epic } : {}), updatedAt: new Date().toISOString() };
    writeState(changeDir, state);
    if (!isEpic) linkKeyIntoStory(changeDir, key);
    console.log(`\n  ingested -> ${key}   (${url})`);
    console.log(`  wrote ${jiraStatePath(changeDir)}${!isEpic ? ' + linked key into story.md' : ''}`);
    process.exit(0);
  }

  if (a.dryRun || !authHeader()) {
    const verb = prev?.key ? 'PUT' : 'POST';
    const url = prev?.key ? `${trimSlash(base)}/rest/api/3/issue/${prev.key}` : `${trimSlash(base)}/rest/api/3/issue`;
    console.log(`\n  [plan] ${verb} ${url}`);
    console.log(`  [plan] fields: { project: ${project}, issuetype: ${issuetype}, summary: "${summary}"${a.epic && !isEpic ? `, parent: ${a.epic}` : ''} }`);
    process.exit(0);
  }

  // Live
  if (prev?.key) {
    await api('PUT', `${trimSlash(base)}/rest/api/3/issue/${prev.key}`, { fields });
    writeState(changeDir, { ...prev, summary, updatedAt: new Date().toISOString() });
    console.log(`\n  updated ${prev.key}`);
    process.exit(0);
  }
  const resp = await api('POST', `${trimSlash(base)}/rest/api/3/issue`, { fields });
  const key = resp.key;
  const url = `${trimSlash(base)}/browse/${key}`;
  writeState(changeDir, { key, url, type: issuetype, status: 'To Do', summary, ...(a.epic && !isEpic ? { epicKey: a.epic } : {}), updatedAt: new Date().toISOString() });
  if (!isEpic) linkKeyIntoStory(changeDir, key);
  console.log(`\n  created ${key}   (${url})`);
  process.exit(0);
}

main();

#!/usr/bin/env node
/**
 * Forge Confluence sync — Phase 4.
 *
 * Content authority stays in the REPO. We publish a work order's story.md to a
 * Confluence page for review, record what we published, and read back approval.
 *
 *   publish        render story.md → Confluence storage, create/update the page,
 *                  record <changeDir>/.forge/confluence.json (publishedHash, approved:false).
 *                  Re-publishing a changed doc clears the `approved` label (strict re-approval).
 *   check          read the page's labels; approved = labels include `approved`.
 *   read-comments  fetch page comments so the agent can revise from reviewer feedback.
 *
 * Offline/CI: --result-file ingests a captured API response; --dry-run prints calls.
 * Env: CONFLUENCE_TOKEN (+ CONFLUENCE_EMAIL for Atlassian Cloud basic auth),
 *      CONFLUENCE_BASE_URL (overrides connections.yaml).
 *
 * NOTE: markdown→storage here is a minimal converter (headings/lists/bold/code/paragraphs);
 * a proper converter is a hardening step, same as the JIRA→ADF conversion in Phase 5.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { readConnections } from './lib/connections.mjs';
import { confluenceStatePath, readConfluenceState, hashDoc } from './lib/confluence.mjs';

function parseArgs(argv) {
  const a = { action: argv[2], root: process.cwd(), dryRun: false, doc: 'story.md' };
  for (let i = 3; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--workorder' || x === '--change') a.workorder = argv[++i];
    else if (x === '--root') a.root = path.resolve(argv[++i]);
    else if (x === '--doc') a.doc = argv[++i];
    else if (x === '--result-file') a.resultFile = path.resolve(argv[++i]);
    else if (x === '--dry-run') a.dryRun = true;
    else if (x === '-h' || x === '--help') a.help = true;
  }
  return a;
}

const trimSlash = (s) => s.replace(/\/$/, '');

function authHeader() {
  const token = process.env.CONFLUENCE_TOKEN;
  if (!token) return null;
  const email = process.env.CONFLUENCE_EMAIL;
  return email ? 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64') : `Bearer ${token}`;
}

function mdToStorage(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push('</ul>'); list = null; } };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    const li = line.match(/^\s*[-*]\s+(.+)$/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); }
    else if (li) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(li[1])}</li>`); }
    else if (!line.trim()) { closeList(); }
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  }
  closeList();
  return out.join('\n');
}

function storyTitle(changeDir, wo) {
  const p = path.join(changeDir, 'story.md');
  const t = existsSync(p) ? (readFileSync(p, 'utf8').match(/^#\s+(?:Work Order:\s*)?(.+)$/m) || [])[1] : null;
  return `[${wo}] ${(t && t.trim()) || wo}`;
}

function writeState(changeDir, state) {
  const p = confluenceStatePath(changeDir);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2) + '\n');
  return p;
}

function labelsFromResponse(raw) {
  // Confluence labels API: { results: [ { name, label? } ] }; tolerate {labels:[...]}/plain strings.
  const arr = raw.results || raw.labels || raw || [];
  return arr.map((l) => (typeof l === 'string' ? l : l.name || l.label)).filter(Boolean);
}

function commentsFromResponse(raw) {
  const arr = raw.results || raw.comments || [];
  return arr.map((c) => ({
    author: c.author || c.version?.by?.displayName || 'reviewer',
    text: c.text || c.body?.storage?.value || c.body?.view?.value || '',
  }));
}

async function api(method, url, body) {
  const auth = authHeader();
  const res = await fetch(url, {
    method,
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function main() {
  const a = parseArgs(process.argv);
  const actions = ['publish', 'check', 'read-comments'];
  if (a.help || !actions.includes(a.action) || !a.workorder) {
    console.error(`Usage: node openspec/forge/sync-confluence.mjs <${actions.join('|')}> --workorder <id> [--root <p>] [--doc story.md] [--result-file <json>] [--dry-run]`);
    process.exit(a.help ? 0 : 2);
  }
  const root = a.root;
  const changeDir = path.join(root, 'openspec', 'changes', a.workorder);
  if (!existsSync(changeDir)) { console.error(`change not found: ${changeDir}`); process.exit(1); }

  const conn = readConnections(root);
  const base = process.env.CONFLUENCE_BASE_URL || conn.confluence?.baseUrl || 'https://your-org.atlassian.net/wiki';
  const space = conn.confluence?.space || 'FORGE';
  const title = storyTitle(changeDir, a.workorder);
  const docPath = path.join(changeDir, a.doc);

  console.log(`\nForge Confluence ${a.action} — work order ${a.workorder}`);
  console.log(`  base:  ${base}`);
  console.log(`  space: ${space}`);
  console.log(`  title: ${title}`);

  if (a.action === 'publish') {
    if (!existsSync(docPath)) { console.error(`  doc not found: ${docPath}`); process.exit(1); }
    const md = readFileSync(docPath, 'utf8');
    const storage = mdToStorage(md);
    const hash = hashDoc(changeDir, a.doc);
    const prev = readConfluenceState(changeDir) || {};
    const create = !prev.pageId;
    const url = create ? `${trimSlash(base)}/rest/api/content` : `${trimSlash(base)}/rest/api/content/${prev.pageId}`;

    if (a.dryRun || !authHeader()) {
      console.log(`\n  [plan] ${create ? 'POST' : 'PUT'} ${url}   (space=${space})`);
      console.log('  [plan] storage preview:');
      storage.split('\n').slice(0, 4).forEach((l) => console.log(`         ${l}`));
      console.log(`  [plan] remove label 'approved' (strict re-approval)`);
      const state = { pageId: prev.pageId || '(pending)', url: prev.url || `${trimSlash(base)}/spaces/${space}`, title, doc: a.doc, publishedHash: hash, approved: false, publishedAt: new Date().toISOString() };
      console.log(`\n  wrote ${writeState(changeDir, state)}  (publishedHash ${hash}, approved cleared)`);
      process.exit(0);
    }

    // Live create/update + clear the approved label
    const payload = create
      ? { type: 'page', title, space: { key: space }, body: { storage: { value: storage, representation: 'storage' } } }
      : { id: prev.pageId, type: 'page', title, version: { number: (prev.version || 1) + 1 }, body: { storage: { value: storage, representation: 'storage' } } };
    const resp = await api(create ? 'POST' : 'PUT', url, payload);
    const pageId = resp.id;
    try { await fetch(`${trimSlash(base)}/rest/api/content/${pageId}/label/approved`, { method: 'DELETE', headers: { Authorization: authHeader() } }); } catch { /* label may not exist */ }
    const state = { pageId, url: `${trimSlash(base)}${resp._links?.webui || ''}`, title, doc: a.doc, version: resp.version?.number || 1, publishedHash: hash, approved: false, publishedAt: new Date().toISOString() };
    console.log(`\n  published page ${pageId}`);
    console.log(`  wrote ${writeState(changeDir, state)}`);
    process.exit(0);
  }

  // check / read-comments both read from the page (or a --result-file mock)
  const state = readConfluenceState(changeDir) || { title, doc: a.doc };

  if (a.action === 'check') {
    let raw;
    if (a.resultFile) raw = JSON.parse(readFileSync(a.resultFile, 'utf8'));
    else if (a.dryRun || !authHeader()) {
      console.log(`\n  [plan] GET ${trimSlash(base)}/rest/api/content/${state.pageId || '<pageId>'}/label`);
      process.exit(0);
    } else raw = await api('GET', `${trimSlash(base)}/rest/api/content/${state.pageId}/label`);
    const labels = labelsFromResponse(raw);
    const approved = labels.includes('approved');
    const next = { ...state, approved, labels, checkedAt: new Date().toISOString() };
    console.log(`\n  labels: [${labels.join(', ')}]`);
    console.log(`  approved: ${approved}`);
    console.log(`  wrote ${writeState(changeDir, next)}`);
    process.exit(0);
  }

  if (a.action === 'read-comments') {
    let raw;
    if (a.resultFile) raw = JSON.parse(readFileSync(a.resultFile, 'utf8'));
    else if (a.dryRun || !authHeader()) {
      console.log(`\n  [plan] GET ${trimSlash(base)}/rest/api/content/${state.pageId || '<pageId>'}/child/comment?expand=body.storage`);
      process.exit(0);
    } else raw = await api('GET', `${trimSlash(base)}/rest/api/content/${state.pageId}/child/comment?expand=body.storage`);
    const comments = commentsFromResponse(raw);
    console.log(`\n  ${comments.length} reviewer comment(s):`);
    comments.forEach((c, i) => console.log(`   ${i + 1}. ${c.author}: ${c.text.replace(/<[^>]+>/g, '').trim()}`));
    console.log('\n  → fold this feedback into the repo doc, then re-publish (clears approval).');
    process.exit(0);
  }
}

main();

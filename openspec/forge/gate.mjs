#!/usr/bin/env node
/**
 * Forge gate — Phase 1 skeleton.
 *
 * Runs the checks that decide whether a work order may proceed / merge.
 * On GitHub Free the gate is ADVISORY: it reports pass/fail and exits non-zero
 * on blocking issues, but a human still makes the merge decision.
 *
 * Phase 1 checks: change exists + required artifacts present + `openspec validate`
 * + RTM presence (warn). Later phases push more checks (SonarQube quality gate,
 * Confluence approval, JIRA sync, compliance controls) — see openspec/forge/DESIGN.md.
 *
 * Usage: node openspec/forge/gate.mjs --change <id> [--root <path>] [--json]
 * Env:   OPENSPEC_BIN  How to invoke the CLI (default "openspec"). Accepts a
 *                      single path ("/abs/bin/openspec.js") or a command with
 *                      leading args ("node /abs/bin/openspec.js").
 */
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readSonarResult } from './lib/sonar.mjs';
import { readConfluenceState, hashDoc } from './lib/confluence.mjs';
import { readJiraState } from './lib/jira.mjs';
import { loadCatalogs, collectTaggedControls } from './lib/controls.mjs';

const LEVEL = { PASS: 'pass', FAIL: 'fail', WARN: 'warn', SKIP: 'skip' };
const ICON = { pass: '✓', fail: '✗', warn: '⚠', skip: '·' };

function parseArgs(argv) {
  const args = { root: process.cwd(), json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--change') args.change = argv[++i];
    else if (a === '--root') args.root = path.resolve(argv[++i]);
    else if (a === '--pr') args.pr = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '-h' || a === '--help') args.help = true;
  }
  return args;
}

function listMarkdownRecursive(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdownRecursive(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function resolveBin() {
  const tokens = (process.env.OPENSPEC_BIN || 'openspec').trim().split(/\s+/);
  return { cmd: tokens[0], pre: tokens.slice(1) };
}

function runValidate(root, change) {
  const { cmd, pre } = resolveBin();
  const res = spawnSync(cmd, [...pre, 'validate', change, '--json'], { cwd: root, encoding: 'utf8' });
  if (res.error) return { ok: false, detail: `could not run openspec (${cmd}): ${res.error.message}` };
  let report = null;
  try { report = JSON.parse(res.stdout); } catch { /* non-JSON output */ }
  const item = report?.items?.[0];
  if (!item) {
    const tail = (res.stderr || res.stdout || '').trim().split('\n').slice(-2).join(' ');
    return { ok: res.status === 0, detail: tail || `exit ${res.status}` };
  }
  if (item.valid) return { ok: true, detail: 'delta specs valid' };
  const errs = (item.issues || []).filter((i) => i.level === 'ERROR').map((e) => `${e.path}: ${e.message}`);
  return { ok: false, detail: errs.join('; ') || 'invalid' };
}

/** Each check: { id, phase, severity?, run(ctx) -> { level, detail } }. severity 'warn' never blocks. */
const checks = [
  {
    id: 'change-exists', phase: 1,
    run: ({ changeDir }) =>
      existsSync(changeDir)
        ? { level: LEVEL.PASS, detail: changeDir }
        : { level: LEVEL.FAIL, detail: `change directory not found: ${changeDir}` },
  },
  {
    id: 'artifacts-present', phase: 1,
    run: ({ changeDir }) => {
      if (!existsSync(changeDir)) return { level: LEVEL.FAIL, detail: 'no change dir' };
      const has = (f) => existsSync(path.join(changeDir, f));
      const specFiles = listMarkdownRecursive(path.join(changeDir, 'specs'));
      const missing = [];
      if (!has('story.md')) missing.push('story.md');
      if (!has('tasks.md')) missing.push('tasks.md');
      if (!has('test-cases.md')) missing.push('test-cases.md');
      if (specFiles.length === 0) missing.push('specs/**/*.md');
      return missing.length
        ? { level: LEVEL.FAIL, detail: `missing: ${missing.join(', ')}` }
        : { level: LEVEL.PASS, detail: `story.md, tasks.md, test-cases.md, ${specFiles.length} spec file(s)` };
    },
  },
  {
    id: 'openspec-validate', phase: 1,
    run: ({ root, change }) => {
      const r = runValidate(root, change);
      return { level: r.ok ? LEVEL.PASS : LEVEL.FAIL, detail: r.detail };
    },
  },
  {
    id: 'rtm-present', phase: 1, severity: 'warn',
    run: ({ changeDir, root }) => {
      const found = [
        path.join(changeDir, 'rtm.md'),
        path.join(root, 'openspec', 'forge', 'rtm.md'),
      ].find(existsSync);
      return found
        ? { level: LEVEL.PASS, detail: found }
        : { level: LEVEL.WARN, detail: 'no rtm.md yet (Epic-level RTM lands in a later phase)' };
    },
  },
  // Wired in later phases; listed here so the gate report shows the full picture.
  {
    id: 'sonar-quality-gate', phase: 3,
    run: ({ changeDir }) => {
      const r = readSonarResult(changeDir);
      if (!r) return { level: LEVEL.SKIP, detail: 'no scan yet — run `forge scan --workorder <id>`' };
      if (r.status === 'OK') return { level: LEVEL.PASS, detail: `quality gate OK (${r.projectKey})` };
      if (r.status === 'ERROR') {
        const failed = (r.conditions || []).filter((c) => c.status === 'ERROR').map((c) => c.metric).join(', ');
        return { level: LEVEL.FAIL, detail: `quality gate FAILED — ${failed || 'see dashboard'}` };
      }
      return { level: LEVEL.WARN, detail: `quality gate ${r.status} (${r.projectKey})` };
    },
  },
  {
    id: 'confluence-approval', phase: 4,
    run: ({ changeDir }) => {
      // The plan (story) AND the QA test cases must both be signed off before any build.
      const required = ['story.md', 'test-cases.md'];
      const notPublished = [], stale = [], pending = [], approved = [];
      for (const doc of required) {
        const st = readConfluenceState(changeDir, doc);
        if (!st) { notPublished.push(doc); continue; }
        const current = hashDoc(changeDir, st.doc || doc);
        if (current && st.publishedHash && current !== st.publishedHash) { stale.push(doc); continue; }
        if (st.approved !== true) { pending.push(doc); continue; }
        approved.push(doc);
      }
      if (notPublished.length === required.length)
        return { level: LEVEL.SKIP, detail: 'not published — run `forge sync confluence publish --workorder <id> --doc <doc>`' };
      if (stale.length) return { level: LEVEL.FAIL, detail: `changed since publish — re-publish + re-approve: ${stale.join(', ')} (strict re-approval)` };
      if (notPublished.length) return { level: LEVEL.FAIL, detail: `not published yet: ${notPublished.join(', ')}` };
      if (pending.length) return { level: LEVEL.FAIL, detail: `awaiting Confluence approval: ${pending.join(', ')}` };
      return { level: LEVEL.PASS, detail: `approved in Confluence: ${approved.join(', ')}` };
    },
  },
  {
    id: 'jira-sync', phase: 5, severity: 'warn',
    run: ({ changeDir }) => {
      const j = readJiraState(changeDir);
      if (!j || !j.key) return { level: LEVEL.WARN, detail: 'no JIRA Story linked — run `forge sync jira story --workorder <id>`' };
      return { level: LEVEL.PASS, detail: `linked to ${j.key}${j.status ? ` (${j.status})` : ''}` };
    },
  },
  {
    id: 'compliance-controls', phase: 6,
    run: ({ changeDir, root }) => {
      const tagged = collectTaggedControls(changeDir);
      if (tagged.length === 0) return { level: LEVEL.WARN, detail: 'no compliance controls tagged — confirm none apply' };
      const cat = loadCatalogs(root);
      const sonarOk = readSonarResult(changeDir)?.status === 'OK';
      const approved = readConfluenceState(changeDir)?.approved === true;
      const unmet = [];
      const unknown = [];
      for (const id of tagged) {
        const c = cat.byId.get(id);
        if (!c) { unknown.push(id); continue; }
        const satisfied = c.class === 'auto' ? sonarOk : c.class === 'attested' ? approved : true;
        if (!satisfied) unmet.push({ id, severity: c.severity || 'error', class: c.class });
      }
      const blocking = unmet.filter((u) => u.severity !== 'warning');
      if (blocking.length) return { level: LEVEL.FAIL, detail: `unsatisfied: ${blocking.map((u) => `${u.id} (${u.class})`).join(', ')}` };
      const advisories = [...unmet.map((u) => u.id), ...unknown.map((u) => `${u} (unknown)`)];
      if (advisories.length) return { level: LEVEL.WARN, detail: `advisory: ${advisories.join(', ')}` };
      return { level: LEVEL.PASS, detail: `${tagged.length} control(s) satisfied: ${tagged.join(', ')}` };
    },
  },
];

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.change) {
    console.error('Usage: node openspec/forge/gate.mjs --change <id> [--root <path>] [--json]');
    process.exit(args.help ? 0 : 2);
  }
  const root = args.root;
  const changeDir = path.join(root, 'openspec', 'changes', args.change);
  const connectionsPath = path.join(root, 'openspec', 'forge', 'connections.yaml');
  const ctx = { root, change: args.change, changeDir };

  const results = checks.map((c) => ({
    id: c.id,
    phase: c.phase,
    severity: c.severity || 'error',
    ...c.run(ctx),
  }));
  const blocking = results.filter((r) => r.level === LEVEL.FAIL && r.severity === 'error');

  if (args.json) {
    console.log(JSON.stringify({
      change: args.change,
      root,
      connections: existsSync(connectionsPath) ? 'found' : 'missing',
      passed: blocking.length === 0,
      checks: results,
    }, null, 2));
  } else {
    console.log(`\nForge gate — change: ${args.change}\n`);
    for (const r of results) {
      const tag = r.severity === 'warn' && r.level === LEVEL.WARN ? ' (advisory)' : '';
      console.log(`  ${ICON[r.level] || '?'} ${r.id.padEnd(22)} ${r.detail}${tag}`);
    }
    console.log(`\nconnections.yaml: ${existsSync(connectionsPath) ? 'found' : 'missing'}`);
    console.log(
      blocking.length === 0
        ? '\nGATE: PASS  (advisory — on GitHub Free the merge is a human decision)\n'
        : `\nGATE: FAIL  — ${blocking.length} blocking issue(s)\n`
    );
  }
  process.exit(blocking.length === 0 ? 0 : 1);
}

main();

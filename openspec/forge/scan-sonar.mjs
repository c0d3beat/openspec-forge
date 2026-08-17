#!/usr/bin/env node
/**
 * Forge SonarQube scan — Phase 3 (Community Edition).
 *
 * Scans a work order's branch into an EPHEMERAL per-PR project
 * (`<projectBase>-pr-<n>`), reads the quality gate via the Web API, and writes a
 * normalized result to `<changeDir>/.forge/sonar.json` (read by gate.mjs and
 * sync-github.mjs). CE has no branch/PR analysis, so each PR gets a throwaway
 * project; `--cleanup` deletes it when the PR closes.
 *
 * Usage:
 *   node openspec/forge/scan-sonar.mjs --workorder <id> [--root <p>] [--pr <n>]
 *        [--dry-run]                          # print the scanner cmd + API calls, do nothing
 *        [--result-file <project_status.json>] # offline/CI: skip the scan, ingest a captured result
 *        [--cleanup]                          # delete the ephemeral project
 *
 * Env: SONAR_TOKEN (required for a live scan/cleanup), SONAR_HOST_URL (overrides connections.yaml).
 *
 * NOTE: the live path fetches project_status by projectKey right after the scan.
 * A hardening step (later) is to poll `.scannerwork/report-task.txt` → /api/ce/task
 * until the analysis is processed before reading the gate.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readConnections } from './lib/connections.mjs';
import { sonarResultPath } from './lib/sonar.mjs';

function parseArgs(argv) {
  const a = { root: process.cwd(), dryRun: false, cleanup: false };
  for (let i = 2; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--workorder' || x === '--change') a.workorder = argv[++i];
    else if (x === '--root') a.root = path.resolve(argv[++i]);
    else if (x === '--pr') a.pr = argv[++i];
    else if (x === '--result-file') a.resultFile = path.resolve(argv[++i]);
    else if (x === '--dry-run') a.dryRun = true;
    else if (x === '--cleanup') a.cleanup = true;
    else if (x === '-h' || x === '--help') a.help = true;
  }
  return a;
}

const trimSlash = (s) => s.replace(/\/$/, '');
const commandExists = (bin) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' }).status === 0;
const authHeader = (token) => 'Basic ' + Buffer.from(`${token}:`).toString('base64');

function normalize(raw, projectKey, host, pr) {
  const ps = raw.projectStatus || raw;
  const conditions = (ps.conditions || []).map((c) => ({
    metric: c.metricKey || c.metric,
    status: c.status,
    actual: c.actualValue ?? c.actual,
    ...(c.errorThreshold !== undefined ? { threshold: c.errorThreshold } : {}),
  }));
  const dashboardUrl = host
    ? `${trimSlash(host)}/dashboard?id=${encodeURIComponent(projectKey)}${pr ? `&pullRequest=${encodeURIComponent(pr)}` : ''}`
    : undefined;
  return { projectKey, status: ps.status || 'NONE', conditions, ...(dashboardUrl ? { dashboardUrl } : {}), scannedAt: new Date().toISOString() };
}

function writeResult(changeDir, result) {
  const p = sonarResultPath(changeDir);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(result, null, 2) + '\n');
  return p;
}

function summarize(r) {
  console.log(`  quality gate: ${r.status}  (${r.projectKey})`);
  for (const c of (r.conditions || []).filter((c) => c.status && c.status !== 'OK')) {
    console.log(`    ${c.status}: ${c.metric} = ${c.actual}${c.threshold !== undefined ? ` (threshold ${c.threshold})` : ''}`);
  }
  if (r.dashboardUrl) console.log(`    dashboard: ${r.dashboardUrl}`);
}

async function fetchJson(url, token) {
  const res = await fetch(url, { headers: { Authorization: authHeader(token) } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function main() {
  const a = parseArgs(process.argv);
  if (a.help || !a.workorder) {
    console.error('Usage: node openspec/forge/scan-sonar.mjs --workorder <id> [--root <p>] [--pr <n>] [--result-file <json>] [--dry-run] [--cleanup]');
    process.exit(a.help ? 0 : 2);
  }
  const root = a.root;
  const changeDir = path.join(root, 'openspec', 'changes', a.workorder);
  if (!existsSync(changeDir)) { console.error(`change not found: ${changeDir}`); process.exit(1); }

  const conn = readConnections(root);
  const host = process.env.SONAR_HOST_URL || conn.sonarqube?.host || 'http://localhost:9000';
  const projectBase = conn.sonarqube?.projectBase || 'app';
  const projectKey = `${projectBase}-pr-${a.pr || a.workorder}`;
  const token = process.env.SONAR_TOKEN;

  console.log(`\nForge SonarQube scan — work order ${a.workorder}`);
  console.log(`  host:       ${host}`);
  console.log(`  projectKey: ${projectKey}   (ephemeral — Community Edition)`);

  // Cleanup: delete the ephemeral project (on PR close)
  if (a.cleanup) {
    const url = `${trimSlash(host)}/api/projects/delete`;
    if (a.dryRun || !token) {
      console.log(`\n  [plan] POST ${url}  project=${projectKey}${!token && !a.dryRun ? '  (SONAR_TOKEN not set)' : ''}`);
      process.exit(0);
    }
    const res = await fetch(url, { method: 'POST', headers: { Authorization: authHeader(token), 'Content-Type': 'application/x-www-form-urlencoded' }, body: `project=${encodeURIComponent(projectKey)}` });
    console.log(res.ok ? `  deleted ephemeral project ${projectKey}` : `  delete failed: ${res.status}`);
    process.exit(res.ok ? 0 : 1);
  }

  // Offline / CI ingest: normalize a captured project_status response
  if (a.resultFile) {
    const raw = JSON.parse(readFileSync(a.resultFile, 'utf8'));
    const result = normalize(raw, projectKey, host, a.pr);
    const p = writeResult(changeDir, result);
    console.log(`\n  ingested ${path.basename(a.resultFile)} → ${p}`);
    summarize(result);
    process.exit(0);
  }

  const scannerArgs = [
    `-Dsonar.host.url=${host}`,
    `-Dsonar.projectKey=${projectKey}`,
    `-Dsonar.sources=.`,
    ...(token ? [`-Dsonar.token=${token}`] : []),
  ];

  if (a.dryRun) {
    console.log('\n  [plan] scan + read quality gate:');
    console.log(`  [plan] sonar-scanner ${scannerArgs.map((s) => (s.startsWith('-Dsonar.token') ? '-Dsonar.token=***' : s)).join(' ')}`);
    console.log(`  [plan] GET ${trimSlash(host)}/api/qualitygates/project_status?projectKey=${projectKey}`);
    console.log(`  [plan] write ${sonarResultPath(changeDir)}`);
    process.exit(0);
  }

  // Live scan
  if (!token) { console.error('\n✗ SONAR_TOKEN not set. Set it (and SONAR_HOST_URL if needed), or use --result-file for offline ingest.'); process.exit(1); }
  if (!commandExists('sonar-scanner')) { console.error('\n✗ sonar-scanner not on PATH. Install it, or use --result-file.'); process.exit(1); }
  console.log('\nRunning sonar-scanner…');
  const scan = spawnSync('sonar-scanner', scannerArgs, { cwd: root, encoding: 'utf8' });
  if (scan.stdout) process.stdout.write(scan.stdout.split('\n').slice(-8).join('\n') + '\n');
  if (scan.status !== 0) { console.error('  sonar-scanner failed'); process.exit(1); }
  try {
    const raw = await fetchJson(`${trimSlash(host)}/api/qualitygates/project_status?projectKey=${encodeURIComponent(projectKey)}`, token);
    const result = normalize(raw, projectKey, host, a.pr);
    const p = writeResult(changeDir, result);
    console.log(`\n  wrote ${p}`);
    summarize(result);
    process.exit(result.status === 'ERROR' ? 1 : 0);
  } catch (e) {
    console.error(`  could not read quality gate: ${e.message}`);
    process.exit(1);
  }
}

main();

#!/usr/bin/env node
/**
 * Forge doctor — Phase 8 readiness preflight.
 *
 * Reports the kit's configuration and whether each integration is LIVE-READY
 * (connections.yaml host + required env token + required CLI on PATH) or
 * OFFLINE-ONLY (works today via --result-file/--dry-run). Offline-safe: probes
 * no network unless `--check-connectivity`.
 *
 * Usage: node openspec/forge/doctor.mjs [--root <path>] [--check-connectivity]
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readConnections, connectionsPath } from './lib/connections.mjs';

function parseArgs(argv) {
  const a = { root: process.cwd(), connectivity: false };
  for (let i = 2; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--root') a.root = path.resolve(argv[++i]);
    else if (x === '--check-connectivity') a.connectivity = true;
    else if (x === '-h' || x === '--help') a.help = true;
  }
  return a;
}
const has = (bin) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' }).status === 0;
const envSet = (k) => Boolean(process.env[k] && process.env[k].trim());

async function reachable(url) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 3000);
    const r = await fetch(url, { signal: c.signal });
    clearTimeout(t);
    return `HTTP ${r.status}`;
  } catch (e) {
    return `unreachable (${e.name === 'AbortError' ? 'timeout' : e.code || e.message})`;
  }
}

async function main() {
  const a = parseArgs(process.argv);
  if (a.help) { console.error('Usage: node openspec/forge/doctor.mjs [--root <path>] [--check-connectivity]'); process.exit(0); }
  const conn = readConnections(a.root);
  console.log(`\nForge doctor — ${a.root}`);
  console.log(`  connections.yaml: ${existsSync(connectionsPath(a.root)) ? 'found' : 'MISSING'}`);

  const rows = [
    { name: 'GitHub', host: conn.github?.repo, token: 'GITHUB_TOKEN', cli: 'gh' },
    { name: 'SonarQube', host: process.env.SONAR_HOST_URL || conn.sonarqube?.host, token: 'SONAR_TOKEN', cli: 'sonar-scanner' },
    { name: 'JIRA', host: conn.jira?.baseUrl, token: 'JIRA_TOKEN', cli: null },
    { name: 'Confluence', host: conn.confluence?.baseUrl, token: 'CONFLUENCE_TOKEN', cli: null },
  ];

  console.log('\n  Integration   Config   Token     CLI               Status');
  console.log('  ' + '-'.repeat(58));
  for (const r of rows) {
    const cfg = r.host ? 'set' : '—';
    const tok = envSet(r.token) ? 'set' : 'missing';
    const cli = r.cli ? (has(r.cli) ? r.cli : `${r.cli} (absent)`) : 'n/a';
    const ready = Boolean(r.host) && envSet(r.token) && (!r.cli || has(r.cli));
    console.log(`  ${r.name.padEnd(12)}  ${cfg.padEnd(6)}  ${tok.padEnd(8)}  ${String(cli).padEnd(16)}  ${ready ? 'LIVE-READY' : 'offline-only'}`);
  }

  console.log(`\n  tools: node ${process.version}, git ${has('git') ? 'yes' : 'NO'}, openspec via "${process.env.OPENSPEC_BIN || 'openspec'}"`);

  if (a.connectivity) {
    console.log('\n  connectivity:');
    for (const r of rows) {
      if (r.host && /^https?:\/\//.test(r.host)) console.log(`    ${r.name.padEnd(12)} ${await reachable(r.host)}`);
    }
  } else {
    console.log('\n  (run with --check-connectivity to probe hosts)');
  }

  console.log('\n  Offline mode works today via --result-file/--dry-run. To go live: fill .env (see .env.example),');
  console.log('  install the CLIs shown "absent", and drop the offline flags.\n');
  process.exit(0);
}

main();

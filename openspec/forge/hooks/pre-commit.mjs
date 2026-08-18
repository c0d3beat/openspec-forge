#!/usr/bin/env node
/**
 * Forge pre-commit enforcement. On a `forge/<key>` branch it resolves the work order
 * and blocks the commit if `forge gate` fails (e.g. Confluence not approved).
 * Non-forge branches, or branches it can't map to a change, are never blocked.
 * (Bypass in emergencies with `git commit --no-verify`.)
 *
 * Needs `openspec` on PATH (or OPENSPEC_BIN) for the gate's openspec-validate check.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // openspec/forge/hooks
const git = (args) => spawnSync('git', args, { encoding: 'utf8' }).stdout.trim();

const root = git(['rev-parse', '--show-toplevel']);
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (!root || !branch.startsWith('forge/')) process.exit(0);

const key = branch.slice('forge/'.length);
const changesDir = path.join(root, 'openspec', 'changes');
function resolveWorkOrder() {
  if (existsSync(path.join(changesDir, key))) return key;
  if (!existsSync(changesDir)) return null;
  for (const d of readdirSync(changesDir)) {
    const jf = path.join(changesDir, d, '.forge', 'jira.json');
    if (existsSync(jf)) { try { if (JSON.parse(readFileSync(jf, 'utf8')).key === key) return d; } catch { /* ignore */ } }
  }
  return null;
}

const wo = resolveWorkOrder();
if (!wo) process.exit(0); // can't map branch → change; don't block

const r = spawnSync(process.execPath, [path.join(HERE, '..', 'gate.mjs'), '--change', wo, '--root', root], { encoding: 'utf8' });
if (r.status !== 0) {
  process.stderr.write((r.stdout || '') + (r.stderr || ''));
  console.error(`\n✗ forge gate failed for '${wo}' — commit blocked.`);
  console.error(`  Get Confluence approval / fix the issues, then retry. (emergency bypass: git commit --no-verify)\n`);
  process.exit(1);
}
process.exit(0);

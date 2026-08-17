#!/usr/bin/env node
/**
 * Forge GitHub sync — Phase 2.
 *
 * Opens (or refreshes) the pull request for ONE work order: gate → branch →
 * commit → push → PR. On GitHub Free the PR is where human review and the
 * (Phase 3) SonarQube status live; nothing here hard-blocks a merge.
 *
 * Usage:
 *   node openspec/forge/sync-github.mjs pr --workorder <id> [--root <path>]
 *        [--key <JIRA-KEY>] [--base <branch>] [--dry-run] [--skip-gate] [--no-commit]
 *
 * Degrades gracefully: if `gh` or an `origin` remote is missing (or --dry-run is
 * set), the push/PR steps are PLANNED (printed) instead of executed, while the
 * local branch/commit still run. Env: OPENSPEC_BIN is inherited by the gate.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConnections } from './lib/connections.mjs';
import { readSonarResult } from './lib/sonar.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const a = { action: argv[2], root: process.cwd(), base: 'main', dryRun: false, skipGate: false, commit: true };
  for (let i = 3; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--workorder' || x === '--change') a.workorder = argv[++i];
    else if (x === '--root') a.root = path.resolve(argv[++i]);
    else if (x === '--key') a.key = argv[++i];
    else if (x === '--base') a.base = argv[++i];
    else if (x === '--pr') a.pr = argv[++i];
    else if (x === '--scan') a.scan = true;
    else if (x === '--title') a.title = argv[++i];
    else if (x === '--dry-run') a.dryRun = true;
    else if (x === '--skip-gate') a.skipGate = true;
    else if (x === '--no-commit') a.commit = false;
    else if (x === '-h' || x === '--help') a.help = true;
  }
  return a;
}

function commandExists(bin) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(finder, [bin], { encoding: 'utf8' }).status === 0;
}

function git(args, { cwd, dry, capture } = {}) {
  if (dry) { console.log(`  [plan] git ${args.join(' ')}`); return { status: 0, stdout: '' }; }
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (!capture && r.status !== 0 && (r.stderr || '').trim()) console.error(`  ${r.stderr.trim()}`);
  return r;
}

function readStory(changeDir) {
  const p = path.join(changeDir, 'story.md');
  if (!existsSync(p)) return {};
  const c = readFileSync(p, 'utf8');
  const title = (c.match(/^#\s+Work Order:\s*(.+)$/m) || c.match(/^#\s+(.+)$/m) || [])[1];
  const jira = (c.match(/JIRA:\s*([A-Z][A-Z0-9]+-\d+)/) || [])[1];
  return { title: title && title.trim(), jira };
}

function runGate(root, wo) {
  // gate.mjs inherits OPENSPEC_BIN from our environment.
  const r = spawnSync(process.execPath, [path.join(HERE, 'gate.mjs'), '--change', wo, '--root', root], { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  if (r.stderr) process.stderr.write(r.stderr);
  return r.status === 0;
}

function main() {
  const a = parseArgs(process.argv);
  if (a.help || a.action !== 'pr' || !a.workorder) {
    console.error('Usage: node openspec/forge/sync-github.mjs pr --workorder <id> [--root <path>] [--key KEY] [--base main] [--dry-run] [--skip-gate] [--no-commit]');
    process.exit(a.help ? 0 : 2);
  }
  const root = a.root;
  const changeDir = path.join(root, 'openspec', 'changes', a.workorder);
  if (!existsSync(changeDir)) { console.error(`change not found: ${changeDir}`); process.exit(1); }

  const conn = readConnections(root);
  const prefix = conn.github?.branchPrefix || 'forge/';
  const repo = conn.github?.repo || '(set github.repo in connections.yaml)';
  const story = readStory(changeDir);
  const key = a.key || story.jira || a.workorder;
  const branch = `${prefix}${key}`;
  const title = a.title || story.title || `Work order ${key}`;

  console.log(`\nForge PR — work order ${a.workorder}`);
  console.log(`  repo:   ${repo}`);
  console.log(`  branch: ${branch}   (base: ${a.base})`);
  console.log(`  title:  ${title}`);

  // 0. Optional scan first (writes .forge/sonar.json for the gate + PR body to read)
  if (a.scan) {
    console.log('\nScanning (SonarQube)…');
    const s = spawnSync(process.execPath, [path.join(HERE, 'scan-sonar.mjs'), '--workorder', a.workorder, '--root', root, ...(a.pr ? ['--pr', a.pr] : [])], { stdio: 'inherit' });
    if (s.status !== 0) { console.error('\n✗ Scan failed — not opening a PR.'); process.exit(1); }
  }

  // 1. Gate (don't open a PR for a failing work order)
  if (!a.skipGate) {
    console.log('\nRunning gate…');
    if (!runGate(root, a.workorder)) {
      console.error('\n✗ Gate failed — not opening a PR. Fix the blocking issues first.');
      process.exit(1);
    }
  } else {
    console.log('\nSkipping gate (--skip-gate).');
  }

  // 2. Git repo present?
  const insideRepo = git(['rev-parse', '--is-inside-work-tree'], { cwd: root, capture: true }).status === 0;
  if (!insideRepo && !a.dryRun) {
    console.error(`\n✗ ${root} is not a git repository. Run 'git init' and add a GitHub 'origin' remote first.`);
    process.exit(1);
  }

  // 3. Branch
  console.log('\nBranch + commit:');
  const branchExists = git(['rev-parse', '--verify', branch], { cwd: root, capture: true }).status === 0;
  const sw = git(branchExists ? ['switch', branch] : ['switch', '-c', branch], { cwd: root, dry: a.dryRun });
  if (!a.dryRun) console.log(sw.status === 0 ? `  ${branchExists ? 'switched to' : 'created'} ${branch}` : `  ✗ could not switch to ${branch}`);

  // 4. Commit
  if (a.commit) {
    const dirty = a.dryRun ? true : ((git(['status', '--porcelain'], { cwd: root, capture: true }).stdout || '').trim().length > 0);
    if (dirty) {
      git(['add', '-A'], { cwd: root, dry: a.dryRun });
      const ci = git(['commit', '-m', `feat(${key}): ${title}`], { cwd: root, dry: a.dryRun, capture: true });
      if (!a.dryRun) console.log(ci.status === 0 ? `  committed: feat(${key}): ${title}` : `  ✗ commit failed${(ci.stderr || '').trim() ? ': ' + ci.stderr.trim() : ''}`);
    } else {
      console.log('  (nothing to commit — working tree clean)');
    }
  }

  // 5. Push + PR (need an origin remote and gh)
  const hasRemote = a.dryRun ? false : ((git(['remote'], { cwd: root, capture: true }).stdout || '').split(/\s+/).includes('origin'));
  const hasGh = commandExists('gh');
  const sonar = readSonarResult(changeDir);
  const sonarBlock = sonar
    ? `## SonarQube — quality gate ${sonar.status}\nProject: ${sonar.projectKey}` +
      (sonar.dashboardUrl ? `\nDashboard: ${sonar.dashboardUrl}` : '') +
      (sonar.conditions || []).filter((c) => c.status && c.status !== 'OK').map((c) => `\n- ${c.status}: ${c.metric} = ${c.actual}`).join('')
    : '## SonarQube\n(no scan result — run `forge scan`)';
  const body = `Work order: ${a.workorder}\nStory: ${title}\nJIRA: ${key}\n\n${sonarBlock}`;
  const ghStatusState = sonar ? (sonar.status === 'OK' ? 'success' : sonar.status === 'ERROR' ? 'failure' : 'pending') : 'pending';
  const pushArgs = ['push', '-u', 'origin', branch];
  const prArgs = ['pr', 'create', '--base', a.base, '--head', branch, '--title', title, '--body', body];

  console.log('\nPush + PR:');
  if (a.dryRun || !hasRemote || !hasGh) {
    if (!a.dryRun) {
      const reasons = [!hasRemote && 'no origin remote', !hasGh && 'gh not installed'].filter(Boolean).join(', ');
      console.log(`  (planned — ${reasons})`);
    }
    console.log(`  [plan] git ${pushArgs.join(' ')}`);
    console.log(`  [plan] gh ${prArgs.map((q) => (/\s/.test(q) ? JSON.stringify(q) : q)).join(' ')}`);
  } else {
    git(pushArgs, { cwd: root });
    const r = spawnSync('gh', prArgs, { cwd: root, encoding: 'utf8' });
    process.stdout.write(r.stdout || '');
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.status !== 0) { console.error('  gh pr create failed'); process.exit(1); }
  }

  console.log(`  [plan] gh api repos/${repo}/statuses/<sha> -f state=${ghStatusState} -f context="Sonar Quality Gate"   (advisory on Free)`);

  console.log('\n✓ Done. On GitHub Free, review + merge happen on the PR (a human decision).\n');
}

main();

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
import { readJiraState } from './lib/jira.mjs';

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
    else if (x === '--result-file') a.resultFile = path.resolve(argv[++i]);
    else if (x === '--assume-merged') a.assumeMerged = true;
    else if (x === '--force') a.force = true;
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

/** `forge start` — sync the work-order branch to the remote (the source of truth) BEFORE building. */
function runStart(a) {
  const root = a.root;
  const changeDir = path.join(root, 'openspec', 'changes', a.workorder);
  if (!existsSync(changeDir)) { console.error(`change not found: ${changeDir}`); process.exit(1); }
  const conn = readConnections(root);
  const prefix = conn.github?.branchPrefix || 'forge/';
  const base = a.base;
  const story = readStory(changeDir);
  const jira = readJiraState(changeDir);
  const branch = `${prefix}${a.key || jira?.key || story.jira || a.workorder}`;

  console.log(`\nForge start — work order ${a.workorder}`);
  console.log(`  branch: ${branch}   base: ${base}`);

  if (a.dryRun) {
    console.log('  [plan] git fetch origin');
    console.log(`  [plan] git switch -C ${branch} origin/${branch}   (if it exists on the remote) else origin/${base}`);
    return;
  }

  const insideRepo = git(['rev-parse', '--is-inside-work-tree'], { cwd: root, capture: true }).status === 0;
  if (!insideRepo) { console.error(`  ✗ ${root} is not a git repository.`); process.exit(1); }

  // Remote is the source of truth, but never silently destroy uncommitted local work.
  const dirty = (git(['status', '--porcelain'], { cwd: root, capture: true }).stdout || '').trim().length > 0;
  if (dirty && !a.force) {
    console.error('  ✗ uncommitted changes present — commit/stash them first, or pass --force to discard and match the remote.');
    process.exit(1);
  }

  const switchLocal = () => {
    const exists = git(['rev-parse', '--verify', branch], { cwd: root, capture: true }).status === 0;
    git(exists ? ['switch', branch] : ['switch', '-c', branch], { cwd: root });
  };

  const hasRemote = (git(['remote'], { cwd: root, capture: true }).stdout || '').split(/\s+/).includes('origin');
  if (!hasRemote) { console.log('  · no origin remote — using the local base (offline).'); switchLocal(); return; }

  if (git(['fetch', 'origin'], { cwd: root }).status !== 0) {
    console.log('  ⚠ git fetch failed (offline?) — using the local base.'); switchLocal(); return;
  }
  if (a.force && dirty) git(['reset', '--hard'], { cwd: root });

  const remoteWo = git(['rev-parse', '--verify', `origin/${branch}`], { cwd: root, capture: true }).status === 0;
  const startPoint = remoteWo ? `origin/${branch}` : `origin/${base}`;
  const sw = git(['switch', '-C', branch, startPoint], { cwd: root });
  if (sw.status !== 0) { console.error(`  ✗ could not align ${branch} to ${startPoint}`); process.exit(1); }
  console.log(`  ✓ ${branch} aligned to ${startPoint} (remote is the source of truth)`);
}

/** Resolve whether the work order's PR is merged: { merged: true|false|null, how }. */
async function prMergeState(a, { root, repo, branch }) {
  if (a.assumeMerged) return { merged: true, how: '--assume-merged (UNVERIFIED)' };
  if (a.resultFile) {
    const pr = JSON.parse(readFileSync(a.resultFile, 'utf8'));
    const merged = pr.merged === true || String(pr.state || '').toUpperCase() === 'MERGED' || !!pr.mergedAt || !!pr.merged_at;
    return { merged, how: `result-file (${path.basename(a.resultFile)})` };
  }
  if (commandExists('gh')) {
    const r = spawnSync('gh', ['pr', 'view', branch, '--json', 'state,mergedAt,url'], { cwd: root, encoding: 'utf8' });
    if (r.status === 0) {
      try { const pr = JSON.parse(r.stdout); return { merged: pr.state === 'MERGED' || !!pr.mergedAt, how: `gh (${pr.url || branch})` }; }
      catch { return { merged: null, how: 'gh (unparseable output)' }; }
    }
    return { merged: null, how: 'gh (no PR found for branch)' };
  }
  if (process.env.GITHUB_TOKEN && repo && repo.includes('/')) {
    const owner = repo.split('/')[0];
    const q = encodeURIComponent(`${owner}:${branch}`);
    const res = await fetch(`https://api.github.com/repos/${repo}/pulls?head=${q}&state=all`, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
    });
    if (res.ok) { const arr = await res.json(); const pr = Array.isArray(arr) ? arr[0] : null; return { merged: !!(pr && pr.merged_at), how: `REST (${pr?.html_url || branch})` }; }
    return { merged: null, how: `REST (HTTP ${res.status})` };
  }
  return { merged: null, how: 'no verifier (no gh / GITHUB_TOKEN)' };
}

/** `forge done` — verify the PR is actually merged, then transition the JIRA story to Done. */
async function runDone(a) {
  const root = a.root;
  const changeDir = path.join(root, 'openspec', 'changes', a.workorder);
  if (!existsSync(changeDir)) { console.error(`change not found: ${changeDir}`); process.exit(1); }
  const conn = readConnections(root);
  const repo = conn.github?.repo;
  const prefix = conn.github?.branchPrefix || 'forge/';
  const story = readStory(changeDir);
  const jira = readJiraState(changeDir);
  const branch = `${prefix}${a.key || jira?.key || story.jira || a.workorder}`;

  console.log(`\nForge done — work order ${a.workorder}`);
  console.log(`  branch: ${branch}`);
  if (!jira?.key) { console.error('  ✗ no linked JIRA story (run `forge sync jira story` first) — nothing to mark Done'); process.exit(1); }

  if (a.dryRun) {
    console.log(`  [plan] verify PR ${branch} is MERGED (gh pr view / REST)`);
    console.log(`  [plan] if merged: sync-jira transition ${jira.key} -> Done`);
    return;
  }

  const { merged, how } = await prMergeState(a, { root, repo, branch });
  if (merged === true) {
    console.log(`  ✓ PR merged  [${how}] — setting JIRA ${jira.key} -> Done`);
    const jr = spawnSync(process.execPath, [path.join(HERE, 'sync-jira.mjs'), 'transition', '--workorder', a.workorder, '--to', 'Done', '--root', root], { stdio: 'inherit' });
    process.exit(jr.status ?? 0);
  }
  if (merged === false) {
    console.error(`  ✗ PR is NOT merged yet  [${how}] — NOT setting Done. Merge the PR, then re-run.`);
    process.exit(1);
  }
  console.error(`  ⚠ could not verify merge state  [${how}].`);
  console.error('    Fix: install `gh`, or set GITHUB_TOKEN + github.repo and re-run online;');
  console.error('    or pass --result-file <pr.json> (offline); or --assume-merged to override (unverified).');
  process.exit(2);
}

async function main() {
  const a = parseArgs(process.argv);
  if (a.help || !['pr', 'done', 'start'].includes(a.action) || !a.workorder) {
    console.error('Usage:\n  node openspec/forge/sync-github.mjs start --workorder <id> [--root <p>] [--base main] [--force] [--dry-run]\n  node openspec/forge/sync-github.mjs pr    --workorder <id> [--root <p>] [--key KEY] [--base main] [--dry-run] [--skip-gate] [--no-commit]\n  node openspec/forge/sync-github.mjs done  --workorder <id> [--root <p>] [--result-file <pr.json>] [--assume-merged] [--dry-run]');
    process.exit(a.help ? 0 : 2);
  }
  if (a.action === 'start') { runStart(a); return; }
  if (a.action === 'done') { await runDone(a); return; }
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

  // 5b. Branch is committed + pushed and the PR is open → move the JIRA story to "In Review".
  const jira = readJiraState(changeDir);
  if (jira?.key) {
    if (a.dryRun) {
      console.log(`\nJIRA:\n  [plan] transition ${jira.key} -> In Review`);
    } else {
      console.log('\nJIRA:');
      const jr = spawnSync(process.execPath, [path.join(HERE, 'sync-jira.mjs'), 'transition', '--workorder', a.workorder, '--to', 'In Review', '--root', root], { stdio: 'inherit' });
      if (jr.status !== 0) console.error('  (could not set In Review — transition it manually if needed)');
    }
  } else {
    console.log('\nJIRA:\n  (no linked story — skipping In Review)');
  }

  console.log(`  [plan] gh api repos/${repo}/statuses/<sha> -f state=${ghStatusState} -f context="Sonar Quality Gate"   (advisory on Free)`);

  console.log('\n✓ Done. On GitHub Free, review + merge happen on the PR (a human decision). After merge: `forge done --workorder <id>`.\n');
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });

#!/usr/bin/env node
/**
 * openspec-forge installer.
 *
 * Copies the Forge kit into a project's openspec/ (after `openspec init`),
 * safely seeds config, and runs `forge doctor`. Cross-platform (Node only) —
 * the shell bootstraps just download this and run it.
 *
 * Run: node install.mjs [--dir <project>] [--update] [--force] [--no-doctor]
 *   (default) fresh install, or auto-update if openspec/forge already exists
 *   --update  replace kit CODE, preserve your config (connections.yaml, controls/*, rubric, .env, config.yaml)
 *   --force   overwrite everything, including your config
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = path.dirname(fileURLToPath(import.meta.url)); // repo root (contains openspec/)

function parseArgs(argv) {
  const a = { dir: process.cwd(), doctor: true, update: false, force: false };
  for (let i = 2; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--dir') a.dir = path.resolve(argv[++i]);
    else if (x === '--update') a.update = true;
    else if (x === '--force') a.force = true;
    else if (x === '--no-doctor') a.doctor = false;
    else if (x === '-h' || x === '--help') a.help = true;
  }
  return a;
}

const version = (() => {
  try { return JSON.parse(readFileSync(path.join(SOURCE, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; }
})();

// Files under openspec/forge/ that are user-owned config → preserved on --update.
const isPreserved = (rel) =>
  rel === 'connections.yaml' ||
  rel === path.join('ui', 'design-system-rubric.mjs') ||
  rel.startsWith('controls' + path.sep);

function copyTree(src, dest, { mode }) {
  const skipped = [];
  const walk = (s, d, relBase) => {
    mkdirSync(d, { recursive: true });
    for (const entry of readdirSync(s, { withFileTypes: true })) {
      const rel = relBase ? path.join(relBase, entry.name) : entry.name;
      const sp = path.join(s, entry.name);
      const dp = path.join(d, entry.name);
      if (entry.isDirectory()) walk(sp, dp, rel);
      else if (mode === 'update' && isPreserved(rel) && existsSync(dp)) skipped.push(rel);
      else copyFileSync(sp, dp);
    }
  };
  walk(src, dest, '');
  return skipped;
}

function main() {
  const a = parseArgs(process.argv);
  if (a.help) { console.log('Usage: node install.mjs [--dir <project>] [--update] [--force] [--no-doctor]'); process.exit(0); }

  const target = a.dir;
  const kitSrc = path.join(SOURCE, 'openspec');
  if (!existsSync(path.join(kitSrc, 'forge', 'forge.mjs'))) { console.error(`✗ kit not found under ${kitSrc} — is this the openspec-forge repo?`); process.exit(1); }
  if (!existsSync(path.join(target, 'openspec'))) { console.error(`✗ no openspec/ in ${target}. Run \`openspec init\` there first.`); process.exit(1); }
  if (path.resolve(kitSrc) === path.resolve(target, 'openspec')) { console.error('✗ source and target are the same directory. Use --dir <project>.'); process.exit(1); }

  const existing = existsSync(path.join(target, 'openspec', 'forge'));
  const mode = a.force ? 'fresh' : (existing || a.update) ? 'update' : 'fresh';
  console.log(`\nopenspec-forge v${version}  →  ${target}   (${a.force ? 'force overwrite' : existing ? 'update' : 'fresh install'})`);

  // 1. copy the kit
  const skipped = copyTree(path.join(kitSrc, 'forge'), path.join(target, 'openspec', 'forge'), { mode });
  copyTree(path.join(kitSrc, 'schemas', 'forge-workorder'), path.join(target, 'openspec', 'schemas', 'forge-workorder'), { mode: 'fresh' });
  copyTree(path.join(kitSrc, 'schemas', 'forge-epic'), path.join(target, 'openspec', 'schemas', 'forge-epic'), { mode: 'fresh' });
  console.log('  ✓ kit copied (openspec/forge + schemas/forge-workorder + schemas/forge-epic)');
  if (skipped.length) console.log(`  · preserved your files: ${skipped.join(', ')}`);

  // 2. safe-seed openspec/config.yaml
  const cfg = path.join(target, 'openspec', 'config.yaml');
  const sample = path.join(target, 'openspec', 'forge', 'config.sample.yaml');
  if (!existsSync(cfg)) { copyFileSync(sample, cfg); console.log('  ✓ seeded openspec/config.yaml from config.sample.yaml'); }
  else {
    console.log('  · openspec/config.yaml exists — NOT overwritten. Ensure it contains:');
    console.log('      schema: forge-workorder');
    console.log('      operations.apply.guidance: [ ... ]   (copy from openspec/forge/config.sample.yaml)');
  }

  // 3. .env
  const env = path.join(target, '.env');
  const envEx = path.join(target, 'openspec', 'forge', '.env.example');
  if (!existsSync(env)) { copyFileSync(envEx, env); console.log('  ✓ seeded .env from .env.example (fill in tokens)'); }
  else console.log('  · .env exists — left as-is');

  // 4. .gitignore (idempotent append)
  const gi = path.join(target, '.gitignore');
  const wanted = readFileSync(path.join(target, 'openspec', 'forge', 'gitignore.sample'), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const current = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  const toAdd = wanted.filter((l) => !current.split('\n').includes(l));
  if (toAdd.length) {
    appendFileSync(gi, (current && !current.endsWith('\n') ? '\n' : '') + '\n# Forge kit\n' + toAdd.join('\n') + '\n');
    console.log(`  ✓ added ${toAdd.length} line(s) to .gitignore`);
  }

  // 5. version stamp
  writeFileSync(path.join(target, 'openspec', 'forge', '.forge-version'), version + '\n');

  // 6. doctor
  if (a.doctor) {
    console.log('\nRunning forge doctor…');
    spawnSync(process.execPath, [path.join(target, 'openspec', 'forge', 'doctor.mjs'), '--root', target], { stdio: 'inherit' });
  }

  console.log('\n✓ openspec-forge installed. Next:');
  console.log('  1. edit openspec/forge/connections.yaml (JIRA/Confluence/GitHub/SonarQube host) and fill .env');
  console.log("  2. alias forge='node openspec/forge/forge.mjs'");
  console.log('  3. openspec new change my-feature --schema forge-epic     # see openspec/forge/README.md\n');
}

main();

#!/usr/bin/env node
/**
 * Forge companion CLI — thin dispatcher over the kit's scripts.
 * Keeps each script independently runnable while giving the `forge <cmd>` surface
 * referenced by the apply guidance and DESIGN.md.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [, , cmd, ...rest] = process.argv;

// command -> [script, ...leadingArgs]
const routes = {
  doctor: ['doctor.mjs'],
  gate: ['gate.mjs'],
  scan: ['scan-sonar.mjs'],
  rtm: ['build-rtm.mjs'],
  preview: ['preview.mjs'],
  start: ['sync-github.mjs', 'start'],
  pr: ['sync-github.mjs', 'pr'],
  done: ['sync-github.mjs', 'done'],
  adopt: ['adopt.mjs'],
};
// `forge sync <target> ...`
const syncTargets = {
  confluence: ['sync-confluence.mjs'],
  jira: ['sync-jira.mjs'], // Phase 5
};

function help() {
  console.log(`forge <command> [...args]

Commands:
  doctor          [--root <path>] [--check-connectivity]        readiness preflight (config/tokens/CLIs)
  gate            --change <id> [--root <path>] [--json]        run the advisory gate
  scan            --workorder <id> [--pr <n>] [--dry-run]       SonarQube scan -> .forge/sonar.json
  rtm             [--root <path>]                               (re)generate openspec/forge/rtm.md
  preview         <recommend|mockup|shot> --epic <id> [--system <id>]   design-system pick + single-page app mockup + screenshot
  start           --workorder <id> [--base main] [--force]     fetch origin + align forge/<KEY> to the latest remote (remote = source of truth)
  pr              --workorder <id> [--root <path>] [--dry-run]  open/refresh the work order's PR (--scan to scan first)
  done            --workorder <id> [--result-file <pr.json>] [--assume-merged]   verify the PR is MERGED, then set JIRA Done
  adopt           --workorder <id> | --epic <id> [--result-file <bundle.json>]   reconnect .forge/ after a fresh clone (handoff)
  sync confluence <publish|check|read-comments> --workorder <id>
  sync jira       <story|epic|transition|qa> [--workorder|--epic <id>] [--to <status>] [--list]
                  (qa = file/read QA-defect issues — a workflow separate from the build Story)

See openspec/forge/DESIGN.md.`);
}

function resolve() {
  if (cmd === 'sync') {
    const target = rest[0];
    if (!syncTargets[target]) return null;
    return [...syncTargets[target], ...rest.slice(1)];
  }
  if (routes[cmd]) return [...routes[cmd], ...rest];
  return null;
}

const argv = (!cmd || cmd === '-h' || cmd === '--help') ? null : resolve();
if (!argv) {
  help();
  process.exit(cmd && !['-h', '--help'].includes(cmd) ? 2 : 0);
}

const [script, ...scriptArgs] = argv;
const r = spawnSync(process.execPath, [path.join(HERE, script), ...scriptArgs], { stdio: 'inherit' });
process.exit(r.status ?? 1);

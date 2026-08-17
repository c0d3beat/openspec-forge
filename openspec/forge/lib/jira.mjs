/**
 * Shared access to the per-change JIRA state (Story for a work order, Epic for a feature).
 * `sync-jira.mjs` writes it; `gate.mjs` and `build-rtm.mjs` read it. JIRA is tracking only.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function jiraStatePath(changeDir) {
  return path.join(changeDir, '.forge', 'jira.json');
}

export function readJiraState(changeDir) {
  const p = jiraStatePath(changeDir);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * Shared access to the per-work-order SonarQube result.
 * `scan-sonar.mjs` writes it; `gate.mjs` and `sync-github.mjs` read it.
 * Kept in a tiny dot-dir inside the change so it travels with the work order
 * (add `.forge/` to your .gitignore — it is a scan cache, not a planning artifact).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function sonarResultPath(changeDir) {
  return path.join(changeDir, '.forge', 'sonar.json');
}

export function readSonarResult(changeDir) {
  const p = sonarResultPath(changeDir);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

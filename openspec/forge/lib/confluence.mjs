/**
 * Shared access to the per-work-order Confluence state.
 * `sync-confluence.mjs` writes it; `gate.mjs` reads it.
 * Content authority stays in the repo: we publish story.md to Confluence for
 * review, record what we published (hash), and read back the `approved` label.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export function confluenceStatePath(changeDir) {
  return path.join(changeDir, '.forge', 'confluence.json');
}

export function readConfluenceState(changeDir) {
  const p = confluenceStatePath(changeDir);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/** Short content hash of a doc in the change dir (for strict re-approval). */
export function hashDoc(changeDir, file = 'story.md') {
  const p = path.join(changeDir, file);
  if (!existsSync(p)) return null;
  return createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);
}

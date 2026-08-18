/**
 * Per-DOCUMENT Confluence state for a change: `.forge/confluence.json` is a map
 * keyed by document filename (so an epic's brd/prd/ux-design/… are distinct pages,
 * not one shared page). Also exposes the doc content hash for strict re-approval.
 * `sync-confluence.mjs` writes it; `gate.mjs` / `build-rtm.mjs` read it (default doc = story.md).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export function confluenceStatePath(changeDir) {
  return path.join(changeDir, '.forge', 'confluence.json');
}

function readAll(changeDir) {
  const p = confluenceStatePath(changeDir);
  if (!existsSync(p)) return {};
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    // Migrate a legacy single-doc file ({ pageId, doc, ... }) into the per-doc map.
    if (data && data.pageId && data.doc) return { [data.doc]: data };
    return data || {};
  } catch { return {}; }
}

export function readConfluenceState(changeDir, doc = 'story.md') {
  return readAll(changeDir)[doc] || null;
}

export function writeConfluenceState(changeDir, doc, state) {
  const p = confluenceStatePath(changeDir);
  mkdirSync(path.dirname(p), { recursive: true });
  const all = readAll(changeDir);
  all[doc] = state;
  writeFileSync(p, JSON.stringify(all, null, 2) + '\n');
  return p;
}

/** Short content hash of a doc in the change dir (for strict re-approval). */
export function hashDoc(changeDir, file = 'story.md') {
  const p = path.join(changeDir, file);
  if (!existsSync(p)) return null;
  return createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);
}

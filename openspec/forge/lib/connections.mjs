/**
 * Minimal reader for the kit's own `openspec/forge/connections.yaml`.
 *
 * Deliberately dependency-free: it parses only the small, controlled 2-level
 * shape this kit writes (top-level sections with `key: value` scalars, `#`
 * comments, inline ` # ...` comments). When later phases add real REST calls we
 * can swap in the `yaml` package; until then this keeps the kit zero-install.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function connectionsPath(root) {
  return path.join(root, 'openspec', 'forge', 'connections.yaml');
}

export function readConnections(root) {
  const p = connectionsPath(root);
  if (!existsSync(p)) return {};
  const out = {};
  let section = null;
  for (const raw of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, ''); // strip trailing inline comment
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const top = line.match(/^([A-Za-z0-9_]+):\s*$/);
    if (top) { section = top[1]; out[section] = {}; continue; }
    const kv = line.match(/^\s+([A-Za-z0-9_]+):\s*(.+)$/);
    if (kv && section) out[section][kv[1]] = kv[2].trim();
  }
  return out;
}

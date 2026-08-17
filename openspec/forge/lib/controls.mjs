/**
 * Loads compliance control catalogs (`openspec/forge/controls/*.yaml`) and collects
 * the controls a change tags via `(control: ID, ...)` markers in its story/specs.
 *
 * Dependency-free: a minimal parser for the catalog's controlled shape
 * (top-level `regime:` scalar + a `controls:` list of maps with scalar fields).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

function stripQuotes(v) {
  const t = (v || '').trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1) : t;
}

export function parseCatalog(text) {
  const cat = { regime: null, controls: [] };
  let inControls = false;
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const topMap = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/); // no leading space => top-level key
    if (topMap) {
      if (topMap[1] === 'controls') { inControls = true; cur = null; continue; }
      if (topMap[1] === 'regime') { cat.regime = stripQuotes(topMap[2]); inControls = false; continue; }
      inControls = false;
      continue;
    }
    if (!inControls) continue;
    const item = line.match(/^\s*-\s*([A-Za-z0-9_]+):\s*(.*)$/); // list item: first field
    if (item) { cur = {}; cat.controls.push(cur); cur[item[1]] = stripQuotes(item[2]); continue; }
    const kv = line.match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/); // subsequent field
    if (kv && cur) cur[kv[1]] = stripQuotes(kv[2]);
  }
  return cat;
}

export function loadCatalogs(root) {
  const dir = path.join(root, 'openspec', 'forge', 'controls');
  const out = { regimes: [], byId: new Map() };
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const cat = parseCatalog(readFileSync(path.join(dir, f), 'utf8'));
    out.regimes.push({ file: f, regime: cat.regime, count: cat.controls.length });
    for (const c of cat.controls) if (c.id) out.byId.set(c.id, { ...c, regime: cat.regime });
  }
  return out;
}

function listMd(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listMd(f));
    else if (e.name.endsWith('.md')) out.push(f);
  }
  return out;
}

export function collectTaggedControls(changeDir) {
  const ids = new Set();
  const files = [path.join(changeDir, 'story.md'), ...listMd(path.join(changeDir, 'specs'))].filter(existsSync);
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\(control:\s*([^)]+)\)/g)) {
      for (const id of m[1].split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)) ids.add(id);
    }
  }
  return [...ids];
}

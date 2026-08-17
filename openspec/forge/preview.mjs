#!/usr/bin/env node
/**
 * Forge UI/UX preview — a single-page app-shell mockup (not a component catalog).
 *
 *   recommend  score the allowed React design systems against the epic's BRD/PRD
 *              (rubric: ui/design-system-rubric.mjs) -> <change>/.forge/ux-recommendation.json
 *   mockup     scaffold ONE Vite single-page app (app shell: sidebar + top menu + content + buttons + modal)
 *              in the chosen/recommended system under <change>/ux-preview/. The agent then rebuilds
 *              src/App.jsx as the real app shell for the feature (per ux-design.md).
 *   shot       build the mockup + render ONE screenshot -> <change>/ux-preview/mockup.png
 *              (system Chrome/Edge headless; Playwright fallback). Hash-gated. `sync confluence publish`
 *              embeds this PNG automatically.
 *
 * Offline: `mockup` writes real files; `shot` needs a real toolchain (npm + a browser) so it PLANS under
 * --dry-run or when prerequisites are missing.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import rubric from './ui/design-system-rubric.mjs';

// React peer deps required alongside each design system's package.
const PEERS = {
  mui: ['@emotion/react', '@emotion/styled'],
  'ant-design': [],
  fluent: [],
  chakra: ['@emotion/react', '@emotion/styled', 'framer-motion'],
  mantine: ['@mantine/hooks'],
};
const BROWSERS = ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'chrome', 'microsoft-edge', 'msedge'];

function parseArgs(argv) {
  const a = { action: argv[2], root: process.cwd(), dryRun: false, force: false };
  for (let i = 3; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--epic') a.epic = argv[++i];
    else if (x === '--workorder' || x === '--change') a.workorder = argv[++i];
    else if (x === '--system') a.system = argv[++i];
    else if (x === '--root') a.root = path.resolve(argv[++i]);
    else if (x === '--dry-run') a.dryRun = true;
    else if (x === '--force') a.force = true;
    else if (x === '-h' || x === '--help') a.help = true;
  }
  return a;
}
const which = (bin) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' }).status === 0;
const findBrowser = () => BROWSERS.find(which) || null;
const changeDirOf = (a) => { const id = a.epic || a.workorder; return id ? path.join(a.root, 'openspec', 'changes', id) : null; };
const readDocs = (d) => ['brd.md', 'prd.md', 'story.md', 'capabilities.md'].map((f) => path.join(d, f)).filter(existsSync).map((f) => readFileSync(f, 'utf8')).join('\n\n');

// ---- recommend ----
function recommend(changeDir) {
  const text = readDocs(changeDir);
  const scores = Object.fromEntries(rubric.systems.map((s) => [s, 0]));
  const matched = [];
  for (const sig of rubric.signals) {
    if (new RegExp(sig.match, 'i').test(text)) {
      const points = rubric.weights[sig.criterion] || 1;
      for (const s of sig.favor) scores[s] += points;
      matched.push({ criterion: sig.criterion, favor: sig.favor, points });
    }
  }
  const ranked = [...rubric.systems].sort((x, y) => scores[y] - scores[x] || rubric.systems.indexOf(x) - rubric.systems.indexOf(y));
  const [top, second] = ranked;
  const margin = scores[top] - scores[second];
  return { recommended: top, package: rubric.packages[top], label: rubric.labels[top], confidence: scores[top] === 0 ? 'none' : margin >= 3 ? 'high' : margin >= 1 ? 'medium' : 'low', runnerUp: second, runnerUpLabel: rubric.labels[second], scores, matched };
}
const recPath = (d) => path.join(d, '.forge', 'ux-recommendation.json');
function writeRec(d, rec) { mkdirSync(path.dirname(recPath(d)), { recursive: true }); writeFileSync(recPath(d), JSON.stringify(rec, null, 2) + '\n'); }
const readRec = (d) => (existsSync(recPath(d)) ? JSON.parse(readFileSync(recPath(d), 'utf8')) : null);

// ---- mockup scaffold (single-page Vite app) ----
function mockupFiles(system) {
  const pkg = rubric.packages[system];
  const prov = rubric.providers[system] || rubric.providers.mui;
  const deps = { react: '^18', 'react-dom': '^18', [pkg]: '*' };
  for (const p of PEERS[system] || []) deps[p] = '*';
  return {
    'package.json': JSON.stringify({
      name: `ux-preview-${system}`, private: true, type: 'module',
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
      dependencies: deps,
      devDependencies: { vite: '^5', '@vitejs/plugin-react': '^4', 'vite-plugin-singlefile': '^2' },
    }, null, 2) + '\n',
    'vite.config.js': `import react from '@vitejs/plugin-react';\nimport { viteSingleFile } from 'vite-plugin-singlefile';\nexport default { plugins: [react(), viteSingleFile()] };\n`,
    'index.html': `<!doctype html><html><head><meta charset="utf-8"><title>UI Preview</title></head>\n<body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>\n`,
    'src/main.jsx': `import React from 'react';\nimport { createRoot } from 'react-dom/client';\n${prov.import}\nimport App from './App.jsx';\n${prov.setup ? prov.setup + '\n' : ''}\ncreateRoot(document.getElementById('root')).render(\n  <React.StrictMode>\n    ${prov.open}\n      <App />\n    ${prov.close}\n  </React.StrictMode>\n);\n`,
    'src/App.jsx': `import React, { useState } from 'react';\n\n// TODO (agent): rebuild this as the REAL app shell for the feature, in ${rubric.labels[system]} components,\n// per ux-design.md — actual sidebar nav, top menu, the key screen(s), primary/secondary actions, a representative modal.\n// This placeholder renders a generic shell so \`forge preview shot\` produces a meaningful screenshot out of the box.\nexport default function App() {\n  const [open, setOpen] = useState(false);\n  return (\n    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>\n      <aside style={{ width: 220, background: '#1f2937', color: '#fff', padding: 16 }}>\n        <h3 style={{ marginTop: 0 }}>My App</h3>\n        <nav><ul style={{ listStyle: 'none', padding: 0, lineHeight: 2.2 }}><li>Dashboard</li><li>Records</li><li>Reports</li><li>Settings</li></ul></nav>\n      </aside>\n      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#f9fafb' }}>\n        <header style={{ height: 56, background: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px' }}>\n          <strong>Records</strong>\n          <button onClick={() => setOpen(true)} style={{ padding: '8px 14px' }}>+ New</button>\n        </header>\n        <section style={{ padding: 20 }}>\n          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>\n            <thead><tr><th style={{ textAlign: 'left', padding: 10, borderBottom: '2px solid #e5e7eb' }}>Name</th><th style={{ padding: 10 }}>Status</th><th style={{ padding: 10 }}>Updated</th></tr></thead>\n            <tbody>\n              <tr><td style={{ padding: 10 }}>Example A</td><td style={{ padding: 10 }}>Active</td><td style={{ padding: 10 }}>Today</td></tr>\n              <tr><td style={{ padding: 10 }}>Example B</td><td style={{ padding: 10 }}>Pending</td><td style={{ padding: 10 }}>Yesterday</td></tr>\n            </tbody>\n          </table>\n        </section>\n        {open && (\n          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'grid', placeItems: 'center' }}>\n            <div style={{ background: '#fff', padding: 24, borderRadius: 8, minWidth: 340 }}><h4 style={{ marginTop: 0 }}>New record</h4><p>Modal content…</p><button onClick={() => setOpen(false)}>Close</button></div>\n          </div>\n        )}\n      </main>\n    </div>\n  );\n}\n`,
  };
}

function srcHash(dir) {
  const srcDir = path.join(dir, 'src');
  if (!existsSync(srcDir)) return '';
  const h = createHash('sha256');
  for (const f of readdirSync(srcDir).sort()) h.update(readFileSync(path.join(srcDir, f)));
  return h.digest('hex').slice(0, 16);
}

function main() {
  const a = parseArgs(process.argv);
  const actions = ['recommend', 'mockup', 'shot'];
  const changeDir = changeDirOf(a);
  if (a.help || !actions.includes(a.action) || !changeDir) {
    console.error('Usage: node openspec/forge/preview.mjs <recommend|mockup|shot> (--epic <id>|--workorder <id>) [--system <id>] [--root <p>] [--dry-run] [--force]');
    process.exit(a.help ? 0 : 2);
  }
  if (!existsSync(changeDir)) { console.error(`change not found: ${changeDir}`); process.exit(1); }

  if (a.action === 'recommend') {
    const rec = recommend(changeDir);
    console.log(`\nForge UI/UX recommendation — ${a.epic || a.workorder}`);
    if (rec.confidence === 'none') console.log('  (no design-system signals in BRD/PRD — author them, or pass --system to mockup)');
    console.log(`  recommended: ${rec.label}  [${rec.package}]   confidence: ${rec.confidence}`);
    console.log(`  runner-up:   ${rec.runnerUpLabel}`);
    console.log(`  scores:      ${rubric.systems.map((s) => `${s}=${rec.scores[s]}`).join('   ')}`);
    if (rec.matched.length) { console.log('  rationale:'); for (const m of rec.matched) console.log(`    - ${m.criterion} (+${m.points}) -> ${m.favor.join(', ')}`); }
    writeRec(changeDir, rec);
    console.log('  -> record the choice in ux-design.md, then `forge preview mockup`.');
    process.exit(0);
  }

  const dir = path.join(changeDir, 'ux-preview');

  if (a.action === 'mockup') {
    const system = a.system || readRec(changeDir)?.recommended;
    if (!system) { console.error('  no --system and no recommendation — run `forge preview recommend` or pass --system'); process.exit(1); }
    if (!rubric.systems.includes(system)) { console.error(`  unknown system "${system}" (allowed: ${rubric.systems.join(', ')})`); process.exit(2); }
    const files = mockupFiles(system);
    console.log(`\nForge UI/UX mockup — ${a.epic || a.workorder}   system: ${rubric.labels[system]}`);
    if (a.dryRun) { console.log('  [plan] write single-page app under ux-preview/:'); for (const f of Object.keys(files)) console.log(`         ux-preview/${f}`); process.exit(0); }
    for (const [f, content] of Object.entries(files)) { const fp = path.join(dir, f); mkdirSync(path.dirname(fp), { recursive: true }); writeFileSync(fp, content); }
    console.log(`  wrote ${Object.keys(files).length} files under ux-preview/  (${rubric.labels[system]})`);
    console.log('  -> agent: rebuild src/App.jsx as the real app shell (per ux-design.md), then `forge preview shot`.');
    process.exit(0);
  }

  // shot
  if (!existsSync(path.join(dir, 'package.json'))) { console.error('  no ux-preview/ — run `forge preview mockup` first'); process.exit(1); }
  const out = path.join(dir, 'mockup.png');
  const hashPath = path.join(dir, '.shot-hash');
  const hash = srcHash(dir);
  if (!a.force && existsSync(out) && existsSync(hashPath) && readFileSync(hashPath, 'utf8').trim() === hash) {
    console.log('\nForge UI/UX shot — up to date (src unchanged); use --force to re-render.');
    process.exit(0);
  }
  const browser = findBrowser();
  const needInstall = !existsSync(path.join(dir, 'node_modules'));
  console.log(`\nForge UI/UX shot — ${a.epic || a.workorder}`);
  console.log('  plan:');
  if (needInstall) console.log(`    - npm --prefix ${path.relative(a.root, dir)} install`);
  console.log(`    - npm --prefix ${path.relative(a.root, dir)} run build      # vite → dist/index.html (single file)`);
  console.log(browser
    ? `    - ${browser} --headless=new --screenshot=mockup.png --window-size=1440,900 dist/index.html`
    : '    - render dist/index.html → mockup.png  (no system browser found: install Chrome/Edge, or `npx playwright install chromium`)');

  if (a.dryRun) process.exit(0);
  if (!browser && !which('npx')) { console.error('\n  ✗ no renderer available. Install Chrome/Edge or run `npx playwright install chromium`, then retry.'); process.exit(1); }

  // Live render
  if (needInstall) { const r = spawnSync('npm', ['--prefix', dir, 'install'], { stdio: 'inherit' }); if (r.status !== 0) { console.error('  ✗ npm install failed'); process.exit(1); } }
  if (spawnSync('npm', ['--prefix', dir, 'run', 'build'], { stdio: 'inherit' }).status !== 0) { console.error('  ✗ vite build failed'); process.exit(1); }
  const html = path.join(dir, 'dist', 'index.html');
  let ok;
  if (browser) ok = spawnSync(browser, ['--headless=new', '--disable-gpu', `--screenshot=${out}`, '--window-size=1440,900', html], { stdio: 'inherit' }).status === 0;
  else ok = spawnSync('npx', ['playwright', 'screenshot', '--viewport-size=1440,900', html, out], { stdio: 'inherit' }).status === 0;
  if (!ok || !existsSync(out)) { console.error('  ✗ screenshot failed'); process.exit(1); }
  writeFileSync(hashPath, hash + '\n');
  console.log(`  ✓ wrote ${path.relative(a.root, out)}  — sync confluence publish will embed it.`);
  process.exit(0);
}

main();

#!/usr/bin/env node
/**
 * Forge UI/UX preview — Phase 7.
 *
 *   recommend  score the allowed React design systems against the epic's BRD/PRD
 *              (rubric: ui/design-system-rubric.mjs) -> <change>/.forge/ux-recommendation.json
 *   scaffold   generate a Storybook scaffold in the chosen/recommended system under
 *              <change>/ux-preview/, then plan install + build + Playwright screenshots + Confluence upload.
 *
 * Offline: `scaffold` writes real scaffold files but PLANS the npm install / storybook build /
 * screenshot steps (they need a full React toolchain). `--dry-run` prints the plan only.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import rubric from './ui/design-system-rubric.mjs';

function parseArgs(argv) {
  const a = { action: argv[2], root: process.cwd(), dryRun: false };
  for (let i = 3; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--epic') a.epic = argv[++i];
    else if (x === '--workorder' || x === '--change') a.workorder = argv[++i];
    else if (x === '--system') a.system = argv[++i];
    else if (x === '--root') a.root = path.resolve(argv[++i]);
    else if (x === '--dry-run') a.dryRun = true;
    else if (x === '-h' || x === '--help') a.help = true;
  }
  return a;
}

const changeDirOf = (a) => {
  const id = a.epic || a.workorder;
  return id ? path.join(a.root, 'openspec', 'changes', id) : null;
};
const readDocs = (changeDir) =>
  ['brd.md', 'prd.md', 'story.md', 'capabilities.md']
    .map((f) => path.join(changeDir, f))
    .filter(existsSync)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n\n');

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
  const confidence = scores[top] === 0 ? 'none' : margin >= 3 ? 'high' : margin >= 1 ? 'medium' : 'low';
  return {
    recommended: top, package: rubric.packages[top], label: rubric.labels[top],
    confidence, runnerUp: second, runnerUpLabel: rubric.labels[second], scores, matched,
  };
}

function writeRec(changeDir, rec) {
  const p = path.join(changeDir, '.forge', 'ux-recommendation.json');
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(rec, null, 2) + '\n');
  return p;
}
function readRec(changeDir) {
  const p = path.join(changeDir, '.forge', 'ux-recommendation.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

function scaffoldFiles(system) {
  const pkg = rubric.packages[system];
  const prov = rubric.providers[system] || rubric.providers.mui;
  return {
    'package.json': JSON.stringify({
      name: `ux-preview-${system}`, private: true, type: 'module',
      scripts: { storybook: 'storybook dev -p 6006', 'build-storybook': 'storybook build' },
      dependencies: { react: '^18', 'react-dom': '^18', [pkg]: '*' },
      devDependencies: { storybook: '^8', '@storybook/react-vite': '^8', vite: '^5', playwright: '^1' },
    }, null, 2) + '\n',
    '.storybook/main.js': `export default {\n  stories: ['../src/**/*.stories.@(jsx|tsx)'],\n  framework: { name: '@storybook/react-vite', options: {} },\n};\n`,
    '.storybook/preview.jsx': `import React from 'react';\n${prov.import}\n${prov.setup ? prov.setup + '\n' : ''}\nexport const decorators = [(Story) => (\n  ${prov.open}\n    <Story />\n  ${prov.close}\n)];\n`,
    'src/Sample.stories.jsx': `import React from 'react';\n\nexport default { title: 'Preview/Sample' };\n\n// Replace with the components from ux-design.md, themed in ${rubric.labels[system]}.\nexport const Default = () => (\n  <div style={{ padding: 16 }}>\n    <h3>${rubric.labels[system]} preview</h3>\n    <p>Scaffolded by \`forge preview scaffold\`. Add the feature's components here.</p>\n  </div>\n);\n`,
  };
}

function main() {
  const a = parseArgs(process.argv);
  const actions = ['recommend', 'scaffold'];
  const changeDir = changeDirOf(a);
  if (a.help || !actions.includes(a.action) || !changeDir) {
    console.error('Usage: node openspec/forge/preview.mjs <recommend|scaffold> (--epic <id>|--workorder <id>) [--system <id>] [--root <p>] [--dry-run]');
    process.exit(a.help ? 0 : 2);
  }
  if (!existsSync(changeDir)) { console.error(`change not found: ${changeDir}`); process.exit(1); }

  if (a.action === 'recommend') {
    const rec = recommend(changeDir);
    console.log(`\nForge UI/UX recommendation — ${a.epic || a.workorder}`);
    if (rec.confidence === 'none') console.log('  (no design-system signals found in BRD/PRD — author them, or pass --system to scaffold)');
    console.log(`  recommended: ${rec.label}  [${rec.package}]   confidence: ${rec.confidence}`);
    console.log(`  runner-up:   ${rec.runnerUpLabel}`);
    console.log(`  scores:      ${rubric.systems.map((s) => `${s}=${rec.scores[s]}`).join('   ')}`);
    if (rec.matched.length) {
      console.log('  rationale (matched signals):');
      for (const m of rec.matched) console.log(`    - ${m.criterion} (+${m.points}) -> ${m.favor.join(', ')}`);
    }
    console.log(`  wrote ${writeRec(changeDir, rec)}`);
    console.log('  -> record the decision in ux-design.md, then `forge preview scaffold`.');
    process.exit(0);
  }

  // scaffold
  const rec = readRec(changeDir);
  const system = a.system || rec?.recommended;
  if (!system) { console.error('  no --system and no recommendation yet — run `forge preview recommend` or pass --system'); process.exit(1); }
  if (!rubric.systems.includes(system)) { console.error(`  unknown system "${system}" (allowed: ${rubric.systems.join(', ')})`); process.exit(2); }
  const dir = path.join(changeDir, 'ux-preview');
  const files = scaffoldFiles(system);
  console.log(`\nForge UI/UX scaffold — ${a.epic || a.workorder}   system: ${rubric.labels[system]}`);
  if (a.dryRun) {
    console.log('  [plan] write files:');
    for (const f of Object.keys(files)) console.log(`         ux-preview/${f}`);
  } else {
    for (const [f, content] of Object.entries(files)) {
      const fp = path.join(dir, f);
      mkdirSync(path.dirname(fp), { recursive: true });
      writeFileSync(fp, content);
    }
    console.log(`  wrote ${Object.keys(files).length} files under ux-preview/`);
  }
  console.log('\n  [plan] npm --prefix ux-preview install');
  console.log('  [plan] npm --prefix ux-preview run build-storybook');
  console.log('  [plan] playwright screenshot each story -> ux-preview/screenshots/*.png');
  console.log('  [plan] forge sync confluence publish --doc ux-design.md   (attach screenshots for visual approval)');
  console.log('\n  -> review locally: npm --prefix ux-preview run storybook; approve via Confluence screenshots.');
  process.exit(0);
}

main();

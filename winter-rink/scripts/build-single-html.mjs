// Builds dist-single/magical-winter-forest-ice-rink.html: one self-contained
// file that opens by double-click (Three.js loads from the jsDelivr CDN).
// No dependencies — plain Node. The Vite setup (npm run dev) is unchanged.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => path.join(root, 'src', f);
const THREE_VERSION = '0.170.0';

// dependency order
const order = [
  'world/config.js', 'world/warmGlow.js', 'world/bulbs.js', 'world/sky.js', 'world/firTree.js',
  'world/deciduousTree.js', 'world/ground.js', 'world/iceRink.js', 'world/christmasTree.js',
  'world/forest.js', 'world/lights.js', 'world/snowfall.js', 'world/index.js',
  'camera/cinematicCamera.js', 'player/PlaceholderPlayer.js', 'main.js',
];

const externalImports = new Set();
let body = '';
for (const f of order) {
  let code = fs.readFileSync(src(f), 'utf8');
  code = code.replace(/^import[\s\S]*?from\s+['"]([^'"]+)['"];[ \t]*$/gm, (m, from) => {
    if (!from.startsWith('.')) externalImports.add(m.replace(/\s+/g, ' ').trim());
    return '';
  });
  code = code.replace(/^export\s+/gm, '');
  body += `\n// ===== ${f} =====\n${code}`;
}

const cdn = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;
const script = `<script type="importmap">
    { "imports": { "three": "${cdn}/build/three.module.js", "three/addons/": "${cdn}/examples/jsm/" } }
    </script>
    <script type="module">
${[...externalImports].join('\n')}
${body}
    </script>`;

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace('<script type="module" src="/src/main.js"></script>', script);
const outDir = path.join(root, 'dist-single');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'magical-winter-forest-ice-rink.html');
fs.writeFileSync(out, html);
console.log('wrote', path.relative(root, out), (html.length / 1024).toFixed(1) + ' KB');

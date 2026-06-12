/**
 * Generate an offline-safe HTML documentation page for every `ring-*` component
 * into `docs/`, plus a `docs/index.html` catalog.
 *
 * Uses `banira doc` with:
 *   --stylesheet assets/docs.css   inline a local stylesheet (no CDN)
 *   --script-src ../dist/index.js  load the built bundle, registering every element
 *
 * Requires a prior `npm run build` so `dist/index.js` exists. Run via `npm run docs`.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const componentsDir = resolve(root, 'src/components');
const outDir = resolve(root, 'docs');
const stylesheet = 'assets/docs.css';
const scriptSrc = '../dist/index.js';
const banira = resolve(root, 'node_modules/.bin/banira');

if (!existsSync(resolve(root, 'dist/index.js'))) {
    console.error('dist/index.js not found — run `npm run build` first.');
    process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const files = readdirSync(componentsDir)
    .filter((f) => f.startsWith('ring-') && f.endsWith('.ts'))
    .sort();

const pages = [];
for (const file of files) {
    const tag = file.replace(/\.ts$/, '');
    const src = resolve(componentsDir, file);
    const out = resolve(outDir, `${tag}.html`);
    execFileSync(banira, ['doc', src, '-o', out, '--stylesheet', stylesheet, '--script-src', scriptSrc], {
        stdio: ['ignore', 'ignore', 'inherit'],
    });
    pages.push(tag);
}

const list = pages.map((tag) => `      <li><a href="./${tag}.html"><code>&lt;${tag}&gt;</code></a></li>`).join('\n');
const index = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ring-webcomponents — component docs</title>
    <link rel="stylesheet" href="../${stylesheet}">
</head>
<body>
    <header class="container"><h1>Component documentation</h1></header>
    <main class="container">
      <p>${pages.length} components. Generated offline with <code>banira doc</code>.</p>
      <ul>
${list}
      </ul>
    </main>
    <footer class="container"><small>Built with banira</small></footer>
</body>
</html>
`;
writeFileSync(resolve(outDir, 'index.html'), index);

console.log(`Generated ${pages.length} doc pages + index.html in docs/`);

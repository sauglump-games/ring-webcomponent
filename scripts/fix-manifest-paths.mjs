/**
 * Post-process `custom-elements.json` so module paths are portable.
 *
 * `banira manifest` emits absolute filesystem paths to the analyzed `src/*.ts`
 * sources. A committed / published manifest must instead point at package-root
 * relative modules that actually ship in the tarball — i.e. the compiled
 * `dist/**.js`. This rewrites every `module.path` accordingly and is idempotent.
 *
 * Run by the `manifest` npm script after `banira manifest`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const file = resolve(process.cwd(), 'custom-elements.json');
const manifest = JSON.parse(readFileSync(file, 'utf8'));

/** Absolute or repo-relative `src/foo/bar.ts` -> `dist/foo/bar.js`. */
function toDistModule(p) {
    const rel = p.startsWith('/') ? relative(process.cwd(), p) : p;
    return rel.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js');
}

for (const mod of manifest.modules ?? []) {
    if (typeof mod.path === 'string') mod.path = toDistModule(mod.path);
}

writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Rewrote ${manifest.modules?.length ?? 0} module paths to dist/ in custom-elements.json`);

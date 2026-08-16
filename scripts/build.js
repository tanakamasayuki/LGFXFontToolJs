// @ts-check
/**
 * dist/ の生成（仕様 §16）。
 *
 *   dist/lgfx-font-tool.js       ESM バンドル（非圧縮）
 *   dist/lgfx-font-tool.min.js   ESM バンドル（圧縮）
 *   dist/data/                   npm / CDN に同梱する軽量フォント
 *                                （LGFX 内部形式 + 欧文 GFX ≒ 0.35MB。
 *                                CJK 系はローダがリモート解決する）
 *
 * ローダは new URL('./data/…', import.meta.url) で解決するため、
 * バンドルの隣に data/ を置けば npm / CDN / ローカルのどこでも動く。
 */
import { build } from 'esbuild';
import { rmSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'data'), { recursive: true });

/** npm に同梱するフォント（軽量な 70 本）。CJK 系（efont / lgfxJapan）は除外 */
const BUNDLED = (/** @type {string} */ f) => !/^(efont|lgfxJapan)/.test(f) && f !== 'README.md';

const dataDir = join(root, 'src', 'fonts', 'data');
let bundledBytes = 0;
let bundledCount = 0;
for (const f of readdirSync(dataDir)) {
  if (!BUNDLED(f)) continue;
  copyFileSync(join(dataDir, f), join(dist, 'data', f));
  bundledBytes += statSync(join(dataDir, f)).size;
  bundledCount++;
}

for (const minify of [false, true]) {
  await build({
    entryPoints: [join(root, 'src', 'index.js')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify,
    outfile: join(dist, `lgfx-font-tool${minify ? '.min' : ''}.js`),
    // node:fs/promises は Node 実行時のみ動的 import される（ブラウザでは到達しない）
    external: ['node:fs/promises'],
    logLevel: 'warning',
  });
}

console.log(`dist/ ready (bundled fonts: ${bundledCount}, ${(bundledBytes / 1024).toFixed(0)} KB)`);

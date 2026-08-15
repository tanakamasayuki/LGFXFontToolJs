// @ts-check
/**
 * レイヤ規律の静的検査（仕様 §4.1）。CI で実行する。
 *
 * - 依存は util/charsets ← model ← format ← (render / inspect / fonts / gen) ← index の一方向のみ
 * - import は相対パスかつ拡張子付き
 * - 環境グローバル（document / window / navigator / fetch / node:）の参照は
 *   fonts/loader.js と gen/rasterize.js に限る
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** レイヤと依存してよい先（自身は暗黙に許可）
 * @type {Record<string, string[]>} */
const LAYER_DEPS = {
  util: [],
  charsets: [],
  model: ['util'],
  format: ['model', 'util'],
  render: ['model', 'util'],
  inspect: ['format', 'model', 'charsets', 'util'],
  fonts: ['format', 'model', 'util'],
  gen: ['model', 'charsets', 'util'],
  '.': ['util', 'charsets', 'model', 'format', 'render', 'inspect', 'fonts', 'gen'], // index.js
};

const IO_ALLOWED = new Set(['fonts/loader.js', 'gen/rasterize.js']);
const IO_PATTERN = /\b(document|window|navigator)\b|\bfetch\s*\(|from\s+'node:|import\s*\(\s*'node:/;

/** @type {string[]} */
const errors = [];

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'data') continue; // fonts/data はバイナリ
      out.push(...walk(path));
    } else if (name.endsWith('.js')) {
      out.push(path);
    }
  }
  return out;
}

for (const file of walk(srcRoot)) {
  const rel = relative(srcRoot, file).split(sep).join('/');
  const layer = rel.includes('/') ? rel.split('/')[0] : '.';
  const allowed = LAYER_DEPS[/** @type {keyof typeof LAYER_DEPS} */ (layer)];
  if (allowed === undefined) {
    errors.push(`${rel}: unknown layer '${layer}'`);
    continue;
  }
  const text = readFileSync(file, 'utf8');

  // import の検査
  const importRe = /import\s[^'"]*['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(text)) !== null) {
    const spec = m[1];
    if (spec.startsWith('node:')) continue; // IO 検査側で判定
    if (!spec.startsWith('./') && !spec.startsWith('../')) {
      errors.push(`${rel}: bare specifier '${spec}'`);
      continue;
    }
    if (!spec.endsWith('.js')) {
      errors.push(`${rel}: import without extension '${spec}'`);
      continue;
    }
    const target = relative(srcRoot, resolve(dirname(file), spec)).split(sep).join('/');
    if (target.startsWith('..')) {
      errors.push(`${rel}: import escapes src/ '${spec}'`);
      continue;
    }
    const targetLayer = target.includes('/') ? target.split('/')[0] : '.';
    if (targetLayer !== layer && !allowed.includes(targetLayer)) {
      errors.push(`${rel}: layer '${layer}' may not import '${targetLayer}' (${spec})`);
    }
  }

  // 環境グローバル / node: の検査
  if (!IO_ALLOWED.has(rel) && IO_PATTERN.test(text)) {
    errors.push(`${rel}: environment access is only allowed in ${[...IO_ALLOWED].join(', ')}`);
  }
}

if (errors.length > 0) {
  console.error('layer check failed:');
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log('layer check ok');

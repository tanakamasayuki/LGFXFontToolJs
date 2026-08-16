// @ts-check
/**
 * `npm version` 時に package.json のバージョンを src/index.js の VERSION 定数へ
 * 同期する（package.json の "version" スクリプトから呼ばれる）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.env.npm_package_version;
if (!version) {
  console.error('npm_package_version is not set (run via `npm version`)');
  process.exit(1);
}
const indexPath = join(root, 'src', 'index.js');
const src = readFileSync(indexPath, 'utf8');
const next = src.replace(/export const VERSION = '[^']*';/, `export const VERSION = '${version}';`);
if (next === src) {
  console.error('VERSION constant not found in src/index.js');
  process.exit(1);
}
writeFileSync(indexPath, next);
console.log(`VERSION -> ${version}`);

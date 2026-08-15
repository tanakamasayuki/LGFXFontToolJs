// @ts-check
/**
 * ロケール辞書の検査（CI）。
 * - すべての locales/*.json が en.json と同じキー集合を持つこと
 * - 各文言の {placeholder} 集合が en.json と一致すること
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const localesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'locales');

/** @param {string} s */
const placeholders = (s) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

/** @type {Record<string, string>} */
const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8'));
const enKeys = new Set(Object.keys(en));

/** @type {string[]} */
const errors = [];

for (const file of readdirSync(localesDir)) {
  if (!file.endsWith('.json') || file === 'en.json') continue;
  /** @type {Record<string, string>} */
  const dict = JSON.parse(readFileSync(join(localesDir, file), 'utf8'));
  const keys = new Set(Object.keys(dict));
  for (const k of enKeys) {
    if (!keys.has(k)) errors.push(`${file}: missing key '${k}'`);
  }
  for (const k of keys) {
    if (!enKeys.has(k)) errors.push(`${file}: extra key '${k}'`);
  }
  for (const k of keys) {
    if (!enKeys.has(k)) continue;
    const a = placeholders(en[k]);
    const b = placeholders(dict[k]);
    if (a.size !== b.size || [...a].some((p) => !b.has(p))) {
      errors.push(`${file}: placeholder mismatch in '${k}' (en: {${[...a]}} vs {${[...b]}})`);
    }
  }
}

if (errors.length > 0) {
  console.error('locale check failed:');
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log('locale check ok');

// @ts-check
/** `npm version` が package.json を上げる前に変更履歴の書き忘れを止める。 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unreleasedEntries } from './sync-version.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entries = unreleasedEntries(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'));
if (!entries) {
  console.error('Nothing is written under "## Unreleased" in CHANGELOG.md.');
  process.exit(1);
}
console.log(
  `Ready to release: ${entries.split('\n').filter((line) => line.startsWith('- ')).length} changelog line(s) waiting.`,
);

// @ts-check
/** `npm version` が package.json を上げる前に変更履歴の書き忘れを止める。 */
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unreleasedEntries } from './sync-version.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 自己依存の再発を止める。2.2.2 は dependencies に自分自身を持って公開されてしまい、
// 入れ子で古い版が落ちてくるうえ、このリポジトリ内で npx を叩くと作業ツリーではなく
// 公開版が動くという罠になっていた。`npm i <自分>` を一度打つだけで戻るので機械で見る。
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  if (pkg[field]?.[pkg.name] !== undefined) {
    console.error(`package.json: ${field} に自分自身（${pkg.name}）が入っています。`);
    process.exit(1);
  }
}
const entries = unreleasedEntries(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'));
if (!entries) {
  console.error('Nothing is written under "## Unreleased" in CHANGELOG.md.');
  process.exit(1);
}
console.log(
  `Ready to release: ${entries.split('\n').filter((line) => line.startsWith('- ')).length} changelog line(s) waiting.`,
);

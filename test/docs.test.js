// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('変更履歴は英日が対になり、現行版を含む', () => {
  const text = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const lines = text.split('\n');
  assert.equal(lines[0], '# Changelog / 変更履歴');
  const headings = lines.filter((line) => line.startsWith('## '));
  assert.equal(headings[0], '## Unreleased');
  for (const heading of headings.slice(1)) assert.match(heading, /^## \d+\.\d+\.\d+$/);

  /** @type {Map<string, {en: number, ja: number}>} */
  const counts = new Map();
  let section = '';
  for (const line of lines) {
    if (line.startsWith('## ')) {
      section = line.slice(3);
      counts.set(section, { en: 0, ja: 0 });
    } else if (line.startsWith('- ')) {
      assert.match(line, /^- \((EN|JA)\) /);
      const count = /** @type {{en: number, ja: number}} */ (counts.get(section));
      if (line.startsWith('- (EN)')) count.en++;
      else count.ja++;
    }
  }
  for (const [version, count] of counts) {
    assert.equal(count.en, count.ja, `${version}: EN ${count.en}, JA ${count.ja}`);
  }
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(text.includes(`\n## ${version}\n`), `CHANGELOG.md has no ${version} section`);
});

test('ドキュメント内の CDN 固定版は package.json と一致する', () => {
  const root = new URL('../', import.meta.url);
  const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  /** @param {URL} dir @returns {string[]} */
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      return entry.isDirectory() ? walk(child) : [child.pathname];
    });
  const files = [
    new URL('README.md', root).pathname,
    new URL('README.ja.md', root).pathname,
    ...walk(new URL('docs/', root)),
  ];
  for (const file of files) {
    const pins = readFileSync(file, 'utf8').match(/lgfx-font-tool@(\d+\.\d+\.\d+)/g) ?? [];
    for (const pin of pins) assert.equal(pin, `lgfx-font-tool@${version}`, file);
  }
});

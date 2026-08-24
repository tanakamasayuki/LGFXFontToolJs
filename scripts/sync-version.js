// @ts-check
/**
 * `npm version` が上げた版を、VERSION 定数、ドキュメント内の CDN 固定版、
 * CHANGELOG.md へ同期する。すべての編集を確定してから書き込む。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PINNED = ['README.md', 'README.ja.md', 'docs'];
export const PACKAGE_PIN = /lgfx-font-tool@\d+\.\d+\.\d+/g;

/** @param {string} target @returns {string[]} */
function expand(target) {
  const path = join(ROOT, target);
  try {
    return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? expand(join(target, entry.name)) : [join(path, entry.name)],
    );
  } catch {
    return [path];
  }
}

/** @param {string} changelog */
export function unreleasedEntries(changelog) {
  const marker = '\n## Unreleased\n';
  const at = changelog.indexOf(marker);
  if (at < 0) throw new Error('CHANGELOG.md has no "## Unreleased" section.');
  const body = changelog.slice(at + marker.length);
  const end = body.indexOf('\n## ');
  return (end < 0 ? body : body.slice(0, end + 1)).trim();
}

async function main() {
  const version = process.env.npm_package_version;
  if (!version) throw new Error('npm_package_version is not set (run via `npm version`)');

  /** @type {{path: string, text: string}[]} */
  const edits = [];
  const indexPath = join(ROOT, 'src', 'index.js');
  const index = readFileSync(indexPath, 'utf8');
  const nextIndex = index.replace(
    /export const VERSION = '[^']*';/,
    `export const VERSION = '${version}';`,
  );
  if (nextIndex === index) throw new Error('VERSION constant not found or already updated');
  edits.push({ path: indexPath, text: nextIndex });

  for (const target of PINNED) {
    for (const path of expand(target)) {
      const source = readFileSync(path, 'utf8');
      const text = source.replace(PACKAGE_PIN, `lgfx-font-tool@${version}`);
      if (text !== source) edits.push({ path, text });
    }
  }

  const changelogPath = join(ROOT, 'CHANGELOG.md');
  const changelog = readFileSync(changelogPath, 'utf8');
  if (!unreleasedEntries(changelog)) {
    throw new Error('CHANGELOG.md has nothing under "## Unreleased".');
  }
  if (changelog.includes(`\n## ${version}\n`)) {
    throw new Error(`CHANGELOG.md already has a ${version} section.`);
  }
  const marker = '\n## Unreleased\n';
  edits.push({
    path: changelogPath,
    text: changelog.replace(marker, `${marker}\n## ${version}\n`),
  });

  for (const edit of edits) {
    writeFileSync(edit.path, edit.text);
    console.log(`  ${relative(ROOT, edit.path)} -> ${version}`);
  }
  execFileSync('git', ['add', '--', ...edits.map((edit) => edit.path)], {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exit(1);
  });
}

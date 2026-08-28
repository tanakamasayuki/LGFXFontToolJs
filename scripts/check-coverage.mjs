// @ts-check
/**
 * Guards the presence-detection fix on a real rasterizer.
 *
 * Skia substitutes a system font for a character the requested typeface lacks,
 * so before the cmap check every character looked present and the CLI happily
 * embedded glyphs from whatever the host had installed. That is exactly the kind
 * of defect a unit test cannot see: it depends on the machine's fonts.
 *
 *   node scripts/check-coverage.mjs
 *
 * Silkscreen is a 31 KB pixel face with no Greek and no arrows. Asking it for
 * one must fail; the same request with a fallback that has them must succeed and
 * must record both typefaces. Exit 0 when both hold, 1 otherwise.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'bin', 'lgfx-font.js');
const charset = join(root, 'test', 'fixtures', 'ci-fallback.txt');
const out = join(root, 'coverage-check.h');

/** @param {string[]} args */
const run = (args) => {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: root });
  return { code: r.status ?? 1, stderr: r.stderr ?? '' };
};

/** @type {string[]} */
const failures = [];
/** @param {string} what @param {boolean} ok @param {string} [detail] */
function expect(what, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!ok) failures.push(what + (detail ? `\n        ${detail.trim().split('\n')[0]}` : ''));
}

rmSync(out, { force: true });

// ASCII comes from Silkscreen; the fixture adds the two characters it lacks.
const base = ['build', '--google', 'Silkscreen', '--em', '8',
  '--sets', 'ascii', '--charset', charset, '--format', 'cellfont'];

const absent = run([...base, '--out', out]);
expect(
  'a character the typeface lacks is reported, not drawn by a system font',
  absent.code === 1 && /not in the source/.test(absent.stderr),
  absent.stderr,
);

const filled = run([...base, '--fallback', 'google:Tiny5', '--out', out]);
expect('--fallback supplies it', filled.code === 0 && /filled 2 character/.test(filled.stderr), filled.stderr);

if (filled.code === 0) {
  const text = readFileSync(out, 'utf8');
  expect('both typefaces are named in the notice', text.includes('Silkscreen') && text.includes('Tiny5'));
  expect('the fallback gets its own licence block', /were taken from:/.test(text));
  // Match the command, not the label: the label's wording has drifted before
  // (it gained the --out note) while the line that matters stayed put.
  const rebuild = /Rebuild with[^\n]*:\n\/\/\s+(\S[^\n]*)/.exec(text);
  expect(
    'the rebuild command is recorded',
    !!rebuild && /lgfx-font build/.test(rebuild[1]) && rebuild[1].includes('--fallback google:Tiny5'),
    rebuild ? rebuild[1] : 'no "Rebuild with" line',
  );
}

rmSync(out, { force: true });

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}

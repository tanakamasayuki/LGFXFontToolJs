// @ts-check
/** Ensures implementation comments in src/ stay English while allowing localized data strings. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const nonLatin = /[ぁ-んァ-ヶ一-龠々]/;

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (name.endsWith('.js')) out.push(path);
  }
  return out;
}

/** @type {string[]} */
const errors = [];
for (const file of walk(srcRoot)) {
  const source = readFileSync(file, 'utf8');
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token !== ts.SyntaxKind.SingleLineCommentTrivia &&
      token !== ts.SyntaxKind.MultiLineCommentTrivia
    ) continue;
    const comment = scanner.getTokenText();
    if (!nonLatin.test(comment)) continue;
    const line = source.slice(0, scanner.getTokenPos()).split('\n').length;
    const rel = relative(srcRoot, file).split(sep).join('/');
    errors.push(`${rel}:${line}: non-English implementation comment`);
  }
}

if (errors.length) {
  console.error('source comment check failed:');
  for (const error of errors) console.error('  ' + error);
  process.exit(1);
}
console.log('source comment check ok');

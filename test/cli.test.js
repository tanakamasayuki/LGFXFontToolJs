// @ts-check
/**
 * CLI（docs/cli.ja.md）。終了コードと出力の契約を、実際にコマンドを起動して確かめる。
 * ネットワークと任意依存（ラスタライザ）には触れないよう、入力は同梱フォントに限る。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCharsetFile } from '../bin/lgfx-font.js';
import { encodePng, renderSheet, renderText } from '../bin/render.js';
import { defaultCacheDir } from '../bin/sources.js';
import { loadFont } from '../src/fonts/loader.js';
import { subset } from '../src/model/subset.js';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'lgfx-font.js');

/**
 * Runs the CLI and returns its exit code with both streams.
 * @param {string[]} args
 */
function run(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** @type {string} */
let dir;
/** @param {string} name */
const tmp = (name) => join(dir, name);
test.before(() => {
  dir = mkdtempSync(join(tmpdir(), 'lgfx-cli-'));
});
test.after(() => {
  rmSync(dir, { recursive: true, force: true });
});

//--- 終了コードの契約（§10） -----------------------------------------------------

test('--format は必須で、省略すると形式一覧を出して 3 で終わる', () => {
  const r = run(['build', '--font', 'DejaVu9', '--chars', 'AB', '--out', tmp('a.h')]);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /--format is required/);
  assert.match(r.stderr, /cellfont/, '一覧に cellfont が出る');
  assert.match(r.stderr, /u8g2/);
});

test('書体に無い文字は既定でエラー（1）、--allow-missing で警告に落ちる', () => {
  const args = ['build', '--font', 'DejaVu9', '--chars', 'AB温度', '--format', 'u8g2', '--out', tmp('b.u8g2')];
  const strict = run(args);
  assert.equal(strict.code, 1);
  assert.match(strict.stderr, /not in the source/);
  assert.ok(!existsSync(tmp('b.u8g2')), '失敗時は書かない');

  const lenient = run([...args, '--allow-missing']);
  assert.equal(lenient.code, 0);
  assert.match(lenient.stderr, /warning/);
  assert.ok(existsSync(tmp('b.u8g2')));
});

test('文字が 1 つも選ばれなければエラー（1）', () => {
  const r = run(['build', '--font', 'DejaVu9', '--format', 'u8g2', '--out', tmp('c.u8g2')]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no characters/);
});

test('形式と容器の組み合わせが不正ならエラー（3）', () => {
  const raw = run(['build', '--font', 'DejaVu9', '--chars', 'AB', '--format', 'cellfont', '--out', tmp('d.bin')]);
  assert.equal(raw.code, 3, 'cellfont は生ファイル不可');
  const csrc = run(['build', '--font', 'DejaVu9', '--chars', 'AB', '--format', 'bdf', '--out', tmp('d.h')]);
  assert.equal(csrc.code, 3, 'bdf は C ソース不可');
});

test('入力は 1 つだけ（3）', () => {
  const r = run([
    'build', '--font', 'DejaVu9', '--input', tmp('nope.u8g2'),
    '--chars', 'AB', '--format', 'u8g2', '--out', tmp('e.u8g2'),
  ]);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /exactly one of/);
});

//--- --check（§7） ---------------------------------------------------------------

test('--check: 一致で 0、不一致で 2、出力が無ければ 2。いずれも書かない', () => {
  const out = tmp('chk.u8g2');
  const base = ['build', '--font', 'DejaVu9', '--format', 'u8g2', '--out', out];

  assert.equal(run([...base, '--chars', 'AB', '--check']).code, 2, '未生成も不一致');
  assert.ok(!existsSync(out));

  assert.equal(run([...base, '--chars', 'AB']).code, 0);
  const written = readFileSync(out);

  assert.equal(run([...base, '--chars', 'AB', '--check']).code, 0, '一致');
  const diff = run([...base, '--chars', 'ABC', '--check']);
  assert.equal(diff.code, 2, '内容が変われば不一致');
  assert.match(diff.stderr, /differs/);
  assert.deepEqual(readFileSync(out), written, '--check は上書きしない');
});

test('同じコマンドを二度走らせるとバイト一致の出力が出る', () => {
  // 出力先の名前はヘッダの再現コマンドに載るので、比較は同じ --out で行う。
  const a = tmp('det.h');
  const args = ['build', '--font', 'lgfxJapanGothic_12', '--chars', 'ABC温度', '--format', 'cellfont', '--out', a, '--name', 'F'];
  assert.equal(run(args).code, 0);
  const first = readFileSync(a);
  assert.equal(run(args).code, 0);
  assert.deepEqual(readFileSync(a), first);
});

test('再現コマンドが記録され、絶対パスはファイル名に丸められる', () => {
  const out = tmp('repro.h');
  assert.equal(
    run(['build', '--font', 'lgfxJapanGothic_12', '--chars', 'A B', '--format', 'cellfont', '--out', out]).code,
    0,
  );
  const text = readFileSync(out, 'utf8');
  assert.match(text, /Rebuild with:/);
  assert.match(text, /npx lgfx-font build --font lgfxJapanGothic_12/, 'npx 付きで動く形');
  assert.doesNotMatch(text, /\\\n/, 'コメント内で折り返すとコピーしても動かないので 1 行');
  assert.match(text, /--chars 'A B'/, '空白を含む値は引用される');
  assert.match(text, /--out repro\.h/, '作業ディレクトリ外の絶対パスはファイル名だけになる');
  assert.doesNotMatch(text, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '絶対パスは残らない');
  // 出力に影響しない指定は載せない。
  assert.doesNotMatch(text, /--cache-dir|--preview|--check/);
});

test('--version は版だけを標準出力に出す', () => {
  const pkg = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
  for (const flag of ['--version', '-v', 'version']) {
    const r = run([flag]);
    assert.equal(r.code, 0, flag);
    assert.equal(r.stdout.trim(), pkg.version, flag);
  }
});

test('--fallback は --em を要求する（3）', () => {
  // 補完はラスタライズなので、ビットマップ入力でも寸法の指定が要る。
  const r = run(['build', '--font', 'lgfxJapanGothic_12', '--chars', 'A', '--format', 'cellfont',
    '--fallback', 'google:Roboto', '--out', tmp('fb.h')]);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /--em is required when --fallback is used/);
});

test('CellFont ヘッダは読み戻せないと明言する', () => {
  const cf = tmp('rt.h');
  assert.equal(
    run(['build', '--font', 'lgfxJapanGothic_12', '--chars', 'AB', '--format', 'cellfont', '--out', cf]).code,
    0,
  );
  const r = run(['build', '--input', cf, '--chars', 'AB', '--format', 'u8g2', '--out', tmp('rt2.h')]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no readable font/);
  assert.match(r.stderr, /Rebuild with/, '代わりに何をすればよいかを言う');
});

test('--no-wrapper は u8g2 だけで、LovyanGFX の型宣言を落とす', () => {
  const base = ['build', '--font', 'lgfxJapanGothic_12', '--chars', 'AB', '--format', 'u8g2', '--name', 'W'];
  const wrapped = tmp('w.h');
  assert.equal(run([...base, '--out', wrapped]).code, 0);
  const withWrapper = readFileSync(wrapped, 'utf8');
  assert.match(withWrapper, /static const lgfx::U8g2font W\(W_data\);/);
  assert.match(withWrapper, /static const uint8_t W_data\[/);

  const raw = tmp('raw.h');
  assert.equal(run([...base, '--no-wrapper', '--out', raw]).code, 0);
  const withoutWrapper = readFileSync(raw, 'utf8');
  assert.doesNotMatch(withoutWrapper, /lgfx::/, 'LovyanGFX の型は出てこない');
  assert.match(withoutWrapper, /static const uint8_t W\[/, '配列そのものがフォント記号になる');
  assert.match(withoutWrapper, /u8g2\.setFont\(W\);/);

  const bad = run(['build', '--font', 'lgfxJapanGothic_12', '--chars', 'AB', '--format', 'gfx',
    '--no-wrapper', '--out', tmp('bad.h')]);
  assert.equal(bad.code, 3);
  assert.match(bad.stderr, /--no-wrapper applies to --format u8g2/);
});

//--- 収まりの検査（§4.5） ---------------------------------------------------------

test('--max-height を超えたらエラー（1）', () => {
  const args = ['build', '--font', 'lgfxJapanGothic_16', '--chars', '温度', '--format', 'cellfont', '--out', tmp('h.h')];
  assert.equal(run([...args, '--max-height', '12']).code, 1);
  assert.equal(run([...args, '--max-height', '99']).code, 0);
});

//--- 出力の中身（§6） -------------------------------------------------------------

test('cellfont の C ソースは版ガードと include ガードを持つ', () => {
  const out = tmp('cf.h');
  assert.equal(run(['build', '--font', 'lgfxJapanGothic_12', '--chars', 'ABC', '--format', 'cellfont', '--out', out, '--name', 'MyFont']).code, 0);
  const src = readFileSync(out, 'utf8');
  assert.match(src, /#pragma once/);
  assert.match(src, /#include <stdint\.h>/);
  assert.ok(!/#include <CellFont\.h>/.test(src), '描画器のヘッダは include しない');
  assert.match(src, /#if !defined\(CELLFONT_SPEC_VERSION\)/);
  assert.match(src, /static const CellFont MyFont LGFXFT_PROGMEM/);
  assert.ok(!/[/\\]tmp[/\\]/.test(src), '絶対パスを出力に入れない（正準出力）');
});

test('--name 省略時は --out の basename から C 識別子を作る', () => {
  const out = tmp('my-font.h');
  assert.equal(run(['build', '--font', 'DejaVu9', '--chars', 'AB', '--format', 'cellfont', '--out', out]).code, 0);
  assert.match(readFileSync(out, 'utf8'), /static const CellFont my_font LGFXFT_PROGMEM/);
});

test('--target で CellFont の対象 ABI が変わる', () => {
  /** @param {string} abi @param {string} file */
  const mk = (abi, file) => {
    assert.equal(run(['build', '--font', 'lgfxJapanGothic_12', '--sets', 'ascii', '--format', 'cellfont', '--out', tmp(file), '--target', abi, '--name', 'F']).code, 0);
    return readFileSync(tmp(file), 'utf8');
  };
  assert.notEqual(mk('ilp32', 'abi32.h'), mk('avr', 'abiavr.h'), 'ABI で選ぶ候補が変わりうる');
});

//--- 文字集合ファイル（§11） ------------------------------------------------------

test('parseCharsetFile: コメント・@集合・U+範囲・リテラルを読む', () => {
  const cps = parseCharsetFile('# comment\n@digits\nU+00B0-U+00B1\n温度\n');
  assert.ok(cps.has(0x30) && cps.has(0x39), '@digits');
  assert.ok(cps.has(0xb0) && cps.has(0xb1), 'U+ 範囲');
  assert.ok(cps.has(0x6e29) && cps.has(0x5ea6), 'リテラル');
  assert.ok(!cps.has(0x23), '# 行は無視');
});

test('charset --normalize は行ごとに整え、行をまたいで文字を動かさない', () => {
  const f = tmp('cs.txt');
  writeFileSync(f, '# 見出し\n@ascii\n温度温度設定\nBA\n');
  const r = run(['charset', f]);
  assert.equal(r.code, 0);
  const lines = r.stdout.split('\n');
  assert.equal(lines[0], '# 見出し', 'コメントは残る');
  assert.equal(lines[1], '@ascii', '@ は展開しない');
  assert.equal(lines[2], '定度温設', '行内で重複除去してコード順');
  assert.equal(lines[3], 'AB', '別の行はそのまま別の行');
  assert.equal(readFileSync(f, 'utf8'), '# 見出し\n@ascii\n温度温度設定\nBA\n', '既定では書き換えない');

  assert.equal(run(['charset', f, '--write']).code, 0);
  assert.match(readFileSync(f, 'utf8'), /定度温/, '--write で置換する');
});

test('charset --expand は @集合を実際の文字に展開する', () => {
  const f = tmp('cs2.txt');
  writeFileSync(f, '@digits\n℃\n');
  const r = run(['charset', f, '--expand']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /0123456789/);
  assert.match(r.stdout, /℃/);
});

test('charset --list は定義済みの集合とテンプレートを出す', () => {
  const r = run(['charset', '--list']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /ascii/);
  assert.match(r.stdout, /hanJaG6/, 'UI に出していない集合も含む');
  assert.match(r.stdout, /templates/);
});

test('未知の集合名はエラー（3）', () => {
  const r = run(['build', '--font', 'DejaVu9', '--sets', 'nosuchset', '--format', 'u8g2', '--out', tmp('z.u8g2')]);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /unknown set/);
});

//--- inspect（§9） ---------------------------------------------------------------

test('inspect は既存フォントを読み、--json で機械可読に出す', () => {
  const out = tmp('ins.u8g2');
  assert.equal(run(['build', '--font', 'DejaVu9', '--sets', 'ascii', '--format', 'u8g2', '--out', out]).code, 0);

  const human = run(['inspect', out]);
  assert.equal(human.code, 0);
  assert.match(human.stdout, /glyphs\s+95/);

  const json = run(['inspect', out, '--json']);
  assert.equal(json.code, 0);
  const parsed = JSON.parse(json.stdout);
  assert.equal(typeof parsed.sizes.u8g2, 'number');
});

test('inspect: 無いファイルはエラー（3）', () => {
  assert.equal(run(['inspect', tmp('missing.u8g2')]).code, 3);
});

//--- 確認用の画像（§8） -----------------------------------------------------------

test('--preview は PNG を書く。--check でも書ける（主出力ではない）', async () => {
  const out = tmp('p.h');
  const png = tmp('p.png');
  assert.equal(run(['build', '--font', 'DejaVu9', '--sets', 'digits', '--format', 'cellfont', '--out', out, '--preview', png]).code, 0);
  const sig = readFileSync(png).subarray(0, 8);
  assert.deepEqual([...sig], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG シグネチャ');

  rmSync(png);
  const checked = run(['build', '--font', 'DejaVu9', '--sets', 'digits', '--format', 'cellfont', '--out', out, '--preview', png, '--check']);
  assert.equal(checked.code, 0);
  assert.ok(existsSync(png), '--check でもプレビューは書く');
});

test('renderSheet / renderText は妥当な寸法の画像を返す', async () => {
  const font = subset(await loadFont('DejaVu9'), 'ABC');
  const sheet = renderSheet(font, { cols: 2, zoom: 2 });
  assert.ok(sheet.width > 0 && sheet.height > 0);
  assert.equal(sheet.gray.length, sheet.width * sheet.height);
  const png = encodePng(sheet.gray, sheet.width, sheet.height);
  assert.ok(png.length > 8);

  const line = renderText(font, 'ABC', { zoom: 1 });
  assert.ok(line.width > 0 && line.height > 0);
  assert.equal(line.gray.length, line.width * line.height);
});

//--- 使い方 -----------------------------------------------------------------------

test('引数なし / --help で使い方を出して 0', () => {
  for (const args of [[], ['--help'], ['build', '--help']]) {
    const r = run(args);
    assert.equal(r.code, 0, args.join(' '));
    assert.match(r.stdout, /lgfx-font/);
  }
});

test('既定のキャッシュはユーザのキャッシュ配下で、カレントに依存しない', () => {
  const a = defaultCacheDir();
  const before = process.cwd();
  try {
    process.chdir(dir);
    assert.equal(defaultCacheDir(), a, 'カレントを変えても同じ場所');
  } finally {
    process.chdir(before);
  }
  assert.ok(a.endsWith('lgfx-font-tool'));
  assert.ok(!a.includes('node_modules'), 'プロジェクト配下ではない');
});

test('取得元の SHA-256 が生成ヘッダに残り、中身が変われば値も変わる', () => {
  const src = tmp('src.u8g2');
  const out = tmp('hash.h');
  assert.equal(run(['build', '--font', 'DejaVu9', '--chars', 'ABC', '--format', 'u8g2', '--out', src]).code, 0);
  assert.equal(run(['build', '--input', src, '--chars', 'ABC', '--format', 'cellfont', '--out', out]).code, 0);
  const first = /Source   : sha256:([0-9a-f]{64})/.exec(readFileSync(out, 'utf8'));
  assert.ok(first, '生成ヘッダに sha256 が入る');

  // 元のフォントが差し替わったら、ハッシュが変わって diff に出る
  const src2 = tmp('src2.u8g2');
  assert.equal(run(['build', '--font', 'DejaVu9', '--chars', 'AB', '--format', 'u8g2', '--out', src2]).code, 0);
  const out2 = tmp('hash2.h');
  assert.equal(run(['build', '--input', src2, '--chars', 'AB', '--format', 'cellfont', '--out', out2]).code, 0);
  const second = /Source   : sha256:([0-9a-f]{64})/.exec(readFileSync(out2, 'utf8'));
  assert.ok(second);
  assert.notEqual(first[1], second[1], '別の入力なら別のハッシュ');
});

test('--list-google はキュレーション済みの書体を出す', () => {
  const r = run(['build', '--list-google']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Noto Sans JP/);
  assert.match(r.stdout, /OFL|Apache/, 'ライセンスも添える');
});

test('charset は既定で正準化し、--normalize は明示形として同じ結果を出す', () => {
  const f = tmp('same.txt');
  writeFileSync(f, '# c\n温度温度\n');
  const a = run(['charset', f]);
  const b = run(['charset', f, '--normalize']);
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  assert.equal(a.stdout, b.stdout);
});

test('未知のコマンドはエラー（3）', () => {
  const r = run(['nope']);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /unknown command/);
});

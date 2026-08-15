// @ts-check
/**
 * オラクル一致テスト（仕様 §13.1）。
 *
 * oracle/ のハーネスが実物の LovyanGFX（lang-ship:host ビルド）で描いた
 * 1bpp ビットマップと、本ライブラリの描画がバイト列レベルで完全一致すること。
 * 計測値（textWidth / fontHeight / drawString の戻り値）も同時に照合する。
 *
 * fixture の再生成: npm run oracle（oracle/README.ja.md 参照）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadFont } from '../src/fonts/loader.js';
import { createBitmap, bitmapToText } from '../src/model/bitmap.js';
import { drawString } from '../src/render/draw.js';
import { textWidth, fontHeight } from '../src/render/measure.js';

// oracle_dump.ino の kAscii / kCjk と一致させること。
const TEXTS = {
  ascii: 'Ag9 !~',
  cjk: '日本語あア漢A9',
};

const indexUrl = new URL('./fixtures/oracle/oracle-index.jsonl', import.meta.url);
const binUrl = new URL('./fixtures/oracle/oracle-bitmaps.bin', import.meta.url);

const lines = (await readFile(indexUrl, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
const bin = new Uint8Array(await readFile(binUrl));

test('オラクル: LovyanGFX と完全一致する', async (t) => {
  assert.equal(lines.length, 1860);

  /** @type {Map<string, {total: number, failed: number}>} */
  const perFont = new Map();
  /** @type {string[]} */
  const failures = [];

  for (const c of lines) {
    const font = await loadFont(c.font);
    const text = TEXTS[/** @type {keyof typeof TEXTS} */ (c.text)];
    const style = { sizeX: c.sizeX, sizeY: c.sizeY, datum: c.datum };

    const stat = perFont.get(c.font) ?? { total: 0, failed: 0 };
    stat.total++;
    perFont.set(c.font, stat);

    const caseName = `${c.font} ${c.text} x${c.sizeX}/${c.sizeY} datum=${c.datum}`;
    /** @type {string[]} */
    const problems = [];

    const tw = textWidth(font, text, style);
    if (tw !== c.textWidth) problems.push(`textWidth ${tw} != ${c.textWidth}`);
    const fh = fontHeight(font, style);
    if (fh !== c.fontHeight) problems.push(`fontHeight ${fh} != ${c.fontHeight}`);

    const bmp = createBitmap(c.w, c.h, 1);
    const r = drawString(bmp, font, text, c.x, c.y, style);
    if (r.advance !== c.advance) problems.push(`advance ${r.advance} != ${c.advance}`);

    const expected = bin.subarray(c.offset, c.offset + c.bytes);
    let diff = -1;
    for (let i = 0; i < c.bytes; i++) {
      if (bmp.data[i] !== expected[i]) {
        diff = i;
        break;
      }
    }
    if (diff >= 0) problems.push(`bitmap differs at byte ${diff}`);

    if (problems.length > 0) {
      stat.failed++;
      if (failures.length < 10) {
        failures.push(`${caseName}: ${problems.join(', ')}`);
        if (diff >= 0 && failures.length <= 3) {
          const exp = { ...bmp, data: Uint8Array.from(expected) };
          failures.push('--- expected (LovyanGFX) ---\n' + bitmapToText(exp));
          failures.push('--- actual (this library) ---\n' + bitmapToText(bmp));
        }
      }
    }
  }

  const failedFonts = [...perFont.entries()].filter(([, s]) => s.failed > 0);
  const failedCases = failedFonts.reduce((n, [, s]) => n + s.failed, 0);
  if (failedCases > 0) {
    const summary = failedFonts
      .slice(0, 20)
      .map(([name, s]) => `${name}: ${s.failed}/${s.total}`)
      .join('\n');
    assert.fail(
      `${failedCases}/${lines.length} cases differ from LovyanGFX\n` +
        `fonts:\n${summary}\n\nfirst failures:\n${failures.join('\n')}`,
    );
  }
});

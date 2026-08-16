// @ts-check
/**
 * 実物一致テスト（仕様 §13.3）。
 *
 * 本ライブラリのエンコーダが出力した u8g2 / GFXfont バイナリを
 * 実物の LovyanGFX（oracle/oracle_encoded ハーネス）が描いた結果と、
 * 同じバイナリを本ライブラリでデコード → 描画した結果が完全一致すること。
 *
 * 往復テスト（§13.2）は「自分の読み書きが自己整合」までしか言えない。
 * ここが落とすのは書き方の解釈ずれ——特に u8g2 のジャンプ表は
 * 本ライブラリのデコーダが読み飛ばすため、この照合が唯一の検証になる。
 *
 * fixture の再生成: npm run oracle:encoded
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decode } from '../src/format/registry.js';
import { createBitmap } from '../src/model/bitmap.js';
import { drawString } from '../src/render/draw.js';
import { textWidth, fontHeight } from '../src/render/measure.js';

// oracle_encoded.ino の kAscii / kCjk と一致させること。
const TEXTS = { ascii: 'Ag9 !~', cjk: '日本語あア漢A9' };

const base = new URL('./fixtures/oracle-encoded/', import.meta.url);
const lines = (await readFile(new URL('oracle-index.jsonl', base), 'utf8'))
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));
const bin = new Uint8Array(await readFile(new URL('oracle-bitmaps.bin', base)));

test('実物一致: エンコード結果を LovyanGFX が読んだ描画と一致する', async () => {
  assert.equal(lines.length, 36);
  /** @type {Map<string, import('../src/model/font.js').Font>} */
  const cache = new Map();
  for (const c of lines) {
    let font = cache.get(c.file);
    if (!font) {
      const bytes = new Uint8Array(await readFile(new URL(c.file, base)));
      const format = c.file.endsWith('.u8g2')
        ? 'u8g2'
        : c.file.endsWith('.vlw')
          ? 'vlw'
          : c.file.endsWith('.bff')
            ? 'bff'
            : 'gfx';
      font = decode(bytes, { format });
      cache.set(c.file, font);
    }
    const text = TEXTS[/** @type {keyof typeof TEXTS} */ (c.text)];
    const style = { sizeX: c.sizeX, sizeY: c.sizeY, datum: 0 };
    const label = `${c.file} ${c.text} x${c.sizeX}`;

    assert.equal(textWidth(font, text, style), c.textWidth, `${label}: textWidth`);
    assert.equal(fontHeight(font, style), c.fontHeight, `${label}: fontHeight`);

    const bmp = createBitmap(c.w, c.h, 1);
    const r = drawString(bmp, font, text, c.x, c.y, style);
    assert.equal(r.advance, c.advance, `${label}: advance`);

    const expected = bin.subarray(c.offset, c.offset + c.bytes);
    for (let i = 0; i < c.bytes; i++) {
      assert.equal(bmp.data[i], expected[i], `${label}: bitmap byte ${i}`);
    }
  }
});

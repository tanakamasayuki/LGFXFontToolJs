// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBitmap, getPixel, bitmapEquals, createBitmap as newBitmap } from '../src/model/bitmap.js';
import { drawString, drawChar } from '../src/render/draw.js';
import { textWidth, fontHeight, measureText } from '../src/render/measure.js';
import { tinyFont } from './helpers.js';
import { loadFont } from '../src/fonts/loader.js';

test('drawString: 等倍でグリフがそのまま置かれる', () => {
  const font = tinyFont();
  const bmp = createBitmap(8, 6, 1);
  const r = drawString(bmp, font, 'A', 0, 0);
  assert.equal(r.advance, 5);
  // グリフは boxRow = ascent + yOffset = 0 から始まる
  const expected = ['.##.', '#..#', '####', '#..#'];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      assert.equal(getPixel(bmp, x, y), expected[y][x] === '#' ? 1 : 0, `(${x},${y})`);
    }
  }
  // ボックス外は空
  assert.equal(getPixel(bmp, 0, 5), 0);
});

test('datum: baseline-left は top-left をアセントぶん上げたもの', () => {
  const font = tinyFont();
  const a = createBitmap(8, 8, 1);
  const b = createBitmap(8, 8, 1);
  drawString(a, font, 'A', 0, 0, { datum: 'top-left' });
  drawString(b, font, 'A', 0, 4, { datum: 'baseline-left' });
  assert.ok(bitmapEquals(a, b));
});

test('datum: top-right は幅ぶん左へ', () => {
  const font = tinyFont();
  const a = createBitmap(10, 6, 1);
  const b = createBitmap(10, 6, 1);
  drawString(a, font, 'A', 0, 0);
  drawString(b, font, 'A', 5, 0, { datum: 'top-right' }); // cwidth = 5
  assert.ok(bitmapEquals(a, b));
});

test('整数倍率: 2 倍で各ピクセルが 2x2 になる', () => {
  const font = tinyFont();
  const base = createBitmap(4, 4, 1);
  drawString(base, font, 'A', 0, 0);
  const scaled = createBitmap(8, 8, 1);
  const r = drawString(scaled, font, 'A', 0, 0, { sizeX: 2, sizeY: 2 });
  assert.equal(r.advance, 10);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      assert.equal(getPixel(scaled, x, y), getPixel(base, x >> 1, y >> 1), `(${x},${y})`);
    }
  }
});

test('非整数倍率: LGFX と同じ固定小数点で送りが決まる', () => {
  const font = tinyFont();
  const bmp = createBitmap(16, 10, 1);
  const r = drawString(bmp, font, 'A', 0, 0, { sizeX: 1.5, sizeY: 1.5 });
  // (5 * trunc(1.5*65536)) >> 16 = 7
  assert.equal(r.advance, 7);
});

test('textWidth / fontHeight / measureText', () => {
  const font = tinyFont();
  assert.equal(textWidth(font, 'A'), 5);
  assert.equal(textWidth(font, 'AA'), 10);
  assert.equal(fontHeight(font), 5);
  const m = measureText(font, 'A', { sizeY: 2 });
  assert.equal(m.height, 10);
  assert.equal(m.ascent, 8);
  assert.equal(m.lineHeight, 12);
});

test('収録外文字は代替ボックスを描いて送る', () => {
  const font = tinyFont();
  const bmp = createBitmap(8, 6, 1);
  const r = drawString(bmp, font, 'B', 0, 0);
  assert.equal(r.advance, 3); // fallback.advance
  assert.equal(getPixel(bmp, 1, 1), 1); // 枠の左上
});

test('制御文字と異体字セレクタは読み飛ばす', () => {
  const font = tinyFont();
  assert.equal(textWidth(font, '\nA️'), 5);
});

test('内蔵フォント: Font0 の等倍描画はグリフと一致する', async () => {
  const font = await loadFont('Font0');
  const glyph = font.glyphs.get(0x41);
  assert.ok(glyph);
  const bmp = newBitmap(6, 8, 1);
  drawString(bmp, font, 'A', 0, 0);
  assert.ok(bitmapEquals(bmp, glyph.bitmap));
});

test('内蔵フォント: u8g2 日本語の描画スモーク', async () => {
  const font = await loadFont('lgfxJapanGothic_12');
  const bmp = newBitmap(24, 16, 1);
  const r = drawString(bmp, font, 'あ', 0, 0);
  assert.ok(r.advance > 0);
  let set = 0;
  for (let y = 0; y < bmp.height; y++) {
    for (let x = 0; x < bmp.width; x++) set += getPixel(bmp, x, y);
  }
  assert.ok(set > 10, `pixels: ${set}`);
  // グリフ矩形の再配置と drawString の出力が一致する
  const glyph = font.glyphs.get('あ'.codePointAt(0) ?? 0);
  assert.ok(glyph);
  const direct = newBitmap(24, 16, 1);
  drawChar(direct, font, 0x3042, 0, 0);
  assert.ok(bitmapEquals(bmp, direct));
});

test('内蔵フォント: RLE (Font4) の描画スモーク', async () => {
  const font = await loadFont('Font4');
  const bmp = newBitmap(32, 32, 1);
  const r = drawString(bmp, font, '0', 0, 0);
  assert.ok(r.advance > 0);
  let set = 0;
  for (let y = 0; y < bmp.height; y++) {
    for (let x = 0; x < bmp.width; x++) set += getPixel(bmp, x, y);
  }
  assert.ok(set > 20, `pixels: ${set}`);
});

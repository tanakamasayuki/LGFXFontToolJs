// @ts-check
/**
 * decodeCSource（UC5: GitHub の .h を貼り付けたら読める）。
 * 検証データは本ライブラリ自身の出力（emitU8g2Header / emitGfxHeader）と、
 * Adafruit GFX 流の手書きヘッダ・bdfconv 流の文字列リテラル。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCSource, decodeCSource } from '../src/format/csource.js';
import { encodeU8g2 } from '../src/format/u8g2.js';
import { bitmapEquals } from '../src/model/bitmap.js';
import { loadFont } from '../src/fonts/loader.js';
import { subset } from '../src/model/subset.js';

/** @typedef {import('../src/model/font.js').Font} Font */

/** @param {Font} a @param {Font} b @param {string} label */
function assertGlyphsEqual(a, b, label) {
  assert.equal(b.glyphs.size, a.glyphs.size, `${label}: glyph count`);
  for (const [cp, ga] of a.glyphs) {
    const gb = b.glyphs.get(cp);
    assert.ok(gb, `${label}: U+${cp.toString(16)} missing`);
    assert.equal(gb.xAdvance, ga.xAdvance, `${label}: U+${cp.toString(16)} xAdvance`);
    assert.ok(bitmapEquals(gb.bitmap, ga.bitmap), `${label}: U+${cp.toString(16)} bitmap`);
  }
}

test('decodeCSource: 自ライブラリの u8g2 .h を読み戻す', async () => {
  const font = subset(await loadFont('lgfxJapanGothic_16'), 'こんにちは012A');
  const src = encodeCSource(font, { format: 'u8g2', symbolName: 'RoundTrip16' });
  const found = decodeCSource(src);
  assert.equal(found.length, 1);
  assert.equal(found[0].format, 'u8g2');
  assert.equal(found[0].name, 'RoundTrip16_data');
  assertGlyphsEqual(font, found[0].font, 'u8g2 .h');
});

test('decodeCSource: 自ライブラリの GFX .h（単一範囲 / EncodeRange 付き）を読み戻す', async () => {
  const plainSrc = encodeCSource(await loadFont('FreeSans9pt7b'), {
    format: 'gfx',
    symbolName: 'FS9',
  });
  const plain = decodeCSource(plainSrc);
  assert.equal(plain.length, 1);
  assert.equal(plain[0].format, 'gfx');
  assert.equal(plain[0].name, 'FS9');
  assertGlyphsEqual(await loadFont('FreeSans9pt7b'), plain[0].font, 'gfx plain');

  const kana = subset(await loadFont('lgfxJapanGothic_16'), 'あいうえおABC');
  const ranged = decodeCSource(encodeCSource(kana, { format: 'gfx', symbolName: 'Kana' }));
  assert.equal(ranged.length, 1);
  assertGlyphsEqual(kana, ranged[0].font, 'gfx ranged');
});

test('decodeCSource: Adafruit GFX 流の手書きヘッダを読む', () => {
  // TomThumb 風の最小ヘッダ（'A' 1 グリフ）
  const src = `
/* stub license comment */
const uint8_t MiniBitmaps[] PROGMEM = { 0x69, 0xF9, 0x90 };
const GFXglyph MiniGlyphs[] PROGMEM = {
  { 0, 4, 5, 5, 0, -5 } }; // 'A'
const GFXfont Mini PROGMEM = {
  (uint8_t  *)MiniBitmaps,
  (GFXglyph *)MiniGlyphs,
  0x41, 0x41, 6 };
`;
  const found = decodeCSource(src);
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'Mini');
  const g = found[0].font.glyphs.get(0x41);
  assert.ok(g);
  assert.equal(g.bitmap.width, 4);
  assert.equal(g.bitmap.height, 5);
  assert.equal(g.xAdvance, 5);
  assert.equal(found[0].font.lineHeight, 6);
});

test('decodeCSource: bdfconv 流の文字列リテラル u8g2 を読む', async () => {
  const font = subset(await loadFont('lgfxJapanGothic_12'), 'A9あ');
  const bytes = encodeU8g2(font);
  // バイト列を 8 進エスケープの C 文字列にする（bdfconv の出力形）。
  // 3 桁固定にして「\1 の直後に数字文字」の誤結合を避ける
  let lit = '';
  for (const b of bytes) {
    if (b >= 0x20 && b < 0x7f && b !== 0x22 && b !== 0x5c) lit += String.fromCharCode(b);
    else lit += '\\' + b.toString(8).padStart(3, '0');
  }
  const src = `const uint8_t my_font[${bytes.length}] U8G2_FONT_SECTION("my_font") =\n  "${lit}";\n`;
  const found = decodeCSource(src);
  assert.equal(found.length, 1);
  assert.equal(found[0].format, 'u8g2');
  assertGlyphsEqual(font, found[0].font, 'string literal u8g2');
});

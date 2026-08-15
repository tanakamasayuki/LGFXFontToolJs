// @ts-check
/**
 * 内蔵コレクション: カタログ整合と全 186 本のデコード。
 * 内蔵フォント自体がデコーダの実データテストを兼ねる（仕様 §15）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fontCatalog, collectionInfo } from '../src/fonts/catalog.js';
import { loadFont } from '../src/fonts/loader.js';

test('カタログは 186 本', () => {
  assert.equal(fontCatalog.length, 186);
  assert.equal(collectionInfo.fontCount, 186);
  const formats = new Map();
  for (const e of fontCatalog) {
    formats.set(e.format, (formats.get(e.format) ?? 0) + 1);
  }
  assert.equal(formats.get('u8g2'), 116);
  assert.equal(formats.get('gfx'), 61);
  assert.equal(formats.get('glcd'), 2);
  assert.equal(formats.get('fixedbmp'), 2);
  assert.equal(formats.get('bmp'), 1);
  assert.equal(formats.get('rle'), 4);
});

test('全フォントがデコードでき、カタログの値と一致する', async () => {
  for (const entry of fontCatalog) {
    const font = await loadFont(entry.name);
    assert.equal(font.glyphs.size, entry.glyphCount, `${entry.name}: glyphCount`);
    assert.equal(font.lineHeight, entry.lineHeight, `${entry.name}: lineHeight`);
    assert.equal(font.ascent, entry.ascent, `${entry.name}: ascent`);
    assert.equal(font.descent, entry.descent, `${entry.name}: descent`);
    // メトリクスが int16 に収まる（仕様 §5.1）
    for (const g of font.glyphs.values()) {
      for (const v of [g.xOffset, g.yOffset, g.xAdvance, g.bitmap.width, g.bitmap.height]) {
        assert.ok(v >= -32768 && v <= 32767, `${entry.name} U+${g.codepoint.toString(16)}: ${v}`);
      }
    }
  }
});

test('未知のフォント名はエラー', () => {
  assert.throws(() => loadFont('NoSuchFont'), /UNKNOWN_FONT|not in catalog/);
});

test('coverage: 日本語フォントは ascii と kana を持つ', async () => {
  const entry = fontCatalog.find((e) => e.name === 'lgfxJapanGothic_16');
  assert.ok(entry);
  assert.ok(entry.coverage.includes('ascii'));
  assert.ok(entry.coverage.includes('kana'));
});

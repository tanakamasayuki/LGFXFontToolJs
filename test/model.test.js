// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBitmap, getPixel, setPixel, bitmapEquals } from '../src/model/bitmap.js';
import { subset, merge } from '../src/model/subset.js';
import { serializeFont, deserializeFont } from '../src/model/serialize.js';
import { tinyFont, bitmapFromText } from './helpers.js';
import { loadFont } from '../src/fonts/loader.js';

test('Bitmap: 1bpp の get/set と MSB first', () => {
  const bmp = createBitmap(10, 2, 1);
  assert.equal(bmp.stride, 2);
  setPixel(bmp, 0, 0, 1);
  setPixel(bmp, 9, 1, 1);
  assert.equal(bmp.data[0], 0x80);
  assert.equal(bmp.data[3], 0x40);
  assert.equal(getPixel(bmp, 0, 0), 1);
  assert.equal(getPixel(bmp, 9, 1), 1);
  assert.equal(getPixel(bmp, 1, 0), 0);
  assert.equal(getPixel(bmp, -1, 0), 0);
  assert.equal(getPixel(bmp, 10, 0), 0);
});

test('subset: 指定文字だけ残る（非破壊）', () => {
  const font = tinyFont();
  const sub = subset(font, 'A');
  assert.equal(sub.glyphs.size, 1);
  assert.ok(sub.glyphs.has(0x41));
  const empty = subset(font, 'B');
  assert.equal(empty.glyphs.size, 0);
  assert.equal(font.glyphs.size, 1); // 元は不変
});

test('merge: overlay 優先、メトリクス不一致は warning', () => {
  const base = tinyFont();
  const overlay = tinyFont({ ascent: 5, descent: 2, lineHeight: 8 });
  const bGlyph = {
    codepoint: 0x42,
    xOffset: 0,
    yOffset: -4,
    xAdvance: 5,
    bitmap: bitmapFromText(['###.', '#..#', '###.', '#..#']),
  };
  overlay.glyphs.set(0x42, bGlyph);
  const merged = merge(base, overlay);
  assert.equal(merged.glyphs.size, 2);
  assert.equal(merged.ascent, base.ascent); // メトリクスは base
  assert.ok(merged.meta.issues.some((i) => i.code === 'MERGE_METRICS_MISMATCH'));
});

test('serialize: 往復で完全一致', async () => {
  const font = await loadFont('Font2');
  const restored = deserializeFont(JSON.parse(JSON.stringify(serializeFont(font))));
  assert.equal(restored.glyphs.size, font.glyphs.size);
  assert.equal(restored.ascent, font.ascent);
  assert.equal(restored.descent, font.descent);
  assert.equal(restored.lineHeight, font.lineHeight);
  for (const [cp, g] of font.glyphs) {
    const r = restored.glyphs.get(cp);
    assert.ok(r, `U+${cp.toString(16)}`);
    assert.equal(r.xOffset, g.xOffset);
    assert.equal(r.yOffset, g.yOffset);
    assert.equal(r.xAdvance, g.xAdvance);
    assert.ok(bitmapEquals(r.bitmap, g.bitmap), `bitmap U+${cp.toString(16)}`);
  }
});

// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeVlw, encodeVlw, canEncodeVlw } from '../src/format/vlw.js';
import { createBitmap, setPixel, getPixel, bitmapEquals } from '../src/model/bitmap.js';
import { createFont } from '../src/model/font.js';
import { drawString } from '../src/render/draw.js';
import { textWidth } from '../src/render/measure.js';
import { loadFont } from '../src/fonts/loader.js';
import { subset } from '../src/model/subset.js';

/** 8bpp のグラデーション付き試験フォント */
function alphaFont() {
  const bmp = createBitmap(3, 2, 8);
  bmp.data.set([10, 128, 255, 0, 64, 200]);
  const glyphs = new Map();
  glyphs.set(0x41, { codepoint: 0x41, xOffset: 1, yOffset: -2, xAdvance: 4, bitmap: bmp });
  // 走査対象になる CJK グリフ（メトリクス再計算の経路を通す）
  const big = createBitmap(2, 5, 8);
  big.data.fill(255);
  glyphs.set(0x3042, { codepoint: 0x3042, xOffset: 0, yOffset: -4, xAdvance: 5, bitmap: big });
  return createFont({
    familyName: 'Alpha',
    ascent: 4,
    descent: 1,
    lineHeight: 5,
    glyphs,
    meta: { drawProfile: 'vlw' },
  });
}

test('VLW 往復: 8bpp の被覆値がそのまま保存される', () => {
  const font = alphaFont();
  const check = canEncodeVlw(font);
  assert.ok(check.ok, JSON.stringify(check.issues));
  const bytes = encodeVlw(font);
  const restored = decodeVlw(bytes);
  const a = restored.glyphs.get(0x41);
  assert.ok(a);
  assert.equal(a.bitmap.bpp, 8);
  assert.deepEqual([...a.bitmap.data], [10, 128, 255, 0, 64, 200]);
  assert.equal(a.xOffset, 1);
  assert.equal(a.yOffset, -2);
  assert.equal(a.xAdvance, 4);
  // メトリクスはデコード時の再走査で確定する（あ: dY=4, h=5 → descent 1）
  assert.equal(restored.ascent, 4);
  assert.equal(restored.descent, 1);
});

test('VLW 往復: 内蔵フォント（1bpp → 0/255 展開）とメタ経由のヘッダ保存', async () => {
  const src = subset(await loadFont('lgfxJapanGothic_16'), 'こんにちは漢字09A ');
  const bytes = encodeVlw(src);
  const once = decodeVlw(bytes);
  // 2 回目の往復は完全一致（ヘッダ値が meta に保存されるため安定する）
  const twice = decodeVlw(encodeVlw(once));
  assert.equal(twice.glyphs.size, once.glyphs.size);
  assert.equal(twice.ascent, once.ascent);
  assert.equal(twice.descent, once.descent);
  assert.equal(twice.lineHeight, once.lineHeight);
  for (const [cp, g] of once.glyphs) {
    const h = twice.glyphs.get(cp);
    assert.ok(h, `U+${cp.toString(16)}`);
    assert.equal(h.xAdvance, g.xAdvance);
    assert.equal(h.xOffset, g.xOffset);
    assert.equal(h.yOffset, g.yOffset);
    assert.ok(bitmapEquals(h.bitmap, g.bitmap));
  }
  // 1bpp モデルの黒画素は 255 になっている
  const kan = once.glyphs.get('漢'.codePointAt(0) ?? 0);
  assert.ok(kan);
  assert.ok([...kan.bitmap.data].every((v) => v === 0 || v === 255));
});

test('VLW: 空白の癖（描画は spaceWidth、ファイルに空白グリフが無ければ合成）', async () => {
  const src = subset(await loadFont('lgfxJapanGothic_16'), 'AB'); // 空白なし
  const restored = decodeVlw(encodeVlw(src));
  const space = restored.glyphs.get(0x20);
  assert.ok(space, 'space glyph should be synthesized');
  const meta = /** @type {any} */ (restored.meta.format).vlw;
  assert.equal(space.xAdvance, meta.spaceWidth);
  assert.equal(meta.spaceGlyphInFile, false);
  // 描画も計測も spaceWidth で送られる
  const w = textWidth(restored, 'A B');
  const bmp = createBitmap(w + 4, restored.lineHeight + 2, 1);
  const r = drawString(bmp, restored, 'A B', 0, 0);
  assert.equal(r.advance, w);
});

test('VLW 描画: 1bpp 化は「被覆値 1 以上で点灯」、8bpp 先には被覆値そのまま', () => {
  const font = alphaFont();
  const one = createBitmap(8, 6, 1);
  drawString(one, font, 'A', 0, 0);
  // グリフは boxRow = ascent + yOffset = 2、gx = xOffset = 1
  assert.equal(getPixel(one, 1, 2), 1); // a=10 → 点灯
  assert.equal(getPixel(one, 3, 2), 1); // a=255
  assert.equal(getPixel(one, 1, 3), 0); // a=0 → 消灯
  const eight = createBitmap(8, 6, 8);
  drawString(eight, font, 'A', 0, 0);
  assert.equal(getPixel(eight, 1, 2), 10);
  assert.equal(getPixel(eight, 2, 2), 128);
  assert.equal(getPixel(eight, 2, 3), 64);
});

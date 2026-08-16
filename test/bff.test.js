// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBff, encodeBff, canEncodeBff, decodeRleBitmap } from '../src/format/bff.js';
import { detect } from '../src/format/registry.js';
import { createBitmap, bitmapEquals } from '../src/model/bitmap.js';
import { createFont } from '../src/model/font.js';
import { loadFont } from '../src/fonts/loader.js';
import { subset, merge } from '../src/model/subset.js';

/** @typedef {import('../src/model/font.js').Font} Font */

/** @param {Font} a @param {Font} b @param {string} label */
function assertGlyphsEqual(a, b, label) {
  for (const [cp, ga] of a.glyphs) {
    const gb = b.glyphs.get(cp);
    assert.ok(gb, `${label}: U+${cp.toString(16)} missing`);
    assert.equal(gb.xOffset, ga.xOffset, `${label}: U+${cp.toString(16)} xOffset`);
    assert.equal(gb.yOffset, ga.yOffset, `${label}: U+${cp.toString(16)} yOffset`);
    assert.equal(gb.xAdvance, ga.xAdvance, `${label}: U+${cp.toString(16)} xAdvance`);
    assert.ok(bitmapEquals(gb.bitmap, ga.bitmap), `${label}: U+${cp.toString(16)} bitmap`);
  }
}

/** 8bpp グラデーション付き試験フォント（4bpp 経路を通す） */
function alphaFont() {
  const bmp = createBitmap(4, 2, 8);
  // 4bpp で可逆な値（v*255/15 の丸め値: 0,17,136,255 ...）
  bmp.data.set([0, 17, 136, 255, 255, 136, 17, 0]);
  const glyphs = new Map();
  glyphs.set(0x41, { codepoint: 0x41, xOffset: 1, yOffset: -3, xAdvance: 5, bitmap: bmp });
  const kan = createBitmap(3, 4, 8);
  kan.data.fill(255);
  glyphs.set(0x6f22, { codepoint: 0x6f22, xOffset: 0, yOffset: -4, xAdvance: 4, bitmap: kan });
  return createFont({
    familyName: 'AlphaBff',
    ascent: 4,
    descent: 1,
    lineHeight: 5,
    glyphs,
    meta: { drawProfile: 'vlw', fallback: { advance: 3, width: 3, xOffset: 0 } },
  });
}

test('BFF 往復: 4bpp（グラデーション）の正規化が可逆', () => {
  const font = alphaFont();
  const check = canEncodeBff(font);
  assert.ok(check.ok, JSON.stringify(check.issues));
  const bytes = encodeBff(font);
  assert.equal(detect(bytes)[0]?.format, 'bff');
  const restored = decodeBff(bytes);
  assertGlyphsEqual(font, restored, '4bpp');
  assert.equal(restored.ascent, 4);
  assert.equal(restored.descent, 1);
  assert.equal(restored.lineHeight, 5);
  // gid 0（代替グリフ）は fallback の送り幅を持つ空グリフとして現れる
  const g0 = restored.glyphs.get(0);
  assert.ok(g0);
  assert.equal(g0.xAdvance, 3);
  assert.equal(g0.bitmap.width, 0);
});

test('BFF 往復: 内蔵フォント（1bpp）と 2 回目の安定', async () => {
  const src = subset(await loadFont('lgfxJapanGothic_16'), 'こんにちは漢字09A ');
  const once = decodeBff(encodeBff(src));
  // 1bpp 選択の確認（全値 0/255 → bpp 1 が選ばれてもビットマップは 0/255 のまま）
  const kan = once.glyphs.get('漢'.codePointAt(0) ?? 0);
  assert.ok(kan);
  assert.ok([...kan.bitmap.data.subarray(0, kan.bitmap.width * kan.bitmap.height)].every((v) => v === 0 || v === 255));
  const twice = decodeBff(encodeBff(once));
  assert.equal(twice.glyphs.size, once.glyphs.size);
  assertGlyphsEqual(once, twice, 'stability');
  assert.equal(twice.ascent, once.ascent);
  assert.equal(twice.descent, once.descent);
  assert.equal(twice.lineHeight, once.lineHeight);
});

test('BFF: kern レコードは素通しで保持される', () => {
  const font = alphaFont();
  const bytes = encodeBff(font);
  // 人工の kern レコードを付けたファイルを作る
  const kern = Uint8Array.from([12, 0, 0, 0, 0x6b, 0x65, 0x72, 0x6e, 1, 2, 3, 4]);
  const withKern = new Uint8Array(bytes.length + kern.length);
  withKern.set(bytes);
  withKern.set(kern, bytes.length);
  const decoded = decodeBff(withKern);
  const meta = /** @type {any} */ (decoded.meta.format).bff;
  assert.deepEqual(meta.kernRecord, [...kern]);
  // 再エンコードで kern がそのまま末尾に戻る
  const re = encodeBff(decoded);
  assert.deepEqual([...re.subarray(re.length - kern.length)], [...kern]);
});

test('decodeRleBitmap: 手書きビット列（LGFX の RLE 状態機械）', () => {
  // 値1, 値0, 値1, 値1(同値→REPEATED へ), repeat=1(もう1個), repeat=0 → 新値0
  // ビット: 1 0 1 1 1 0 0
  const bits = [1, 0, 1, 1, 1, 0, 0];
  const bytes = new Uint8Array(1);
  bits.forEach((b, i) => {
    if (b) bytes[0] |= 0x80 >> i;
  });
  const bs = new (class {
    constructor() {
      this.data = bytes;
      this.bitPos = 0;
      this.bitLength = bits.length;
    }
    /** @param {number} count */
    readBits(count) {
      let r = 0;
      while (count--) {
        if (this.bitPos >= this.bitLength) break;
        r = (r << 1) | ((this.data[this.bitPos >> 3] >> (7 - (this.bitPos & 7))) & 1);
        this.bitPos++;
      }
      return r;
    }
  })();
  const out = decodeRleBitmap(/** @type {any} */ (bs), 1, 6);
  // 1, 0, 1(SINGLE→同値検知), 1(repeat ビット 1), 1(repeat ビット 0 → 新値 0)...
  // 期待列: [1, 0, 1, 1, 1, 0]
  assert.deepEqual([...out], [1, 0, 1, 1, 1, 0]);
});

test('merge の実データ検証（UC4: 欠落文字を別書体から補完）', async () => {
  const gothic = subset(await loadFont('lgfxJapanGothic_16'), 'こんにちは');
  const mincho = await loadFont('lgfxJapanMincho_16');
  const missing = ['漢', '字'].map((c) => /** @type {number} */ (c.codePointAt(0)));
  const filler = subset(mincho, missing);
  const merged = merge(gothic, filler);
  assert.equal(merged.glyphs.size, gothic.glyphs.size + 2);
  for (const cp of missing) {
    const g = merged.glyphs.get(cp);
    const m = mincho.glyphs.get(cp);
    assert.ok(g && m);
    assert.ok(bitmapEquals(g.bitmap, m.bitmap)); // 再スケールなしでそのまま
  }
  // メトリクスは base（gothic）のまま
  assert.equal(merged.ascent, gothic.ascent);
  // 補完込みで BFF / u8g2 にエンコードできる
  assert.ok(canEncodeBff(merged).ok);
  const restored = decodeBff(encodeBff(merged));
  assert.ok(restored.glyphs.has(missing[0]));
});

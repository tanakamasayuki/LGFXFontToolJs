// @ts-check
/**
 * エンコーダの往復テスト（仕様 §13.2）と canEncode の制約検出（§7）。
 *
 * 往復の規準: 中立モデル → エンコード → デコード → 中立モデル で、
 * 形式が保存する情報（グリフ・派生メトリクス）が完全一致すること。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFont } from '../src/fonts/loader.js';
import { fontCatalog } from '../src/fonts/catalog.js';
import { decodeU8g2, encodeU8g2, canEncodeU8g2 } from '../src/format/u8g2.js';
import { decodeGfx, encodeGfx, canEncodeGfx } from '../src/format/gfxfont.js';
import { canEncode, encode } from '../src/format/registry.js';
import { bitmapEquals } from '../src/model/bitmap.js';
import { EncodeConstraintError } from '../src/util/errors.js';
import { subset } from '../src/model/subset.js';
import { tinyFont } from './helpers.js';

/** @typedef {import('../src/model/font.js').Font} Font */

/**
 * 2 つのモデルのグリフ集合が完全一致するか検証する。
 * @param {Font} a - 元
 * @param {Font} b - 往復後
 * @param {string} label
 */
function assertGlyphsEqual(a, b, label) {
  assert.equal(b.glyphs.size, a.glyphs.size, `${label}: glyph count`);
  for (const [cp, ga] of a.glyphs) {
    const gb = b.glyphs.get(cp);
    assert.ok(gb, `${label}: U+${cp.toString(16)} missing`);
    assert.equal(gb.xOffset, ga.xOffset, `${label}: U+${cp.toString(16)} xOffset`);
    assert.equal(gb.yOffset, ga.yOffset, `${label}: U+${cp.toString(16)} yOffset`);
    assert.equal(gb.xAdvance, ga.xAdvance, `${label}: U+${cp.toString(16)} xAdvance`);
    assert.ok(bitmapEquals(gb.bitmap, ga.bitmap), `${label}: U+${cp.toString(16)} bitmap`);
  }
}

test('u8g2 往復: 内蔵フォントの代表選', async () => {
  // 各ファミリ・サイズ極値から選ぶ（全 116 本はエンコード計算が重いので代表で回す）
  const names = [
    'lgfxJapanGothic_8',
    'lgfxJapanGothic_40',
    'lgfxJapanMinchoP_12',
    'efontJA_10',
    'efontKR_16_b',
    'efontCN_24',
  ];
  for (const name of names) {
    const original = await loadFont(name);
    const check = canEncodeU8g2(original);
    assert.ok(check.ok, `${name}: canEncode -> ${JSON.stringify(check.issues.slice(0, 3))}`);
    const bytes = encodeU8g2(original);
    const restored = decodeU8g2(bytes);
    assertGlyphsEqual(original, restored, name);
    assert.equal(restored.ascent, original.ascent, `${name}: ascent`);
    assert.equal(restored.descent, original.descent, `${name}: descent`);
    assert.equal(restored.lineHeight, original.lineHeight, `${name}: lineHeight`);
  }
});

test('gfx 往復: 内蔵 GFX フォント全 61 本', async () => {
  for (const entry of fontCatalog.filter((e) => e.format === 'gfx')) {
    const original = await loadFont(entry.name);
    const check = canEncodeGfx(original);
    assert.ok(check.ok, `${entry.name}: canEncode`);
    const restored = decodeGfx(encodeGfx(original));
    assertGlyphsEqual(original, restored, entry.name);
    assert.equal(restored.ascent, original.ascent, `${entry.name}: ascent`);
    assert.equal(restored.descent, original.descent, `${entry.name}: descent`);
    assert.equal(restored.lineHeight, original.lineHeight, `${entry.name}: lineHeight`);
  }
});

test('gfx 往復: CJK（飛び飛びの文字集合 → EncodeRange 経路）', async () => {
  const original = await loadFont('lgfxJapanGothic_16');
  const check = canEncodeGfx(original);
  assert.ok(check.ok, JSON.stringify(check.issues.slice(0, 3)));
  assert.ok(
    check.issues.some((i) => i.code === 'RANGE_COUNT_LARGE'),
    'RANGE_COUNT_LARGE warning expected for sparse CJK set',
  );
  const restored = decodeGfx(encodeGfx(original));
  assertGlyphsEqual(original, restored, 'lgfxJapanGothic_16->gfx');
});

test('u8g2 制約: DejaVu72 は入らない（送り幅 73 > 63。実在の失敗ケース）', async () => {
  const font = await loadFont('DejaVu72');
  const check = canEncodeU8g2(font);
  assert.equal(check.ok, false);
  const codes = new Set(check.issues.map((i) => i.code));
  assert.ok(codes.has('XADVANCE_RANGE'), `${[...codes]}`);
  // 事前判定どおり、encode はエラーになる（切り詰めない）
  assert.throws(() => encodeU8g2(font), EncodeConstraintError);
});

test('u8g2 往復: Font8（75px でも全フィールドが 7bit に収まるので入る）', async () => {
  // FONT_FORMATS.ja.md は「75px の Font8 は u8g2 に変換できない」としていたが、
  // 実測では最大送り 55 / 高さ 75（< 127）で全フィールドが範囲内に収まる。
  // 高さではなく送り幅・ベアリングが制約であることの生きた確認。
  const font = await loadFont('Font8');
  const check = canEncodeU8g2(font);
  assert.equal(check.ok, true, JSON.stringify(check.issues.slice(0, 3)));
  const restored = decodeU8g2(encodeU8g2(font));
  assert.equal(restored.glyphs.size, font.glyphs.size);
});

test('u8g2 dropInvalid: 違反グリフを落として続行できる', async () => {
  const font = await loadFont('DejaVu40'); // 一部のグリフだけが 7bit を超える
  const check = canEncodeU8g2(font);
  if (check.ok) {
    // 全部入るなら drop しても同じ
    const restored = decodeU8g2(encodeU8g2(font, { dropInvalid: true }));
    assert.equal(restored.glyphs.size, font.glyphs.size);
    return;
  }
  const badCps = new Set(
    check.issues.filter((i) => i.level === 'error' && i.codepoint !== undefined).map((i) => i.codepoint),
  );
  assert.ok(badCps.size > 0);
  const bytes = encodeU8g2(font, { dropInvalid: true });
  const restored = decodeU8g2(bytes);
  assert.equal(restored.glyphs.size, font.glyphs.size - badCps.size);
  for (const cp of badCps) {
    assert.ok(!restored.glyphs.has(/** @type {number} */ (cp)), `U+${Number(cp).toString(16)} should be dropped`);
  }
});

test('registry: canEncode / encode のディスパッチ', async () => {
  const font = tinyFont();
  assert.equal(canEncode(font, 'u8g2').ok, true);
  assert.equal(canEncode(font, 'gfx').ok, true);
  const r = canEncode(font, 'rle');
  assert.equal(r.ok, false);
  assert.equal(r.issues[0].code, 'ENCODER_NOT_IMPLEMENTED');
  assert.throws(() => encode(font, { format: 'rle' }), /ENCODER_NOT_IMPLEMENTED|no encoder/);
  assert.throws(() => canEncode(font, 'nope'), /UNKNOWN_FORMAT|unknown format/);

  const restored = decodeU8g2(encode(font, { format: 'u8g2' }));
  assertGlyphsEqual(font, restored, 'tinyFont->u8g2');
});

test('サブセット → エンコード（UC4 の減）', async () => {
  const font = await loadFont('lgfxJapanGothic_16');
  const sub = subset(font, 'こんにちは0123456789');
  const bytes = encodeU8g2(sub);
  const restored = decodeU8g2(bytes);
  assert.equal(restored.glyphs.size, sub.glyphs.size);
  assertGlyphsEqual(sub, restored, 'subset->u8g2');
  // サブセットはフォント全体より大幅に小さいこと
  const fullBytes = fontCatalog.find((e) => e.name === 'lgfxJapanGothic_16')?.dataBytes ?? 0;
  assert.ok(bytes.length < fullBytes / 50, `${bytes.length} vs ${fullBytes}`);
});

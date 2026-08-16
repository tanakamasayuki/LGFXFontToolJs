// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeFontx2,
  encodeFontx2,
  canEncodeFontx2,
  sjisToUnicode,
  unicodeToSjis,
} from '../src/format/fontx2.js';
import { detect, decode } from '../src/format/registry.js';
import { createBitmap, bitmapEquals } from '../src/model/bitmap.js';
import { drawString } from '../src/render/draw.js';
import { textWidth, fontHeight } from '../src/render/measure.js';
import { loadFont } from '../src/fonts/loader.js';
import { subset, merge } from '../src/model/subset.js';

test('SJIS ↔ Unicode 変換（Encoding Standard の shift_jis）', () => {
  assert.equal(sjisToUnicode(0x41), 0x41); // 'A'
  assert.equal(sjisToUnicode(0xb1), 0xff71); // 半角ｱ
  assert.equal(sjisToUnicode(0x8abf), '漢'.codePointAt(0));
  assert.equal(sjisToUnicode(0x82a0), 'あ'.codePointAt(0));
  assert.equal(unicodeToSjis(/** @type {number} */ ('漢'.codePointAt(0))), 0x8abf);
  assert.equal(unicodeToSjis(0xff71), 0xb1);
  assert.equal(unicodeToSjis(0x1f600), null); // 絵文字は SJIS に無い
});

test('ANK 往復: AsciiFont8x16（固定セル）', async () => {
  const src = subset(await loadFont('AsciiFont8x16'), ' !09AZaz~');
  const bytes = encodeFontx2(src, { name: 'TEST8x16' });
  assert.equal(detect(bytes)[0]?.format, 'fontx2');
  const restored = decodeFontx2(bytes);
  assert.equal(restored.familyName, 'TEST8x16');
  assert.equal(restored.lineHeight, 16);
  // ANK ファイルは常に 256 コードぶんのセルを持つ（未収録は空白）
  for (const [cp, g] of src.glyphs) {
    const r = restored.glyphs.get(cp);
    assert.ok(r, `U+${cp.toString(16)}`);
    assert.ok(bitmapEquals(r.bitmap, g.bitmap), `U+${cp.toString(16)} bitmap`);
    assert.equal(r.xAdvance, g.xAdvance);
  }
});

test('漢字往復: セル再配置後も描画がピクセル一致する', async () => {
  // 漢字グリフは送り 16 固定（FONTX2 の固定ピッチ要件を満たす）
  const src = subset(await loadFont('lgfxJapanGothic_16'), '漢字常用あいう');
  const check = canEncodeFontx2(src);
  assert.ok(check.ok, JSON.stringify(check.issues.slice(0, 3)));
  assert.equal(check.type, 'kanji');
  const bytes = encodeFontx2(src, { name: 'GOTHIC16' });
  const restored = decodeFontx2(bytes);
  assert.equal(restored.glyphs.size, src.glyphs.size);
  // ビットマップはセル形（余白込み）に変わるので、描画結果で比較する
  const text = '常用漢字あいう'.split('').filter((c) => src.glyphs.has(/** @type {number} */ (c.codePointAt(0)))).join('');
  const w = textWidth(src, text);
  const h = fontHeight(src);
  assert.equal(textWidth(restored, text), w);
  const a = createBitmap(w, h, 1);
  const b = createBitmap(w, h, 1);
  drawString(a, src, text, 0, 0);
  drawString(b, restored, text, 0, 0);
  assert.ok(bitmapEquals(a, b), 'rendering must match after cell re-layout');
});

test('固定ピッチ違反と SJIS 変換不能は事前に報告される', async () => {
  const proportional = subset(await loadFont('FreeSans9pt7b'), 'ABC');
  const check = canEncodeFontx2(proportional);
  assert.equal(check.ok, false);
  assert.ok(check.issues.some((i) => i.code === 'NOT_FIXED_PITCH'));

  const gothic = subset(await loadFont('lgfxJapanGothic_16'), '漢');
  // ハングルは SJIS に無い → merge して変換不能を作る
  const kr = subset(await loadFont('efontKR_16'), '한');
  const mixed = merge(gothic, kr);
  const c2 = canEncodeFontx2(mixed);
  assert.equal(c2.ok, false);
  assert.ok(c2.issues.some((i) => i.code === 'CODEPOINT_UNMAPPABLE'));
  // dropInvalid で変換不能だけ落として続行できる
  const bytes = encodeFontx2(mixed, { dropInvalid: true });
  const restored = decodeFontx2(bytes);
  assert.ok(restored.glyphs.has(/** @type {number} */ ('漢'.codePointAt(0))));
  assert.ok(!restored.glyphs.has(/** @type {number} */ ('한'.codePointAt(0))));
});

test('registry: 自動判定で decode できる', async () => {
  const src = subset(await loadFont('lgfxJapanGothic_16'), '字');
  const bytes = encodeFontx2(src);
  const font = decode(bytes); // detect → fontx2
  assert.ok(font.glyphs.has(/** @type {number} */ ('字'.codePointAt(0))));
});

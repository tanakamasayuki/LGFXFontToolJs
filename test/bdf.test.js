// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBdf, encodeBdf } from '../src/format/bdf.js';
import { decode, detect, encode } from '../src/format/registry.js';
import { bitmapEquals } from '../src/model/bitmap.js';
import { loadFont } from '../src/fonts/loader.js';
import { subset } from '../src/model/subset.js';
import { tinyFont } from './helpers.js';

/** @typedef {import('../src/model/font.js').Font} Font */

/** @param {Font} a @param {Font} b @param {string} label */
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

const SAMPLE_BDF = `STARTFONT 2.1
FONT -test-sample-medium-r-normal--8-80-75-75-c-80-iso10646-1
SIZE 8 75 75
FONTBOUNDINGBOX 8 8 0 -2
STARTPROPERTIES 3
FONT_ASCENT 6
FONT_DESCENT 2
FAMILY_NAME "Sample"
ENDPROPERTIES
CHARS 2
STARTCHAR A
ENCODING 65
SWIDTH 500 0
DWIDTH 5 0
BBX 4 5 0 0
BITMAP
60
90
F0
90
90
ENDCHAR
STARTCHAR unnamed
ENCODING -1
SWIDTH 500 0
DWIDTH 5 0
BBX 2 2 0 0
BITMAP
C0
C0
ENDCHAR
ENDFONT
`;

test('decodeBdf: 手書き BDF を読む（ENCODING -1 は読み飛ばし）', () => {
  const font = decodeBdf(SAMPLE_BDF);
  assert.equal(font.familyName, 'Sample');
  assert.equal(font.ascent, 6);
  assert.equal(font.descent, 2);
  assert.equal(font.glyphs.size, 1);
  const a = font.glyphs.get(65);
  assert.ok(a);
  assert.equal(a.xAdvance, 5);
  assert.equal(a.bitmap.width, 4);
  assert.equal(a.bitmap.height, 5);
  assert.equal(a.yOffset, -5); // BBX yoff 0, h 5
  // '6' = 0b0110 → (1,0) と (2,0)
  assert.equal(a.bitmap.data[0], 0x60);
  assert.ok(font.meta.issues.some((i) => i.code === 'BDF_UNENCODED_GLYPH'));
});

test('BDF 往復: 内蔵フォント（ベアリング付き GFX / CJK u8g2）', async () => {
  for (const name of ['FreeSans9pt7b', 'TomThumb']) {
    const original = await loadFont(name);
    const restored = decodeBdf(encodeBdf(original));
    assertGlyphsEqual(original, restored, name);
    assert.equal(restored.ascent, original.ascent, `${name}: ascent`);
    assert.equal(restored.descent, original.descent, `${name}: descent`);
  }
  const cjk = subset(await loadFont('lgfxJapanGothic_16'), 'こんにちは漢字012A');
  const restored = decodeBdf(encodeBdf(cjk));
  assertGlyphsEqual(cjk, restored, 'gothic16-subset');
});

test('registry: detect / decode / encode が BDF を扱う', async () => {
  assert.equal(detect(SAMPLE_BDF)[0].format, 'bdf');
  const font = decode(SAMPLE_BDF); // format 自動判定
  assert.equal(font.glyphs.size, 1);

  const tiny = tinyFont();
  const bytes = encode(tiny, { format: 'bdf' });
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /^STARTFONT 2\.1/);
  const back = decode(text, { format: 'bdf' });
  assertGlyphsEqual(tiny, back, 'tiny->bdf');
});

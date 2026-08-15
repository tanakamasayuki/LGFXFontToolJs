// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { packGfxContainer, unpackGfxContainer } from '../src/format/gfxfont.js';
import { packLegacyContainer, unpackLegacyContainer } from '../src/format/legacy.js';
import { detect, decode } from '../src/format/registry.js';
import { readU8g2Header } from '../src/format/u8g2.js';
import { DetectFailedError } from '../src/util/errors.js';

test('GFX1 コンテナ: pack → unpack で完全一致', () => {
  const gfx = {
    first: 0x20,
    last: 0x22,
    yAdvance: 10,
    ranges: [{ start: 0x20, end: 0x22, base: 0 }],
    glyphs: [
      { bitmapOffset: 0, width: 3, height: 4, xAdvance: 4, xOffset: 0, yOffset: -4 },
      { bitmapOffset: 2, width: 2, height: 2, xAdvance: 3, xOffset: 1, yOffset: -2 },
      { bitmapOffset: 3, width: 1, height: 1, xAdvance: 2, xOffset: -1, yOffset: -1 },
    ],
    bitmap: Uint8Array.from([0xaa, 0x55, 0xf0, 0x80]),
  };
  const packed = packGfxContainer(gfx);
  const back = unpackGfxContainer(packed);
  assert.deepEqual(back.ranges, gfx.ranges);
  assert.deepEqual(back.glyphs, gfx.glyphs);
  assert.deepEqual([...back.bitmap], [...gfx.bitmap]);
  assert.equal(back.first, gfx.first);
  assert.equal(back.last, gfx.last);
  assert.equal(back.yAdvance, gfx.yAdvance);
});

test('LBMP/LRLE コンテナ: pack → unpack で完全一致', () => {
  const data = {
    height: 16,
    baseline: 13,
    widths: [3, 5, 7],
    glyphData: [Uint8Array.from([1, 2]), Uint8Array.from([3]), Uint8Array.from([4, 5, 6])],
  };
  for (const magic of /** @type {const} */ (['LBMP', 'LRLE'])) {
    const back = unpackLegacyContainer(magic, packLegacyContainer(magic, data));
    assert.equal(back.height, 16);
    assert.equal(back.baseline, 13);
    assert.deepEqual(back.widths, data.widths);
    assert.deepEqual(
      back.glyphData.map((g) => [...g]),
      data.glyphData.map((g) => [...g]),
    );
  }
});

test('detect: magic 判定と u8g2 の推定', async () => {
  const gfxBytes = await readFile(new URL('../src/fonts/data/FreeSans9pt7b.gfx', import.meta.url));
  assert.equal(detect(new Uint8Array(gfxBytes))[0].format, 'gfx');

  const u8g2Bytes = new Uint8Array(
    await readFile(new URL('../src/fonts/data/lgfxJapanGothic_12.u8g2', import.meta.url)),
  );
  const candidates = detect(u8g2Bytes);
  assert.ok(candidates.some((c) => c.format === 'u8g2'));
  const h = readU8g2Header(u8g2Bytes);
  assert.ok(h.maxCharHeight > 0);

  assert.throws(() => decode(Uint8Array.from([1, 2, 3])), DetectFailedError);
});

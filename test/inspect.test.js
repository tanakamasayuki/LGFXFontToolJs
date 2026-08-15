// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect, coverage, codepointRanges } from '../src/inspect/inspect.js';
import { estimateSize, estimateSizes } from '../src/inspect/estimate.js';
import { encodeU8g2 } from '../src/format/u8g2.js';
import { encodeGfx } from '../src/format/gfxfont.js';
import { loadFont } from '../src/fonts/loader.js';

test('coverage: 文言・集合名・欠落の列挙（UC6）', async () => {
  const font = await loadFont('lgfxJapanGothic_16');
  const ok = coverage(font, 'こんにちは、世界。');
  assert.equal(ok.missing.length, 0);
  assert.equal(ok.present, ok.total);

  const latin = await loadFont('FreeSans9pt7b');
  const ng = coverage(latin, 'ABCあ');
  assert.equal(ng.total, 4);
  assert.equal(ng.present, 3);
  assert.deepEqual(ng.missing, ['あ'.codePointAt(0)]);

  // 名前付き集合でも呼べる
  const kana = coverage(font, 'hiragana');
  assert.ok(kana.total > 80);
  assert.equal(kana.missing.length, 0);
});

test('inspect: 収録・極値・被覆率（UC2）', async () => {
  const font = await loadFont('Font2');
  const info = inspect(font);
  assert.equal(info.glyphCount, 96);
  assert.deepEqual(info.ranges, [{ start: 0x20, end: 0x7f }]);
  assert.equal(info.metrics.lineHeight, 16);
  assert.equal(info.bpp, 1);
  assert.equal(info.coverage.ascii, 1);
  assert.equal(info.coverage.hiragana, 0);
  assert.ok(info.extremes.maxAdvance > 0);
});

test('estimateSize: エンコードした場合の正確なバイト数', async () => {
  const font = await loadFont('lgfxJapanGothic_16');
  const u8g2 = estimateSize(font, 'u8g2');
  assert.equal(u8g2.bytes, encodeU8g2(font).length);
  const gfx = estimateSize(font, 'gfx');
  assert.equal(gfx.bytes, encodeGfx(font).length);
  assert.ok(gfx.issues.some((i) => i.code === 'RANGE_COUNT_LARGE'));

  // 入らないフォントは null + 理由
  const big = await loadFont('DejaVu72');
  const ng = estimateSize(big, 'u8g2');
  assert.ok(ng.issues.some((i) => i.code === 'XADVANCE_RANGE'));

  const all = estimateSizes(font);
  assert.ok(all.u8g2.bytes && all.gfx.bytes && all.bdf.bytes);
  // FONT_FORMATS.ja.md の実測の再現: 16px では RLE の管理コストが勝り
  // GFXfont のほうがわずかに小さい。24px では u8g2 が逆転する
  assert.ok(/** @type {number} */ (all.gfx.bytes) < /** @type {number} */ (all.u8g2.bytes));
  const font24 = await loadFont('lgfxJapanGothic_24');
  const s24 = estimateSizes(font24);
  assert.ok(/** @type {number} */ (s24.u8g2.bytes) < /** @type {number} */ (s24.gfx.bytes));
});

test('codepointRanges: 連続区間への要約', async () => {
  const font = await loadFont('Font0');
  const ranges = codepointRanges(font);
  // cp437 再配置で 175/176 の間が割れ、255 が落ちる
  assert.ok(ranges.length >= 1);
  assert.equal(ranges[0].start, 0);
});

// @ts-check
/** CellFont のパッキング（docs/formats/cellfont.ja.md v1）。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { packCellFont } from '../src/format/cellfont.js';
import { encodeCSource } from '../src/format/csource.js';
import { createFont } from '../src/model/font.js';
import { createBitmap, setPixel } from '../src/model/bitmap.js';

/**
 * @param {number} cp @param {number} w @param {number} h
 * @param {{xOffset?: number, yOffset?: number, xAdvance?: number}} [o]
 * @returns {import('../src/model/font.js').Glyph}
 */
function glyph(cp, w, h, o = {}) {
  const bitmap = createBitmap(w, h, 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPixel(bitmap, x, y, 1);
  return {
    codepoint: cp,
    xOffset: o.xOffset ?? 0,
    yOffset: o.yOffset ?? -h,
    xAdvance: o.xAdvance ?? w,
    bitmap,
  };
}
/** @param {import('../src/model/font.js').Glyph[]} gs */
const fontOf = (gs) =>
  createFont({
    ascent: 8,
    descent: 2,
    lineHeight: 10,
    glyphs: new Map(gs.map((g) => [g.codepoint, g])),
  });

/**
 * 収録コードを昇順で取り出す（頭ブロック + しっぽ）。
 * @param {ReturnType<typeof packCellFont>['chain'][number]} c
 */
function codepointsOf(c) {
  const out = [];
  if (c.contiguous) {
    for (let i = 0; i < c.count; i++) out.push(c.first + i);
  } else {
    for (let i = 0; i < c.headCount; i++) out.push(c.first + i);
    out.push(...(c.codes ?? []));
  }
  return out.sort((a, b) => a - b);
}

/** 半角 40 字 + 全角 40 字。この規模なら分割が確実に勝つ。 */
function mixedFont() {
  const gs = [];
  for (let i = 0; i < 40; i++) gs.push(glyph(0x41 + i, 4, 8));
  for (let i = 0; i < 40; i++) gs.push(glyph(0x4e00 + i * 3, 8, 8));
  return fontOf(gs);
}

test('固定ピッチ・連続: グリフ表もコード表も出ない', () => {
  const f = fontOf([0x41, 0x42, 0x43].map((cp) => glyph(cp, 4, 8)));
  const { chain } = packCellFont(f);
  assert.equal(chain.length, 1);
  const c = chain[0];
  assert.ok(c.fixed && c.contiguous);
  assert.equal(c.glyphs, null);
  assert.equal(c.codes, null);
  assert.equal(c.first, 0x41);
  assert.equal(c.count, 3);
  assert.equal(c.bytesPerGlyph, Math.ceil((4 * 8) / 8));
  assert.equal(c.headCount, 0);
});

test('疎索引: 頭ブロックは最長の連続並び。長さ 1 でも採る', () => {
  // 0x41-0x43 が連続、0x50 と 0x60 は孤立
  const f = fontOf([0x41, 0x42, 0x43, 0x50, 0x60].map((cp) => glyph(cp, 4, 8)));
  const c = packCellFont(f).chain[0];
  assert.equal(c.contiguous, false);
  assert.equal(c.headCount, 3);
  assert.equal(c.first, 0x41);
  assert.deepEqual([...(c.codes ?? [])], [0x50, 0x60]);
  // 疎索引では 1 <= headCount < count（仕様 §15.1）
  assert.ok(c.headCount >= 1 && c.headCount < c.count);
});

test('可変ピッチ: オフセットは累積で、最後は総バイト数に一致する', () => {
  const f = fontOf([glyph(0x41, 3, 8), glyph(0x42, 6, 8), glyph(0x43, 4, 8)]);
  const c = packCellFont(f).chain[0];
  assert.ok(!c.fixed);
  assert.ok(c.glyphs);
  let at = 0;
  for (const g of c.glyphs) {
    assert.equal(g.offset, at, `U+${g.offset}`);
    at += Math.ceil((g.width * c.height) / 8);
  }
  assert.equal(at, c.bitmap.length);
});

test('連鎖: yAdvance は全体で一致し、集合は重ならず全グリフを覆う', () => {
  const f = mixedFont();
  const { chain } = packCellFont(f);
  assert.equal(chain.length, 2, '半角/全角で 2 本になる');
  assert.equal(chain[0].yAdvance, chain[1].yAdvance);
  const seen = new Set();
  for (const c of chain) {
    for (const cp of codepointsOf(c)) {
      assert.ok(!seen.has(cp), `重複 U+${cp.toString(16)}`);
      seen.add(cp);
    }
  }
  assert.equal(seen.size, f.glyphs.size, '全グリフが 1 度ずつ現れる');
  for (const cp of f.glyphs.keys()) assert.ok(seen.has(cp), `欠落 U+${cp.toString(16)}`);
});

test('分割は得なときだけ起きる（少数のグリフでは単一が勝つ）', () => {
  const few = fontOf([
    ...[0x41, 0x42].map((cp) => glyph(cp, 4, 8)),
    ...[0x6e29, 0x5ea6].map((cp) => glyph(cp, 8, 8)),
  ]);
  // ヘッダ 2 本ぶんが 4 バイト/字のグリフ表より高くつくので単一が選ばれる
  assert.equal(packCellFont(few).chain.length, 1);
});

test('maxChain は連鎖長を縛る。既定は 2', () => {
  const f = fontOf([
    ...[0x41, 0x42].map((cp) => glyph(cp, 3, 8)),
    ...[0x51, 0x52].map((cp) => glyph(cp, 5, 8)),
    ...[0x61, 0x62].map((cp) => glyph(cp, 7, 8)),
  ]);
  assert.ok(packCellFont(f).chain.length <= 2, '既定 2');
  assert.ok(packCellFont(f, { maxChain: 1 }).chain.length === 1);
  assert.ok(packCellFont(f, { maxChain: 9 }).chain.length <= 3);
});

test('対象 ABI で候補の大きさが変わる', () => {
  const f = fontOf([
    ...[0x41, 0x42].map((cp) => glyph(cp, 4, 8)),
    ...[0x6e29, 0x5ea6].map((cp) => glyph(cp, 8, 8)),
  ]);
  const a = packCellFont(f, { abi: 'ilp32' });
  const b = packCellFont(f, { abi: 'avr' });
  assert.equal(a.bytes - b.bytes, (28 - 20) * a.chain.length);
});

test('空のフォントと BMP 外のコードは拒否する', () => {
  assert.throws(() => packCellFont(fontOf([])), /EMPTY_FONT|empty/);
  assert.throws(() => packCellFont(fontOf([glyph(0x1f600, 8, 8)])), /uint16|CODEPOINT/);
});

test('同じ入力からバイト一致の C ソースが出る', () => {
  const f = fontOf([0x41, 0x42, 0x50].map((cp) => glyph(cp, 4, 8)));
  const a = encodeCSource(f, { format: 'cellfont', symbolName: 'F' });
  const b = encodeCSource(f, { format: 'cellfont', symbolName: 'F' });
  assert.equal(a, b);
  assert.match(a, /#pragma once/);
  assert.match(a, /CELLFONT_SPEC_VERSION != 1/);
  assert.match(a, /static const CellFont F LGFXFT_PROGMEM/);
});

test('連鎖は末尾から先に定義される（C は前方参照できない）', () => {
  const src = encodeCSource(mixedFont(), { format: 'cellfont', symbolName: 'F' });
  assert.ok(src.indexOf('CellFont F_2 ') < src.indexOf('CellFont F '), 'F_2 が先');
  assert.match(src, /&F_2/);
});

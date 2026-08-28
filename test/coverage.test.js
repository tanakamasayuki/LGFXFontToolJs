// @ts-check
/**
 * cmap 読み取り（bin/coverage.js）。
 *
 * ラスタライザは収録外の文字をシステムフォントで代替描画してしまうので、収録判定は
 * フォント自身の cmap で行う。ここでは cmap を手で組み立てて、書式ごとの読み取りと
 * 読めない入力の扱いを固定する。実物のフォントに依存すると、実行環境にどのフォントが
 * 入っているかで結果が変わってしまう。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fontCoverage } from '../bin/coverage.js';

/** ビッグエンディアンの並びを組み立てる小道具。 */
class Buf {
  constructor() {
    /** @type {number[]} */ this.b = [];
  }
  /** @param {number} v */
  u8(v) { this.b.push(v & 0xff); return this; }
  /** @param {number} v */
  u16(v) { return this.u8(v >> 8).u8(v); }
  /** @param {number} v */
  i16(v) { return this.u16(v < 0 ? v + 0x10000 : v); }
  /** @param {number} v */
  u32(v) { return this.u16(v >>> 16).u16(v & 0xffff); }
  /** @param {string} s */
  tag(s) { for (const c of s) this.u8(c.charCodeAt(0)); return this; }
  get length() { return this.b.length; }
}

/**
 * cmap サブテーブルひとつだけを持つ sfnt を作る。
 * @param {number[]} subtable
 * @param {{platform?: number, encoding?: number}} [id]
 */
function sfnt(subtable, id = {}) {
  const cmap = new Buf().u16(0).u16(1)
    .u16(id.platform ?? 3).u16(id.encoding ?? 1).u32(12);
  const table = [...cmap.b, ...subtable];
  const f = new Buf().u32(0x00010000).u16(1).u16(0).u16(0).u16(0)
    .tag('cmap').u32(0).u32(28).u32(table.length);
  return new Uint8Array([...f.b, ...table]);
}

/**
 * 書式 4。区間は [開始, 終了] で与え、字形番号は開始からの連番にする。
 * @param {[number, number][]} segments
 */
function format4(segments) {
  const segs = [...segments, [0xffff, 0xffff]];
  const segX2 = segs.length * 2;
  const s = new Buf().u16(4).u16(0).u16(0).u16(segX2).u16(0).u16(0).u16(0);
  for (const [, end] of segs) s.u16(end);
  s.u16(0); // reservedPad
  for (const [start] of segs) s.u16(start);
  let gid = 1;
  for (const [start, end] of segs) {
    // 最後の番兵は字形番号 0（未収録）に落とす。
    if (start === 0xffff) s.i16(1);
    else { s.i16((gid - start) & 0xffff); gid += end - start + 1; }
  }
  for (const _ of segs) s.u16(0); // idRangeOffset なし
  return s.b;
}

/** 書式 12。 @param {[number, number][]} groups */
function format12(groups) {
  const s = new Buf().u16(12).u16(0).u32(0).u32(0).u32(groups.length);
  let gid = 1;
  for (const [start, end] of groups) {
    s.u32(start).u32(end).u32(gid);
    gid += end - start + 1;
  }
  return s.b;
}

/** @param {Uint8Array} bytes */
function has(bytes) {
  const cov = fontCoverage(bytes);
  assert.ok('codepoints' in cov, 'unavailable: ' + JSON.stringify(cov));
  return cov.codepoints;
}

test('書式 4: 区間に入る文字だけを収録とみなす', () => {
  const cp = has(sfnt(format4([[0x41, 0x43], [0x6e29, 0x6e29]])));
  assert.deepEqual([...cp].sort((a, b) => a - b), [0x41, 0x42, 0x43, 0x6e29]);
  assert.ok(!cp.has(0x40), '区間の外は収録されない');
  assert.ok(!cp.has(0xffff), '末尾の番兵は収録に数えない');
});

test('書式 12: BMP 外も読める', () => {
  const cp = has(sfnt(format12([[0x41, 0x42], [0x1f600, 0x1f601]]), { platform: 3, encoding: 10 }));
  assert.deepEqual([...cp].sort((a, b) => a - b), [0x41, 0x42, 0x1f600, 0x1f601]);
});

test('書式 0: 1 バイト表を読める', () => {
  const s = new Buf().u16(0).u16(262).u16(0);
  for (let c = 0; c < 256; c++) s.u8(c === 0x41 || c === 0x42 ? 1 : 0);
  assert.deepEqual([...has(sfnt(s.b))].sort((a, b) => a - b), [0x41, 0x42]);
});

test('書式 6: 連続範囲の表を読める', () => {
  const s = new Buf().u16(6).u16(0).u16(0).u16(0x41).u16(3).u16(1).u16(0).u16(3);
  assert.deepEqual([...has(sfnt(s.b))].sort((a, b) => a - b), [0x41, 0x43]);
});

test('全字形の表があればそちらを選ぶ', () => {
  // 3,1（BMP のみ）と 3,10（全字形）が並んでいたら、後者を読む。
  const bmp = format4([[0x41, 0x41]]);
  const full = format12([[0x41, 0x41], [0x20000, 0x20000]]);
  const cmap = new Buf().u16(0).u16(2)
    .u16(3).u16(1).u32(20)
    .u16(3).u16(10).u32(20 + bmp.length);
  const table = [...cmap.b, ...bmp, ...full];
  const f = new Buf().u32(0x00010000).u16(1).u16(0).u16(0).u16(0)
    .tag('cmap').u32(0).u32(28).u32(table.length);
  const cp = has(new Uint8Array([...f.b, ...table]));
  assert.ok(cp.has(0x20000), 'BMP 外が読めている＝全字形の表を選んだ');
});

test('圧縮容器と壊れた入力は「読めない」と申告する（黙って全部収録にしない）', () => {
  const woff = new Uint8Array(20);
  new DataView(woff.buffer).setUint32(0, 0x774f4646); // 'wOFF'
  assert.match(/** @type {any} */ (fontCoverage(woff)).unavailable, /WOFF is compressed/);

  const woff2 = new Uint8Array(20);
  new DataView(woff2.buffer).setUint32(0, 0x774f4632); // 'wOF2'
  assert.match(/** @type {any} */ (fontCoverage(woff2)).unavailable, /WOFF2 is compressed/);

  assert.match(/** @type {any} */ (fontCoverage(new Uint8Array(4))).unavailable, /too short/);

  const noCmap = new Buf().u32(0x00010000).u16(1).u16(0).u16(0).u16(0)
    .tag('glyf').u32(0).u32(28).u32(0);
  assert.match(/** @type {any} */ (fontCoverage(new Uint8Array(noCmap.b))).unavailable, /no cmap/);
});

test('読めない書式は「読めない」に落ちる（空集合として扱わない）', () => {
  const s = new Buf().u16(13).u16(0).u32(0); // 書式 13 は未対応
  assert.ok('unavailable' in fontCoverage(sfnt(s.b)));
});

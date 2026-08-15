// @ts-check
/**
 * GFXfont (Adafruit GFX) のデコーダと、本ライブラリのバイナリコンテナ。
 *
 * GFXfont はメモリ上の構造体でありファイル形式を持たないため、内蔵コレクションの
 * 保存用に 'GFX1' コンテナを定義する（docs/formats/gfx.ja.md 予定地）:
 *
 *   magic   "GFX1"
 *   u16le   first
 *   u16le   last
 *   u8      yAdvance
 *   u16le   rangeCount            (LovyanGFX 拡張 EncodeRange。0 = first..last の単一範囲)
 *   range × rangeCount:  u16le start, u16le end, u16le base
 *   u32le   glyphCount
 *   glyph × glyphCount:  u32le bitmapOffset, u8 width, u8 height, u8 xAdvance, i8 xOffset, i8 yOffset
 *   u32le   bitmapLength
 *   bytes   bitmap                (行連結の MSB first ビットストリーム。行境界のパディングなし)
 */
import { ByteReader, ByteWriter } from '../util/bytes.js';
import { FormatError, EncodeConstraintError } from '../util/errors.js';
import { createBitmap, setPixel, getPixel } from '../model/bitmap.js';
import { createFont } from '../model/font.js';

/** @typedef {import('../model/font.js').Font} Font */
/** @typedef {import('../model/font.js').Glyph} Glyph */

/**
 * @typedef {object} GfxGlyphRec
 * @property {number} bitmapOffset
 * @property {number} width
 * @property {number} height
 * @property {number} xAdvance
 * @property {number} xOffset
 * @property {number} yOffset
 *
 * @typedef {object} GfxData
 * @property {number} first
 * @property {number} last
 * @property {number} yAdvance
 * @property {{start: number, end: number, base: number}[]} ranges
 * @property {GfxGlyphRec[]} glyphs
 * @property {Uint8Array} bitmap
 */

const MAGIC = [0x47, 0x46, 0x58, 0x31]; // "GFX1"

/**
 * 構造化された GFXfont データを 'GFX1' コンテナへ書き出す（抽出スクリプトが使う）。
 * @param {GfxData} gfx
 * @returns {Uint8Array}
 */
export function packGfxContainer(gfx) {
  const w = new ByteWriter();
  w.bytes(MAGIC);
  w.u16le(gfx.first);
  w.u16le(gfx.last);
  w.u8(gfx.yAdvance);
  w.u16le(gfx.ranges.length);
  for (const r of gfx.ranges) {
    w.u16le(r.start).u16le(r.end).u16le(r.base);
  }
  w.u32le(gfx.glyphs.length);
  for (const g of gfx.glyphs) {
    w.u32le(g.bitmapOffset).u8(g.width).u8(g.height).u8(g.xAdvance).i8(g.xOffset).i8(g.yOffset);
  }
  w.u32le(gfx.bitmap.length);
  w.bytes(gfx.bitmap);
  return w.toUint8Array();
}

/**
 * 'GFX1' コンテナを構造化データへ読み戻す。
 * @param {Uint8Array} data
 * @returns {GfxData}
 */
export function unpackGfxContainer(data) {
  const r = new ByteReader(data);
  for (const m of MAGIC) {
    if (r.u8() !== m) throw new FormatError('DETECT_FAILED', 'not a GFX1 container');
  }
  const first = r.u16le();
  const last = r.u16le();
  const yAdvance = r.u8();
  const rangeCount = r.u16le();
  const ranges = [];
  for (let i = 0; i < rangeCount; i++) {
    ranges.push({ start: r.u16le(), end: r.u16le(), base: r.u16le() });
  }
  const glyphCount = r.u32le();
  /** @type {GfxGlyphRec[]} */
  const glyphs = [];
  for (let i = 0; i < glyphCount; i++) {
    glyphs.push({
      bitmapOffset: r.u32le(),
      width: r.u8(),
      height: r.u8(),
      xAdvance: r.u8(),
      xOffset: r.i8(),
      yOffset: r.i8(),
    });
  }
  const bitmapLength = r.u32le();
  const bitmap = new Uint8Array(r.bytes(bitmapLength));
  return { first, last, yAdvance, ranges, glyphs, bitmap };
}

/**
 * GFX のビットストリーム（行連結 MSB first）からビットマップを起こす。
 * @param {Uint8Array} bits
 * @param {number} offset
 * @param {number} w
 * @param {number} h
 */
function extractBitmap(bits, offset, w, h) {
  const bmp = createBitmap(w, h, 1);
  let k = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, k++) {
      const byte = bits[offset + (k >> 3)] ?? 0;
      if ((byte >> (7 - (k & 7))) & 1) setPixel(bmp, x, y, 1);
    }
  }
  return bmp;
}

/**
 * 'GFX1' コンテナを中立モデルへデコードする。
 * @param {Uint8Array} data
 * @param {{familyName?: string, styleName?: string}} [opts]
 * @returns {Font}
 */
export function decodeGfx(data, opts = {}) {
  const gfx = unpackGfxContainer(data);
  /** @type {Map<number, Glyph>} */
  const glyphs = new Map();

  /** @type {{cp: number, index: number}[]} */
  const mapping = [];
  if (gfx.ranges.length === 0) {
    for (let cp = gfx.first; cp <= gfx.last; cp++) {
      mapping.push({ cp, index: cp - gfx.first });
    }
  } else {
    for (const range of gfx.ranges) {
      for (let cp = range.start; cp <= range.end; cp++) {
        mapping.push({ cp, index: cp - range.start + range.base });
      }
    }
  }
  for (const { cp, index } of mapping) {
    const rec = gfx.glyphs[index];
    if (!rec) continue;
    glyphs.set(cp, {
      codepoint: cp,
      xOffset: rec.xOffset,
      yOffset: rec.yOffset,
      xAdvance: rec.xAdvance,
      bitmap: extractBitmap(gfx.bitmap, rec.bitmapOffset, rec.width, rec.height),
    });
  }

  // LGFX GFXfont::getDefaultMetric の再現。
  // numChars = last - first（+1 しない）/ ranges 有りは range_num + Σ(end - start)。
  // LovyanGFX の実装をそのまま踏襲する（末尾グリフが走査から漏れる off-by-one も含めて）。
  let numChars = gfx.last - gfx.first;
  if (gfx.ranges.length !== 0) {
    numChars = gfx.ranges.length;
    for (const range of gfx.ranges) numChars += range.end - range.start;
  }
  let glyphAb = 0;
  let glyphBb = 0;
  for (let c = 0; c < numChars; c++) {
    const rec = gfx.glyphs[c];
    if (!rec) break;
    const ab = -rec.yOffset;
    if (ab > glyphAb) glyphAb = ab;
    const bb = rec.height - ab;
    if (bb > glyphBb) glyphBb = bb;
  }

  // LGFX の updateFontMetric(0) / drawChar(0) の挙動:
  // 空白グリフがあればその計測値で代替ボックスを描く。無ければ幅 yAdvance/2 と
  // 数えるが何も描かず送りも 0（drawChar が 0 を返す）。
  const space = glyphs.get(0x20);
  const fallback = space
    ? { advance: space.xAdvance, width: space.bitmap.width, xOffset: space.xOffset }
    : {
        advance: gfx.yAdvance >> 1,
        width: gfx.yAdvance >> 1,
        xOffset: 0,
        drawAdvance: 0,
        drawBox: false,
      };

  return createFont({
    familyName: opts.familyName ?? '',
    styleName: opts.styleName ?? 'Regular',
    ascent: glyphAb,
    descent: glyphBb,
    lineHeight: gfx.yAdvance,
    glyphs,
    meta: {
      sourceFormat: 'gfx',
      drawProfile: 'gfx',
      fallback,
      issues: [],
      format: {
        gfx: { first: gfx.first, last: gfx.last, yAdvance: gfx.yAdvance, ranges: gfx.ranges },
      },
    },
  });
}

//----------------------------------------------------------------------------
// エンコーダ（仕様 §7）。中立モデル → 'GFX1' コンテナ。
//
// GFXfont が保存するのはグリフ配列・ビットマップ・yAdvance だけで、
// アセント/ディセントは持たない（LovyanGFX が getDefaultMetric で
// グリフ走査から導出する）。したがってモデルの ascent / descent が
// グリフから導出される値と異なる場合、その差は保存されない（warning）。

/**
 * 昇順のコードポイント列を連続区間へまとめる。
 * @param {number[]} cps
 * @returns {{start: number, end: number, base: number}[]}
 */
function rangesOf(cps) {
  /** @type {{start: number, end: number, base: number}[]} */
  const ranges = [];
  let base = 0;
  for (let i = 0; i < cps.length; ) {
    const start = cps[i];
    let j = i;
    while (j + 1 < cps.length && cps[j + 1] === cps[j] + 1) j++;
    ranges.push({ start, end: cps[j], base });
    base += cps[j] - start + 1;
    i = j + 1;
  }
  return ranges;
}

/**
 * @param {Font} font
 */
function planGfx(font) {
  /** @type {import('./registry.js').EncodeIssue[]} */
  const issues = [];
  /** @type {import('../model/font.js').Glyph[]} */
  const recs = [];

  for (const g of [...font.glyphs.values()].sort((a, b) => a.codepoint - b.codepoint)) {
    let bad = false;
    /** @param {string} code @param {object} params */
    const err = (code, params) => {
      issues.push({ level: 'error', code, codepoint: g.codepoint, params });
      bad = true;
    };
    if (g.bitmap.bpp !== 1) err('BPP_UNSUPPORTED', { bpp: g.bitmap.bpp });
    if (g.codepoint > 0xffff) err('CODEPOINT_OVER_BMP', { value: g.codepoint });
    if (g.xAdvance < 0 || g.xAdvance > 255) {
      err('XADVANCE_RANGE', { value: g.xAdvance, min: 0, max: 255 });
    }
    if (g.xOffset < -128 || g.xOffset > 127 || g.yOffset < -128 || g.yOffset > 127) {
      err('BEARING_RANGE', { x: g.xOffset, y: g.yOffset, min: -128, max: 127 });
    }
    if (g.bitmap.width > 255 || g.bitmap.height > 255) {
      err('GLYPH_TOO_LARGE', { width: g.bitmap.width, height: g.bitmap.height, max: 255 });
    }
    if (!bad) recs.push(g);
  }

  if (font.lineHeight < 0 || font.lineHeight > 255) {
    issues.push({
      level: 'error',
      code: 'LINE_HEIGHT_RANGE',
      params: { value: font.lineHeight, min: 0, max: 255 },
    });
  }
  if (recs.length === 0) {
    issues.push({ level: 'error', code: 'EMPTY_FONT' });
    return { issues, recs, ranges: [] };
  }

  const ranges = rangesOf(recs.map((g) => g.codepoint));
  if (ranges.length > 64) {
    // 範囲は描画する文字ごとに線形走査される。飛び飛びの CJK 集合では性能に効く
    issues.push({ level: 'warning', code: 'RANGE_COUNT_LARGE', params: { count: ranges.length } });
  }

  // LovyanGFX の getDefaultMetric（末尾グリフが漏れる off-by-one 込み）で
  // 導出されるメトリクスがモデルと一致するか
  let numChars;
  if (ranges.length === 1) {
    numChars = ranges[0].end - ranges[0].start; // 単一範囲は range 無しで出すため last - first
  } else {
    numChars = ranges.length;
    for (const r of ranges) numChars += r.end - r.start;
  }
  let ab = 0;
  let bb = 0;
  for (let c = 0; c < numChars && c < recs.length; c++) {
    const g = recs[c];
    const a = -g.yOffset;
    if (a > ab) ab = a;
    const b = g.bitmap.height - a;
    if (b > bb) bb = b;
  }
  if (ab !== font.ascent || bb !== font.descent) {
    issues.push({
      level: 'warning',
      code: 'METRICS_DERIVED',
      params: { ascent: font.ascent, descent: font.descent, derivedAscent: ab, derivedDescent: bb },
    });
  }

  return { issues, recs, ranges };
}

/**
 * GFXfont（GFX1 コンテナ）へエンコードできるか（仕様 §7.1）。
 * @param {Font} font
 * @returns {{ok: boolean, issues: import('./registry.js').EncodeIssue[]}}
 */
export function canEncodeGfx(font) {
  const plan = planGfx(font);
  return { ok: !plan.issues.some((i) => i.level === 'error'), issues: plan.issues };
}

/**
 * 中立モデル → 'GFX1' コンテナ。
 * 制約違反があれば EncodeConstraintError（切り詰めない。仕様 §7.2）。
 * dropInvalid: true なら違反グリフを落として続行する（フォント全体の制約は除く）。
 * @param {Font} font
 * @param {{dropInvalid?: boolean}} [opts]
 * @returns {Uint8Array}
 */
export function encodeGfx(font, opts = {}) {
  const plan = planGfx(font);
  const errors = plan.issues.filter((i) => i.level === 'error');
  if (errors.length > 0) {
    const fontLevel = errors.filter((i) => i.codepoint === undefined);
    if (!opts.dropInvalid || fontLevel.length > 0) {
      throw new EncodeConstraintError('font does not fit the GFXfont format', plan.issues);
    }
  }
  const { recs, ranges } = plan;

  /** @type {number[]} */
  const bitmapBytes = [];
  let bitBuf = 0;
  let bitCount = 0;
  /** @type {GfxGlyphRec[]} */
  const glyphRecs = [];
  let offset = 0;
  for (const g of recs) {
    glyphRecs.push({
      bitmapOffset: offset,
      width: g.bitmap.width,
      height: g.bitmap.height,
      xAdvance: g.xAdvance,
      xOffset: g.xOffset,
      yOffset: g.yOffset,
    });
    // 行連結の MSB first ビットストリーム（グリフごとにバイト境界へ揃える）
    for (let y = 0; y < g.bitmap.height; y++) {
      for (let x = 0; x < g.bitmap.width; x++) {
        bitBuf = (bitBuf << 1) | getPixel(g.bitmap, x, y);
        if (++bitCount === 8) {
          bitmapBytes.push(bitBuf);
          bitBuf = 0;
          bitCount = 0;
        }
      }
    }
    if (bitCount > 0) {
      bitmapBytes.push(bitBuf << (8 - bitCount));
      bitBuf = 0;
      bitCount = 0;
    }
    offset = bitmapBytes.length;
  }

  const single = ranges.length === 1;
  return packGfxContainer({
    first: recs[0].codepoint,
    last: recs[recs.length - 1].codepoint,
    yAdvance: font.lineHeight,
    ranges: single ? [] : ranges,
    glyphs: glyphRecs,
    bitmap: Uint8Array.from(bitmapBytes),
  });
}

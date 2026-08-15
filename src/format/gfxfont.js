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
import { FormatError } from '../util/errors.js';
import { createBitmap, setPixel } from '../model/bitmap.js';
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

// @ts-check
/**
 * u8g2 フォント形式のデコーダ。
 *
 * 参照実装: LovyanGFX v1.2.26 lgfx_fonts.cpp の U8g2font（u8g2 本家 bdfconv の出力形式）。
 * ヘッダ 23 バイト + ASCII 区間（1 バイト encoding + 1 バイト size の連結リスト）
 * + Unicode 区間（ジャンプ表 + 2 バイト encoding + 1 バイト size）。
 * グリフ本体は可変ビット幅フィールド（LSB first）+ 0/1 ランレングス。
 */
import { BitReaderLsb } from '../util/bits.js';
import { TruncatedDataError, FormatError } from '../util/errors.js';
import { createBitmap, setPixel } from '../model/bitmap.js';
import { createFont } from '../model/font.js';

/** @typedef {import('../model/font.js').Font} Font */
/** @typedef {import('../model/font.js').Glyph} Glyph */

const HEADER_SIZE = 23;

/**
 * @param {Uint8Array} data
 * @returns {{
 *   glyphCnt: number, bbxMode: number, bitsPer0: number, bitsPer1: number,
 *   bitsPerCharWidth: number, bitsPerCharHeight: number, bitsPerCharX: number,
 *   bitsPerCharY: number, bitsPerDeltaX: number,
 *   maxCharWidth: number, maxCharHeight: number, xOffset: number, yOffset: number,
 *   ascentA: number, descentG: number, ascentPara: number, descentPara: number,
 *   startPosUpperA: number, startPosLowerA: number, startPosUnicode: number,
 * }}
 */
export function readU8g2Header(data) {
  if (data.length < HEADER_SIZE) {
    throw new TruncatedDataError('u8g2 header needs 23 bytes', { length: data.length });
  }
  const i8 = (/** @type {number} */ v) => (v >= 0x80 ? v - 0x100 : v);
  return {
    glyphCnt: data[0],
    bbxMode: data[1],
    bitsPer0: data[2],
    bitsPer1: data[3],
    bitsPerCharWidth: data[4],
    bitsPerCharHeight: data[5],
    bitsPerCharX: data[6],
    bitsPerCharY: data[7],
    bitsPerDeltaX: data[8],
    maxCharWidth: i8(data[9]),
    maxCharHeight: i8(data[10]),
    xOffset: i8(data[11]),
    yOffset: i8(data[12]),
    ascentA: i8(data[13]),
    descentG: i8(data[14]),
    ascentPara: i8(data[15]),
    descentPara: i8(data[16]),
    startPosUpperA: (data[17] << 8) | data[18],
    startPosLowerA: (data[19] << 8) | data[20],
    startPosUnicode: (data[21] << 8) | data[22],
  };
}

/**
 * グリフ 1 個をビット列からデコードする。
 * @param {Uint8Array} data
 * @param {number} offset - グリフのビットフィールド先頭（encoding/size の後）
 * @param {ReturnType<typeof readU8g2Header>} h
 * @param {number} codepoint
 * @returns {Glyph}
 */
function decodeGlyphBits(data, offset, h, codepoint) {
  const r = new BitReaderLsb(data, offset);
  const w = r.readUnsigned(h.bitsPerCharWidth);
  const height = r.readUnsigned(h.bitsPerCharHeight);
  const gx = r.readSigned(h.bitsPerCharX);
  const gy = r.readSigned(h.bitsPerCharY);
  const dx = r.readSigned(h.bitsPerDeltaX);

  const bitmap = createBitmap(w, height, 1);
  const total = w * height;
  let p = 0;
  while (p < total) {
    const zeros = r.readUnsigned(h.bitsPer0);
    const ones = r.readUnsigned(h.bitsPer1);
    do {
      p += zeros;
      for (let k = 0; k < ones && p < total; k++, p++) {
        setPixel(bitmap, p % w, (p / w) | 0, 1);
      }
      if (p >= total) break;
    } while (r.readUnsigned(1) === 1);
  }

  return {
    codepoint,
    xOffset: gx,
    yOffset: -(gy + height),
    xAdvance: dx,
    bitmap,
  };
}

/**
 * u8g2 フォントバイナリを中立モデルへデコードする。
 * @param {Uint8Array} data
 * @param {{familyName?: string, styleName?: string}} [opts]
 * @returns {Font}
 */
export function decodeU8g2(data, opts = {}) {
  const h = readU8g2Header(data);
  /** @type {import('../model/font.js').FontIssue[]} */
  const issues = [];
  /** @type {Map<number, Glyph>} */
  const glyphs = new Map();

  // ASCII 区間（encoding <= 255）: [enc(1)][size(1)][bits...] の連結。size 0 で終端。
  let pos = HEADER_SIZE;
  while (pos + 1 < data.length && data[pos + 1] !== 0) {
    const enc = data[pos];
    const size = data[pos + 1];
    glyphs.set(enc, decodeGlyphBits(data, pos + 2, h, enc));
    pos += size;
  }

  // Unicode 区間: ジャンプ表（[offsetBE(2)][endEncodingBE(2)] の列）の後に
  // [encBE(2)][size(1)][bits...] の連結。encoding 0 で終端。
  if (h.startPosUnicode !== 0) {
    const base = HEADER_SIZE + h.startPosUnicode;
    if (base + 2 <= data.length) {
      const firstOff = (data[base] << 8) | data[base + 1];
      let gpos = base + firstOff;
      while (gpos + 2 < data.length) {
        const enc = (data[gpos] << 8) | data[gpos + 1];
        if (enc === 0) break;
        const size = data[gpos + 2];
        if (size === 0) {
          issues.push({ level: 'warning', code: 'U8G2_BAD_GLYPH_SIZE', codepoint: enc });
          break;
        }
        glyphs.set(enc, decodeGlyphBits(data, gpos + 3, h, enc));
        gpos += size;
      }
    } else {
      throw new FormatError('TRUNCATED', 'u8g2 unicode section out of range', { base });
    }
  }

  // LGFX U8g2font::getDefaultMetric と同じ:
  // height = max_char_height, baseline = height + y_offset（y_offset は負）
  const height = h.maxCharHeight;
  const baseline = height + h.yOffset;

  return createFont({
    familyName: opts.familyName ?? '',
    styleName: opts.styleName ?? 'Regular',
    ascent: baseline,
    descent: height - baseline,
    lineHeight: height,
    glyphs,
    meta: {
      sourceFormat: 'u8g2',
      drawProfile: 'u8g2',
      fallback: { advance: h.maxCharWidth, width: h.maxCharWidth, xOffset: 0 },
      issues,
      format: { u8g2: h },
    },
  });
}

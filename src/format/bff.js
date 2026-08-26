// @ts-check
/**
 * BFF decoder and encoder for LovyanGFX BFFfont, whose binary format originates
 * in LVGL lv_font_conv (implemented in Phase 4 from the spec §2.1 candidate list).
 *
 * Reference: LovyanGFX v1.2.26 BFFfont in lgfx_fonts.cpp (loadFont /
 * mapCodepointToGlyph / loadGlyphInfo / decodeGlyphBitmap）。
 *
 * Layout: records of [u32le size + four-character tag].
 *   head: version(4), extra table count(2), font_size(2), ascent(2), signed descent(2)
 *         typo_ascent(2) typo_descent(2) typo_line_gap(2) min_y(2) max_y(2)
 *         default_advance_width(2) kerning_scale(2) index_to_loc_format(1)
 *         glyph_id_format(1) advance_width_format(1) bits_per_pixel(1)
 *         bbox_xy_bits(1) bbox_wh_bits(1) advance_width_bits(1)
 *         compression_alg(1) subpixel(1)
 *   cmap: format 0/1/2/3 subtables mapping code points to glyph ids
 *   loca: glyph id to offset within glyf
 *   glyf: per-glyph MSB-first bitstream
 *         [advance][bbox_x][bbox_y][w][h][pixels...]
 *         bbox_y is baseline to bitmap bottom, positive upward (BDF-style)
 *   kern: kerning table. LovyanGFX skips it, so this library preserves the
 *         record opaquely without applying it (spec §2.3).
 *
 * Pixels are coverage values 0..(2^bpp - 1), normalized to 8bpp in the neutral
 * model using a8 = (255*v + max/2) / max, matching LovyanGFX blend rounding.
 * For bpp <= 4 this normalization is reversible and round-trips the original bits.
 */
import { TruncatedDataError, FormatError, EncodeConstraintError } from '../util/errors.js';
import { createBitmap } from '../model/bitmap.js';
import { createFont } from '../model/font.js';

/** @typedef {import('../model/font.js').Font} Font */
/** @typedef {import('../model/font.js').Glyph} Glyph */

/** @param {Uint8Array} p @param {number} at */
const u16 = (p, at) => p[at] | (p[at + 1] << 8);
/** @param {Uint8Array} p @param {number} at */
const s16 = (p, at) => {
  const v = u16(p, at);
  return v >= 0x8000 ? v - 0x10000 : v;
};
/** @param {Uint8Array} p @param {number} at */
const u32 = (p, at) => (p[at] | (p[at + 1] << 8) | (p[at + 2] << 16) | (p[at + 3] << 24)) >>> 0;

/** MSB-first bit reader matching LGFX bit_stream_t. */
class BitStream {
  /** @param {Uint8Array} data @param {number} [bitPos] */
  constructor(data, bitPos = 0) {
    this.data = data;
    this.bitPos = bitPos;
    this.bitLength = data.length * 8;
  }

  /** @param {number} count */
  readBits(count) {
    let result = 0;
    while (count--) {
      if (this.bitPos >= this.bitLength) break;
      const byteIndex = this.bitPos >> 3;
      const bitIndex = 7 - (this.bitPos & 7);
      result = (result << 1) | ((this.data[byteIndex] >> bitIndex) & 1);
      this.bitPos++;
    }
    return result >>> 0;
  }

  /** Reads a two's-complement signed value. @param {number} count */
  readSbits(count) {
    if (count === 0) return 0;
    const v = this.readBits(count);
    const sign = 1 << (count - 1);
    return v & sign ? v - (1 << count) : v;
  }
}

/** MSB-first bit writer. */
class BitSink {
  constructor() {
    /** @type {number[]} */
    this.bytes = [];
    this.cur = 0;
    this.nbits = 0;
  }

  /** @param {number} value @param {number} count */
  writeBits(value, count) {
    for (let i = count - 1; i >= 0; i--) {
      this.cur = (this.cur << 1) | ((value >> i) & 1);
      if (++this.nbits === 8) {
        this.bytes.push(this.cur);
        this.cur = 0;
        this.nbits = 0;
      }
    }
  }

  /** @param {number} value @param {number} count */
  writeSbits(value, count) {
    this.writeBits(value < 0 ? value + (1 << count) : value, count);
  }

  toUint8Array() {
    const out = [...this.bytes];
    if (this.nbits) out.push((this.cur << (8 - this.nbits)) & 0xff);
    return Uint8Array.from(out);
  }
}

/**
 * Port of LGFX decode_rle_bitmap for lv_font_conv I3BN compression.
 * @param {BitStream} bs
 * @param {number} bpp
 * @param {number} pixelCount
 * @returns {Uint8Array}
 */
export function decodeRleBitmap(bs, bpp, pixelCount) {
  const dst = new Uint8Array(pixelCount);
  let out = 0;
  let prev = 0;
  let count = 0;
  /** @type {0 | 1 | 2} RLE_SINGLE / RLE_REPEATED / RLE_COUNTER */
  let state = 0;

  while (out < pixelCount) {
    let ret = 0;
    if (state === 0) {
      if (bs.bitPos + bpp > bs.bitLength) break;
      ret = bs.readBits(bpp);
      if (bs.bitPos !== bpp && prev === ret) {
        count = 0;
        state = 1;
      }
      prev = ret;
    } else if (state === 1) {
      if (bs.bitPos >= bs.bitLength) break;
      const v = bs.readBits(1);
      ++count;
      if (v === 1) {
        ret = prev;
        if (count === 11) {
          if (bs.bitPos + 6 > bs.bitLength) break;
          count = bs.readBits(6);
          if (count !== 0) {
            state = 2;
          } else {
            if (bs.bitPos + bpp > bs.bitLength) break;
            ret = bs.readBits(bpp);
            prev = ret;
            state = 0;
          }
        }
      } else {
        if (bs.bitPos + bpp > bs.bitLength) break;
        ret = bs.readBits(bpp);
        prev = ret;
        state = 0;
      }
    } else {
      ret = prev;
      if (count) --count;
      if (count === 0) {
        if (bs.bitPos + bpp > bs.bitLength) break;
        ret = bs.readBits(bpp);
        prev = ret;
        state = 0;
      }
    }
    dst[out++] = ret;
  }
  return dst; // Missing output remains zero, matching LGFX.
}

/**
 * Decodes a BFF binary into the neutral model.
 * @param {Uint8Array} data
 * @param {{familyName?: string, styleName?: string}} [opts]
 * @returns {Font}
 */
export function decodeBff(data, opts = {}) {
  /** @type {import('../model/font.js').FontIssue[]} */
  const issues = [];

  // --- Record scan ---
  /** @type {Record<string, {offset: number, size: number}>} */
  const records = {};
  /** @type {Uint8Array | null} */
  let kernRecord = null;
  let offset = 0;
  for (let i = 0; i < 32 && offset + 8 <= data.length; i++) {
    const size = u32(data, offset);
    if (size < 8) break;
    const tag = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]);
    if (tag === 'head' || tag === 'cmap' || tag === 'loca' || tag === 'glyf') {
      records[tag] = { offset, size };
    } else if (tag === 'kern') {
      kernRecord = new Uint8Array(data.subarray(offset, offset + size));
    }
    if (offset + size > data.length) break;
    offset += size;
  }
  const head = records.head;
  const cmapRec = records.cmap;
  const locaRec = records.loca;
  const glyfRec = records.glyf;
  if (!head || head.size < 44 || !cmapRec || cmapRec.size < 12 || !locaRec || locaRec.size < 12 || !glyfRec || glyfRec.size < 8) {
    throw new FormatError('DETECT_FAILED', 'not a BFF/LVGL font (missing records)', {
      found: Object.keys(records),
    });
  }

  // --- head ---
  const h = data.subarray(head.offset + 8, head.offset + head.size);
  const fontSize = u16(h, 6);
  const ascent = s16(h, 8);
  const descent = s16(h, 10);
  const typoAscent = u16(h, 12);
  const typoDescent = s16(h, 14);
  const typoLineGap = u16(h, 16);
  const minY = s16(h, 18);
  const maxY = s16(h, 20);
  const defaultAdvance = u16(h, 22);
  const kerningScale = u16(h, 24);
  const indexToLocFormat = h[26];
  const glyphIdFormat = h[27];
  const advanceWidthFormat = h[28];
  const bpp = h[29];
  const bboxXyBits = h[30];
  const bboxWhBits = h[31];
  const advanceWidthBits = h[32];
  const compression = h[33];
  const subpixel = h[34];
  if (bpp === 0 || bpp > 4) {
    throw new FormatError('UNSUPPORTED_FEATURE', `bits_per_pixel ${bpp} (LovyanGFX supports 1..4)`, { bpp });
  }

  // --- cmap ---
  const cmap = data.subarray(cmapRec.offset + 8, cmapRec.offset + cmapRec.size);
  const subtableCount = u32(cmap, 0);
  /** @type {{dataOffset: number, rangeStart: number, rangeLength: number,
   *          glyphIdOffset: number, entriesCount: number, formatType: number}[]} */
  const subtables = [];
  for (let i = 0; i < subtableCount; i++) {
    const at = 4 + i * 16;
    subtables.push({
      dataOffset: u32(cmap, at),
      rangeStart: u32(cmap, at + 4),
      rangeLength: u16(cmap, at + 8),
      glyphIdOffset: u16(cmap, at + 10),
      entriesCount: u16(cmap, at + 12),
      formatType: cmap[at + 14],
    });
  }
  // lv_font_conv may write offsets relative to the record start. Like LGFX,
  // use majority voting to normalize them to payload-relative offsets.
  {
    let payloadValid = 0;
    let recordValid = 0;
    for (const st of subtables) {
      if (st.dataOffset === 0) {
        payloadValid++;
        recordValid++;
        continue;
      }
      if (st.dataOffset < cmap.length) payloadValid++;
      if (st.dataOffset >= 8 && st.dataOffset - 8 < cmap.length) recordValid++;
    }
    if (recordValid > payloadValid) {
      for (const st of subtables) if (st.dataOffset >= 8) st.dataOffset -= 8;
    }
  }

  // Enumerate every codepoint-to-glyph-id mapping.
  /** @type {Map<number, number>} cp → gid */
  const cpToGid = new Map();
  for (const st of subtables) {
    switch (st.formatType) {
      case 0:
        // Dense u8 delta array; gid 0 means absent, as in LGFX.
        for (let i = 0; i < st.rangeLength; i++) {
          if (st.dataOffset === 0 || st.dataOffset + i >= cmap.length) break;
          const gid = st.glyphIdOffset + cmap[st.dataOffset + i];
          if (gid !== 0) cpToGid.set(st.rangeStart + i, gid);
        }
        break;
      case 1: {
        const cpOff = st.dataOffset;
        const gidOff = cpOff + st.entriesCount * 2;
        for (let i = 0; i < st.entriesCount; i++) {
          const delta = u16(cmap, cpOff + i * 2);
          const gid = st.glyphIdOffset + u16(cmap, gidOff + i * 2);
          if (gid !== 0) cpToGid.set(st.rangeStart + delta, gid);
        }
        break;
      }
      case 2:
        for (let i = 0; i < st.rangeLength; i++) {
          const gid = st.glyphIdOffset + i;
          if (gid !== 0) cpToGid.set(st.rangeStart + i, gid);
        }
        break;
      case 3:
        for (let i = 0; i < st.entriesCount; i++) {
          const delta = u16(cmap, st.dataOffset + i * 2);
          const gid = st.glyphIdOffset + i;
          if (gid !== 0) cpToGid.set(st.rangeStart + delta, gid);
        }
        break;
      default:
        issues.push({ level: 'warning', code: 'BFF_CMAP_FORMAT_UNSUPPORTED', params: { format: st.formatType } });
    }
  }

  // --- loca ---
  const loca = data.subarray(locaRec.offset + 8, locaRec.offset + locaRec.size);
  const locaEntries = u32(loca, 0);
  /** @type {number[]} */
  const locaTable = [];
  for (let i = 0; i < locaEntries; i++) {
    locaTable.push(indexToLocFormat === 0 ? u16(loca, 4 + i * 2) : u32(loca, 4 + i * 4));
  }
  const glyfPayloadSize = glyfRec.size - 8;
  // loca may be relative to the glyf record start. Like LGFX, read actual glyph
  // headers and choose the origin with the better validity score.
  {
    const headerBits = advanceWidthBits + bboxXyBits * 2 + bboxWhBits * 2;
    const headerBytes = Math.max(1, Math.ceil(headerBits / 8));
    const glyf = data.subarray(glyfRec.offset + 8, glyfRec.offset + glyfRec.size);
    /** @param {number} shift */
    const score = (shift) => {
      if (headerBytes > 16) return -1;
      let s = 0;
      const probeBegin = locaEntries > 1 ? 1 : 0;
      const probeEnd = Math.min(locaEntries, probeBegin + 12);
      for (let gid = probeBegin; gid < probeEnd; gid++) {
        const raw = locaTable[gid];
        if (raw < shift) continue;
        const off = raw - shift;
        if (off >= glyfPayloadSize) continue;
        let next = glyfPayloadSize;
        if (gid + 1 < locaEntries) {
          const rawNext = locaTable[gid + 1];
          if (rawNext >= shift) {
            const nn = rawNext - shift;
            if (nn >= off && nn <= glyfPayloadSize) next = nn;
          }
        }
        if (next <= off || next - off < headerBytes) continue;
        const bs = new BitStream(glyf.subarray(off, off + headerBytes));
        const adv = advanceWidthBits ? bs.readBits(advanceWidthBits) : defaultAdvance;
        const bx = bs.readSbits(bboxXyBits);
        const by = bs.readSbits(bboxXyBits);
        const bw = bs.readBits(bboxWhBits);
        const bh = bs.readBits(bboxWhBits);
        if (adv > 0) s += 1;
        if (bw > 0 && bh > 0) s += 3;
        if (bw <= fontSize * 3 + 8 && bh <= fontSize * 3 + 8) s += 2;
        if (Math.abs(bx) <= 32 && Math.abs(by) <= 32) s += 1;
      }
      return s;
    };
    const canShift8 = locaTable.every((v) => v >= 8);
    const score0 = score(0);
    const score8 = canShift8 ? score(8) : -1;
    let useShift8 = false;
    if (score8 >= 0) {
      if (score8 > score0 + 2) useShift8 = true;
      else if (score8 === score0 && locaEntries > 0 && locaTable[0] === 8) useShift8 = true;
    }
    if (useShift8) for (let i = 0; i < locaTable.length; i++) locaTable[i] -= 8;
  }

  // --- glyf ---
  const glyf = data.subarray(glyfRec.offset + 8, glyfRec.offset + glyfRec.size);
  const maxAlpha = (1 << bpp) - 1;
  const headerBits = advanceWidthBits + bboxXyBits * 2 + bboxWhBits * 2;

  /**
   * Decodes one glyph id into a model glyph.
   * @param {number} gid
   * @param {number} cp
   * @returns {Glyph | null}
   */
  const decodeGid = (gid, cp) => {
    if (gid >= locaEntries) return null;
    const off = locaTable[gid];
    if (off >= glyfPayloadSize) return null;
    let next = glyfPayloadSize;
    if (gid + 1 < locaEntries) {
      const nn = locaTable[gid + 1];
      if (nn >= off && nn <= glyfPayloadSize) next = nn;
    }
    if (next <= off) return null;
    const bytes = glyf.subarray(off, next);
    const bs = new BitStream(bytes);
    const advRaw = advanceWidthBits ? bs.readBits(advanceWidthBits) : defaultAdvance;
    const bx = bs.readSbits(bboxXyBits);
    const by = bs.readSbits(bboxXyBits);
    let w = bs.readBits(bboxWhBits);
    const hgt = bs.readBits(bboxWhBits);
    const pixelCount = w * hgt;

    /** @type {Uint8Array} */
    let pix;
    if (pixelCount === 0) {
      pix = new Uint8Array(0);
    } else if (compression === 0) {
      pix = new Uint8Array(pixelCount);
      const pbs = new BitStream(bytes, headerBits);
      for (let i = 0; i < pixelCount; i++) pix[i] = pbs.readBits(bpp);
    } else if (compression === 1 || compression === 2) {
      const pbs = new BitStream(bytes, headerBits);
      pix = decodeRleBitmap(pbs, bpp, pixelCount);
      if (compression === 1) {
        // Reverse the inter-row XOR delta filter.
        for (let y = 1; y < hgt; y++) {
          for (let x = 0; x < w; x++) pix[y * w + x] ^= pix[(y - 1) * w + x];
        }
      }
    } else {
      issues.push({ level: 'warning', code: 'BFF_COMPRESSION_UNSUPPORTED', codepoint: cp, params: { compression } });
      return null;
    }

    // Collapse RGB subpixel triplets to luminance using the LGFX formula.
    if (subpixel && w >= 3) {
      const outW = Math.max(1, Math.floor(w / 3));
      const gray = new Uint8Array(outW * hgt);
      for (let y = 0; y < hgt; y++) {
        for (let x = 0; x < outW; x++) {
          const s = x * 3;
          const rr = pix[y * w + s];
          const gg = pix[y * w + s + 1];
          const bb = pix[y * w + s + 2];
          gray[y * outW + x] = (rr * 77 + gg * 150 + bb * 29 + 128) >> 8;
        }
      }
      pix = gray;
      w = outW;
    }

    const bitmap = createBitmap(w, hgt, 8);
    for (let i = 0; i < w * hgt; i++) {
      const v = pix[i];
      bitmap.data[i] = v >= maxAlpha ? 255 : Math.floor((255 * v + (maxAlpha >> 1)) / maxAlpha);
    }
    const adv = advanceWidthFormat === 1 ? (advRaw + 8) >> 4 : advRaw;
    return {
      codepoint: cp,
      xOffset: bx,
      yOffset: by + hgt === 0 ? 0 : -(by + hgt),
      xAdvance: adv,
      bitmap,
    };
  };

  /** @type {Map<number, Glyph>} */
  const glyphs = new Map();
  for (const [cp, gid] of [...cpToGid.entries()].sort((a, b) => a[0] - b[0])) {
    if (cp > 0x10ffff) continue;
    const g = decodeGid(gid, cp);
    if (g) glyphs.set(cp, g);
    else issues.push({ level: 'warning', code: 'BFF_GLYPH_UNREADABLE', codepoint: cp });
  }
  // gid 0 is the missing-character fallback. LGFX draws it for missing input,
  // so store it at code point 0 to join the same model fallback chain.
  if (!glyphs.has(0)) {
    const g0 = decodeGid(0, 0);
    if (g0) glyphs.set(0, g0);
  }

  // Derive metrics exactly like LGFX getDefaultMetric.
  const boxH = ascent + Math.abs(descent) > 0 ? ascent + Math.abs(descent) : fontSize > 0 ? fontSize : 16;
  let yAdv = typoAscent + Math.abs(typoDescent) + typoLineGap;
  if (yAdv <= 0) yAdv = boxH;

  return createFont({
    familyName: opts.familyName ?? '',
    styleName: opts.styleName ?? 'Regular',
    ascent,
    descent: boxH - ascent,
    lineHeight: yAdv,
    glyphs,
    meta: {
      sourceFormat: 'bff',
      drawProfile: 'vlw', // draw_alpha_bitmap_common uses the same quantization as VLW.
      fallback: { advance: defaultAdvance, width: defaultAdvance, xOffset: 0 },
      issues,
      format: {
        bff: {
          fontSize,
          headerAscent: ascent,
          headerDescent: descent,
          typoAscent,
          typoDescent,
          typoLineGap,
          minY,
          maxY,
          defaultAdvance,
          kerningScale,
          glyphIdFormat,
          advanceWidthFormat,
          bpp,
          subpixel,
          kernRecord: kernRecord ? [...kernRecord] : null,
        },
      },
    },
  });
}

/**
 * Checks BFF encodability (spec §7.1).
 * @param {Font} font
 * @returns {{ok: boolean, issues: import('./registry.js').EncodeIssue[]}}
 */
export function canEncodeBff(font) {
  /** @type {import('./registry.js').EncodeIssue[]} */
  const issues = [];
  for (const g of font.glyphs.values()) {
    /** @param {string} code @param {object} params */
    const err = (code, params) => issues.push({ level: 'error', code, codepoint: g.codepoint, params });
    if (g.codepoint > 0xffff && g.codepoint !== 0) {
      // cmap range_start is u32, but the LGFX drawing API is uint16, effectively limiting it to BMP.
      err('CODEPOINT_OVER_BMP', { value: g.codepoint });
    }
    if (g.bitmap.width > 1023 || g.bitmap.height > 1023) {
      err('GLYPH_TOO_LARGE', { width: g.bitmap.width, height: g.bitmap.height, max: 1023 });
    }
    if (g.xAdvance < 0 || g.xAdvance > 1023) err('XADVANCE_RANGE', { value: g.xAdvance, min: 0, max: 1023 });
  }
  if (font.glyphs.size === 0) issues.push({ level: 'error', code: 'EMPTY_FONT' });
  if (font.lineHeight < font.ascent + font.descent) {
    issues.push({
      level: 'warning',
      code: 'LINE_HEIGHT_COLLAPSED',
      params: { lineHeight: font.lineHeight, boxHeight: font.ascent + font.descent },
    });
  }
  return { ok: !issues.some((i) => i.level === 'error'), issues };
}

/** Unsigned bit count. @param {number} max */
const bitsFor = (max) => {
  let n = 1;
  while (max >= 1 << n) n++;
  return n;
};
/** Two's-complement signed bit count. @param {number} min @param {number} max */
const sbitsFor = (min, max) => {
  let n = 1;
  while (min < -(1 << (n - 1)) || max > (1 << (n - 1)) - 1) n++;
  return n;
};

/**
 * Encodes the neutral model as BFF without compression (algorithm 0; LovyanGFX
 * reads 0/1/2). An opaque kern record preserved during decoding is written back unchanged.
 * @param {Font} font
 * @param {{dropInvalid?: boolean, bpp?: 1 | 2 | 4}} [opts]
 * @returns {Uint8Array}
 */
export function encodeBff(font, opts = {}) {
  const check = canEncodeBff(font);
  const badCps = new Set(
    check.issues.filter((i) => i.level === 'error' && i.codepoint !== undefined).map((i) => i.codepoint),
  );
  if (!check.ok) {
    const fontLevel = check.issues.some((i) => i.level === 'error' && i.codepoint === undefined);
    if (!opts.dropInvalid || fontLevel) {
      throw new EncodeConstraintError('font does not fit the BFF format', check.issues);
    }
  }

  const meta = /** @type {{bff?: any}} */ (font.meta.format ?? {}).bff;
  // Choose 1bpp for all-0/255 coverage, otherwise 4bpp; source metadata takes precedence.
  let bpp = opts.bpp ?? meta?.bpp;
  if (!bpp) {
    bpp = 1;
    outer: for (const g of font.glyphs.values()) {
      const n = g.bitmap.bpp === 8 ? g.bitmap.width * g.bitmap.height : 0;
      for (let i = 0; i < n; i++) {
        const v = g.bitmap.data[i];
        if (v !== 0 && v !== 255) {
          bpp = 4;
          break outer;
        }
      }
    }
  }
  const maxAlpha = (1 << bpp) - 1;

  // gid 0 is the fallback glyph. Use model code point 0 if present; otherwise
  // create an empty glyph with fallback advance, matching LGFX missing -> gid 0.
  const fallbackAdv = Math.min(1023, meta?.defaultAdvance ?? font.meta.fallback?.advance ?? 0);
  const zero = font.glyphs.get(0);
  const rest = [...font.glyphs.values()]
    .filter((g) => g.codepoint !== 0 && !badCps.has(g.codepoint))
    .sort((a, b) => a.codepoint - b.codepoint);
  /** @type {(Glyph | null)[]} glyph-id order */
  const byGid = [zero ?? null, ...rest];

  // Field widths.
  let maxAdv = Math.max(1, fallbackAdv);
  let minXy = 0;
  let maxXy = 0;
  let maxWh = 1;
  for (const g of byGid) {
    if (!g) continue;
    const by = g.yOffset === 0 ? 0 : -g.yOffset - g.bitmap.height;
    maxAdv = Math.max(maxAdv, g.xAdvance);
    minXy = Math.min(minXy, g.xOffset, by);
    maxXy = Math.max(maxXy, g.xOffset, by);
    maxWh = Math.max(maxWh, g.bitmap.width, g.bitmap.height);
  }
  const advanceWidthBits = bitsFor(maxAdv);
  const bboxXyBits = sbitsFor(minXy, maxXy);
  const bboxWhBits = bitsFor(maxWh);

  // --- glyf ---
  /** @type {Uint8Array[]} */
  const glyphBlobs = [];
  for (const g of byGid) {
    const sink = new BitSink();
    if (!g) {
      sink.writeBits(fallbackAdv, advanceWidthBits);
      sink.writeSbits(0, bboxXyBits);
      sink.writeSbits(0, bboxXyBits);
      sink.writeBits(0, bboxWhBits);
      sink.writeBits(0, bboxWhBits);
      glyphBlobs.push(sink.toUint8Array());
      continue;
    }
    const w = g.bitmap.width;
    const hgt = g.bitmap.height;
    const by = g.yOffset === 0 ? 0 : -g.yOffset - hgt;
    sink.writeBits(g.xAdvance, advanceWidthBits);
    sink.writeSbits(g.xOffset, bboxXyBits);
    sink.writeSbits(by, bboxXyBits);
    sink.writeBits(w, bboxWhBits);
    sink.writeBits(hgt, bboxWhBits);
    for (let y = 0; y < hgt; y++) {
      for (let x = 0; x < w; x++) {
        let a8;
        if (g.bitmap.bpp === 8) {
          a8 = g.bitmap.data[y * g.bitmap.width + x];
        } else {
          const byte = g.bitmap.data[y * g.bitmap.stride + (x >> 3)];
          a8 = (byte >> (7 - (x & 7))) & 1 ? 255 : 0;
        }
        sink.writeBits(Math.round((a8 * maxAlpha) / 255), bpp);
      }
    }
    glyphBlobs.push(sink.toUint8Array());
  }
  /** @type {number[]} */
  const locaOffsets = [];
  let glyfLen = 0;
  for (const blob of glyphBlobs) {
    locaOffsets.push(glyfLen);
    glyfLen += blob.length;
  }
  const indexToLocFormat = glyfLen <= 0xffff ? 0 : 1;

  // --- cmap: one format-1 subtable, split so ranges fit u16 ---
  /** @type {{rangeStart: number, cps: number[], gids: number[]}[]} */
  const subtables = [];
  {
    /** @type {{rangeStart: number, cps: number[], gids: number[]} | null} */
    let cur = null;
    rest.forEach((g, i) => {
      const gid = i + 1;
      if (!cur || g.codepoint - cur.rangeStart >= 0xffff) {
        cur = { rangeStart: g.codepoint, cps: [], gids: [] };
        subtables.push(cur);
      }
      cur.cps.push(g.codepoint - cur.rangeStart);
      cur.gids.push(gid);
    });
  }

  // --- Serialization ---
  /** @type {number[]} */
  const out = [];
  const pushU16 = (/** @type {number} */ v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const pushU32 = (/** @type {number} */ v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  /** @param {string} tag @param {() => void} body */
  const record = (tag, body) => {
    const sizeAt = out.length;
    pushU32(0);
    out.push(tag.charCodeAt(0), tag.charCodeAt(1), tag.charCodeAt(2), tag.charCodeAt(3));
    body();
    const size = out.length - sizeAt;
    out[sizeAt] = size & 0xff;
    out[sizeAt + 1] = (size >> 8) & 0xff;
    out[sizeAt + 2] = (size >> 16) & 0xff;
    out[sizeAt + 3] = (size >>> 24) & 0xff;
  };

  const ascent = meta?.headerAscent ?? font.ascent;
  const descent = meta?.headerDescent ?? -font.descent;
  record('head', () => {
    pushU32(1); // version
    pushU16(0); // extra tables
    pushU16(meta?.fontSize ?? font.lineHeight);
    pushU16(ascent & 0xffff);
    pushU16(descent & 0xffff);
    pushU16(meta?.typoAscent ?? font.ascent);
    pushU16((meta?.typoDescent ?? -font.descent) & 0xffff);
    pushU16(meta?.typoLineGap ?? Math.max(0, font.lineHeight - font.ascent - font.descent));
    pushU16((meta?.minY ?? minXy) & 0xffff);
    pushU16((meta?.maxY ?? maxXy + maxWh) & 0xffff);
    pushU16(meta?.defaultAdvance ?? font.meta.fallback?.advance ?? 0);
    pushU16(meta?.kerningScale ?? 16);
    out.push(indexToLocFormat);
    out.push(meta?.glyphIdFormat ?? 0);
    out.push(0); // advance_width_format 0 (integer).
    out.push(bpp);
    out.push(bboxXyBits);
    out.push(bboxWhBits);
    out.push(advanceWidthBits);
    out.push(0); // compression 0
    out.push(0); // subpixel 0
    out.push(0); // Padding; LGFX requires at least 44 bytes.
  });

  record('cmap', () => {
    pushU32(subtables.length);
    // Data follows the header table; offsets are payload-relative.
    let dataOffset = 4 + subtables.length * 16;
    for (const st of subtables) {
      pushU32(dataOffset);
      pushU32(st.rangeStart);
      pushU16(st.cps[st.cps.length - 1] + 1); // range_length
      pushU16(0); // glyph_id_offset
      pushU16(st.cps.length); // entries_count
      out.push(1, 0); // format 1 (sparse) plus padding.
      dataOffset += st.cps.length * 4;
    }
    for (const st of subtables) {
      for (const d of st.cps) pushU16(d);
      for (const gid of st.gids) pushU16(gid);
    }
  });

  record('loca', () => {
    pushU32(glyphBlobs.length);
    for (const off of locaOffsets) {
      if (indexToLocFormat === 0) pushU16(off);
      else pushU32(off);
    }
  });

  record('glyf', () => {
    for (const blob of glyphBlobs) for (const b of blob) out.push(b);
  });

  if (meta?.kernRecord) {
    for (const b of meta.kernRecord) out.push(b);
  }

  return Uint8Array.from(out);
}

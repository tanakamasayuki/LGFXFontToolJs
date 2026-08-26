// @ts-check
/**
 * FONTX2 decoder and encoder (spec §2.1, Phase 4).
 *
 * A long-standing Japanese embedded format originating on MS-DOS and compatible
 * with tools around ChaN / ELM. It stores fixed-cell bitmap tables. One file is
 * either ANK (256 single-byte glyphs) or kanji (two-byte Shift-JIS with a code-block
 * table). ANK and full-width kanji traditionally come as separate paired files;
 * decoding and merging both produces one neutral model.
 *
 *   0    6  signature "FONTX2"
 *   6    8  space-padded font name
 *   14   1  width XSize
 *   15   1  height YSize
 *   16   1  code type: 0=ANK, 1=Shift-JIS
 *   ANK:  256 glyphs from offset 17, each ceil(XSize/8)*YSize bytes, row-major MSB-first
 *   kanji: block count NB at 17, then NB×4 bytes from 18 (start/end SJIS u16 LE),
 *          followed by glyphs in block and code order
 *
 * Code-point conversion uses Encoding Standard shift_jis through TextDecoder,
 * required in browsers and bundled with Node 20+. The reverse map is built on
 * first use by decoding all codes, keeping both directions dependency-free.
 *
 * FONTX2 has no baseline metadata. The cell bottom is the default baseline
 * (descent 0), overridable via opts.descent. LovyanGFX has no corresponding
 * class, so the generic 'gfx' drawing profile is used.
 */
import { FormatError, TruncatedDataError, EncodeConstraintError } from '../util/errors.js';
import { createBitmap, getPixel, setPixel } from '../model/bitmap.js';
import { createFont } from '../model/font.js';

/** @typedef {import('../model/font.js').Font} Font */
/** @typedef {import('../model/font.js').Glyph} Glyph */

const SIGNATURE = 'FONTX2';

/** @type {TextDecoder | null} */
let sjisDecoder = null;

/** Converts a one- or two-byte SJIS code to Unicode; returns null if unassigned.
 * @param {number} code */
export function sjisToUnicode(code) {
  sjisDecoder ??= new TextDecoder('shift_jis');
  const bytes = code > 0xff ? Uint8Array.of(code >> 8, code & 0xff) : Uint8Array.of(code);
  const s = sjisDecoder.decode(bytes);
  if ([...s].length !== 1) return null;
  const cp = /** @type {number} */ (s.codePointAt(0));
  return cp === 0xfffd ? null : cp;
}

/** @type {Map<number, number> | null} */
let reverseMap = null;

/** Converts a Unicode code point to SJIS; returns null if unrepresentable.
 * @param {number} cp */
export function unicodeToSjis(cp) {
  if (!reverseMap) {
    reverseMap = new Map();
    for (let c = 0x20; c <= 0xdf; c++) {
      const u = sjisToUnicode(c);
      if (u !== null && !reverseMap.has(u)) reverseMap.set(u, c);
    }
    for (let lead = 0x81; lead <= 0xfc; lead++) {
      if (lead > 0x9f && lead < 0xe0) continue;
      for (let trail = 0x40; trail <= 0xfc; trail++) {
        if (trail === 0x7f) continue;
        const code = (lead << 8) | trail;
        const u = sjisToUnicode(code);
        if (u !== null && !reverseMap.has(u)) reverseMap.set(u, code);
      }
    }
  }
  return reverseMap.get(cp) ?? null;
}

/**
 * Decodes a FONTX2 binary into the neutral model.
 * @param {Uint8Array} data
 * @param {{familyName?: string, styleName?: string, descent?: number}} [opts]
 * @returns {Font}
 */
export function decodeFontx2(data, opts = {}) {
  if (data.length < 17) throw new TruncatedDataError('FONTX2 header needs 17 bytes', {});
  for (let i = 0; i < 6; i++) {
    if (data[i] !== SIGNATURE.charCodeAt(i)) {
      throw new FormatError('DETECT_FAILED', 'not a FONTX2 file (bad signature)');
    }
  }
  const name = String.fromCharCode(...data.subarray(6, 14)).trim();
  const width = data[14];
  const height = data[15];
  const codeType = data[16];
  const stride = (width + 7) >> 3;
  const glyphSize = stride * height;
  const descent = opts.descent ?? 0;
  const ascent = height - descent;

  /** @type {import('../model/font.js').FontIssue[]} */
  const issues = [];
  /** @type {Map<number, Glyph>} */
  const glyphs = new Map();

  /** @param {number} cp @param {number} offset */
  const addGlyph = (cp, offset) => {
    const bitmap = createBitmap(width, height, 1);
    // FONTX2 rows match neutral Bitmap layout: MSB-first and byte-padded.
    const src = data.subarray(offset, offset + glyphSize);
    if (src.length < glyphSize) {
      issues.push({ level: 'warning', code: 'FONTX2_BITMAP_TRUNCATED', codepoint: cp });
    }
    bitmap.data.set(src);
    glyphs.set(cp, { codepoint: cp, xOffset: 0, yOffset: -ascent, xAdvance: width, bitmap });
  };

  if (codeType === 0) {
    // ANK 0x00..0xFF maps through single-byte shift_jis: ASCII is identity and
    // 0xA1..0xDF is half-width kana. Skip unmappable codes.
    let skipped = 0;
    for (let code = 0; code < 256; code++) {
      const offset = 17 + code * glyphSize;
      if (offset + glyphSize > data.length) break;
      const cp = code < 0x20 ? code : sjisToUnicode(code);
      if (cp === null) {
        skipped++;
        continue;
      }
      addGlyph(cp, offset);
    }
    if (skipped > 0) {
      issues.push({ level: 'warning', code: 'FONTX2_UNMAPPED_CODES', params: { count: skipped } });
    }
  } else if (codeType === 1) {
    const nb = data[17];
    /** @type {{start: number, end: number}[]} */
    const blocks = [];
    for (let i = 0; i < nb; i++) {
      const at = 18 + i * 4;
      blocks.push({ start: data[at] | (data[at + 1] << 8), end: data[at + 2] | (data[at + 3] << 8) });
    }
    let offset = 18 + nb * 4;
    let skipped = 0;
    for (const b of blocks) {
      for (let code = b.start; code <= b.end; code++, offset += glyphSize) {
        if (offset + glyphSize > data.length) break;
        const cp = sjisToUnicode(code);
        if (cp === null) {
          skipped++;
          continue;
        }
        addGlyph(cp, offset);
      }
    }
    if (skipped > 0) {
      issues.push({ level: 'warning', code: 'FONTX2_UNMAPPED_CODES', params: { count: skipped } });
    }
  } else {
    throw new FormatError('UNSUPPORTED_FEATURE', `FONTX2 code type ${codeType}`, { codeType });
  }

  return createFont({
    familyName: opts.familyName ?? name,
    styleName: opts.styleName ?? 'Regular',
    ascent,
    descent,
    lineHeight: height,
    glyphs,
    meta: {
      sourceFormat: 'fontx2',
      drawProfile: 'gfx',
      fallback: { advance: width, width, xOffset: 0 },
      issues,
      format: { fontx2: { name, width, height, codeType } },
    },
  });
}

/**
 * Repositions a glyph into a fixed cell, returning null when ink lies outside.
 * @param {Glyph} g
 * @param {number} cellW
 * @param {number} cellH
 * @param {number} ascent
 * @returns {Uint8Array | null} cell row data (stride * cellH)
 */
function rasterizeCell(g, cellW, cellH, ascent) {
  const stride = (cellW + 7) >> 3;
  const cell = createBitmap(cellW, cellH, 1);
  const left = g.xOffset;
  const top = ascent + g.yOffset;
  for (let y = 0; y < g.bitmap.height; y++) {
    for (let x = 0; x < g.bitmap.width; x++) {
      if (!getPixel(g.bitmap, x, y)) continue;
      const cx = left + x;
      const cy = top + y;
      if (cx < 0 || cy < 0 || cx >= cellW || cy >= cellH) return null;
      setPixel(cell, cx, cy, 1);
    }
  }
  void stride;
  return cell.data;
}

/**
 * Checks FONTX2 encodability (spec §7.1).
 * @param {Font} font
 * @param {{type?: 'ank' | 'kanji'}} [opts]
 * @returns {{ok: boolean, issues: import('./registry.js').EncodeIssue[], type: 'ank' | 'kanji'}}
 */
export function canEncodeFontx2(font, opts = {}) {
  /** @type {import('./registry.js').EncodeIssue[]} */
  const issues = [];
  const cellW = Math.max(1, ...[...font.glyphs.values()].map((g) => g.xAdvance));
  const cellH = font.ascent + font.descent;

  let allAnk = true;
  for (const g of font.glyphs.values()) {
    /** @param {string} code @param {object} params */
    const err = (code, params) => issues.push({ level: 'error', code, codepoint: g.codepoint, params });
    if (g.bitmap.bpp !== 1) err('BPP_UNSUPPORTED', { bpp: g.bitmap.bpp });
    const sjis = g.codepoint < 0x20 ? g.codepoint : unicodeToSjis(g.codepoint);
    if (sjis === null) {
      err('CODEPOINT_UNMAPPABLE', { value: g.codepoint });
      continue;
    }
    if (sjis > 0xff) allAnk = false;
    if (g.xAdvance !== cellW) {
      // FONTX2 is fixed-pitch only.
      err('NOT_FIXED_PITCH', { advance: g.xAdvance, cell: cellW });
    } else if (rasterizeCell(g, cellW, cellH, font.ascent) === null) {
      err('GLYPH_OUT_OF_CELL', { cellW, cellH });
    }
  }
  if (font.glyphs.size === 0) issues.push({ level: 'error', code: 'EMPTY_FONT' });
  if (cellW > 255 || cellH > 255) {
    issues.push({ level: 'error', code: 'GLYPH_TOO_LARGE', params: { width: cellW, height: cellH, max: 255 } });
  }
  const type = opts.type ?? (allAnk ? 'ank' : 'kanji');
  return { ok: !issues.some((i) => i.level === 'error'), issues, type };
}

/**
 * Encodes the neutral model as FONTX2. Chooses ANK (single-byte) or kanji
 * (two-byte Shift-JIS) from repertoire unless opts.type forces it. If a kanji
 * file exceeds 255 blocks, the smallest gaps are filled with empty glyphs to merge them.
 * @param {Font} font
 * @param {{dropInvalid?: boolean, type?: 'ank' | 'kanji', name?: string}} [opts]
 * @returns {Uint8Array}
 */
export function encodeFontx2(font, opts = {}) {
  const check = canEncodeFontx2(font, opts);
  const badCps = new Set(
    check.issues.filter((i) => i.level === 'error' && i.codepoint !== undefined).map((i) => i.codepoint),
  );
  if (!check.ok) {
    const fontLevel = check.issues.some((i) => i.level === 'error' && i.codepoint === undefined);
    if (!opts.dropInvalid || fontLevel) {
      throw new EncodeConstraintError('font does not fit the FONTX2 format', check.issues);
    }
  }
  const type = opts.type ?? check.type;
  const cellW = Math.max(1, ...[...font.glyphs.values()].map((g) => g.xAdvance));
  const cellH = font.ascent + font.descent;
  const stride = (cellW + 7) >> 3;
  const glyphSize = stride * cellH;

  /** @type {Map<number, Glyph>} SJIS code to glyph */
  const byCode = new Map();
  for (const g of font.glyphs.values()) {
    if (badCps.has(g.codepoint)) continue;
    const sjis = g.codepoint < 0x20 ? g.codepoint : unicodeToSjis(g.codepoint);
    if (sjis === null) continue;
    if (type === 'ank' && sjis > 0xff) continue;
    if (type === 'kanji' && sjis <= 0xff) continue; // Single-byte codes belong in the ANK file.
    byCode.set(sjis, g);
  }

  /** @type {number[]} */
  const out = [];
  for (const ch of SIGNATURE) out.push(ch.charCodeAt(0));
  const name = (opts.name ?? font.familyName ?? '').slice(0, 8).padEnd(8, ' ');
  for (const ch of name) out.push(ch.charCodeAt(0) & 0x7f);
  out.push(cellW, cellH, type === 'ank' ? 0 : 1);

  /** @param {Glyph | undefined} g */
  const pushGlyph = (g) => {
    const cell = g ? rasterizeCell(g, cellW, cellH, font.ascent) : null;
    if (cell) for (const b of cell) out.push(b);
    else for (let i = 0; i < glyphSize; i++) out.push(0);
  };

  if (type === 'ank') {
    for (let code = 0; code < 256; code++) pushGlyph(byCode.get(code));
    return Uint8Array.from(out);
  }

  // Kanji: form code-order blocks; above 255, merge across the smallest gaps first.
  const codes = [...byCode.keys()].sort((a, b) => a - b);
  if (codes.length === 0) {
    throw new EncodeConstraintError('no double-byte glyphs to encode', [
      { level: 'error', code: 'EMPTY_FONT' },
    ]);
  }
  /** @type {{start: number, end: number}[]} */
  let blocks = [];
  for (const code of codes) {
    const last = blocks[blocks.length - 1];
    if (last && code === last.end + 1) last.end = code;
    else blocks.push({ start: code, end: code });
  }
  while (blocks.length > 255) {
    let bestIdx = 0;
    let bestGap = Infinity;
    for (let i = 0; i + 1 < blocks.length; i++) {
      const gap = blocks[i + 1].start - blocks[i].end - 1;
      if (gap < bestGap) {
        bestGap = gap;
        bestIdx = i;
      }
    }
    blocks[bestIdx].end = blocks[bestIdx + 1].end;
    blocks.splice(bestIdx + 1, 1);
  }

  out.push(blocks.length);
  for (const b of blocks) {
    out.push(b.start & 0xff, (b.start >> 8) & 0xff, b.end & 0xff, (b.end >> 8) & 0xff);
  }
  for (const b of blocks) {
    for (let code = b.start; code <= b.end; code++) pushGlyph(byCode.get(code));
  }
  return Uint8Array.from(out);
}

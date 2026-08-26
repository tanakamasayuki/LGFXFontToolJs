// @ts-check
/**
 * Format registry, decode entry point, and format detection (spec §6.1).
 */
import { decodeU8g2, readU8g2Header, encodeU8g2, canEncodeU8g2 } from './u8g2.js';
import { decodeGfx, encodeGfx, canEncodeGfx } from './gfxfont.js';
import { decodeBdf, encodeBdf, canEncodeBdf } from './bdf.js';
import { decodeVlw, encodeVlw, canEncodeVlw } from './vlw.js';
import { decodeBff, encodeBff, canEncodeBff } from './bff.js';
import { decodeFontx2, encodeFontx2, canEncodeFontx2 } from './fontx2.js';
import { decodeCSource } from './csource.js';
import { decodeGlcd } from './glcd.js';
import { decodeFixedBmp } from './fixedbmp.js';
import { decodeBmpFont } from './bmpfont.js';
import { decodeRleFont } from './rlefont.js';
import { DetectFailedError, FormatError } from '../util/errors.js';

/** @typedef {import('../model/font.js').Font} Font */

/**
 * Encoding-constraint report (spec §7.1).
 * @typedef {object} EncodeIssue
 * @property {'error'|'warning'} level
 * @property {string} code
 * @property {number} [codepoint]
 * @property {object} [params]
 */

/**
 * @typedef {object} FormatInfo
 * @property {string} id
 * @property {string} name
 * @property {boolean} decode
 * @property {boolean} encode
 * @property {string} [note]
 */

/** @type {FormatInfo[]} */
const FORMATS = [
  { id: 'u8g2', name: 'u8g2', decode: true, encode: true },
  { id: 'gfx', name: 'GFXfont (GFX1 container)', decode: true, encode: true },
  { id: 'bdf', name: 'BDF 2.1 (text)', decode: true, encode: true },
  { id: 'vlw', name: 'VLW (Processing / TFT_eSPI Smooth Font)', decode: true, encode: true },
  { id: 'bff', name: 'BFF (LovyanGFX / LVGL lv_font_conv)', decode: true, encode: true },
  { id: 'fontx2', name: 'FONTX2', decode: true, encode: true },
  { id: 'csource', name: 'C/C++ source', decode: true, encode: true, note: 'decodeCSource / encodeCSource' },
  { id: 'glcd', name: 'GLCDfont (raw + params)', decode: true, encode: false },
  { id: 'fixedbmp', name: 'FixedBMPfont (raw + params)', decode: true, encode: false },
  { id: 'bmp', name: 'BMPfont (LBMP container)', decode: true, encode: false },
  { id: 'rle', name: 'RLEfont (LRLE container)', decode: true, encode: false },
];

/** @returns {FormatInfo[]} */
export function listFormats() {
  return FORMATS.map((f) => ({ ...f }));
}

/** @param {Uint8Array} data @param {string} magic */
function hasMagic(data, magic) {
  if (data.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (data[i] !== magic.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Detects formats. Containers with magic are high confidence; u8g2 is inferred
 * from structural validity. Headerless raw GLCD / FixedBMP data cannot be detected.
 * @param {Uint8Array | string} input
 * @returns {{format: string, confidence: number}[]} descending confidence
 */
export function detect(input) {
  /** @type {{format: string, confidence: number}[]} */
  const results = [];
  if (typeof input === 'string') {
    if (/^\s*STARTFONT\b/.test(input)) results.push({ format: 'bdf', confidence: 1.0 });
    else if (/\bGFXfont\b|\b(?:uint8_t|unsigned\s+char)\s+\w+\s*\[/.test(input)) {
      results.push({ format: 'csource', confidence: 0.8 });
    }
    return results;
  }
  if (hasMagic(input, 'GFX1')) results.push({ format: 'gfx', confidence: 1.0 });
  if (hasMagic(input, 'FONTX2')) results.push({ format: 'fontx2', confidence: 1.0 });
  if (input.length >= 8) {
    const tag = String.fromCharCode(input[4], input[5], input[6], input[7]);
    if (tag === 'head') results.push({ format: 'bff', confidence: 0.9 });
  }
  if (hasMagic(input, 'LBMP')) results.push({ format: 'bmp', confidence: 1.0 });
  if (hasMagic(input, 'LRLE')) results.push({ format: 'rle', confidence: 1.0 });
  if (input.length >= 23) {
    try {
      const h = readU8g2Header(input);
      const bitsSane = [
        h.bitsPerCharWidth,
        h.bitsPerCharHeight,
        h.bitsPerCharX,
        h.bitsPerCharY,
        h.bitsPerDeltaX,
      ].every((b) => b >= 1 && b <= 8);
      const rleSane = h.bitsPer0 >= 1 && h.bitsPer0 <= 8 && h.bitsPer1 >= 1 && h.bitsPer1 <= 8;
      if (bitsSane && rleSane && h.maxCharHeight > 0 && h.glyphCnt > 0) {
        results.push({ format: 'u8g2', confidence: 0.5 });
      }
    } catch {
      // A failed probe simply does not become a candidate.
    }
  }
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

/**
 * @typedef {object} DecodeOptions
 * @property {string} [format] - defaults to detect() top result; ambiguous input fails
 * @property {string} [familyName]
 * @property {string} [styleName]
 * @property {import('./glcd.js').GlcdParams} [glcd]
 * @property {import('./fixedbmp.js').FixedBmpParams} [fixedbmp]
 */

/**
 * Decodes bytes or text into the neutral model.
 * @param {Uint8Array | string} input
 * @param {DecodeOptions} [opts]
 * @returns {Font}
 */
export function decode(input, opts = {}) {
  let format = opts.format;
  if (!format) {
    const candidates = detect(input);
    if (candidates.length === 0 || candidates[0].confidence < 0.5) {
      throw new DetectFailedError('cannot detect font format; pass { format }', {
        candidates,
      });
    }
    format = candidates[0].format;
  }
  if (typeof input === 'string') {
    switch (format) {
      case 'bdf':
        return decodeBdf(input, opts);
      case 'csource': {
        const fonts = decodeCSource(input);
        if (fonts.length === 0) {
          throw new FormatError('NO_FONTS_FOUND', 'no fonts found in C source');
        }
        if (fonts.length > 1) {
          throw new FormatError(
            'MULTIPLE_FONTS',
            `C source contains ${fonts.length} fonts; use decodeCSource()`,
            { names: fonts.map((f) => f.name) },
          );
        }
        return fonts[0].font;
      }
      default:
        throw new FormatError('UNKNOWN_FORMAT', `text input needs format 'bdf' or 'csource'`, {
          format,
        });
    }
  }
  switch (format) {
    case 'u8g2':
      return decodeU8g2(input, opts);
    case 'gfx':
      return decodeGfx(input, opts);
    case 'vlw':
      return decodeVlw(input, opts);
    case 'bff':
      return decodeBff(input, opts);
    case 'fontx2':
      return decodeFontx2(input, opts);
    case 'glcd': {
      if (!opts.glcd) throw new FormatError('MISSING_PARAMS', 'glcd format needs opts.glcd params');
      return decodeGlcd(input, opts.glcd, opts);
    }
    case 'fixedbmp': {
      if (!opts.fixedbmp) {
        throw new FormatError('MISSING_PARAMS', 'fixedbmp format needs opts.fixedbmp params');
      }
      return decodeFixedBmp(input, opts.fixedbmp, opts);
    }
    case 'bmp':
      return decodeBmpFont(input, opts);
    case 'rle':
      return decodeRleFont(input, opts);
    default:
      throw new FormatError('UNKNOWN_FORMAT', `unknown format id: ${format}`, { format });
  }
}

/**
 * Checks whether the neutral model can be encoded in a format (spec §7.1).
 * @param {Font} font
 * @param {string} format
 * @returns {{ok: boolean, issues: EncodeIssue[]}}
 */
export function canEncode(font, format) {
  switch (format) {
    case 'u8g2':
      return canEncodeU8g2(font);
    case 'gfx':
      return canEncodeGfx(font);
    case 'bdf':
      return canEncodeBdf(font);
    case 'vlw':
      return canEncodeVlw(font);
    case 'bff':
      return canEncodeBff(font);
    case 'fontx2': {
      const r = canEncodeFontx2(font);
      return { ok: r.ok, issues: r.issues };
    }
    default: {
      const info = FORMATS.find((f) => f.id === format);
      if (!info) throw new FormatError('UNKNOWN_FORMAT', `unknown format id: ${format}`, { format });
      return {
        ok: false,
        issues: [{ level: 'error', code: 'ENCODER_NOT_IMPLEMENTED', params: { format } }],
      };
    }
  }
}

/**
 * Encodes the neutral model as format bytes (spec §7.2). Constraint violations
 * throw EncodeConstraintError; values are never truncated.
 * @param {Font} font
 * @param {{format: string, dropInvalid?: boolean, bpp?: 1|2|4}} opts
 * @returns {Uint8Array}
 */
export function encode(font, opts) {
  switch (opts.format) {
    case 'u8g2':
      return encodeU8g2(font, opts);
    case 'gfx':
      return encodeGfx(font, opts);
    case 'bdf':
      // BDF is text; return UTF-8 bytes for uniform file handling.
      // Call encodeBdf() directly when a string is desired.
      return new TextEncoder().encode(encodeBdf(font, opts));
    case 'vlw':
      return encodeVlw(font, opts);
    case 'bff':
      return encodeBff(font, opts);
    case 'fontx2':
      return encodeFontx2(font, opts);
    default: {
      const info = FORMATS.find((f) => f.id === opts.format);
      if (!info) {
        throw new FormatError('UNKNOWN_FORMAT', `unknown format id: ${opts.format}`, {
          format: opts.format,
        });
      }
      throw new FormatError('ENCODER_NOT_IMPLEMENTED', `no encoder for ${opts.format}`, {
        format: opts.format,
      });
    }
  }
}

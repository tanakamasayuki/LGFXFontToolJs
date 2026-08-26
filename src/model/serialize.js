// @ts-check
/**
 * JSON serialization for the neutral model (spec §5.3).
 * Intended for test fixtures, debugging, and tool interchange rather than efficiency.
 */
import { createFont } from './font.js';
import { FormatError } from '../util/errors.js';

/** @typedef {import('./font.js').Font} Font */

const FORMAT_ID = 'lgfx-font-tool/font';
const VERSION = 1;

/** @param {Uint8Array} bytes */
function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** @param {string} b64 */
function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * @param {Font} font
 * @returns {object} JSON.stringify-compatible object
 */
export function serializeFont(font) {
  return {
    format: FORMAT_ID,
    version: VERSION,
    familyName: font.familyName,
    styleName: font.styleName,
    ascent: font.ascent,
    descent: font.descent,
    lineHeight: font.lineHeight,
    defaultCodepoint: font.defaultCodepoint,
    kerning: font.kerning,
    meta: font.meta,
    glyphs: [...font.glyphs.values()].map((g) => ({
      cp: g.codepoint,
      xOffset: g.xOffset,
      yOffset: g.yOffset,
      xAdvance: g.xAdvance,
      width: g.bitmap.width,
      height: g.bitmap.height,
      bpp: g.bitmap.bpp,
      data: toBase64(g.bitmap.data),
    })),
  };
}

/**
 * @param {any} obj - output from serializeFont, possibly after JSON.parse
 * @returns {Font}
 */
export function deserializeFont(obj) {
  if (!obj || obj.format !== FORMAT_ID) {
    throw new FormatError('DETECT_FAILED', `not a ${FORMAT_ID} object`);
  }
  if (obj.version !== VERSION) {
    throw new FormatError('UNSUPPORTED_FEATURE', `unsupported version ${obj.version}`, {
      version: obj.version,
    });
  }
  const glyphs = new Map();
  for (const g of obj.glyphs) {
    const stride = g.bpp === 1 ? (g.width + 7) >> 3 : g.width;
    glyphs.set(g.cp, {
      codepoint: g.cp,
      xOffset: g.xOffset,
      yOffset: g.yOffset,
      xAdvance: g.xAdvance,
      bitmap: {
        width: g.width,
        height: g.height,
        bpp: g.bpp,
        stride,
        data: fromBase64(g.data),
      },
    });
  }
  return createFont({
    familyName: obj.familyName,
    styleName: obj.styleName,
    ascent: obj.ascent,
    descent: obj.descent,
    lineHeight: obj.lineHeight,
    glyphs,
    defaultCodepoint: obj.defaultCodepoint ?? undefined,
    kerning: obj.kerning ?? undefined,
    meta: obj.meta ?? { issues: [] },
  });
}

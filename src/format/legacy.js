// @ts-check
/**
 * Shared support for LovyanGFX internal GLCD / FixedBMP / BMP / RLE formats.
 *
 * - cp437 remapping: when cp437 style is disabled (the LovyanGFX default),
 *   GLCDfont / FixedBMPfont drawChar maps code points >= 176 to the next glyph,
 *   the classic Adafruit GFX behavior. Decoding bakes this into codepoint-to-index mapping.
 * - Legacy variable-width BMP / RLE data is distributed as per-glyph pointer
 *   tables without a file format, so this module defines a storage container:
 *
 *   magic   "LBMP" or "LRLE"
 *   u8      height
 *   u8      baseline
 *   u8      glyphCount           (starting at 0x20; 96 for Font2/4/6/7/8)
 *   u8  × glyphCount   widths
 *   u32le × glyphCount  offsets  (relative to the start of blob)
 *   u32le   blobLength
 *   bytes   blob
 */
import { ByteReader, ByteWriter } from '../util/bytes.js';
import { FormatError } from '../util/errors.js';

/**
 * Returns the glyph index when cp437 is disabled, equivalent to
 * LGFX `if (!style->cp437 && (c >= 176)) c++;`.
 * @param {number} codepoint
 * @param {number} start
 * @param {boolean} cp437
 * @returns {number} glyph index
 */
export function legacyGlyphIndex(codepoint, start, cp437) {
  let c = codepoint;
  if (!cp437 && c >= 176) c++;
  return c - start;
}

/**
 * @typedef {object} LegacyVarData
 * @property {number} height
 * @property {number} baseline
 * @property {number[]} widths
 * @property {Uint8Array[]} glyphData - bytes for each glyph
 */

/**
 * @param {'LBMP'|'LRLE'} magic
 * @param {LegacyVarData} data
 * @returns {Uint8Array}
 */
export function packLegacyContainer(magic, data) {
  const w = new ByteWriter();
  for (const ch of magic) w.u8(ch.charCodeAt(0));
  w.u8(data.height).u8(data.baseline).u8(data.widths.length);
  for (const width of data.widths) w.u8(width);
  let offset = 0;
  for (const g of data.glyphData) {
    w.u32le(offset);
    offset += g.length;
  }
  w.u32le(offset);
  for (const g of data.glyphData) w.bytes(g);
  return w.toUint8Array();
}

/**
 * @param {'LBMP'|'LRLE'} magic
 * @param {Uint8Array} bytes
 * @returns {LegacyVarData}
 */
export function unpackLegacyContainer(magic, bytes) {
  const r = new ByteReader(bytes);
  for (const ch of magic) {
    if (r.u8() !== ch.charCodeAt(0)) {
      throw new FormatError('DETECT_FAILED', `not a ${magic} container`);
    }
  }
  const height = r.u8();
  const baseline = r.u8();
  const count = r.u8();
  const widths = [];
  for (let i = 0; i < count; i++) widths.push(r.u8());
  const offsets = [];
  for (let i = 0; i < count; i++) offsets.push(r.u32le());
  const blobLength = r.u32le();
  const blob = r.bytes(blobLength);
  /** @type {Uint8Array[]} */
  const glyphData = [];
  for (let i = 0; i < count; i++) {
    const end = i + 1 < count ? offsets[i + 1] : blobLength;
    glyphData.push(new Uint8Array(blob.subarray(offsets[i], end)));
  }
  return { height, baseline, widths, glyphData };
}

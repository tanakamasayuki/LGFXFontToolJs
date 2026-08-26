// @ts-check
/**
 * Per-format size calculation (spec §11). Returns exact encoded byte counts,
 * not estimates, reproducing the FONT_FORMATS.ja.md comparison for any font (UC2).
 */
import { canEncode, encode, listFormats } from '../format/registry.js';
import { EncodeConstraintError, FormatError } from '../util/errors.js';

/** @typedef {import('../model/font.js').Font} Font */

/**
 * @param {Font} font
 * @param {string} format
 * @returns {{bytes: number | null, issues: import('../format/registry.js').EncodeIssue[]}}
 *   bytes: exact encoded size, or null when font-level constraints fail.
 *   For glyph-level violations, returns the size after dropping invalid glyphs;
 *   issues contains the details.
 */
export function estimateSize(font, format) {
  const check = canEncode(font, format);
  try {
    const bytes = encode(font, { format, dropInvalid: true });
    return { bytes: bytes.length, issues: check.issues };
  } catch (e) {
    if (e instanceof EncodeConstraintError || e instanceof FormatError) {
      return { bytes: null, issues: check.issues };
    }
    throw e;
  }
}

/**
 * Compares sizes across all formats that have encoders.
 * @param {Font} font
 * @returns {Record<string, {bytes: number | null, issues: import('../format/registry.js').EncodeIssue[]}>}
 */
export function estimateSizes(font) {
  /** @type {Record<string, {bytes: number | null, issues: import('../format/registry.js').EncodeIssue[]}>} */
  const out = {};
  for (const f of listFormats()) {
    if (!f.encode) continue;
    out[f.id] = estimateSize(font, f.id);
  }
  return out;
}

// @ts-check
/**
 * Text measurement faithful to LovyanGFX v1.2.26 LGFXBase::text_width / fontHeight,
 * including the original 16.16 fixed-point rounding expressions.
 */

/** @typedef {import('../model/font.js').Font} Font */

/**
 * @typedef {object} TextStyle
 * @property {number} [sizeX]  - horizontal text scale, default 1
 * @property {number} [sizeY]  - vertical text scale, default 1
 * @property {string | number} [datum] - drawing datum, default 'top-left'
 */

/** Matches C++ `int32_t s = 65536 * size;`, truncating float to int.
 * @param {number} size */
export function toFixed16(size) {
  return Math.trunc(65536 * size);
}

/**
 * Converts text to code points using LovyanGFX rules, skipping controls
 * U+0000..U+001F and variation selectors U+FE00..U+FE0F.
 * @param {string} text
 * @returns {number[]}
 */
export function codepointsOf(text) {
  const out = [];
  for (const ch of text) {
    const cp = /** @type {number} */ (ch.codePointAt(0));
    if (cp < 0x20) continue;
    if (cp >= 0xfe00 && cp < 0xfe10) continue;
    out.push(cp);
  }
  return out;
}

/**
 * Returns metrics for one character, equivalent to LGFX updateFontMetric.
 * Missing characters resolve through glyph 0, then metadata fallback.
 * @param {Font} font
 * @param {number} cp
 * @returns {{width: number, advance: number, xOffset: number}}
 */
export function metricFor(font, cp) {
  const g = font.glyphs.get(cp) ?? font.glyphs.get(0);
  if (g) return { width: g.bitmap.width, advance: g.xAdvance, xOffset: g.xOffset };
  const fb = font.meta.fallback;
  if (fb) return { width: fb.width, advance: fb.advance, xOffset: fb.xOffset };
  return { width: 0, advance: 0, xOffset: 0 };
}

/**
 * Returns line-box height, equivalent to LGFX fontHeight().
 * @param {Font} font
 * @param {TextStyle} [style]
 * @returns {number}
 */
export function fontHeight(font, style = {}) {
  const sy = toFixed16(style.sizeY ?? 1);
  return ((font.ascent + font.descent) * sy) >> 16;
}

/**
 * Returns rendered text width, equivalent to LGFX textWidth().
 * @param {Font} font
 * @param {string} text
 * @param {TextStyle} [style]
 * @returns {number}
 */
export function textWidth(font, text, style = {}) {
  const cps = codepointsOf(text);
  if (cps.length === 0) return 0;
  const sx = toFixed16(style.sizeX ?? 1);
  let left = 0;
  let right = 0;
  for (const cp of cps) {
    const m = metricFor(font, cp);
    const sxoffset = (m.xOffset * sx) >> 16;
    if (left === 0 && right === 0 && m.xOffset < 0) left = right = -sxoffset;
    const sxadvance = (m.advance * sx) >> 16;
    right = left + Math.max(sxadvance, ((m.width * sx) >> 16) + sxoffset);
    left += sxadvance;
  }
  return right;
}

/**
 * Returns width, height, ascent, and descent together.
 * @param {Font} font
 * @param {string} text
 * @param {TextStyle} [style]
 */
export function measureText(font, text, style = {}) {
  const sy = toFixed16(style.sizeY ?? 1);
  return {
    width: textWidth(font, text, style),
    height: fontHeight(font, style),
    ascent: (font.ascent * sy) >> 16,
    descent: (font.descent * sy) >> 16,
    lineHeight: (font.lineHeight * sy) >> 16,
  };
}

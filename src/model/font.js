// @ts-check
/**
 * Neutral Font / Glyph model (spec §5.1).
 *
 * Coordinate convention:
 * - Positive Y points downward.
 * - A glyph originates at the pen position on the baseline. xOffset / yOffset
 *   are signed offsets to the bitmap's top-left; upward glyphs have negative yOffset.
 * - After drawing, the pen advances right by xAdvance.
 */

/** @typedef {import('./bitmap.js').Bitmap} Bitmap */

/**
 * @typedef {object} Glyph
 * @property {number} codepoint  - 0 〜 0x10FFFF
 * @property {number} xOffset    - pen to bitmap left edge (int16)
 * @property {number} yOffset    - baseline to bitmap top edge; upward is negative (int16)
 * @property {number} xAdvance   - horizontal advance (int16)
 * @property {Bitmap} bitmap
 */

/**
 * @typedef {object} KerningPair
 * @property {number} left   - left glyph code point
 * @property {number} right  - right glyph code point
 * @property {number} dx     - advance adjustment
 */

/**
 * @typedef {object} FontIssue
 * @property {'error'|'warning'} level
 * @property {string} code
 * @property {number} [codepoint]
 * @property {object} [params]
 */

/**
 * LovyanGFX-compatible fallback data for missing characters. Decoders derive
 * it from source-format rules (spec §9.2 and LGFX updateFontMetric failure behavior).
 * @typedef {object} FallbackMetric
 * @property {number} advance - advance used by textWidth
 * @property {number} width   - width used by textWidth
 * @property {number} xOffset
 * @property {number} [drawAdvance] - drawing advance; defaults to advance (0 for GFX without space)
 * @property {boolean} [drawBox]    - whether to draw the fallback box (default true)
 *
 * @typedef {object} FontMeta
 * @property {string} [sourceFormat]  - 'u8g2' | 'gfx' | 'glcd' | 'fixedbmp' | 'bmp' | 'rle' | ...
 * @property {string} [drawProfile]   - drawing profile (spec §9.3 scaling quantization rules)
 * @property {FallbackMetric} [fallback]
 * @property {FontIssue[]} issues
 * @property {object} [format]        - source-format parameters retained for re-encoding
 * @property {string} [license]
 * @property {string} [copyright]
 */

/**
 * @typedef {object} Font
 * @property {string} familyName
 * @property {string} styleName
 * @property {number} ascent      - baseline to line-box top, positive (int16)
 * @property {number} descent     - baseline to line-box bottom, positive (int16)
 * @property {number} lineHeight  - line advance (int16)
 * @property {Map<number, Glyph>} glyphs
 * @property {number} [defaultCodepoint]
 * @property {KerningPair[]} [kerning]
 * @property {FontMeta} meta
 */

/**
 * @param {object} props
 * @param {string} [props.familyName]
 * @param {string} [props.styleName]
 * @param {number} props.ascent
 * @param {number} props.descent
 * @param {number} props.lineHeight
 * @param {Map<number, Glyph>} [props.glyphs]
 * @param {number} [props.defaultCodepoint]
 * @param {KerningPair[]} [props.kerning]
 * @param {Partial<FontMeta>} [props.meta]
 * @returns {Font}
 */
export function createFont(props) {
  return {
    familyName: props.familyName ?? '',
    styleName: props.styleName ?? 'Regular',
    ascent: props.ascent,
    descent: props.descent,
    lineHeight: props.lineHeight,
    glyphs: props.glyphs ?? new Map(),
    defaultCodepoint: props.defaultCodepoint,
    kerning: props.kerning,
    meta: { issues: [], ...(props.meta ?? {}) },
  };
}

/**
 * @param {Font} font
 * @param {number} codepoint
 * @returns {Glyph | undefined}
 */
export function getGlyph(font, codepoint) {
  return font.glyphs.get(codepoint);
}

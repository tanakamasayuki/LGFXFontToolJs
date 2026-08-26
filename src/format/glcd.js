// @ts-check
/**
 * GLCDfont decoder for Font0 / Font8x8C64.
 *
 * Data is a raw column-major bitmap table with datawidth bytes per glyph.
 * Each byte is one column with bit 0 at the top; the final
 * (width - datawidth) columns of the drawing cell are blank.
 */
import { createBitmap, setPixel } from '../model/bitmap.js';
import { createFont } from '../model/font.js';
import { legacyGlyphIndex } from './legacy.js';

/** @typedef {import('../model/font.js').Font} Font */

/**
 * @typedef {object} GlcdParams
 * @property {number} width      - advance / drawing-cell width
 * @property {number} height
 * @property {number} baseline
 * @property {number} start      - first code point
 * @property {number} end        - last code point
 * @property {number} datawidth  - stored column count
 * @property {boolean} [cp437]   - default false, matching LovyanGFX
 */

/**
 * @param {Uint8Array} data - raw glyph-table bytes
 * @param {GlcdParams} params
 * @param {{familyName?: string, styleName?: string}} [opts]
 * @returns {Font}
 */
export function decodeGlcd(data, params, opts = {}) {
  const { width, height, baseline, start, end, datawidth } = params;
  const cp437 = params.cp437 ?? false;
  const glyphCount = Math.floor(data.length / datawidth);
  /** @type {import('../model/font.js').FontIssue[]} */
  const issues = [];
  const glyphs = new Map();

  for (let cp = start; cp <= end; cp++) {
    const idx = legacyGlyphIndex(cp, start, cp437);
    if (idx < 0 || idx >= glyphCount) {
      issues.push({ level: 'warning', code: 'CP437_REMAP_OUT_OF_TABLE', codepoint: cp });
      continue;
    }
    const bitmap = createBitmap(width, height, 1);
    for (let col = 0; col < datawidth; col++) {
      const byte = data[idx * datawidth + col];
      for (let row = 0; row < height; row++) {
        if ((byte >> row) & 1) setPixel(bitmap, col, row, 1);
      }
    }
    glyphs.set(cp, {
      codepoint: cp,
      xOffset: 0,
      yOffset: -baseline,
      xAdvance: width,
      bitmap,
    });
  }

  return createFont({
    familyName: opts.familyName ?? '',
    styleName: opts.styleName ?? 'Regular',
    ascent: baseline,
    descent: height - baseline,
    lineHeight: height,
    glyphs,
    meta: {
      sourceFormat: 'glcd',
      drawProfile: 'glcd',
      fallback: { advance: width, width, xOffset: 0 },
      issues,
      format: { glcd: { ...params, cp437 } },
    },
  });
}

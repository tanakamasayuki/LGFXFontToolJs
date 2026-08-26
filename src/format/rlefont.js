// @ts-check
/**
 * RLEfont decoder for Font4 / Font6 / Font7 / Font8 using the 'LRLE' container.
 *
 * Glyph data uses byte runs: bit 7 is color (1 = foreground), and the low
 * 7 bits + 1 are run length. Pixels fill width × height in row-major order.
 */
import { createBitmap, setPixel } from '../model/bitmap.js';
import { createFont } from '../model/font.js';
import { unpackLegacyContainer } from './legacy.js';

/** @typedef {import('../model/font.js').Font} Font */

const FIRST_CODE = 0x20;

/**
 * @param {Uint8Array} data - 'LRLE' container
 * @param {{familyName?: string, styleName?: string}} [opts]
 * @returns {Font}
 */
export function decodeRleFont(data, opts = {}) {
  const { height, baseline, widths, glyphData } = unpackLegacyContainer('LRLE', data);
  /** @type {import('../model/font.js').FontIssue[]} */
  const issues = [];
  const glyphs = new Map();

  for (let i = 0; i < widths.length; i++) {
    const cp = FIRST_CODE + i;
    const width = widths[i];
    const bytes = glyphData[i];
    const bitmap = createBitmap(width, height, 1);
    const total = width * height;
    let p = 0;
    let pos = 0;
    while (p < total && pos < bytes.length) {
      const b = bytes[pos++];
      const fg = (b & 0x80) !== 0;
      let len = (b & 0x7f) + 1;
      if (p + len > total) {
        issues.push({ level: 'warning', code: 'RLE_RUN_OVERFLOW', codepoint: cp });
        len = total - p;
      }
      if (fg) {
        for (let k = 0; k < len; k++) {
          const q = p + k;
          setPixel(bitmap, q % width, (q / width) | 0, 1);
        }
      }
      p += len;
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
      sourceFormat: 'rle',
      drawProfile: 'rle',
      fallback: { advance: widths[0] ?? 0, width: widths[0] ?? 0, xOffset: 0 },
      issues,
      format: { rle: { height, baseline } },
    },
  });
}

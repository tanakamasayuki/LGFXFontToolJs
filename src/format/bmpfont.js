// @ts-check
/**
 * BMPfont (Font2) decoder for the 'LBMP' container defined in legacy.js.
 *
 * Glyph data is row-major and MSB-first. The final column of advance width is
 * an unstored margin (LGFX draw_char_bmp margin=1), with row stride
 * (width + 6) >> 3 bytes. Neutral bitmaps omit that margin and use
 * (width - 1) × height.
 */
import { createBitmap, setPixel } from '../model/bitmap.js';
import { createFont } from '../model/font.js';
import { unpackLegacyContainer } from './legacy.js';

/** @typedef {import('../model/font.js').Font} Font */

const FIRST_CODE = 0x20;

/**
 * @param {Uint8Array} data - 'LBMP' container
 * @param {{familyName?: string, styleName?: string}} [opts]
 * @returns {Font}
 */
export function decodeBmpFont(data, opts = {}) {
  const { height, baseline, widths, glyphData } = unpackLegacyContainer('LBMP', data);
  const glyphs = new Map();

  for (let i = 0; i < widths.length; i++) {
    const cp = FIRST_CODE + i;
    const advance = widths[i];
    const drawnWidth = Math.max(0, advance - 1);
    const stride = (advance + 6) >> 3;
    const bytes = glyphData[i];
    const bitmap = createBitmap(drawnWidth, height, 1);
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < drawnWidth; col++) {
        const byte = bytes[row * stride + (col >> 3)] ?? 0;
        if ((byte >> (7 - (col & 7))) & 1) setPixel(bitmap, col, row, 1);
      }
    }
    glyphs.set(cp, {
      codepoint: cp,
      xOffset: 0,
      yOffset: -baseline,
      xAdvance: advance,
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
      sourceFormat: 'bmp',
      drawProfile: 'bmp',
      fallback: { advance: widths[0] ?? 0, width: widths[0] ?? 0, xOffset: 0 },
      issues: [],
      format: { bmp: { height, baseline } },
    },
  });
}

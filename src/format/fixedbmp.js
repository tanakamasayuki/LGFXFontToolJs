// @ts-check
/**
 * FixedBMPfont（AsciiFont8x16 / AsciiFont24x48）のデコーダ。
 *
 * データは行優先の素のビットマップ表: グリフごとに ((width+7)>>3) * height バイト、
 * 行は MSB first でバイト境界へパディング。
 */
import { createBitmap, setPixel } from '../model/bitmap.js';
import { createFont } from '../model/font.js';
import { legacyGlyphIndex } from './legacy.js';

/** @typedef {import('../model/font.js').Font} Font */

/**
 * @typedef {object} FixedBmpParams
 * @property {number} width
 * @property {number} height
 * @property {number} baseline
 * @property {number} start
 * @property {number} end
 * @property {boolean} [cp437]
 */

/**
 * @param {Uint8Array} data
 * @param {FixedBmpParams} params
 * @param {{familyName?: string, styleName?: string}} [opts]
 * @returns {Font}
 */
export function decodeFixedBmp(data, params, opts = {}) {
  const { width, height, baseline, start, end } = params;
  const cp437 = params.cp437 ?? false;
  const stride = (width + 7) >> 3;
  const glyphSize = stride * height;
  const glyphCount = Math.floor(data.length / glyphSize);
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
    const base = idx * glyphSize;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const byte = data[base + row * stride + (col >> 3)];
        if ((byte >> (7 - (col & 7))) & 1) setPixel(bitmap, col, row, 1);
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
      sourceFormat: 'fixedbmp',
      drawProfile: 'bmp',
      fallback: { advance: width, width, xOffset: 0 },
      issues,
      format: { fixedbmp: { ...params, cp437 } },
    },
  });
}

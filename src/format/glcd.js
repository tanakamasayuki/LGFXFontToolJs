// @ts-check
/**
 * GLCDfont（Font0 / Font8x8C64）のデコーダ。
 *
 * データは列優先の素のビットマップ表: グリフごとに datawidth バイト、
 * 各バイトが 1 列で bit0 が最上段。描画幅 width のうち末尾
 * (width - datawidth) 列は空白。
 */
import { createBitmap, setPixel } from '../model/bitmap.js';
import { createFont } from '../model/font.js';
import { legacyGlyphIndex } from './legacy.js';

/** @typedef {import('../model/font.js').Font} Font */

/**
 * @typedef {object} GlcdParams
 * @property {number} width      - 送り幅（描画セル幅）
 * @property {number} height
 * @property {number} baseline
 * @property {number} start      - 先頭コードポイント
 * @property {number} end        - 末尾コードポイント
 * @property {number} datawidth  - データに存在する列数
 * @property {boolean} [cp437]   - 既定 false（LovyanGFX の既定と同じ）
 */

/**
 * @param {Uint8Array} data - グリフ表の生バイト列
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

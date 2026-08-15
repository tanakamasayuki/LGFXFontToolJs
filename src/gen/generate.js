// @ts-check
/**
 * TTF / OTF / WOFF からの新規フォント生成（仕様 §10、UC1）。
 * ラスタライズ結果を中立モデルへ組み立てる。ブラウザ専用（rasterize.js 参照）。
 */
import { loadTtf, unloadTtf, rasterizeSet } from './rasterize.js';
import { createBitmap, setPixel } from '../model/bitmap.js';
import { createFont } from '../model/font.js';

/** @typedef {import('../model/font.js').Font} Font */
/** @typedef {import('./rasterize.js').RasterGlyph} RasterGlyph */

/**
 * @param {RasterGlyph} g
 * @returns {import('../model/font.js').Glyph}
 */
function toModelGlyph(g) {
  const bitmap = createBitmap(g.w, g.h, 1);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (g.bits[y * g.w + x]) setPixel(bitmap, x, y, 1);
    }
  }
  // g.y は「ベースライン → ビットマップ下端」（上が正）。モデルの yOffset は
  // 「ベースライン → ビットマップ上端」（下向き正の軸、上が負）
  const yOffset = g.y + g.h === 0 ? 0 : -(g.y + g.h);
  return {
    codepoint: g.code,
    xOffset: g.x,
    yOffset,
    xAdvance: g.dx,
    bitmap,
  };
}

/**
 * フォントファイルから新しいビットマップフォントを生成する。
 *
 * @param {object} opts
 * @param {ArrayBuffer | string} opts.source - TTF/OTF/WOFF のバイナリ、または URL
 * @param {number} opts.px - 文字高さ（行ボックスではなく文字インクの高さ）
 * @param {number[] | string} opts.codepoints - 収録する文字（コードポイント列 or 文字列）
 * @param {{weight?: number, italic?: boolean}} [opts.style]
 * @param {number} [opts.threshold] - 1bpp 化の alpha 閾値（1..255。既定 128）
 * @param {string} [opts.familyName]
 * @param {(p: {done: number, total: number}) => void} [opts.onProgress]
 * @returns {Promise<{font: Font, missing: number[]}>}
 *   font: 生成された中立モデル / missing: フォントがグリフを持たなかった文字
 */
export async function generateFont(opts) {
  /** @type {number[]} */
  const codepoints =
    typeof opts.codepoints === 'string'
      ? [...new Set([...opts.codepoints].map((ch) => /** @type {number} */ (ch.codePointAt(0))))].sort(
          (a, b) => a - b,
        )
      : [...new Set(opts.codepoints)].sort((a, b) => a - b);

  const { family, face } = await loadTtf(opts.source);
  try {
    const { glyphs, missing, sizing, box } = await rasterizeSet({
      family,
      size: opts.px,
      codepoints,
      style: opts.style ?? {},
      threshold: opts.threshold ?? 128,
      onProgress: opts.onProgress,
    });

    const map = new Map();
    for (const g of glyphs) {
      map.set(g.code, toModelGlyph(g));
    }
    const space = map.get(0x20);
    const font = createFont({
      familyName: opts.familyName ?? '',
      styleName: opts.style?.italic ? 'Italic' : 'Regular',
      ascent: box.ascent,
      descent: box.descent,
      lineHeight: box.height,
      glyphs: map,
      meta: {
        sourceFormat: 'ttf-raster',
        drawProfile: 'gfx',
        fallback: space
          ? { advance: space.xAdvance, width: space.bitmap.width, xOffset: space.xOffset }
          : { advance: 0, width: 0, xOffset: 0, drawBox: false },
        issues: [],
        format: {
          gen: {
            requestedPx: opts.px,
            cssPx: sizing.cssPx,
            probe: sizing.probe,
            probeHeight: sizing.probeHeight,
            threshold: opts.threshold ?? 128,
            weight: opts.style?.weight ?? 400,
            italic: opts.style?.italic ?? false,
          },
        },
      },
    });
    return { font, missing };
  } finally {
    unloadTtf(face);
  }
}

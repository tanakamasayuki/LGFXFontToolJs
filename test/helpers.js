// @ts-check
/**
 * テスト用の小さなフォントを手組みする部品。
 */
import { createBitmap, setPixel } from '../src/model/bitmap.js';
import { createFont } from '../src/model/font.js';

/**
 * テキストアート（'#' = 1）からビットマップを作る。
 * @param {string[]} rows
 */
export function bitmapFromText(rows) {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const bmp = createBitmap(width, height, 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rows[y][x] === '#') setPixel(bmp, x, y, 1);
    }
  }
  return bmp;
}

/**
 * 1 グリフだけの試験用フォント。
 * @param {object} [over]
 */
export function tinyFont(over = {}) {
  const glyphs = new Map();
  glyphs.set(0x41, {
    codepoint: 0x41,
    xOffset: 0,
    yOffset: -4,
    xAdvance: 5,
    bitmap: bitmapFromText(['.##.', '#..#', '####', '#..#']),
  });
  return createFont({
    familyName: 'Tiny',
    ascent: 4,
    descent: 1,
    lineHeight: 6,
    glyphs,
    meta: { drawProfile: 'gfx', fallback: { advance: 3, width: 3, xOffset: 0 } },
    ...over,
  });
}

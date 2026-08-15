// @ts-check
/**
 * テキスト描画。LovyanGFX v1.2.26 の draw_string / 各フォント drawChar の忠実な移植。
 *
 * 出力は被覆値のみ（前景 = 1）。背景は描かない。これは LovyanGFX で
 * setTextColor(color) を 1 引数で呼んだ透過モード（fore == back）と同じであり、
 * ゼロ初期化した対象への描画結果は fill モードと画素単位で一致する。
 *
 * 倍率適用時のピクセル境界の量子化は元形式ごとに癖が異なるため、
 * font.meta.drawProfile（'gfx' | 'u8g2' | 'rle' | 'bmp' | 'glcd'）で再現する。
 * 整数倍率ではどのプロファイルも同じ結果になる。プロファイル未指定は 'gfx'。
 */
import { fillRect, drawRect, getPixel } from '../model/bitmap.js';
import { resolveDatum } from './datum.js';
import { codepointsOf, metricFor, textWidth, toFixed16 } from './measure.js';

/** @typedef {import('../model/bitmap.js').Bitmap} Bitmap */
/** @typedef {import('../model/font.js').Font} Font */
/** @typedef {import('../model/font.js').Glyph} Glyph */
/** @typedef {import('./measure.js').TextStyle} TextStyle */

/**
 * ビットマップの 1 行から極大ラン（同値の連続区間）を列挙する。
 * @param {Bitmap} bmp
 * @param {number} row
 * @returns {{start: number, end: number, value: number}[]}
 */
function rowRuns(bmp, row) {
  const runs = [];
  const w = bmp.width;
  let start = 0;
  let value = getPixel(bmp, 0, row);
  for (let x = 1; x < w; x++) {
    const v = getPixel(bmp, x, row);
    if (v !== value) {
      runs.push({ start, end: x, value });
      start = x;
      value = v;
    }
  }
  if (w > 0) runs.push({ start, end: w, value });
  return runs;
}

/**
 * 1 列の極大ラン（GLCD 用の縦方向）。
 * @param {Bitmap} bmp
 * @param {number} col
 */
function colRuns(bmp, col) {
  const runs = [];
  const h = bmp.height;
  let start = 0;
  let value = getPixel(bmp, col, 0);
  for (let y = 1; y < h; y++) {
    const v = getPixel(bmp, col, y);
    if (v !== value) {
      runs.push({ start, end: y, value });
      start = y;
      value = v;
    }
  }
  if (h > 0) runs.push({ start, end: h, value });
  return runs;
}

/**
 * GFXfont::drawChar の前景描画部の移植。
 * 行境界は行ボックス格子（boxRow 起点）、列境界はグリフ格子。
 * 潰れたランは端でなければ 1px に持ち上げる。
 * @param {Bitmap} dst
 * @param {Glyph} glyph
 * @param {number} gx - グリフ左端（スケール済み）
 * @param {number} yTop - 行ボックス上端
 * @param {number} boxRow - 行ボックス内でのビットマップ開始行（未スケール）
 * @param {number} sx
 * @param {number} sy
 */
function drawGlyphGfx(dst, glyph, gx, yTop, boxRow, sx, sy) {
  const bmp = glyph.bitmap;
  const w = bmp.width;
  const h = bmp.height;
  if (h === 0) return;
  const limitWidth = (w * sx) >> 16;
  const limitHeight = ((h + boxRow) * sy) >> 16;
  let y1 = (boxRow * sy) >> 16;
  for (let i = 0; i < h; i++) {
    const y0 = y1;
    y1 = ((i + 1 + boxRow) * sy) >> 16;
    const fh = y1 < limitHeight && y1 === y0 ? 1 : y1 - y0;
    for (const run of rowRuns(bmp, i)) {
      if (!run.value) continue;
      const x0 = (run.start * sx) >> 16;
      const x1 = (run.end * sx) >> 16;
      const fw = x1 < limitWidth && x1 === x0 ? 1 : x1 - x0;
      fillRect(dst, gx + x0, yTop + y0, fw, fh, 1);
    }
  }
}

/**
 * U8g2font::drawChar / RLEfont::drawChar の前景描画部の移植。
 * 潰れたラン・行は描かない（1px 持ち上げなし）。
 * @param {Bitmap} dst
 * @param {Glyph} glyph
 * @param {number} gx
 * @param {number} yTop
 * @param {number} boxRow
 * @param {number} sx
 * @param {number} sy
 */
function drawGlyphU8g2(dst, glyph, gx, yTop, boxRow, sx, sy) {
  const bmp = glyph.bitmap;
  const w = bmp.width;
  const h = bmp.height;
  if (w === 0) return;
  let y1 = (boxRow * sy) >> 16;
  for (let ly = 0; ly < h; ly++) {
    const y0 = y1;
    y1 = ((ly + 1 + boxRow) * sy) >> 16;
    for (const run of rowRuns(bmp, ly)) {
      if (!run.value) continue;
      const x0 = (run.start * sx) >> 16;
      const x1 = (run.end * sx) >> 16;
      if (x0 < x1) fillRect(dst, gx + x0, yTop + y0, x1 - x0, y1 - y0, 1);
    }
  }
}

/**
 * draw_char_bmp（BMPfont / FixedBMPfont / BDFfont 共用）の前景描画部の移植。
 * 潰れた前景ランは常に 1px へ持ち上げ、潰れた行は下端以外 1px へ持ち上げる。
 * @param {Bitmap} dst
 * @param {Glyph} glyph
 * @param {number} gx
 * @param {number} yTop
 * @param {number} sx
 * @param {number} sy
 */
function drawGlyphBmp(dst, glyph, gx, yTop, sx, sy) {
  const bmp = glyph.bitmap;
  const w = bmp.width;
  const h = bmp.height;
  const heightScaled = (sy * h) >> 16;
  let y1 = 0;
  for (let i = 0; i < h; i++) {
    const y0 = y1;
    y1 = ((i + 1) * sy) >> 16;
    const fh = y1 < heightScaled && y0 === y1 ? 1 : y1 - y0;
    if (w === 0) continue;
    for (const run of rowRuns(bmp, i)) {
      if (!run.value) continue;
      const x0 = (run.start * sx) >> 16;
      let x1 = (run.end * sx) >> 16;
      if (x1 === x0) x1++;
      fillRect(dst, gx + x0, yTop + y0, x1 - x0, fh, 1);
    }
  }
}

/**
 * GLCDfont::drawChar の前景描画部の移植。列方向に走査する。
 * @param {Bitmap} dst
 * @param {Glyph} glyph
 * @param {number} gx
 * @param {number} yTop
 * @param {number} sx
 * @param {number} sy
 */
function drawGlyphGlcd(dst, glyph, gx, yTop, sx, sy) {
  const bmp = glyph.bitmap;
  const w = bmp.width;
  const h = bmp.height;
  let x1 = 0;
  for (let i = 0; i < w; i++) {
    const x0 = x1;
    x1 = ((i + 1) * sx) >> 16;
    const cw = x1 - x0;
    if (h === 0) continue;
    for (const run of colRuns(bmp, i)) {
      if (!run.value) continue;
      const y0 = (run.start * sy) >> 16;
      const y1v = (run.end * sy) >> 16;
      fillRect(dst, gx + x0, yTop + y0, cw, y1v - y0, 1);
    }
  }
}

/**
 * 収録外文字の代替表示（IFont::drawCharDummy の移植）。
 * @param {Bitmap} dst
 * @param {number} x
 * @param {number} yTop
 * @param {number} w - スケール済み幅
 * @param {number} h - スケール済み高さ
 */
function drawDummy(dst, x, yTop, w, h) {
  if (w > 2 && h > 2) {
    drawRect(dst, x + 1, yTop + 1, w - 2, h - 2, 1);
  }
}

/**
 * グリフ 1 個を行ボックス上端 yTop に描き、スケール済み送り幅を返す。
 * @param {Bitmap} dst
 * @param {Font} font
 * @param {Glyph} glyph
 * @param {number} x - ペン位置（スケール済み）
 * @param {number} yTop - 行ボックス上端
 * @param {number} sx
 * @param {number} sy
 * @returns {number} スケール済み送り幅
 */
function drawGlyphAt(dst, font, glyph, x, yTop, sx, sy) {
  const xoffset = (glyph.xOffset * sx) >> 16;
  const xAdvance = (glyph.xAdvance * sx) >> 16;
  const gx = x + xoffset;
  const boxRow = font.ascent + glyph.yOffset;
  const profile = font.meta.drawProfile ?? 'gfx';
  switch (profile) {
    case 'u8g2':
    case 'rle':
      drawGlyphU8g2(dst, glyph, gx, yTop, boxRow, sx, sy);
      break;
    case 'bmp':
      drawGlyphBmp(dst, glyph, gx, yTop, sx, sy);
      break;
    case 'glcd':
      drawGlyphGlcd(dst, glyph, gx, yTop, sx, sy);
      break;
    case 'gfx':
    default:
      drawGlyphGfx(dst, glyph, gx, yTop, boxRow, sx, sy);
      break;
  }
  return xAdvance;
}

/**
 * 1 行のテキストを描く（LGFXBase::draw_string 相当）。
 * @param {Bitmap} dst
 * @param {Font} font
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {TextStyle} [style]
 * @returns {{advance: number, width: number, height: number}}
 *   advance: 描いた送り幅の合計、width/height: datum 解決に使った文字列の外形
 */
export function drawString(dst, font, text, x, y, style = {}) {
  const sx = toFixed16(style.sizeX ?? 1);
  const sy = toFixed16(style.sizeY ?? 1);
  const datum = resolveDatum(style.datum);

  const cps = codepointsOf(text);
  const cwidth = textWidth(font, text, style);
  const boxH = font.ascent + font.descent;
  const cheight = (boxH * sy) >> 16;

  let sumX = 0;
  if (cps.length > 0) {
    const m = metricFor(font, cps[0]);
    if (m.xOffset < 0) {
      // LGFX 原文: sumX = - (metrics.x_offset * sx) >> 16;（単項マイナスが積に先に掛かる）
      sumX = -(m.xOffset * sx) >> 16;
    }
  }

  if (datum & 4) {
    y -= cheight >> 1;
  } else if (datum & 8) {
    y -= cheight;
  } else if (datum & 16) {
    y -= (font.ascent * sy) >> 16;
  }
  if (datum & 1) {
    x -= cwidth >> 1;
  } else if (datum & 2) {
    x -= cwidth;
  }

  for (const cp of cps) {
    const glyph = font.glyphs.get(cp) ?? font.glyphs.get(0);
    if (glyph) {
      sumX += drawGlyphAt(dst, font, glyph, x + sumX, y, sx, sy);
      continue;
    }
    const fb = font.meta.fallback ?? { advance: 0, width: 0, xOffset: 0 };
    const drawAdvance = /** @type {any} */ (fb).drawAdvance ?? fb.advance;
    const drawBox = /** @type {any} */ (fb).drawBox ?? true;
    const w = (drawAdvance * sx) >> 16;
    if (drawBox) drawDummy(dst, x + sumX, y, w, cheight);
    sumX += w;
  }

  return { advance: sumX, width: cwidth, height: cheight };
}

/**
 * グリフ 1 個を描く。y は行ボックス上端。スケール済み送り幅を返す。
 * @param {Bitmap} dst
 * @param {Font} font
 * @param {number} codepoint
 * @param {number} x
 * @param {number} y
 * @param {TextStyle} [style]
 * @returns {number}
 */
export function drawChar(dst, font, codepoint, x, y, style = {}) {
  const sx = toFixed16(style.sizeX ?? 1);
  const sy = toFixed16(style.sizeY ?? 1);
  const glyph = font.glyphs.get(codepoint) ?? font.glyphs.get(0);
  if (glyph) return drawGlyphAt(dst, font, glyph, x, y, sx, sy);
  const fb = font.meta.fallback ?? { advance: 0, width: 0, xOffset: 0 };
  const drawAdvance = /** @type {any} */ (fb).drawAdvance ?? fb.advance;
  const drawBox = /** @type {any} */ (fb).drawBox ?? true;
  const w = (drawAdvance * sx) >> 16;
  if (drawBox) drawDummy(dst, x, y, w, ((font.ascent + font.descent) * sy) >> 16);
  return w;
}

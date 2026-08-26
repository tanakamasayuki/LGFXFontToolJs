// @ts-check
/**
 * Text rendering faithful to LovyanGFX v1.2.26 draw_string and each font's drawChar.
 *
 * Output contains coverage only (foreground = 1) and does not draw a background.
 * This matches LovyanGFX transparent mode from one-argument setTextColor(color)
 * (fore == back); on a zeroed target it is pixel-identical to fill mode.
 *
 * Pixel-boundary quantization under scaling varies by source format and is
 * reproduced through font.meta.drawProfile ('gfx' | 'u8g2' | 'rle' | 'bmp' |
 * 'glcd' | 'vlw'). All profiles agree at integer scales; the default is 'gfx'.
 * 8bpp targets receive coverage values, with 1bpp foreground expanded to 255.
 */
import { fillRect, drawRect, getPixel } from '../model/bitmap.js';
import { resolveDatum } from './datum.js';
import { codepointsOf, metricFor, textWidth, toFixed16 } from './measure.js';

/** @typedef {import('../model/bitmap.js').Bitmap} Bitmap */
/** @typedef {import('../model/font.js').Font} Font */
/** @typedef {import('../model/font.js').Glyph} Glyph */
/** @typedef {import('./measure.js').TextStyle} TextStyle */

/**
 * Enumerates maximal runs of equal values in one bitmap row.
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
 * Enumerates maximal runs in one column for vertical GLCD traversal.
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
 * Port of the foreground portion of GFXfont::drawChar.
 * Row boundaries use the line-box grid from boxRow; columns use the glyph grid.
 * Collapsed runs are promoted to 1px unless they lie at an edge.
 * @param {Bitmap} dst
 * @param {Glyph} glyph
 * @param {number} gx - scaled glyph left edge
 * @param {number} yTop - line-box top
 * @param {number} boxRow - unscaled bitmap start row within the line box
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
      fillRect(dst, gx + x0, yTop + y0, fw, fh, dst.bpp === 8 ? 255 : 1);
    }
  }
}

/**
 * Port of the foreground portion of U8g2font::drawChar / RLEfont::drawChar.
 * Collapsed runs and rows are omitted rather than promoted to 1px.
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
      if (x0 < x1) fillRect(dst, gx + x0, yTop + y0, x1 - x0, y1 - y0, dst.bpp === 8 ? 255 : 1);
    }
  }
}

/**
 * Port of draw_char_bmp foreground rendering shared by BMPfont, FixedBMPfont,
 * and BDFfont. Collapsed foreground runs are always promoted to 1px; collapsed
 * rows are promoted except at the bottom edge.
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
      fillRect(dst, gx + x0, yTop + y0, x1 - x0, fh, dst.bpp === 8 ? 255 : 1);
    }
  }
}

/**
 * Port of VLWfont::drawChar foreground rendering, placing 8bpp coverage per pixel.
 * A 1bpp target lights any coverage >= 1, matching binarized LGFX white-on-black
 * blending. Collapsed pixels are omitted.
 * @param {Bitmap} dst
 * @param {Glyph} glyph
 * @param {number} gx
 * @param {number} yTop
 * @param {number} boxRow
 * @param {number} sx
 * @param {number} sy
 */
function drawGlyphVlw(dst, glyph, gx, yTop, boxRow, sx, sy) {
  const bmp = glyph.bitmap;
  const w = bmp.width;
  const h = bmp.height;
  for (let i = 0; i < h; i++) {
    const y0 = ((boxRow + i) * sy) >> 16;
    const y1 = ((boxRow + i + 1) * sy) >> 16;
    if (y1 <= y0) continue;
    for (let j = 0; j < w; j++) {
      const a = getPixel(bmp, j, i);
      if (a === 0) continue;
      const x0 = (j * sx) >> 16;
      const x1 = ((j + 1) * sx) >> 16;
      if (x1 <= x0) continue;
      fillRect(dst, gx + x0, yTop + y0, x1 - x0, y1 - y0, dst.bpp === 8 ? a : 1);
    }
  }
}

/**
 * Port of GLCDfont::drawChar foreground rendering, traversing by column.
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
      fillRect(dst, gx + x0, yTop + y0, cw, y1v - y0, dst.bpp === 8 ? 255 : 1);
    }
  }
}

/**
 * Missing-character fallback display, ported from IFont::drawCharDummy.
 * @param {Bitmap} dst
 * @param {number} x
 * @param {number} yTop
 * @param {number} w - scaled width
 * @param {number} h - scaled height
 */
function drawDummy(dst, x, yTop, w, h) {
  if (w > 2 && h > 2) {
    drawRect(dst, x + 1, yTop + 1, w - 2, h - 2, dst.bpp === 8 ? 255 : 1);
  }
}

/**
 * Draws one glyph relative to line-box top yTop and returns its scaled advance.
 * @param {Bitmap} dst
 * @param {Font} font
 * @param {Glyph} glyph
 * @param {number} x - scaled pen position
 * @param {number} yTop - line-box top
 * @param {number} sx
 * @param {number} sy
 * @returns {number} scaled advance
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
    case 'vlw':
      drawGlyphVlw(dst, glyph, gx, yTop, boxRow, sx, sy);
      break;
    case 'gfx':
    default:
      drawGlyphGfx(dst, glyph, gx, yTop, boxRow, sx, sy);
      break;
  }
  return xAdvance;
}

/**
 * Handles the VLW space quirk from LGFX VLWfont::drawChar: U+0020 draws
 * nothing and advances by spaceWidth regardless of glyph presence. Returns the
 * unscaled advance when applicable.
 * @param {Font} font
 * @param {number} cp
 * @returns {number | null}
 */
function vlwSpaceAdvance(font, cp) {
  if (cp !== 0x20 || font.meta.drawProfile !== 'vlw') return null;
  const vlw = /** @type {{vlw?: {spaceWidth: number}}} */ (font.meta.format ?? {}).vlw;
  return vlw ? vlw.spaceWidth : null;
}

/**
 * Draws one line of text, equivalent to LGFXBase::draw_string.
 * @param {Bitmap} dst
 * @param {Font} font
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {TextStyle} [style]
 * @returns {{advance: number, width: number, height: number}}
 *   advance: total drawn advance; width/height: text extent used to resolve datum
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
      // Original LGFX: sumX = - (metrics.x_offset * sx) >> 16;
      // unary minus applies to the product before the shift.
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
    const spaceAdv = vlwSpaceAdvance(font, cp);
    if (spaceAdv !== null) {
      sumX += (spaceAdv * sx) >> 16;
      continue;
    }
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
 * Draws one glyph with y at the line-box top and returns its scaled advance.
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
  const spaceAdv = vlwSpaceAdvance(font, codepoint);
  if (spaceAdv !== null) return (spaceAdv * sx) >> 16;
  const glyph = font.glyphs.get(codepoint) ?? font.glyphs.get(0);
  if (glyph) return drawGlyphAt(dst, font, glyph, x, y, sx, sy);
  const fb = font.meta.fallback ?? { advance: 0, width: 0, xOffset: 0 };
  const drawAdvance = /** @type {any} */ (fb).drawAdvance ?? fb.advance;
  const drawBox = /** @type {any} */ (fb).drawBox ?? true;
  const w = (drawAdvance * sx) >> 16;
  if (drawBox) drawDummy(dst, x, y, w, ((font.ascent + font.descent) * sy) >> 16);
  return w;
}

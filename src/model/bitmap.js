// @ts-check
/**
 * Bitmap — 1bpp / 8bpp coverage bitmap (spec §5.1).
 * 1bpp is MSB-first and each row is padded to a byte boundary.
 */

/**
 * @typedef {object} Bitmap
 * @property {number} width
 * @property {number} height
 * @property {1|8} bpp
 * @property {number} stride  - bytes per row = ceil(width * bpp / 8)
 * @property {Uint8Array} data
 */

/**
 * Creates a zero-initialized bitmap.
 * @param {number} width
 * @param {number} height
 * @param {1|8} [bpp]
 * @returns {Bitmap}
 */
export function createBitmap(width, height, bpp = 1) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
    throw new RangeError(`invalid bitmap size ${width}x${height}`);
  }
  const stride = bpp === 1 ? (width + 7) >> 3 : width;
  return {
    width,
    height,
    bpp,
    stride,
    data: new Uint8Array(stride * height),
  };
}

/**
 * @param {Bitmap} bmp
 * @param {number} x
 * @param {number} y
 * @returns {number} 0/1 for 1bpp, 0..255 for 8bpp, or 0 when out of bounds
 */
export function getPixel(bmp, x, y) {
  if (x < 0 || y < 0 || x >= bmp.width || y >= bmp.height) return 0;
  if (bmp.bpp === 1) {
    return (bmp.data[y * bmp.stride + (x >> 3)] >> (7 - (x & 7))) & 1;
  }
  return bmp.data[y * bmp.stride + x];
}

/**
 * @param {Bitmap} bmp
 * @param {number} x
 * @param {number} y
 * @param {number} v
 */
export function setPixel(bmp, x, y, v) {
  if (x < 0 || y < 0 || x >= bmp.width || y >= bmp.height) return;
  if (bmp.bpp === 1) {
    const idx = y * bmp.stride + (x >> 3);
    const mask = 0x80 >> (x & 7);
    if (v) bmp.data[idx] |= mask;
    else bmp.data[idx] &= ~mask;
    return;
  }
  bmp.data[y * bmp.stride + x] = v & 0xff;
}

/**
 * Fills a rectangle clipped to the bitmap bounds, matching LGFX
 * writeFillRect clipping at panel boundaries.
 * @param {Bitmap} bmp
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} v
 */
export function fillRect(bmp, x, y, w, h, v) {
  let x0 = Math.max(0, x);
  let y0 = Math.max(0, y);
  const x1 = Math.min(bmp.width, x + w);
  const y1 = Math.min(bmp.height, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      setPixel(bmp, xx, yy, v);
    }
  }
}

/**
 * Draws a 1px rectangle outline, equivalent to LGFX drawRect and used for missing glyphs.
 * @param {Bitmap} bmp
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} v
 */
export function drawRect(bmp, x, y, w, h, v) {
  if (w <= 0 || h <= 0) return;
  fillRect(bmp, x, y, w, 1, v);
  fillRect(bmp, x, y + h - 1, w, 1, v);
  fillRect(bmp, x, y + 1, 1, h - 2, v);
  fillRect(bmp, x + w - 1, y + 1, 1, h - 2, v);
}

/**
 * Tests whether two bitmaps have identical contents.
 * @param {Bitmap} a
 * @param {Bitmap} b
 */
export function bitmapEquals(a, b) {
  if (a.width !== b.width || a.height !== b.height || a.bpp !== b.bpp) return false;
  if (a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

/**
 * Converts a bitmap to text art for debugging (1 = '#', 0 = '.').
 * @param {Bitmap} bmp
 * @returns {string}
 */
export function bitmapToText(bmp) {
  const lines = [];
  for (let y = 0; y < bmp.height; y++) {
    let line = '';
    for (let x = 0; x < bmp.width; x++) {
      const v = getPixel(bmp, x, y);
      line += bmp.bpp === 1 ? (v ? '#' : '.') : v.toString(16).padStart(2, '0');
    }
    lines.push(line);
  }
  return lines.join('\n');
}

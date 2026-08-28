// @ts-check
/**
 * Confirmation images for the CLI (docs/cli.ja.md §8).
 *
 * The image is not a deliverable, it is how a person checks the deliverable, so
 * this stays deliberately small: a glyph sheet and a sample string, 8-bit
 * grayscale PNG, no dependency beyond node:zlib.
 */
import { deflateSync } from 'node:zlib';
import { createBitmap, getPixel } from '../src/model/bitmap.js';
import { drawString } from '../src/render/draw.js';
import { measureText, fontHeight } from '../src/render/measure.js';

/** @typedef {import('../src/model/font.js').Font} Font */
/** @typedef {import('../src/model/bitmap.js').Bitmap} Bitmap */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

/** @param {Buffer} bytes */
function crc32(bytes) {
  let c = -1;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * 8-bit grayscale PNG.
 * @param {Uint8Array} gray width*height samples
 * @param {number} width
 * @param {number} height
 */
export function encodePng(gray, width, height) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: none
    Buffer.from(gray.buffer, gray.byteOffset + y * width, width).copy(raw, y * (width + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** @param {Bitmap} bmp @param {number} zoom */
function toGray(bmp, zoom) {
  const W = Math.max(1, bmp.width * zoom);
  const H = Math.max(1, bmp.height * zoom);
  const gray = new Uint8Array(W * H).fill(255);
  for (let y = 0; y < bmp.height; y++) {
    for (let x = 0; x < bmp.width; x++) {
      if (!getPixel(bmp, x, y)) continue;
      for (let dy = 0; dy < zoom; dy++) {
        gray.fill(0, (y * zoom + dy) * W + x * zoom, (y * zoom + dy) * W + x * zoom + zoom);
      }
    }
  }
  return { gray, width: W, height: H };
}

/**
 * Renders one line of text.
 * @param {Font} font
 * @param {string} text
 * @param {{zoom?: number}} [opts]
 */
export function renderText(font, text, opts = {}) {
  const zoom = opts.zoom ?? 4;
  const m = measureText(font, text);
  const bmp = createBitmap(Math.max(1, Math.ceil(m.width) + 2), Math.max(1, fontHeight(font) + 2), 1);
  drawString(bmp, font, text, 1, 1); // the default datum is top-left, not the baseline
  return toGray(bmp, zoom);
}

/**
 * Renders every glyph in a grid, so a person can see at a glance whether the
 * characters they asked for arrived.
 * @param {Font} font
 * @param {{cols?: number, zoom?: number}} [opts]
 */
export function renderSheet(font, opts = {}) {
  const cols = opts.cols ?? 16;
  const zoom = opts.zoom ?? 3;
  const cps = [...font.glyphs.keys()].sort((a, b) => a - b);
  const glyphs = [...font.glyphs.values()];

  // Cell size comes from the actual ink, not the declared metrics: a glyph that
  // exceeds ascent/descent would otherwise bleed into the neighbouring cell.
  const inkTop = Math.min(...glyphs.map((g) => g.yOffset));
  const inkBottom = Math.max(...glyphs.map((g) => g.yOffset + g.bitmap.height));
  const cw = Math.max(...glyphs.map((g) => Math.max(g.xAdvance, g.xOffset + g.bitmap.width))) + 2;
  const ch = inkBottom - inkTop + 2;
  const rows = Math.ceil(cps.length / cols);
  const bmp = createBitmap(cols * cw, rows * ch, 1);
  const shift = -(font.ascent + inkTop);
  cps.forEach((cp, i) => {
    const x = (i % cols) * cw + 1;
    const y = Math.floor(i / cols) * ch + 1;
    drawString(bmp, font, String.fromCodePoint(cp), x, y + shift);
  });

  const out = toGray(bmp, zoom);
  // Cell borders. Without them adjacent glyphs read as one character: a `_` at
  // the bottom of one row sits directly above the next row's glyph.
  for (let r = 0; r <= rows; r++) {
    const y = Math.min(r * ch * zoom, out.height - 1);
    for (let x = 0; x < out.width; x++) {
      const i = y * out.width + x;
      if (out.gray[i] === 255) out.gray[i] = 200;
    }
  }
  for (let c = 0; c <= cols; c++) {
    const x = Math.min(c * cw * zoom, out.width - 1);
    for (let y = 0; y < out.height; y++) {
      const i = y * out.width + x;
      if (out.gray[i] === 255) out.gray[i] = 200;
    }
  }
  return out;
}

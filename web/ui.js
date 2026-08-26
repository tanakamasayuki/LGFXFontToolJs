// @ts-check
/**
 * Small helpers shared by the web apps (DOM helpers, drawing, download, file input).
 * These do not belong in the library itself — I/O and the DOM are the app's
 * responsibility (spec §2.3).
 */
import {
  createBitmap,
  drawString,
  textWidth,
  fontHeight,
  getPixel,
  decode,
  decodeCSource,
  detect,
} from './lgfx-font-tool.js';

/** @typedef {import('../src/model/font.js').Font} Font */

/** @param {string} id */
export function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

/** @param {() => void} fn @param {number} ms */
export function debounce(fn, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

/** @param {BlobPart} content @param {string} name @param {string} type */
export function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Draws onto a canvas with the library's rendering engine (the same rules as
 * the real device).
 * @param {HTMLCanvasElement} canvas
 * @param {Font} font
 * @param {string} text
 * @param {number} zoom
 * @param {1|2|4|8} [coverageBpp] Coverage levels used for display. The BFF preview
 *                                 passes the output bpp.
 */
export function drawFontTo(canvas, font, text, zoom, coverageBpp = 8) {
  const w = Math.max(8, Math.min(4000, textWidth(font, text) + 8));
  const h = Math.max(8, fontHeight(font) + 8);
  const z = Math.max(1, Math.min(zoom, Math.floor(8192 / w) || 1));
  const glyphBpp = font.glyphs.values().next().value?.bitmap.bpp ?? 1;
  const bmp = createBitmap(w, h, glyphBpp === 8 ? 8 : 1);
  drawString(bmp, font, text, 4, 4);
  canvas.width = w * z;
  canvas.height = h * z;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle =
    getComputedStyle(document.documentElement).getPropertyValue('--preview-bg').trim() || '#11191d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e8f0ff';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const value = getPixel(bmp, x, y);
      if (!value) continue;
      ctx.globalAlpha = bmp.bpp === 8 ? quantizeCoverage(value, coverageBpp) / 255 : 1;
      ctx.fillRect(x * z, y * z, z, z);
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Encodes an 8bpp coverage value at the given bpp once, then expands it back to
 * 0..255 with the same rule the BFF decoder uses.
 * @param {number} value
 * @param {1|2|4|8} bpp
 */
export function quantizeCoverage(value, bpp) {
  const a8 = Math.min(255, Math.max(0, Math.round(value)));
  if (bpp === 8) return a8;
  const maxAlpha = (1 << bpp) - 1;
  const quantized = Math.round((a8 * maxAlpha) / 255);
  return quantized >= maxAlpha
    ? 255
    : Math.floor((255 * quantized + (maxAlpha >> 1)) / maxAlpha);
}

/** Format hints from the file extension. Required because VLW has no magic and
 *  cannot be detected. */
const EXT_HINTS = /** @type {Record<string, string>} */ ({
  vlw: 'vlw',
  u8g2: 'u8g2',
  gfx1: 'gfx',
  bff: 'bff',
  fnt: 'fontx2',
  ftx: 'fontx2',
  bdf: 'bdf',
});

/**
 * Detects and decodes a file's bytes. Binary magic is checked first; text formats
 * (BDF / C source) are re-read as UTF-8 and detected from that. Formats without a
 * magic (VLW and the like) are covered by the extension hint.
 * A C source may hold several fonts, so the result is always an array.
 * @param {Uint8Array} bytes
 * @param {string} fileName
 * @param {string} [format] - Auto-detected when omitted (throws if undetectable)
 * @returns {{detected: {format: string, confidence: number}[],
 *            format: string, fonts: {label: string, font: Font}[]}}
 */
export function decodeInput(bytes, fileName, format) {
  let detected = detect(bytes);
  /** @type {string | null} */
  let text = null;
  const textExt = /\.(h|c|cc|cpp|hpp|inc|txt|bdf)$/i.test(fileName);
  if (textExt || detected.length === 0) {
    try {
      const s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const dText = detect(s);
      if (dText.length > 0) {
        text = s;
        detected = dText;
      }
    } catch {
      // Not readable as UTF-8 = binary. Use the detect(bytes) result
    }
  }
  const extHint = EXT_HINTS[(fileName.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase()];
  // A magic match (high confidence) is trusted over the extension; with only a
  // low-confidence guess, the extension wins
  const guessed =
    detected[0] && detected[0].confidence >= 0.9 ? detected[0].format : (extHint ?? detected[0]?.format);
  const fmt = format || guessed;
  if (!fmt) throw new Error('cannot detect format');

  if (fmt === 'csource') {
    const src = text ?? new TextDecoder().decode(bytes);
    const fonts = decodeCSource(src);
    if (fonts.length === 0) throw new Error('no fonts found in C source');
    return { detected, format: fmt, fonts: fonts.map((f) => ({ label: f.name, font: f.font })) };
  }
  if (fmt === 'bdf') {
    const src = text ?? new TextDecoder().decode(bytes);
    const font = decode(src, { format: 'bdf', familyName: fileName.replace(/\.[^.]+$/, '') });
    return { detected, format: fmt, fonts: [{ label: font.familyName, font }] };
  }
  const font = decode(bytes, { format: fmt, familyName: fileName.replace(/\.[^.]+$/, '') });
  return { detected, format: fmt, fonts: [{ label: font.familyName, font }] };
}

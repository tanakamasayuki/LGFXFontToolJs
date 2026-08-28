// @ts-check
/**
 * New font generation from TTF / OTF / WOFF (spec §10, UC1).
 * Assembles rasterized output into the neutral model; browser-only (see rasterize.js).
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
export function toModelGlyph(g) {
  const bitmap = createBitmap(g.w, g.h, g.bpp);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const value = g.bits[y * g.w + x];
      if (value) setPixel(bitmap, x, y, value);
    }
  }
  // g.y is baseline to bitmap bottom with positive upward. Model yOffset is
  // baseline to bitmap top on a downward-positive axis, so upward is negative.
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
 * One rasterization pass for a source or family over a character set.
 * @param {{source?: ArrayBuffer | string, family?: string}} src
 * @param {number[]} codepoints
 * @param {{em: number, style?: {weight?: number, italic?: boolean}, bpp?: 1|8, threshold?: number,
 *          familyName?: string, onProgress?: (p: {done: number, total: number}) => void}} opts
 *   - generateFont opts, sharing em / style / threshold / familyName / onProgress
 * @returns {Promise<{font: Font, missing: number[]}>}
 */
async function generateOne(src, codepoints, opts) {
  if (src.source === undefined && !src.family) {
    throw new TypeError('generateFont: pass either source or family');
  }
  const own = src.source !== undefined ? await loadTtf(src.source) : null;
  const family = own ? own.family : /** @type {string} */ (src.family);
  try {
    const { glyphs, missing, box } = await rasterizeSet({
      family,
      em: opts.em,
      codepoints,
      style: opts.style ?? {},
      bpp: opts.bpp ?? 1,
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
        drawProfile: (opts.bpp ?? 1) === 8 ? 'vlw' : 'gfx',
        fallback: space
          ? { advance: space.xAdvance, width: space.bitmap.width, xOffset: space.xOffset }
          : { advance: 0, width: 0, xOffset: 0, drawBox: false },
        issues: [],
        format: {
          gen: {
            em: opts.em,
            threshold: opts.threshold ?? 128,
            bpp: opts.bpp ?? 1,
            weight: opts.style?.weight ?? 400,
            italic: opts.style?.italic ?? false,
          },
        },
      },
    });
    return { font, missing };
  } finally {
    if (own) unloadTtf(own.face);
  }
}

/**
 * Derives the line box from actual ink across all model glyphs.
 * @param {Map<number, import('../model/font.js').Glyph>} glyphs
 * @returns {{ascent: number, descent: number, height: number}}
 */
export function lineBoxOfModelGlyphs(glyphs) {
  let ascent = 0;
  let descent = 0;
  for (const g of glyphs.values()) {
    if (!g.bitmap.height) continue;
    ascent = Math.max(ascent, -g.yOffset);
    descent = Math.max(descent, g.yOffset + g.bitmap.height);
  }
  ascent = Math.max(1, Math.ceil(ascent));
  descent = Math.max(0, Math.ceil(descent));
  return { ascent, descent, height: ascent + descent };
}

/** @param {Font} base @param {Font} overlay */
function mergeGenerated(base, overlay) {
  const glyphs = new Map(base.glyphs);
  for (const [cp, glyph] of overlay.glyphs) glyphs.set(cp, glyph);
  const box = lineBoxOfModelGlyphs(glyphs);
  return createFont({
    familyName: base.familyName,
    styleName: base.styleName,
    ascent: box.ascent,
    descent: box.descent,
    lineHeight: box.height,
    glyphs,
    defaultCodepoint: base.defaultCodepoint,
    kerning: base.kerning,
    meta: { ...base.meta, issues: [...base.meta.issues] },
  });
}

/**
 * Generates a bitmap font from a font file or a loaded CSS family.
 *
 * The application owns font acquisition and registration (spec §2.3). For
 * services such as Google Fonts, register a FontFace and pass `family`.
 * When `source` is supplied, this function performs loading.
 *
 * Fallbacks rasterize missing characters from additional sources using the
 * primary font's cssPx and the same style / threshold. After baseline-aligned
 * merging, the line box is recomputed from all actual ink. The application
 * chooses and obtains fallback sources; this function tries them in order.
 *
 * @param {object} opts
 * @param {ArrayBuffer | string} [opts.source] - TTF/OTF/WOFF bytes or URL
 * @param {string} [opts.family] - registered CSS family name, instead of source
 * @param {number} opts.em - em size in pixels: a full-width character advances exactly this
 *   much. The line box is normally larger; read it from the returned font
 * @param {number[] | string} opts.codepoints - code points or text to include
 * @param {{weight?: number, italic?: boolean}} [opts.style]
 * @param {1|8} [opts.bpp] - glyph coverage depth, default 1
 * @param {number} [opts.threshold] - alpha threshold for 1bpp, 1..255, default 128
 * @param {string} [opts.familyName]
 * @param {Array<{source?: ArrayBuffer | string, family?: string}>} [opts.fallbacks]
 *   - sources tried in order for characters missing from the primary source
 * @param {(p: {done: number, total: number}) => void} [opts.onProgress]
 * @returns {Promise<{font: Font, missing: number[], filled: {index: number, codepoints: number[]}[]}>}
 *   font: generated neutral model / missing: absent from every source /
 *   filled: count filled by each fallback index
 */
export async function generateFont(opts) {
  /** @type {number[]} */
  const codepoints =
    typeof opts.codepoints === 'string'
      ? [...new Set([...opts.codepoints].map((ch) => /** @type {number} */ (ch.codePointAt(0))))].sort(
          (a, b) => a - b,
        )
      : [...new Set(opts.codepoints)].sort((a, b) => a - b);

  const primary = await generateOne(opts, codepoints, opts);
  let { font, missing } = primary;

  /** @type {{index: number, codepoints: number[]}[]} */
  const filled = [];
  const fallbacks = opts.fallbacks ?? [];
  for (let i = 0; i < fallbacks.length && missing.length > 0; i++) {
    // Every typeface is drawn at the same em, so fill-in glyphs match by construction.
    const r = await generateOne(fallbacks[i], missing, opts);
    if (r.font.glyphs.size > 0) {
      font = mergeGenerated(font, r.font);
      filled.push({ index: i, codepoints: [...r.font.glyphs.keys()].sort((a, b) => a - b) });
    }
    missing = r.missing;
  }
  return { font, missing, filled };
}

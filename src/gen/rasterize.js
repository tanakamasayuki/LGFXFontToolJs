// @ts-check
/**
 * TTF / OTF / WOFF glyph rasterizer (spec §10).
 *
 * Port of the proven LGFXScreenBuilder fontgen rasterize.js. Instead of bundling
 * a TTF parser, it rasterizes with the browser text engine (FontFace + 2D canvas).
 * It accepts everything the browser accepts—TTF, OTF, WOFF, WOFF2, and variable
 * fonts—and uses the same rasterizer for live preview and generated glyphs.
 * Browser-only: this file and fonts/loader.js are the only src/ modules allowed
 * to touch the DOM (spec §4.1).
 *
 * Size is given as `em` (the typeface design size in pixels). See rasterizeSet.
 *
 * Per-glyph output is { code, w, h, x, y, dx, bits }: bits is row-major coverage,
 * x is left bearing, y is signed baseline-to-bitmap-bottom distance with positive
 * upward (BDF-style), and dx is advance.
 *
 * Glyph presence is detected by comparing rendering with the target family over
 * a generic fallback against rendering with that fallback alone. Identical output
 * means the fallback drew it and the target lacks the glyph. Both serif and
 * monospace fallbacks are tested; either difference proves presence. Apparent
 * misses are retried once at another size because accidental pixel identity is
 * size-dependent rather than a typeface property.
 */
import { CapabilityError } from '../util/errors.js';

const FALLBACKS = ['serif', 'monospace'];

// Unicode spaces draw no shape, so only advance can distinguish them.
const SPACES = new Set([
  0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008,
  0x2009, 0x200a, 0x202f, 0x205f, 0x3000,
]);
void SPACES; // Presence currently relies on rasterizeOne ink comparison; keep this list as reference.

/** Throws CapabilityError outside a browser environment. */
export function ensureRasterizer() {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') {
    throw new CapabilityError(
      'RASTERIZER_UNAVAILABLE',
      'TTF rasterization needs a browser (FontFace + canvas). See spec §10.',
    );
  }
}

let loadCount = 0;

/**
 * Loads a font into document for canvas use. Each load receives a unique family
 * name so a later load cannot silently reuse earlier glyphs resolved by name.
 * @param {ArrayBuffer | string} src - font bytes or source URL
 * @param {string} [familyHint]
 * @returns {Promise<{family: string, face: FontFace}>}
 */
export async function loadTtf(src, familyHint = 'LgfxFontTool') {
  ensureRasterizer();
  const family = `${familyHint}_${++loadCount}`;
  const face = new FontFace(family, typeof src === 'string' ? `url(${JSON.stringify(src)})` : src);
  await face.load();
  document.fonts.add(face);
  return { family, face };
}

/** @param {FontFace} face */
export function unloadTtf(face) {
  try {
    document.fonts.delete(face);
  } catch {
    // Already absent is fine.
  }
}

/**
 * Creates a surface large enough for any glyph at `size`, with the pen inset
 * sufficiently to capture negative bearings and overhangs.
 * @param {number} size
 */
function makeSurface(size) {
  const pad = Math.ceil(size * 1.5) + 8;
  const w = Math.ceil(size * 4) + pad * 2;
  const h = Math.ceil(size * 4) + pad * 2;
  const cv =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = /** @type {CanvasRenderingContext2D} */ (
    /** @type {any} */ (cv).getContext('2d', { willReadFrequently: true })
  );
  return { cv, ctx, w, h, originX: pad, originY: Math.ceil(size * 2) + pad };
}

/** @typedef {ReturnType<typeof makeSurface>} Surface */
/** @typedef {{weight?: number, italic?: boolean}} TtfStyle */

// Quote family names, but never generic fallbacks: quoting turns them into
// nonexistent named families and destroys the comparison baseline.
/** @param {number} size @param {string} family @param {TtfStyle} [style] @param {string | null} [fallback] */
const cssFont = (size, family, { weight = 400, italic = false } = {}, fallback = null) =>
  `${italic ? 'italic ' : ''}${weight} ${size}px "${family}"${fallback ? `, ${fallback}` : ''}`;

/** @param {number} size @param {string} generic @param {TtfStyle} [style] */
const cssGeneric = (size, generic, { weight = 400, italic = false } = {}) =>
  `${italic ? 'italic ' : ''}${weight} ${size}px ${generic}`;

/** @typedef {{px: Uint8ClampedArray, adv: number}} Rendered */

/** Tests thresholded shape and advance equality. @param {Rendered} a @param {Rendered} b @param {number} threshold */
function sameInk(a, b, threshold) {
  if (Math.round(a.adv) !== Math.round(b.adv)) return false;
  for (let i = 3; i < a.px.length; i += 4) {
    if (a.px[i] >= threshold !== b.px[i] >= threshold) return false;
  }
  return true;
}

/** @param {Rendered} r @param {number} threshold */
const hasInk = (r, threshold) => {
  for (let i = 3; i < r.px.length; i += 4) if (r.px[i] >= threshold) return true;
  return false;
};

// --- Second opinion -----------------------------------------------------------
// Fallback comparison fails on accidental pixel identity. Because that is a
// size property, retry apparent misses at another size. True misses match the
// fallback at every size; accidents do not repeat.

const SECOND_OPINION = 1.37;

// A font cannot draw code points outside its declared unicode-range. The range
// may overdeclare, so it cannot prove presence, but it accurately proves absence
// and makes retries cheap.
let declaredCache = { at: -1, byFamily: new Map() };

/** @param {string} family @param {number} code */
function declares(family, code) {
  if (typeof document === 'undefined') return true;
  if (declaredCache.at !== document.fonts.size) {
    declaredCache = { at: document.fonts.size, byFamily: new Map() };
  }
  let ranges = declaredCache.byFamily.get(family);
  if (!ranges) {
    ranges = [];
    for (const face of document.fonts) {
      if (face.family !== family) continue;
      for (const part of String(face.unicodeRange || 'U+0-10FFFF').split(',')) {
        const m = /^\s*U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?\s*$/.exec(part);
        if (m) ranges.push([parseInt(m[1], 16), m[2] ? parseInt(m[2], 16) : parseInt(m[1], 16)]);
      }
    }
    declaredCache.byFamily.set(family, ranges);
  }
  return ranges.some((/** @type {[number, number]} */ [lo, hi]) => code >= lo && code <= hi);
}

/** @type {{of: number, surf: Surface | null}} */
let altSurf = { of: -1, surf: null };

/** @param {number} code @param {number} size @param {string} family @param {TtfStyle} style @param {number} threshold */
function drawsItselfElsewhere(code, size, family, style, threshold) {
  if (!declares(family, code)) return false;
  const at = size * SECOND_OPINION;
  if (altSurf.of !== at) altSurf = { of: at, surf: makeSurface(at) };
  const { ctx, w, h, originX, originY } = /** @type {Surface} */ (altSurf.surf);
  const ch = String.fromCodePoint(code);
  /** @param {string} fallback @param {boolean} withFont @returns {Rendered} */
  const draw = (fallback, withFont) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = withFont ? cssFont(at, family, style, fallback) : cssGeneric(at, fallback, style);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    ctx.fillText(ch, originX, originY);
    return { px: ctx.getImageData(0, 0, w, h).data, adv: ctx.measureText(ch).width };
  };
  for (const fb of FALLBACKS) {
    if (!sameInk(draw(fb, true), draw(fb, false), threshold)) return true;
  }
  return false;
}

/**
 * @typedef {object} RasterGlyph
 * @property {number} code
 * @property {number} w
 * @property {number} h
 * @property {number} x   - left bearing
 * @property {number} y   - baseline to bitmap bottom, positive upward
 * @property {number} dx  - advance
 * @property {1|8} bpp
 * @property {Uint8Array} bits - row-major; 0/1 for 1bpp, alpha 0..255 for 8bpp
 */

/**
 * Rasterizes one code point, returning null when the font lacks the glyph.
 * @param {Surface} surf
 * @param {number} code
 * @param {number} size
 * @param {string} family
 * @param {TtfStyle} style
 * @param {number} threshold
 * @param {1|8} [bpp]
 * @returns {RasterGlyph | null}
 */
function rasterizeOne(surf, code, size, family, style, threshold, bpp = 1) {
  const ch = String.fromCodePoint(code);
  const { ctx, w, h, originX, originY } = surf;

  /** @param {string} fallback @param {boolean} withFont @returns {Rendered} */
  const draw = (fallback, withFont) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = withFont ? cssFont(size, family, style, fallback) : cssGeneric(size, fallback, style);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    ctx.fillText(ch, originX, originY);
    return { px: ctx.getImageData(0, 0, w, h).data, adv: ctx.measureText(ch).width };
  };

  const a = draw(FALLBACKS[0], true);

  // A difference in either fallback pair proves presence. Spaces draw nothing,
  // so accept them here and normalize advance later in rasterizeSet.
  if (hasInk(a, threshold)) {
    /** @param {string} fallback */
    const differs = (fallback) => {
      const mine = fallback === FALLBACKS[0] ? a : draw(fallback, true);
      const theirs = draw(fallback, false);
      return !sameInk(mine, theirs, threshold);
    };
    if (
      !differs(FALLBACKS[0]) &&
      !differs(FALLBACKS[1]) &&
      !drawsItselfElsewhere(code, size, family, style, threshold)
    ) {
      return null;
    }
  }

  // AA output preserves all nonzero Canvas coverage. For 1bpp, continue deriving
  // bounds from thresholded ink so existing output metrics remain unchanged.
  const trimThreshold = bpp === 8 ? 1 : threshold;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      if (a.px[(py * w + px) * 4 + 3] < trimThreshold) continue;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  if (maxX < 0) {
    return { code, w: 0, h: 0, x: 0, y: 0, dx: Math.round(a.adv), bpp, bits: new Uint8Array(0) };
  }

  const gw = maxX - minX + 1;
  const gh = maxY - minY + 1;
  const bits = new Uint8Array(gw * gh);
  for (let py = 0; py < gh; py++) {
    for (let px = 0; px < gw; px++) {
      const alpha = a.px[((minY + py) * w + (minX + px)) * 4 + 3];
      bits[py * gw + px] = bpp === 8 ? alpha : alpha >= threshold ? 1 : 0;
    }
  }

  return {
    code,
    w: gw,
    h: gh,
    x: minX - originX, // Left bearing from the pen.
    y: originY - (maxY + 1), // Baseline to bitmap bottom, positive upward.
    dx: Math.round(a.adv),
    bpp,
    bits,
  };
}

/**
 * Rasterizes a complete character set.
 *
 * `em` is the design size: the typeface's em square in pixels, drawn as a CSS
 * font-size. A full-width character advances exactly one em, so `em` fixes the
 * horizontal scale exactly. Vertical extent follows from the typeface, so the
 * line box (see lineBoxOf) is normally larger than `em`.
 *
 * Nothing here is measured from the requested repertoire, so adding or removing
 * characters never rescales the glyphs already generated.
 *
 * @param {object} opts
 * @param {string} opts.family - CSS family returned by loadTtf()
 * @param {number} opts.em - em size in pixels
 * @param {number[]} opts.codepoints - ascending code points
 * @param {TtfStyle} [opts.style]
 * @param {1|8} [opts.bpp] - output coverage depth, default 1
 * @param {number} [opts.threshold] - 1bpp alpha threshold, 1..255, default 128
 * @param {(p: {done: number, total: number}) => void} [opts.onProgress]
 * @returns {Promise<{glyphs: RasterGlyph[], missing: number[],
 *   box: {ascent: number, descent: number, height: number}}>}
 */
export async function rasterizeSet({
  family,
  em,
  codepoints,
  style = {},
  bpp = 1,
  threshold = 128,
  onProgress,
}) {
  ensureRasterizer();
  if (bpp !== 1 && bpp !== 8) throw new RangeError(`rasterizeSet: bpp must be 1 or 8 (got ${bpp})`);
  if (!Number.isFinite(em) || em <= 0) {
    throw new RangeError(`rasterizeSet: em must be a positive finite number (got ${em})`);
  }
  const surf = makeSurface(em);
  /** @type {RasterGlyph[]} */
  const glyphs = [];
  /** @type {number[]} */
  const missing = [];

  // Yield between chunks so 10,000 CJK glyphs do not freeze the tab.
  const CHUNK = 200;
  for (let i = 0; i < codepoints.length; i++) {
    const g = rasterizeOne(surf, codepoints[i], em, family, style, threshold, bpp);
    if (g) glyphs.push(g);
    else missing.push(codepoints[i]);
    if ((i + 1) % CHUNK === 0 || i === codepoints.length - 1) {
      onProgress?.({ done: i + 1, total: codepoints.length });
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // Clamp spaces to the widest character because presence cannot be detected
  // and an extreme fallback advance may otherwise leak through.
  const widest = glyphs.reduce((a, g) => (g.h && g.dx > a ? g.dx : a), 0);
  if (widest) {
    for (const g of glyphs) {
      if (!g.h && g.dx > widest) g.dx = widest;
    }
  }

  return { glyphs, missing, box: lineBoxOf(glyphs) };
}

/**
 * Computes the glyph-set line box from furthest ink above and below the baseline.
 * It derives from generated glyphs rather than declared typeface metrics, fitting
 * the actual repertoire exactly.
 * @param {RasterGlyph[]} glyphs
 */
export function lineBoxOf(glyphs) {
  let ascent = 0;
  let descent = 0;
  for (const g of glyphs) {
    if (!g.h) continue;
    ascent = Math.max(ascent, g.y + g.h);
    descent = Math.max(descent, -g.y);
  }
  ascent = Math.max(1, Math.ceil(ascent));
  descent = Math.max(0, Math.ceil(descent));
  return { ascent, descent, height: ascent + descent };
}

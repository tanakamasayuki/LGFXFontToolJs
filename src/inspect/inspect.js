// @ts-check
/**
 * フォントの検査（仕様 §11、UC2 / UC6）。
 */
import { codepointsOfSet, ALL_SET_IDS } from '../charsets/charsets.js';

/** @typedef {import('../model/font.js').Font} Font */

/**
 * chars をコードポイント列にする（文字列 / コードポイント列 / 名前付き集合名）。
 * @param {Iterable<number> | string} chars
 * @returns {number[]}
 */
function toCodepoints(chars) {
  if (typeof chars === 'string') {
    const named = ALL_SET_IDS.includes(chars) ? codepointsOfSet(chars) : null;
    if (named) return named;
    return [...chars].map((ch) => /** @type {number} */ (ch.codePointAt(0)));
  }
  return [...chars];
}

/**
 * 文言カバレッジの検査（UC6）。CI に組み込んで tofu を出荷前に検出する用途。
 * @param {Font} font
 * @param {Iterable<number> | string} chars - 文字列・コードポイント列・名前付き集合名
 * @returns {{total: number, present: number, missing: number[]}}
 */
export function coverage(font, chars) {
  const cps = [...new Set(toCodepoints(chars))];
  const missing = cps.filter((cp) => !font.glyphs.has(cp));
  return { total: cps.length, present: cps.length - missing.length, missing };
}

/**
 * 収録コードポイントを連続区間へ要約する。
 * @param {Font} font
 * @returns {{start: number, end: number}[]}
 */
export function codepointRanges(font) {
  const cps = [...font.glyphs.keys()].sort((a, b) => a - b);
  /** @type {{start: number, end: number}[]} */
  const ranges = [];
  for (const cp of cps) {
    const last = ranges[ranges.length - 1];
    if (last && cp === last.end + 1) last.end = cp;
    else ranges.push({ start: cp, end: cp });
  }
  return ranges;
}

/**
 * フォントの棚卸し（UC2）。収録・メトリクス・極値・名前付き集合ごとの被覆率。
 * @param {Font} font
 * @returns {{
 *   glyphCount: number,
 *   ranges: {start: number, end: number}[],
 *   metrics: {ascent: number, descent: number, lineHeight: number},
 *   extremes: {maxWidth: number, maxHeight: number, maxAdvance: number,
 *              minXOffset: number, maxXOffset: number, minYOffset: number},
 *   bpp: 1 | 8,
 *   coverage: Record<string, number>,
 * }}
 */
export function inspect(font) {
  let maxWidth = 0;
  let maxHeight = 0;
  let maxAdvance = 0;
  let minXOffset = 0;
  let maxXOffset = 0;
  let minYOffset = 0;
  /** @type {1 | 8} */
  let bpp = 1;
  for (const g of font.glyphs.values()) {
    if (g.bitmap.width > maxWidth) maxWidth = g.bitmap.width;
    if (g.bitmap.height > maxHeight) maxHeight = g.bitmap.height;
    if (g.xAdvance > maxAdvance) maxAdvance = g.xAdvance;
    if (g.xOffset < minXOffset) minXOffset = g.xOffset;
    if (g.xOffset > maxXOffset) maxXOffset = g.xOffset;
    if (g.yOffset < minYOffset) minYOffset = g.yOffset;
    if (g.bitmap.bpp === 8) bpp = 8;
  }

  /** @type {Record<string, number>} */
  const cov = {};
  for (const id of ALL_SET_IDS) {
    const cps = codepointsOfSet(id);
    let present = 0;
    for (const cp of cps) if (font.glyphs.has(cp)) present++;
    cov[id] = cps.length ? present / cps.length : 0;
  }

  return {
    glyphCount: font.glyphs.size,
    ranges: codepointRanges(font),
    metrics: { ascent: font.ascent, descent: font.descent, lineHeight: font.lineHeight },
    extremes: { maxWidth, maxHeight, maxAdvance, minXOffset, maxXOffset, minYOffset },
    bpp,
    coverage: cov,
  };
}

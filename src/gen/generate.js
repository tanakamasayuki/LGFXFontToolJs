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
/** @typedef {import('./rasterize.js').FontSizing} FontSizing */
/** @typedef {import('./rasterize.js').FontSizingInput} FontSizingInput */

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
 * ソース 1 つ（source または family）を指定文字集合でラスタライズする 1 パス。
 * @param {{source?: ArrayBuffer | string, family?: string}} src
 * @param {number[]} codepoints
 * @param {{px: number, style?: {weight?: number, italic?: boolean}, bpp?: 1|8, threshold?: number, sizing?: FontSizingInput,
 *          familyName?: string, onProgress?: (p: {done: number, total: number}) => void}} opts
 *   - generateFont の opts（px / style / threshold / familyName / onProgress を共有）
 * @returns {Promise<{font: Font, missing: number[], sizing: FontSizing}>}
 */
async function generateOne(src, codepoints, opts) {
  if (src.source === undefined && !src.family) {
    throw new TypeError('generateFont: pass either source or family');
  }
  const own = src.source !== undefined ? await loadTtf(src.source) : null;
  const family = own ? own.family : /** @type {string} */ (src.family);
  try {
    const { glyphs, missing, sizing, box } = await rasterizeSet({
      family,
      size: opts.px,
      codepoints,
      style: opts.style ?? {},
      bpp: opts.bpp ?? 1,
      threshold: opts.threshold ?? 128,
      sizing: opts.sizing,
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
            requestedPx: opts.px,
            cssPx: sizing.cssPx,
            probe: sizing.probe,
            probeHeight: sizing.probeHeight,
            threshold: opts.threshold ?? 128,
            bpp: opts.bpp ?? 1,
            weight: opts.style?.weight ?? 400,
            italic: opts.style?.italic ?? false,
          },
        },
      },
    });
    return { font, missing, sizing };
  } finally {
    if (own) unloadTtf(own.face);
  }
}

/**
 * モデルグリフ全体の実インクから行ボックスを求める。
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
 * フォントファイル（または読み込み済みの CSS ファミリ）から新しい
 * ビットマップフォントを生成する。
 *
 * フォントの入手・読み込みはアプリの責務（仕様 §2.3。Google Fonts 等は
 * アプリ側で FontFace としてページに登録し、`family` で渡す）。
 * `source` を渡した場合の読み込みはこの関数が面倒を見る。
 *
 * 補完（fallbacks）: 主ソースに無かった文字を、指定した別ソースで主フォントの
 * cssPx と同じ CSS em スケール、同じ style / threshold でラスタライズする。
 * ベースライン整列で重ねた後、全グリフの実インクから行ボックスを再計算する。
 * どのソースを補完に使うかの選定・入手はアプリの責務で、ここは渡されたものを
 * 順に試すだけ。
 *
 * @param {object} opts
 * @param {ArrayBuffer | string} [opts.source] - TTF/OTF/WOFF のバイナリ、または URL
 * @param {string} [opts.family] - ページに登録済みの CSS ファミリ名（source の代わり）
 * @param {number} opts.px - 文字高さ（行ボックスではなく文字インクの高さ）
 * @param {number[] | string} opts.codepoints - 収録する文字（コードポイント列 or 文字列）
 * @param {{weight?: number, italic?: boolean}} [opts.style]
 * @param {1|8} [opts.bpp] - グリフの被覆値深度。既定 1
 * @param {number} [opts.threshold] - 1bpp 化の alpha 閾値（1..255。既定 128）
 * @param {FontSizingInput} [opts.sizing] - cssPx を固定するサイジング（別呼び出しでの補完用）
 * @param {string} [opts.familyName]
 * @param {Array<{source?: ArrayBuffer | string, family?: string}>} [opts.fallbacks]
 *   - 主ソースに無かった文字をこの順で補完するソース列
 * @param {(p: {done: number, total: number}) => void} [opts.onProgress]
 * @returns {Promise<{font: Font, missing: number[], filled: {index: number, codepoints: number[]}[], sizing: FontSizing}>}
 *   font: 生成された中立モデル / missing: どのソースにも無かった文字 /
 *   filled: fallbacks の何番目が何文字を埋めたか
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
  const sizing = primary.sizing;

  /** @type {{index: number, codepoints: number[]}[]} */
  const filled = [];
  const fallbacks = opts.fallbacks ?? [];
  for (let i = 0; i < fallbacks.length && missing.length > 0; i++) {
    // fallback は主フォントと同じ CSS em スケールで描く。書体ごとの再計測はしない。
    const r = await generateOne(fallbacks[i], missing, { ...opts, sizing });
    if (r.font.glyphs.size > 0) {
      font = mergeGenerated(font, r.font);
      filled.push({ index: i, codepoints: [...r.font.glyphs.keys()].sort((a, b) => a - b) });
    }
    missing = r.missing;
  }
  return { font, missing, filled, sizing };
}

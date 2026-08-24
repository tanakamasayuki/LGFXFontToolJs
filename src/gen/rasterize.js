// @ts-check
/**
 * TTF / OTF / WOFF のグリフラスタライザ（仕様 §10）。
 *
 * LGFXScreenBuilder fontgen の rasterize.js（実績実装）の移植。
 * TTF パーサを同梱せず、ブラウザ自身のテキストエンジン（FontFace + 2D canvas）で
 * ラスタライズする。ブラウザが受け付けるものすべて（TTF / OTF / WOFF / WOFF2 /
 * バリアブルフォント）が入力になり、画面プレビューと生成グリフが同一の
 * ラスタライザから出る。**ブラウザ専用**（src/ 内で DOM に触れてよいのは
 * このファイルと fonts/loader.js だけ。仕様 §4.1）。
 *
 * 出力はグリフごとの { code, w, h, x, y, dx, bits }:
 * bits は行優先の 0/1 配列、x は左ベアリング、y はベースラインから
 * ビットマップ「下端」までの符号付き距離（上が正。BDF 流）、dx は送り幅。
 *
 * グリフの有無は「フォントを重ねて描いた結果」と「フォントを外して同じ
 * 汎用フォールバックだけで描いた結果」の比較で判定する。二つが一致すれば
 * フォールバックが描いた＝そのフォントにグリフは無い。serif と monospace の
 * 両方で比較し、どちらかが違えば「有り」。それでも無いように見える文字は
 * サイズを変えてもう一度だけ聞き直す（偶然のピクセル一致はサイズの性質で
 * あって書体の性質ではないため）。
 */
import { CapabilityError } from '../util/errors.js';

const FALLBACKS = ['serif', 'monospace'];

// Unicode の空白文字。何も描かないので形の比較では判定できず、送り幅だけが頼り。
const SPACES = new Set([
  0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008,
  0x2009, 0x200a, 0x202f, 0x205f, 0x3000,
]);
void SPACES; // 判定は rasterizeOne のインク比較に委ねる（記録として残す）

/** ブラウザ環境でなければ CapabilityError を投げる */
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
 * フォントを document に読み込み、canvas から使えるようにする。
 * 読み込みごとに一意のファミリ名を割り当てる（canvas は名前で解決するため、
 * 二度目の読み込みが一度目のグリフを黙って再利用しないように）。
 * @param {ArrayBuffer | string} src - フォントバイナリ、または取得先 URL
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
    // 既に無ければそれでよい
  }
}

/**
 * どのグリフも `size` ではみ出さない大きさの描画面。ペンは負のベアリングと
 * オーバーハングを拾えるだけ内側に置く。
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
/**
 * CSS 上の描画サイズと、その導出に使った情報。
 * `cssPx` を指定して再利用する場合、probe / probeHeight は由来の記録として保持する。
 * @typedef {{cssPx: number, probe: string | null, probeHeight: number}} FontSizing
 * @typedef {{cssPx: number, probe?: string | null, probeHeight?: number}} FontSizingInput
 */

// ファミリ名は引用符で囲む。汎用フォールバックは囲んでは「いけない」——
// 囲むと実在しないフォント名として無視され、比較の基準にならなくなる。
/** @param {number} size @param {string} family @param {TtfStyle} [style] @param {string | null} [fallback] */
const cssFont = (size, family, { weight = 400, italic = false } = {}, fallback = null) =>
  `${italic ? 'italic ' : ''}${weight} ${size}px "${family}"${fallback ? `, ${fallback}` : ''}`;

/** @param {number} size @param {string} generic @param {TtfStyle} [style] */
const cssGeneric = (size, generic, { weight = 400, italic = false } = {}) =>
  `${italic ? 'italic ' : ''}${weight} ${size}px ${generic}`;

// サイズは「参照文字のインク高さ」に釘付けする。行ボックスは書体によって
// 大きく違い、誰もが 32 と言うとき意図しているのは 32px の文字だから。
// 参照文字は生成対象の集合から選ぶ（fontgen の知見: 固定の探針だと、
// CJK フォントが 1 つも無い環境で tofu が「有る」ように見える）。
const PROBE_CANDIDATES = [0x6f22, 0x56fd, 0x65e5, 0xac00, 0x48, 0x45, 0x4e, 0x30];
const REF_PX = 100;

/** @param {Surface} surf @param {number} cp @param {number} cssPx @param {string} family @param {TtfStyle} style */
function probeInk(surf, cp, cssPx, family, style) {
  const g = rasterizeOne(surf, cp, cssPx, family, style, 128);
  return g && g.h > 0 ? g.h : 0;
}

/** @param {string} family @param {TtfStyle} style @param {number[]} codepoints */
function pickProbe(family, style, codepoints) {
  const surf = makeSurface(REF_PX);
  const set = new Set(codepoints);
  for (const cp of PROBE_CANDIDATES) {
    if (!set.has(cp)) continue;
    const h = probeInk(surf, cp, REF_PX, family, style);
    if (h) return { cp, refHeight: h };
  }
  // 集合に定番の候補が無い（数字だけの時計など）: 先頭の数文字から最も
  // 背の高いものを取る。その集合にとっては代表的な文字になる。
  /** @type {{cp: number, refHeight: number} | null} */
  let best = null;
  for (const cp of codepoints.slice(0, 24)) {
    const h = probeInk(surf, cp, REF_PX, family, style);
    if (h && (!best || h > best.refHeight)) best = { cp, refHeight: h };
  }
  return best;
}

/**
 * 要求された「文字高さ」を、それを生む CSS px サイズへ解決する。
 * @param {string} family
 * @param {number} size - 文字高さ（px）
 * @param {TtfStyle} [style]
 * @param {number[]} [codepoints]
 * @returns {{cssPx: number, probe: string | null, probeHeight: number}}
 */
export function measureTtf(family, size, style = {}, codepoints = []) {
  const probe = pickProbe(family, style, codepoints);
  // 要求文字を 1 つも描けないフォントには導出すべき縮尺が無い。
  // em サイズとして扱い、呼び出し側が空の結果を報告する
  if (!probe) return { cssPx: size, probe: null, probeHeight: 0 };

  let cssPx = Math.max(1, (REF_PX * size) / probe.refHeight);
  const surf = makeSurface(Math.ceil(cssPx));
  /** @type {{cssPx: number, got: number} | null} */
  let best = null;
  for (let i = 0; i < 16; i++) {
    const got = probeInk(surf, probe.cp, cssPx, family, style);
    if (!best || Math.abs(got - size) < Math.abs(best.got - size)) best = { cssPx, got };
    if (got === size) break;
    cssPx += (got > size ? -1 : 1) * Math.max(0.1, Math.abs(got - size) / 4);
    if (cssPx < 1) {
      cssPx = 1;
      break;
    }
  }
  const b = /** @type {{cssPx: number, got: number}} */ (best);
  return { cssPx: b.cssPx, probe: String.fromCodePoint(probe.cp), probeHeight: b.got };
}

/** @typedef {{px: Uint8ClampedArray, adv: number}} Rendered */

/** 閾値後の形と送り幅が同じか @param {Rendered} a @param {Rendered} b @param {number} threshold */
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

// --- セカンドオピニオン ------------------------------------------------------
// 「フォールバックが描いたか」の比較は、偶然ピクセルが一致すると誤る。
// それはサイズの性質なので、無いように見えた文字は別サイズで聞き直す。
// 本当に無いグリフはどのサイズでもフォールバックと一致し、偶然は再現しない。

const SECOND_OPINION = 1.37;

// フォントが unicode-range で宣言していないコードポイントは描けない。
// 過剰宣言はあり得るので「有る」の証明にはならないが、「無い」方向には正確で、
// これが再試行を安価にする。
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
 * @property {number} x   - 左ベアリング
 * @property {number} y   - ベースライン → ビットマップ下端（上が正）
 * @property {number} dx  - 送り幅
 * @property {Uint8Array} bits - 行優先 0/1
 */

/**
 * コードポイント 1 つをラスタライズする。フォントにグリフが無ければ null。
 * @param {Surface} surf
 * @param {number} code
 * @param {number} size
 * @param {string} family
 * @param {TtfStyle} style
 * @param {number} threshold
 * @returns {RasterGlyph | null}
 */
function rasterizeOne(surf, code, size, family, style, threshold) {
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

  // どちらかの組で違いが出れば「有り」。空白は何も描かないので判定できず、
  // そのまま受け入れる（送り幅の上限は rasterizeSet 側で整える）
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

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      if (a.px[(py * w + px) * 4 + 3] < threshold) continue;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  if (maxX < 0) {
    return { code, w: 0, h: 0, x: 0, y: 0, dx: Math.round(a.adv), bits: new Uint8Array(0) };
  }

  const gw = maxX - minX + 1;
  const gh = maxY - minY + 1;
  const bits = new Uint8Array(gw * gh);
  for (let py = 0; py < gh; py++) {
    for (let px = 0; px < gw; px++) {
      bits[py * gw + px] = a.px[((minY + py) * w + (minX + px)) * 4 + 3] >= threshold ? 1 : 0;
    }
  }

  return {
    code,
    w: gw,
    h: gh,
    x: minX - originX, // ペンからの左ベアリング
    y: originY - (maxY + 1), // ベースライン → ビットマップ下端（上が正）
    dx: Math.round(a.adv),
    bits,
  };
}

/**
 * 文字集合全体をラスタライズする。
 * @param {object} opts
 * @param {string} opts.family - loadTtf() が返した CSS ファミリ名
 * @param {number} opts.size - 目標の文字高さ（px）
 * @param {number[]} opts.codepoints - 昇順のコードポイント列
 * @param {TtfStyle} [opts.style]
 * @param {number} [opts.threshold] - 1bpp 化の alpha 閾値（1..255。既定 128）
 * @param {FontSizingInput} [opts.sizing] - measureTtf を省略して再利用するサイジング
 * @param {(p: {done: number, total: number}) => void} [opts.onProgress]
 * @returns {Promise<{glyphs: RasterGlyph[], missing: number[],
 *   sizing: {cssPx: number, probe: string | null, probeHeight: number},
 *   box: {ascent: number, descent: number, height: number}}>}
 */
export async function rasterizeSet({
  family,
  size,
  codepoints,
  style = {},
  threshold = 128,
  sizing: inheritedSizing,
  onProgress,
}) {
  ensureRasterizer();
  if (inheritedSizing && (!Number.isFinite(inheritedSizing.cssPx) || inheritedSizing.cssPx <= 0)) {
    throw new RangeError('rasterizeSet: sizing.cssPx must be a positive finite number');
  }
  const sizing = inheritedSizing
    ? {
        cssPx: inheritedSizing.cssPx,
        probe: inheritedSizing.probe ?? null,
        probeHeight: inheritedSizing.probeHeight ?? 0,
      }
    : measureTtf(family, size, style, codepoints);
  const surf = makeSurface(sizing.cssPx);
  /** @type {RasterGlyph[]} */
  const glyphs = [];
  /** @type {number[]} */
  const missing = [];

  // CJK 1 万字でもタブが固まらないよう、チャンクごとにイベントループへ戻す
  const CHUNK = 200;
  for (let i = 0; i < codepoints.length; i++) {
    const g = rasterizeOne(surf, codepoints[i], sizing.cssPx, family, style, threshold);
    if (g) glyphs.push(g);
    else missing.push(codepoints[i]);
    if ((i + 1) % CHUNK === 0 || i === codepoints.length - 1) {
      onProgress?.({ done: i + 1, total: codepoints.length });
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // 空白は最も広い文字より広くならないよう整える（空白の有無は判定できず、
  // フォールバック由来の極端な送り幅がそのまま入ることがあるため）
  const widest = glyphs.reduce((a, g) => (g.h && g.dx > a ? g.dx : a), 0);
  if (widest) {
    for (const g of glyphs) {
      if (!g.h && g.dx > widest) g.dx = widest;
    }
  }

  return { glyphs, missing, sizing, box: lineBoxOf(glyphs) };
}

/**
 * グリフ集合の行ボックス（ベースラインの上下それぞれの最遠インク）。
 * 書体の宣言メトリクスではなく実際に生成されたグリフから導くので、
 * 収録内容に対してちょうどの高さになる。
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

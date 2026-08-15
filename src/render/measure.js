// @ts-check
/**
 * テキスト計測。LovyanGFX v1.2.26 LGFXBase::text_width / fontHeight の忠実な移植。
 * 固定小数点（16.16）の丸めもオリジナルの式のまま再現する。
 */

/** @typedef {import('../model/font.js').Font} Font */

/**
 * @typedef {object} TextStyle
 * @property {number} [sizeX]  - 文字倍率（横）。既定 1
 * @property {number} [sizeY]  - 文字倍率（縦）。既定 1
 * @property {string | number} [datum] - 描画基準点。既定 'top-left'
 */

/** C++ の `int32_t s = 65536 * size;`（float → int 切り捨て）と同じ。
 * @param {number} size */
export function toFixed16(size) {
  return Math.trunc(65536 * size);
}

/**
 * LovyanGFX と同じ規則で文字列をコードポイント列にする:
 * 制御文字（U+0000〜U+001F）と異体字セレクタ（U+FE00〜U+FE0F）は読み飛ばす。
 * @param {string} text
 * @returns {number[]}
 */
export function codepointsOf(text) {
  const out = [];
  for (const ch of text) {
    const cp = /** @type {number} */ (ch.codePointAt(0));
    if (cp < 0x20) continue;
    if (cp >= 0xfe00 && cp < 0xfe10) continue;
    out.push(cp);
  }
  return out;
}

/**
 * 1 文字ぶんの計測値。LGFX の updateFontMetric 相当
 * （収録外は グリフ 0 → メタ情報のフォールバックの順で解決する）。
 * @param {Font} font
 * @param {number} cp
 * @returns {{width: number, advance: number, xOffset: number}}
 */
export function metricFor(font, cp) {
  const g = font.glyphs.get(cp) ?? font.glyphs.get(0);
  if (g) return { width: g.bitmap.width, advance: g.xAdvance, xOffset: g.xOffset };
  const fb = font.meta.fallback;
  if (fb) return { width: fb.width, advance: fb.advance, xOffset: fb.xOffset };
  return { width: 0, advance: 0, xOffset: 0 };
}

/**
 * 行ボックスの高さ（LGFX の fontHeight() 相当）。
 * @param {Font} font
 * @param {TextStyle} [style]
 * @returns {number}
 */
export function fontHeight(font, style = {}) {
  const sy = toFixed16(style.sizeY ?? 1);
  return ((font.ascent + font.descent) * sy) >> 16;
}

/**
 * 文字列の描画幅（LGFX の textWidth() 相当）。
 * @param {Font} font
 * @param {string} text
 * @param {TextStyle} [style]
 * @returns {number}
 */
export function textWidth(font, text, style = {}) {
  const cps = codepointsOf(text);
  if (cps.length === 0) return 0;
  const sx = toFixed16(style.sizeX ?? 1);
  let left = 0;
  let right = 0;
  for (const cp of cps) {
    const m = metricFor(font, cp);
    const sxoffset = (m.xOffset * sx) >> 16;
    if (left === 0 && right === 0 && m.xOffset < 0) left = right = -sxoffset;
    const sxadvance = (m.advance * sx) >> 16;
    right = left + Math.max(sxadvance, ((m.width * sx) >> 16) + sxoffset);
    left += sxadvance;
  }
  return right;
}

/**
 * 幅・高さ・アセント・ディセントをまとめて返す。
 * @param {Font} font
 * @param {string} text
 * @param {TextStyle} [style]
 */
export function measureText(font, text, style = {}) {
  const sy = toFixed16(style.sizeY ?? 1);
  return {
    width: textWidth(font, text, style),
    height: fontHeight(font, style),
    ascent: (font.ascent * sy) >> 16,
    descent: (font.descent * sy) >> 16,
    lineHeight: (font.lineHeight * sy) >> 16,
  };
}

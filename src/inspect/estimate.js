// @ts-check
/**
 * 形式ごとのサイズ算出（仕様 §11）。概算ではなく「エンコードした場合の
 * 正確なバイト数」を返す。FONT_FORMATS.ja.md の比較表を任意のフォントで
 * 再現できる（UC2 の選定材料）。
 */
import { canEncode, encode, listFormats } from '../format/registry.js';
import { EncodeConstraintError, FormatError } from '../util/errors.js';

/** @typedef {import('../model/font.js').Font} Font */

/**
 * @param {Font} font
 * @param {string} format
 * @returns {{bytes: number | null, issues: import('../format/registry.js').EncodeIssue[]}}
 *   bytes: エンコード結果の正確なバイト数。フォント全体の制約で入らない場合は null。
 *   グリフ単位の違反がある場合は「違反グリフを落とした場合の」バイト数を返す
 *   （issues にその内訳が載る）。
 */
export function estimateSize(font, format) {
  const check = canEncode(font, format);
  try {
    const bytes = encode(font, { format, dropInvalid: true });
    return { bytes: bytes.length, issues: check.issues };
  } catch (e) {
    if (e instanceof EncodeConstraintError || e instanceof FormatError) {
      return { bytes: null, issues: check.issues };
    }
    throw e;
  }
}

/**
 * エンコーダを持つ全形式のサイズ比較。
 * @param {Font} font
 * @returns {Record<string, {bytes: number | null, issues: import('../format/registry.js').EncodeIssue[]}>}
 */
export function estimateSizes(font) {
  /** @type {Record<string, {bytes: number | null, issues: import('../format/registry.js').EncodeIssue[]}>} */
  const out = {};
  for (const f of listFormats()) {
    if (!f.encode) continue;
    out[f.id] = estimateSize(font, f.id);
  }
  return out;
}

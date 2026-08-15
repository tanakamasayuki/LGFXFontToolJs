// @ts-check
/**
 * 中立モデル Font / Glyph（仕様 §5.1）。
 *
 * 座標規約:
 * - Y 軸は下向きが正。
 * - グリフの原点はベースライン上のペン位置。xOffset / yOffset はそこから
 *   ビットマップ左上への符号付きオフセット。上に伸びるグリフの yOffset は負。
 * - 描画後、ペンは xAdvance だけ右へ進む。
 */

/** @typedef {import('./bitmap.js').Bitmap} Bitmap */

/**
 * @typedef {object} Glyph
 * @property {number} codepoint  - 0 〜 0x10FFFF
 * @property {number} xOffset    - ペン位置からビットマップ左端まで（int16）
 * @property {number} yOffset    - ベースラインからビットマップ上端まで（int16、上が負）
 * @property {number} xAdvance   - 送り幅（int16）
 * @property {Bitmap} bitmap
 */

/**
 * @typedef {object} KerningPair
 * @property {number} left   - 左グリフのコードポイント
 * @property {number} right  - 右グリフのコードポイント
 * @property {number} dx     - 送りの補正量
 */

/**
 * @typedef {object} FontIssue
 * @property {'error'|'warning'} level
 * @property {string} code
 * @property {number} [codepoint]
 * @property {object} [params]
 */

/**
 * 未収録文字を描くときの LovyanGFX 互換フォールバック情報。
 * デコーダが元形式の規則から求める（仕様 §9.2、LGFX の updateFontMetric 失敗時挙動）。
 * @typedef {object} FallbackMetric
 * @property {number} advance - 送り幅（textWidth 計算用）
 * @property {number} width   - textWidth 計算に使う幅
 * @property {number} xOffset
 * @property {number} [drawAdvance] - 描画時の送り幅（省略時 advance。GFX の空白なしは 0）
 * @property {boolean} [drawBox]    - 代替ボックスを描くか（省略時 true）
 *
 * @typedef {object} FontMeta
 * @property {string} [sourceFormat]  - 'u8g2' | 'gfx' | 'glcd' | 'fixedbmp' | 'bmp' | 'rle' | ...
 * @property {string} [drawProfile]   - 描画プロファイル（仕様 §9.3。倍率適用時の量子化規則）
 * @property {FallbackMetric} [fallback]
 * @property {FontIssue[]} issues
 * @property {object} [format]        - 元形式固有の再エンコード用パラメータ
 * @property {string} [license]
 * @property {string} [copyright]
 */

/**
 * @typedef {object} Font
 * @property {string} familyName
 * @property {string} styleName
 * @property {number} ascent      - ベースラインから行ボックス上端まで（正、int16）
 * @property {number} descent     - ベースラインから行ボックス下端まで（正、int16）
 * @property {number} lineHeight  - 行送り（int16）
 * @property {Map<number, Glyph>} glyphs
 * @property {number} [defaultCodepoint]
 * @property {KerningPair[]} [kerning]
 * @property {FontMeta} meta
 */

/**
 * @param {object} props
 * @param {string} [props.familyName]
 * @param {string} [props.styleName]
 * @param {number} props.ascent
 * @param {number} props.descent
 * @param {number} props.lineHeight
 * @param {Map<number, Glyph>} [props.glyphs]
 * @param {number} [props.defaultCodepoint]
 * @param {KerningPair[]} [props.kerning]
 * @param {Partial<FontMeta>} [props.meta]
 * @returns {Font}
 */
export function createFont(props) {
  return {
    familyName: props.familyName ?? '',
    styleName: props.styleName ?? 'Regular',
    ascent: props.ascent,
    descent: props.descent,
    lineHeight: props.lineHeight,
    glyphs: props.glyphs ?? new Map(),
    defaultCodepoint: props.defaultCodepoint,
    kerning: props.kerning,
    meta: { issues: [], ...(props.meta ?? {}) },
  };
}

/**
 * @param {Font} font
 * @param {number} codepoint
 * @returns {Glyph | undefined}
 */
export function getGlyph(font, codepoint) {
  return font.glyphs.get(codepoint);
}

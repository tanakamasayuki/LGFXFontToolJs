// @ts-check
/**
 * 文字集合の絞り込み（仕様 §5.2、UC4）。非破壊。
 */
import { createFont } from './font.js';

/** @typedef {import('./font.js').Font} Font */

/**
 * chars で指定した文字だけを残した新しい Font を返す。
 * @param {Font} font
 * @param {Iterable<number> | string} chars - コードポイント列または文字列
 * @returns {Font}
 */
export function subset(font, chars) {
  /** @type {Set<number>} */
  const wanted = new Set();
  if (typeof chars === 'string') {
    for (const ch of chars) wanted.add(/** @type {number} */ (ch.codePointAt(0)));
  } else {
    for (const cp of chars) wanted.add(cp);
  }
  const glyphs = new Map();
  for (const cp of wanted) {
    const g = font.glyphs.get(cp);
    if (g) glyphs.set(cp, g);
  }
  return createFont({
    familyName: font.familyName,
    styleName: font.styleName,
    ascent: font.ascent,
    descent: font.descent,
    lineHeight: font.lineHeight,
    glyphs,
    defaultCodepoint:
      font.defaultCodepoint !== undefined && wanted.has(font.defaultCodepoint)
        ? font.defaultCodepoint
        : undefined,
    kerning: font.kerning?.filter((k) => wanted.has(k.left) && wanted.has(k.right)),
    meta: { ...font.meta, issues: [...font.meta.issues] },
  });
}

/**
 * base に overlay のグリフを重ねた新しい Font を返す（仕様 §5.2、UC4 の補完）。
 * メトリクスは base のものを保ち、グリフは再スケールせず取り込む。
 * 行ボックスが合わない場合は meta.issues に warning を積む。
 * @param {Font} base
 * @param {Font} overlay
 * @returns {Font}
 */
export function merge(base, overlay) {
  const glyphs = new Map(base.glyphs);
  for (const [cp, g] of overlay.glyphs) glyphs.set(cp, g);
  const issues = [...base.meta.issues];
  if (
    overlay.ascent !== base.ascent ||
    overlay.descent !== base.descent ||
    overlay.lineHeight !== base.lineHeight
  ) {
    issues.push({
      level: 'warning',
      code: 'MERGE_METRICS_MISMATCH',
      params: {
        base: { ascent: base.ascent, descent: base.descent, lineHeight: base.lineHeight },
        overlay: { ascent: overlay.ascent, descent: overlay.descent, lineHeight: overlay.lineHeight },
      },
    });
  }
  return createFont({
    familyName: base.familyName,
    styleName: base.styleName,
    ascent: base.ascent,
    descent: base.descent,
    lineHeight: base.lineHeight,
    glyphs,
    defaultCodepoint: base.defaultCodepoint,
    kerning: base.kerning,
    meta: { ...base.meta, issues },
  });
}

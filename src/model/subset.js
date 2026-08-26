// @ts-check
/**
 * Non-destructive character-set operations (spec §5.2, UC4).
 */
import { createFont } from './font.js';

/** @typedef {import('./font.js').Font} Font */

/**
 * Returns a new Font containing only characters specified by chars.
 * @param {Font} font
 * @param {Iterable<number> | string} chars - code points or a string
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
 * Returns a new Font with overlay glyphs placed over base (spec §5.2, UC4 fallback fill).
 * Base metrics are preserved and glyphs are copied without rescaling.
 * Line-box mismatches append warnings to meta.issues.
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

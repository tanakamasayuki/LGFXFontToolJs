// @ts-check
/**
 * BDF (Glyph Bitmap Distribution Format 2.1) のデコーダとエンコーダ（仕様 §6 / §7）。
 *
 * 相互運用の要となるテキスト形式。fontforge / otf2bdf / bdfconv（u8g2 純正
 * ツール）と繋がる。1bpp のみ。
 *
 * 座標の対応: BBX の (xoff, yoff) は「ペン位置からビットマップ左下」への
 * オフセット（y は上が正）。中立モデルの yOffset（ベースライン→上端、下向き
 * 軸）へは yOffset = -(yoff + h) で写す。BITMAP の各行は MSB first で
 * バイト境界へパディング — 中立モデルの Bitmap と同じ表現なのでそのまま写せる。
 *
 * LovyanGFX の BDFfont クラスは BDF テキストではなく前処理済みの固定セル
 * 表を読むため、この形式に LovyanGFX 互換の描画プロファイルは存在しない。
 * デコード結果の drawProfile は 'gfx'（汎用）とする。
 */
import { FormatError, EncodeConstraintError } from '../util/errors.js';
import { createBitmap } from '../model/bitmap.js';
import { createFont } from '../model/font.js';

/** @typedef {import('../model/font.js').Font} Font */
/** @typedef {import('../model/font.js').Glyph} Glyph */

/**
 * BDF テキストを中立モデルへデコードする。
 * 多少壊れていても読めるだけ読み、問題は meta.issues に積む（仕様 §6.1）。
 * @param {string} text
 * @param {{familyName?: string, styleName?: string}} [opts]
 * @returns {Font}
 */
export function decodeBdf(text, opts = {}) {
  if (!/^\s*STARTFONT\b/.test(text)) {
    throw new FormatError('DETECT_FAILED', 'not a BDF file (missing STARTFONT)');
  }
  /** @type {import('../model/font.js').FontIssue[]} */
  const issues = [];
  /** @type {Map<number, Glyph>} */
  const glyphs = new Map();

  let familyName = opts.familyName ?? '';
  let fontAscent = NaN;
  let fontDescent = NaN;
  let pixelSize = NaN;
  /** @type {[number, number, number, number] | null} FONTBOUNDINGBOX w h xoff yoff */
  let fbb = null;

  const lines = text.split(/\r?\n/);
  let i = 0;
  const n = lines.length;

  /** @param {string} line @param {number} count @returns {number[]} */
  const ints = (line, count) => {
    const parts = line.trim().split(/\s+/).slice(1, 1 + count).map(Number);
    while (parts.length < count) parts.push(0);
    return parts;
  };

  // --- グローバル部 ---
  for (; i < n; i++) {
    const line = lines[i];
    if (line.startsWith('CHARS ') || line.startsWith('STARTCHAR')) break;
    if (line.startsWith('FAMILY_NAME ') && !opts.familyName) {
      familyName = line.slice('FAMILY_NAME '.length).trim().replace(/^"|"$/g, '');
    } else if (line.startsWith('FONT ') && !familyName) {
      familyName = line.slice(5).trim();
    } else if (line.startsWith('FONT_ASCENT ')) {
      fontAscent = Number(line.split(/\s+/)[1]);
    } else if (line.startsWith('FONT_DESCENT ')) {
      fontDescent = Number(line.split(/\s+/)[1]);
    } else if (line.startsWith('PIXEL_SIZE ')) {
      pixelSize = Number(line.split(/\s+/)[1]);
    } else if (line.startsWith('FONTBOUNDINGBOX ')) {
      fbb = /** @type {[number, number, number, number]} */ (ints(line, 4));
    }
  }

  // --- グリフ部 ---
  for (; i < n; i++) {
    if (!lines[i].startsWith('STARTCHAR')) continue;
    let encoding = -1;
    let dwidth = 0;
    let bbx = [0, 0, 0, 0];
    /** @type {string[]} */
    const rows = [];
    let inBitmap = false;
    for (i++; i < n; i++) {
      const line = lines[i];
      if (line.startsWith('ENDCHAR')) break;
      if (inBitmap) {
        rows.push(line.trim());
        continue;
      }
      if (line.startsWith('ENCODING ')) encoding = Number(line.split(/\s+/)[1]);
      else if (line.startsWith('DWIDTH ')) dwidth = ints(line, 2)[0];
      else if (line.startsWith('BBX ')) bbx = ints(line, 4);
      else if (line.startsWith('BITMAP')) inBitmap = true;
    }
    if (encoding < 0) {
      // ENCODING -1（名前でしか引けないグリフ）は読み飛ばす
      issues.push({ level: 'warning', code: 'BDF_UNENCODED_GLYPH' });
      continue;
    }
    const [w, h, xoff, yoff] = bbx;
    const bitmap = createBitmap(w, h, 1);
    for (let y = 0; y < h && y < rows.length; y++) {
      const hex = rows[y];
      for (let b = 0; b < bitmap.stride; b++) {
        bitmap.data[y * bitmap.stride + b] = parseInt(hex.slice(b * 2, b * 2 + 2) || '0', 16);
      }
      // 行のパディングビットが立っていても幅の外なので無視される（stride 表現ゆえ
      // データには残る）。規格上は 0 のはずなので、立っていたら落として警告
      const excess = bitmap.stride * 8 - w;
      if (excess > 0) {
        const lastIdx = y * bitmap.stride + bitmap.stride - 1;
        const mask = 0xff << excess;
        if ((bitmap.data[lastIdx] & ~mask & 0xff) !== 0) {
          bitmap.data[lastIdx] &= mask;
          issues.push({ level: 'warning', code: 'BDF_PADDING_BITS_SET', codepoint: encoding });
        }
      }
    }
    if (rows.length !== h) {
      issues.push({ level: 'warning', code: 'BDF_BITMAP_ROW_COUNT', codepoint: encoding });
    }
    glyphs.set(encoding, {
      codepoint: encoding,
      xOffset: xoff,
      yOffset: yoff + h === 0 ? 0 : -(yoff + h),
      xAdvance: dwidth,
      bitmap,
    });
  }

  // メトリクス: FONT_ASCENT / FONT_DESCENT が正。無ければ FONTBOUNDINGBOX から導く
  let ascent = fontAscent;
  let descent = fontDescent;
  if (!Number.isFinite(ascent) || !Number.isFinite(descent)) {
    issues.push({ level: 'warning', code: 'BDF_MISSING_FONT_METRICS' });
    if (fbb) {
      ascent = fbb[1] + fbb[3];
      descent = -fbb[3];
    } else {
      ascent = Number.isFinite(pixelSize) ? pixelSize : 16;
      descent = 0;
    }
  }

  const space = glyphs.get(0x20);
  return createFont({
    familyName,
    styleName: opts.styleName ?? 'Regular',
    ascent,
    descent,
    lineHeight: ascent + descent,
    glyphs,
    meta: {
      sourceFormat: 'bdf',
      drawProfile: 'gfx',
      fallback: space
        ? { advance: space.xAdvance, width: space.bitmap.width, xOffset: space.xOffset }
        : { advance: 0, width: 0, xOffset: 0, drawBox: false },
      issues,
      format: { bdf: { pixelSize: Number.isFinite(pixelSize) ? pixelSize : ascent + descent } },
    },
  });
}

/**
 * BDF へエンコードできるか（仕様 §7.1）。1bpp であればほぼ常に可能。
 * @param {Font} font
 * @returns {{ok: boolean, issues: import('./registry.js').EncodeIssue[]}}
 */
export function canEncodeBdf(font) {
  /** @type {import('./registry.js').EncodeIssue[]} */
  const issues = [];
  for (const g of font.glyphs.values()) {
    if (g.bitmap.bpp !== 1) {
      issues.push({
        level: 'error',
        code: 'BPP_UNSUPPORTED',
        codepoint: g.codepoint,
        params: { bpp: g.bitmap.bpp },
      });
    }
  }
  if (font.glyphs.size === 0) issues.push({ level: 'error', code: 'EMPTY_FONT' });
  return { ok: !issues.some((i) => i.level === 'error'), issues };
}

/**
 * 中立モデル → BDF テキスト。
 * @param {Font} font
 * @param {{fontName?: string, dropInvalid?: boolean}} [opts]
 * @returns {string}
 */
export function encodeBdf(font, opts = {}) {
  const check = canEncodeBdf(font);
  const badCps = new Set(
    check.issues.filter((i) => i.level === 'error' && i.codepoint !== undefined).map((i) => i.codepoint),
  );
  if (!check.ok) {
    const fontLevel = check.issues.some((i) => i.level === 'error' && i.codepoint === undefined);
    if (!opts.dropInvalid || fontLevel) {
      throw new EncodeConstraintError('font does not fit the BDF format', check.issues);
    }
  }

  const glyphs = [...font.glyphs.values()]
    .filter((g) => !badCps.has(g.codepoint))
    .sort((a, b) => a.codepoint - b.codepoint);
  const name = (opts.fontName ?? font.familyName ?? 'unnamed').replace(/\s+/g, '-') || 'unnamed';
  const pixelSize = font.ascent + font.descent;

  let maxW = 1;
  let maxH = 1;
  let minXo = 0;
  let minYo = 0;
  for (const g of glyphs) {
    maxW = Math.max(maxW, g.bitmap.width);
    maxH = Math.max(maxH, g.bitmap.height);
    minXo = Math.min(minXo, g.xOffset);
    minYo = Math.min(minYo, -(g.yOffset + g.bitmap.height));
  }

  const L = [];
  L.push('STARTFONT 2.1');
  L.push(`FONT ${name}`);
  L.push(`SIZE ${pixelSize} 75 75`);
  L.push(`FONTBOUNDINGBOX ${maxW} ${maxH} ${minXo} ${minYo}`);
  L.push('STARTPROPERTIES 4');
  L.push(`FONT_ASCENT ${font.ascent}`);
  L.push(`FONT_DESCENT ${font.descent}`);
  L.push(`PIXEL_SIZE ${pixelSize}`);
  L.push(`DEFAULT_CHAR ${font.defaultCodepoint ?? 0x20}`);
  L.push('ENDPROPERTIES');
  L.push(`CHARS ${glyphs.length}`);
  for (const g of glyphs) {
    const w = g.bitmap.width;
    const h = g.bitmap.height;
    const yoff = -(g.yOffset + h) || 0; // -0 を出さない
    L.push(`STARTCHAR U+${g.codepoint.toString(16).toUpperCase().padStart(4, '0')}`);
    L.push(`ENCODING ${g.codepoint}`);
    L.push(`SWIDTH ${Math.round((g.xAdvance * 1000) / Math.max(1, pixelSize))} 0`);
    L.push(`DWIDTH ${g.xAdvance} 0`);
    L.push(`BBX ${w} ${h} ${g.xOffset} ${yoff}`);
    L.push('BITMAP');
    for (let y = 0; y < h; y++) {
      let hex = '';
      for (let b = 0; b < g.bitmap.stride; b++) {
        hex += g.bitmap.data[y * g.bitmap.stride + b].toString(16).toUpperCase().padStart(2, '0');
      }
      L.push(hex);
    }
    L.push('ENDCHAR');
  }
  L.push('ENDFONT');
  return L.join('\n') + '\n';
}

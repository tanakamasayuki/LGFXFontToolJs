// @ts-check
/**
 * VLW（Processing / TFT_eSPI Smooth Font / LovyanGFX VLWfont）のデコーダと
 * エンコーダ（仕様 §6 / §7）。8bpp（アンチエイリアス）の実行時ロード形式。
 *
 * レイアウト（すべてビッグエンディアン u32）:
 *   ヘッダ 24B: glyphCount, version, size("points"), 未使用, ascent, descent
 *   グリフ表 28B × N: unicode, height, width, setWidth(送り), topExtent(dY),
 *                     leftExtent(dX), 予約
 *   ビットマップ: 8bpp の被覆値を表の順に連結
 *
 * LovyanGFX の読み込み時の癖（VLWfont::loadFont / drawChar）を再現する:
 * - ascent / descent はヘッダ値を起点に、U+00FF 超（および U+0021..009F、
 *   U+007F と U+3000 を除く）のグリフを走査して maxAscent / maxDescent を
 *   求め直し、行高はその和になる
 * - spaceWidth = 走査前の max(size, ascent+descent) * 2 / 7
 * - U+0020 はファイル内のグリフの有無に関わらず、描画では常に「何も描かず
 *   spaceWidth だけ送る」。計測はグリフ表があれば表の値を使う（LGFX 自身の
 *   非対称。描画プロファイル 'vlw' が再現する）
 */
import { ByteReader, ByteWriter } from '../util/bytes.js';
import { TruncatedDataError, EncodeConstraintError } from '../util/errors.js';
import { createBitmap } from '../model/bitmap.js';
import { createFont } from '../model/font.js';

/** @typedef {import('../model/font.js').Font} Font */
/** @typedef {import('../model/font.js').Glyph} Glyph */

const HEADER_BYTES = 24;
const GLYPH_REC_BYTES = 28;

/** @param {number} v */
const i32 = (v) => (v & 0x80000000 ? v - 0x100000000 : v);
/** @param {number} v */
const i16of = (v) => {
  const t = v & 0xffff;
  return t >= 0x8000 ? t - 0x10000 : t;
};
/** @param {number} v */
const i8of = (v) => {
  const t = v & 0xff;
  return t >= 0x80 ? t - 0x100 : t;
};

/**
 * VLW バイナリを中立モデルへデコードする。
 * @param {Uint8Array} data
 * @param {{familyName?: string, styleName?: string}} [opts]
 * @returns {Font}
 */
export function decodeVlw(data, opts = {}) {
  const r = new ByteReader(data);
  const gCount = r.u32be();
  const version = r.u32be();
  const sizeField = r.u32be();
  r.u32be(); // 未使用
  const headerAscent = Math.abs(i32(r.u32be()));
  const headerDescent = Math.abs(i32(r.u32be()));

  const bitmapBase = HEADER_BYTES + gCount * GLYPH_REC_BYTES;
  if (bitmapBase > data.length) {
    throw new TruncatedDataError('VLW glyph table exceeds data', { gCount, length: data.length });
  }

  /** @type {import('../model/font.js').FontIssue[]} */
  const issues = [];
  /** @type {{cp: number, w: number, h: number, adv: number, dY: number, dX: number, offset: number}[]} */
  const recs = [];
  let bitmapPtr = bitmapBase;
  for (let i = 0; i < gCount; i++) {
    const cp = r.u32be();
    const h = r.u32be();
    const w = r.u32be();
    const adv = r.u32be();
    const dY = i16of(r.u32be());
    const dX = i8of(r.u32be());
    r.u32be(); // 予約
    recs.push({ cp, w, h, adv, dY, dX, offset: bitmapPtr });
    bitmapPtr += w * h;
  }

  // LGFX loadFont のメトリクス再計算（順序・除外条件込みで忠実に）
  let maxAscent = headerAscent;
  let maxDescent = headerDescent;
  const spaceWidth = Math.floor((Math.max(sizeField, headerAscent + headerDescent) * 2) / 7);
  for (const g of recs) {
    if (g.cp > 0xff || (g.cp > 0x20 && g.cp < 0xa0 && g.cp !== 0x7f)) {
      if (maxAscent < g.dY && g.cp !== 0x3000) maxAscent = g.dY;
      if (maxDescent < g.h - g.dY && g.cp !== 0x3000) maxDescent = g.h - g.dY;
    }
  }

  /** @type {Map<number, Glyph>} */
  const glyphs = new Map();
  let spaceGlyphInFile = false;
  for (const g of recs) {
    if (g.cp > 0xffff) {
      issues.push({ level: 'warning', code: 'VLW_CODEPOINT_OVER_BMP', codepoint: g.cp });
      continue;
    }
    if (g.cp === 0x20) spaceGlyphInFile = true;
    const bitmap = createBitmap(g.w, g.h, 8);
    const src = data.subarray(g.offset, g.offset + g.w * g.h);
    if (src.length < g.w * g.h) {
      issues.push({ level: 'warning', code: 'VLW_BITMAP_TRUNCATED', codepoint: g.cp });
    }
    bitmap.data.set(src);
    glyphs.set(g.cp, {
      codepoint: g.cp,
      xOffset: g.dX,
      yOffset: g.dY === 0 ? 0 : -g.dY,
      xAdvance: g.adv,
      bitmap,
    });
  }

  // U+0020 が無いフォントでは LGFX は spaceWidth で空白を描く。
  // モデルにも同じ意味の空グリフを合成する（描画・計測とも spaceWidth）
  if (!spaceGlyphInFile) {
    glyphs.set(0x20, {
      codepoint: 0x20,
      xOffset: 0,
      yOffset: 0,
      xAdvance: spaceWidth,
      bitmap: createBitmap(0, 0, 8),
    });
  }

  return createFont({
    familyName: opts.familyName ?? '',
    styleName: opts.styleName ?? 'Regular',
    ascent: maxAscent,
    descent: maxDescent,
    lineHeight: maxAscent + maxDescent,
    glyphs,
    meta: {
      sourceFormat: 'vlw',
      drawProfile: 'vlw',
      // 未収録文字は spaceWidth 幅の代替ボックス（drawCharDummy）になる
      fallback: { advance: spaceWidth, width: spaceWidth, xOffset: 0 },
      issues,
      format: {
        vlw: { version, sizeField, headerAscent, headerDescent, spaceWidth, spaceGlyphInFile },
      },
    },
  });
}

/**
 * VLW へエンコードできるか（仕様 §7.1）。
 * @param {Font} font
 * @returns {{ok: boolean, issues: import('./registry.js').EncodeIssue[]}}
 */
export function canEncodeVlw(font) {
  /** @type {import('./registry.js').EncodeIssue[]} */
  const issues = [];
  for (const g of font.glyphs.values()) {
    /** @param {string} code @param {object} params */
    const err = (code, params) => issues.push({ level: 'error', code, codepoint: g.codepoint, params });
    if (g.codepoint > 0xffff) err('CODEPOINT_OVER_BMP', { value: g.codepoint });
    // 幅・高さ・送りは描画こそ u32 だが、LGFX が RAM に持つ索引が u8 のため
    // 255 を超えると計測が壊れる
    if (g.bitmap.width > 255 || g.bitmap.height > 255) {
      err('GLYPH_TOO_LARGE', { width: g.bitmap.width, height: g.bitmap.height, max: 255 });
    }
    if (g.xAdvance < 0 || g.xAdvance > 255) err('XADVANCE_RANGE', { value: g.xAdvance, min: 0, max: 255 });
    if (g.xOffset < -128 || g.xOffset > 127) err('BEARING_RANGE', { x: g.xOffset, min: -128, max: 127 });
  }
  if (font.glyphs.size === 0) issues.push({ level: 'error', code: 'EMPTY_FONT' });

  // デコード時の再走査でアセント/ディセントが膨らむ場合は保存されない差になる
  const meta = /** @type {{vlw?: {headerAscent: number, headerDescent: number}}} */ (
    font.meta.format ?? {}
  ).vlw;
  let maxAscent = meta?.headerAscent ?? font.ascent;
  let maxDescent = meta?.headerDescent ?? font.descent;
  for (const g of font.glyphs.values()) {
    const cp = g.codepoint;
    if (cp > 0xff || (cp > 0x20 && cp < 0xa0 && cp !== 0x7f)) {
      const dY = g.yOffset === 0 ? 0 : -g.yOffset;
      if (maxAscent < dY && cp !== 0x3000) maxAscent = dY;
      if (maxDescent < g.bitmap.height - dY && cp !== 0x3000) maxDescent = g.bitmap.height - dY;
    }
  }
  if (maxAscent !== font.ascent || maxDescent !== font.descent) {
    issues.push({
      level: 'warning',
      code: 'METRICS_DERIVED',
      params: {
        ascent: font.ascent,
        descent: font.descent,
        derivedAscent: maxAscent,
        derivedDescent: maxDescent,
      },
    });
  }
  return { ok: !issues.some((i) => i.level === 'error'), issues };
}

/**
 * 中立モデル → VLW バイナリ。1bpp モデルは 0 / 255 に引き伸ばして符号化する。
 * @param {Font} font
 * @param {{dropInvalid?: boolean}} [opts]
 * @returns {Uint8Array}
 */
export function encodeVlw(font, opts = {}) {
  const check = canEncodeVlw(font);
  const badCps = new Set(
    check.issues.filter((i) => i.level === 'error' && i.codepoint !== undefined).map((i) => i.codepoint),
  );
  if (!check.ok) {
    const fontLevel = check.issues.some((i) => i.level === 'error' && i.codepoint === undefined);
    if (!opts.dropInvalid || fontLevel) {
      throw new EncodeConstraintError('font does not fit the VLW format', check.issues);
    }
  }

  const meta = /** @type {{vlw?: {version: number, sizeField: number, headerAscent: number,
    headerDescent: number, spaceGlyphInFile: boolean}}} */ (font.meta.format ?? {}).vlw;

  let glyphs = [...font.glyphs.values()]
    .filter((g) => !badCps.has(g.codepoint))
    .sort((a, b) => a.codepoint - b.codepoint);
  // デコード時に合成した空白（ファイル由来でない）は書き戻さない
  if (meta && !meta.spaceGlyphInFile) {
    glyphs = glyphs.filter((g) => g.codepoint !== 0x20);
  }

  const w = new ByteWriter();
  const u32be = (/** @type {number} */ v) => {
    w.u8((v >>> 24) & 0xff).u8((v >>> 16) & 0xff).u8((v >>> 8) & 0xff).u8(v & 0xff);
  };

  u32be(glyphs.length);
  u32be(meta?.version ?? 11);
  u32be(meta?.sizeField ?? font.lineHeight);
  u32be(0);
  u32be(meta?.headerAscent ?? font.ascent);
  u32be(meta?.headerDescent ?? font.descent);

  for (const g of glyphs) {
    u32be(g.codepoint);
    u32be(g.bitmap.height);
    u32be(g.bitmap.width);
    u32be(g.xAdvance);
    const dY = g.yOffset === 0 ? 0 : -g.yOffset;
    u32be(dY < 0 ? dY + 0x100000000 : dY);
    const dX = g.xOffset;
    u32be(dX < 0 ? dX + 0x100000000 : dX);
    u32be(0);
  }
  for (const g of glyphs) {
    if (g.bitmap.bpp === 8) {
      w.bytes(g.bitmap.data.subarray(0, g.bitmap.width * g.bitmap.height));
    } else {
      // 1bpp → 0 / 255
      for (let y = 0; y < g.bitmap.height; y++) {
        for (let x = 0; x < g.bitmap.width; x++) {
          const byte = g.bitmap.data[y * g.bitmap.stride + (x >> 3)];
          w.u8((byte >> (7 - (x & 7))) & 1 ? 255 : 0);
        }
      }
    }
  }
  return w.toUint8Array();
}

// @ts-check
/**
 * FONTX2 のデコーダとエンコーダ（仕様 §2.1、Phase 4）。
 *
 * 日本語組込みの古参形式（MS-DOS 由来。ChaN / ELM 周辺のツール群と繋がる）。
 * 固定セルのビットマップ表で、1 ファイルは ANK（1 バイト系 256 グリフ）か
 * 漢字（Shift-JIS 2 バイト系、コードブロック表付き）のどちらか。
 * 半角 ANK と全角漢字は別ファイルで対になっている文化なので、両方を
 * デコードして merge すると 1 つの中立モデルになる。
 *
 *   0    6  シグネチャ "FONTX2"
 *   6    8  フォント名（空白詰め）
 *   14   1  幅 XSize
 *   15   1  高さ YSize
 *   16   1  コード種別 0=ANK 1=Shift-JIS
 *   ANK:  17 から 256 グリフ（各 ceil(XSize/8)*YSize バイト、行優先 MSB first）
 *   漢字: 17 に ブロック数 NB、18 から NB×4 バイト（開始/終了 SJIS u16 LE）、
 *         その後にブロック順・コード順でグリフ
 *
 * コードポイント変換は Encoding Standard の shift_jis（TextDecoder。
 * ブラウザ必須実装・Node 20+ 同梱）を使い、逆引き表は初回に全コードを
 * 復号して構築する。依存ゼロのまま両方向を賄う。
 *
 * FONTX2 はベースライン情報を持たない。既定ではセル下端をベースラインとし
 * （descent 0）、opts.descent で上書きできる。LovyanGFX に対応クラスは無い
 * ため描画プロファイルは汎用（'gfx'）。
 */
import { FormatError, TruncatedDataError, EncodeConstraintError } from '../util/errors.js';
import { createBitmap, getPixel, setPixel } from '../model/bitmap.js';
import { createFont } from '../model/font.js';

/** @typedef {import('../model/font.js').Font} Font */
/** @typedef {import('../model/font.js').Glyph} Glyph */

const SIGNATURE = 'FONTX2';

/** @type {TextDecoder | null} */
let sjisDecoder = null;

/** SJIS コード（1 or 2 バイト）→ Unicode コードポイント。未割当は null
 * @param {number} code */
export function sjisToUnicode(code) {
  sjisDecoder ??= new TextDecoder('shift_jis');
  const bytes = code > 0xff ? Uint8Array.of(code >> 8, code & 0xff) : Uint8Array.of(code);
  const s = sjisDecoder.decode(bytes);
  if ([...s].length !== 1) return null;
  const cp = /** @type {number} */ (s.codePointAt(0));
  return cp === 0xfffd ? null : cp;
}

/** @type {Map<number, number> | null} */
let reverseMap = null;

/** Unicode コードポイント → SJIS コード。変換不能は null
 * @param {number} cp */
export function unicodeToSjis(cp) {
  if (!reverseMap) {
    reverseMap = new Map();
    for (let c = 0x20; c <= 0xdf; c++) {
      const u = sjisToUnicode(c);
      if (u !== null && !reverseMap.has(u)) reverseMap.set(u, c);
    }
    for (let lead = 0x81; lead <= 0xfc; lead++) {
      if (lead > 0x9f && lead < 0xe0) continue;
      for (let trail = 0x40; trail <= 0xfc; trail++) {
        if (trail === 0x7f) continue;
        const code = (lead << 8) | trail;
        const u = sjisToUnicode(code);
        if (u !== null && !reverseMap.has(u)) reverseMap.set(u, code);
      }
    }
  }
  return reverseMap.get(cp) ?? null;
}

/**
 * FONTX2 バイナリを中立モデルへデコードする。
 * @param {Uint8Array} data
 * @param {{familyName?: string, styleName?: string, descent?: number}} [opts]
 * @returns {Font}
 */
export function decodeFontx2(data, opts = {}) {
  if (data.length < 17) throw new TruncatedDataError('FONTX2 header needs 17 bytes', {});
  for (let i = 0; i < 6; i++) {
    if (data[i] !== SIGNATURE.charCodeAt(i)) {
      throw new FormatError('DETECT_FAILED', 'not a FONTX2 file (bad signature)');
    }
  }
  const name = String.fromCharCode(...data.subarray(6, 14)).trim();
  const width = data[14];
  const height = data[15];
  const codeType = data[16];
  const stride = (width + 7) >> 3;
  const glyphSize = stride * height;
  const descent = opts.descent ?? 0;
  const ascent = height - descent;

  /** @type {import('../model/font.js').FontIssue[]} */
  const issues = [];
  /** @type {Map<number, Glyph>} */
  const glyphs = new Map();

  /** @param {number} cp @param {number} offset */
  const addGlyph = (cp, offset) => {
    const bitmap = createBitmap(width, height, 1);
    // FONTX2 の行レイアウトは中立モデルの Bitmap と同一（MSB first・バイト詰め）
    const src = data.subarray(offset, offset + glyphSize);
    if (src.length < glyphSize) {
      issues.push({ level: 'warning', code: 'FONTX2_BITMAP_TRUNCATED', codepoint: cp });
    }
    bitmap.data.set(src);
    glyphs.set(cp, { codepoint: cp, xOffset: 0, yOffset: -ascent, xAdvance: width, bitmap });
  };

  if (codeType === 0) {
    // ANK: 0x00..0xFF。Unicode へは shift_jis の 1 バイト解釈で写す
    // （ASCII は恒等、0xA1..0xDF は半角カナ）。写せないコードは読み飛ばす
    let skipped = 0;
    for (let code = 0; code < 256; code++) {
      const offset = 17 + code * glyphSize;
      if (offset + glyphSize > data.length) break;
      const cp = code < 0x20 ? code : sjisToUnicode(code);
      if (cp === null) {
        skipped++;
        continue;
      }
      addGlyph(cp, offset);
    }
    if (skipped > 0) {
      issues.push({ level: 'warning', code: 'FONTX2_UNMAPPED_CODES', params: { count: skipped } });
    }
  } else if (codeType === 1) {
    const nb = data[17];
    /** @type {{start: number, end: number}[]} */
    const blocks = [];
    for (let i = 0; i < nb; i++) {
      const at = 18 + i * 4;
      blocks.push({ start: data[at] | (data[at + 1] << 8), end: data[at + 2] | (data[at + 3] << 8) });
    }
    let offset = 18 + nb * 4;
    let skipped = 0;
    for (const b of blocks) {
      for (let code = b.start; code <= b.end; code++, offset += glyphSize) {
        if (offset + glyphSize > data.length) break;
        const cp = sjisToUnicode(code);
        if (cp === null) {
          skipped++;
          continue;
        }
        addGlyph(cp, offset);
      }
    }
    if (skipped > 0) {
      issues.push({ level: 'warning', code: 'FONTX2_UNMAPPED_CODES', params: { count: skipped } });
    }
  } else {
    throw new FormatError('UNSUPPORTED_FEATURE', `FONTX2 code type ${codeType}`, { codeType });
  }

  return createFont({
    familyName: opts.familyName ?? name,
    styleName: opts.styleName ?? 'Regular',
    ascent,
    descent,
    lineHeight: height,
    glyphs,
    meta: {
      sourceFormat: 'fontx2',
      drawProfile: 'gfx',
      fallback: { advance: width, width, xOffset: 0 },
      issues,
      format: { fontx2: { name, width, height, codeType } },
    },
  });
}

/**
 * グリフを固定セルへ配置し直す（セル外にインクがあれば null）。
 * @param {Glyph} g
 * @param {number} cellW
 * @param {number} cellH
 * @param {number} ascent
 * @returns {Uint8Array | null} セルの行データ（stride * cellH）
 */
function rasterizeCell(g, cellW, cellH, ascent) {
  const stride = (cellW + 7) >> 3;
  const cell = createBitmap(cellW, cellH, 1);
  const left = g.xOffset;
  const top = ascent + g.yOffset;
  for (let y = 0; y < g.bitmap.height; y++) {
    for (let x = 0; x < g.bitmap.width; x++) {
      if (!getPixel(g.bitmap, x, y)) continue;
      const cx = left + x;
      const cy = top + y;
      if (cx < 0 || cy < 0 || cx >= cellW || cy >= cellH) return null;
      setPixel(cell, cx, cy, 1);
    }
  }
  void stride;
  return cell.data;
}

/**
 * FONTX2 へエンコードできるか（仕様 §7.1）。
 * @param {Font} font
 * @param {{type?: 'ank' | 'kanji'}} [opts]
 * @returns {{ok: boolean, issues: import('./registry.js').EncodeIssue[], type: 'ank' | 'kanji'}}
 */
export function canEncodeFontx2(font, opts = {}) {
  /** @type {import('./registry.js').EncodeIssue[]} */
  const issues = [];
  const cellW = Math.max(1, ...[...font.glyphs.values()].map((g) => g.xAdvance));
  const cellH = font.ascent + font.descent;

  let allAnk = true;
  for (const g of font.glyphs.values()) {
    /** @param {string} code @param {object} params */
    const err = (code, params) => issues.push({ level: 'error', code, codepoint: g.codepoint, params });
    if (g.bitmap.bpp !== 1) err('BPP_UNSUPPORTED', { bpp: g.bitmap.bpp });
    const sjis = g.codepoint < 0x20 ? g.codepoint : unicodeToSjis(g.codepoint);
    if (sjis === null) {
      err('CODEPOINT_UNMAPPABLE', { value: g.codepoint });
      continue;
    }
    if (sjis > 0xff) allAnk = false;
    if (g.xAdvance !== cellW) {
      // FONTX2 は固定ピッチのみ
      err('NOT_FIXED_PITCH', { advance: g.xAdvance, cell: cellW });
    } else if (rasterizeCell(g, cellW, cellH, font.ascent) === null) {
      err('GLYPH_OUT_OF_CELL', { cellW, cellH });
    }
  }
  if (font.glyphs.size === 0) issues.push({ level: 'error', code: 'EMPTY_FONT' });
  if (cellW > 255 || cellH > 255) {
    issues.push({ level: 'error', code: 'GLYPH_TOO_LARGE', params: { width: cellW, height: cellH, max: 255 } });
  }
  const type = opts.type ?? (allAnk ? 'ank' : 'kanji');
  return { ok: !issues.some((i) => i.level === 'error'), issues, type };
}

/**
 * 中立モデル → FONTX2 バイナリ。
 * ANK（1 バイト系）か漢字（Shift-JIS 2 バイト系）かは収録内容から自動判定
 * （opts.type で強制可）。漢字型でブロックが 255 を超える場合は、隙間の
 * 小さい順に空グリフで埋めて統合する。
 * @param {Font} font
 * @param {{dropInvalid?: boolean, type?: 'ank' | 'kanji', name?: string}} [opts]
 * @returns {Uint8Array}
 */
export function encodeFontx2(font, opts = {}) {
  const check = canEncodeFontx2(font, opts);
  const badCps = new Set(
    check.issues.filter((i) => i.level === 'error' && i.codepoint !== undefined).map((i) => i.codepoint),
  );
  if (!check.ok) {
    const fontLevel = check.issues.some((i) => i.level === 'error' && i.codepoint === undefined);
    if (!opts.dropInvalid || fontLevel) {
      throw new EncodeConstraintError('font does not fit the FONTX2 format', check.issues);
    }
  }
  const type = opts.type ?? check.type;
  const cellW = Math.max(1, ...[...font.glyphs.values()].map((g) => g.xAdvance));
  const cellH = font.ascent + font.descent;
  const stride = (cellW + 7) >> 3;
  const glyphSize = stride * cellH;

  /** @type {Map<number, Glyph>} sjis コード → グリフ */
  const byCode = new Map();
  for (const g of font.glyphs.values()) {
    if (badCps.has(g.codepoint)) continue;
    const sjis = g.codepoint < 0x20 ? g.codepoint : unicodeToSjis(g.codepoint);
    if (sjis === null) continue;
    if (type === 'ank' && sjis > 0xff) continue;
    if (type === 'kanji' && sjis <= 0xff) continue; // 1 バイト系は ANK ファイルの領分
    byCode.set(sjis, g);
  }

  /** @type {number[]} */
  const out = [];
  for (const ch of SIGNATURE) out.push(ch.charCodeAt(0));
  const name = (opts.name ?? font.familyName ?? '').slice(0, 8).padEnd(8, ' ');
  for (const ch of name) out.push(ch.charCodeAt(0) & 0x7f);
  out.push(cellW, cellH, type === 'ank' ? 0 : 1);

  /** @param {Glyph | undefined} g */
  const pushGlyph = (g) => {
    const cell = g ? rasterizeCell(g, cellW, cellH, font.ascent) : null;
    if (cell) for (const b of cell) out.push(b);
    else for (let i = 0; i < glyphSize; i++) out.push(0);
  };

  if (type === 'ank') {
    for (let code = 0; code < 256; code++) pushGlyph(byCode.get(code));
    return Uint8Array.from(out);
  }

  // 漢字: コード順にブロック化し、255 個を超えるなら隙間の小さい順に統合
  const codes = [...byCode.keys()].sort((a, b) => a - b);
  if (codes.length === 0) {
    throw new EncodeConstraintError('no double-byte glyphs to encode', [
      { level: 'error', code: 'EMPTY_FONT' },
    ]);
  }
  /** @type {{start: number, end: number}[]} */
  let blocks = [];
  for (const code of codes) {
    const last = blocks[blocks.length - 1];
    if (last && code === last.end + 1) last.end = code;
    else blocks.push({ start: code, end: code });
  }
  while (blocks.length > 255) {
    let bestIdx = 0;
    let bestGap = Infinity;
    for (let i = 0; i + 1 < blocks.length; i++) {
      const gap = blocks[i + 1].start - blocks[i].end - 1;
      if (gap < bestGap) {
        bestGap = gap;
        bestIdx = i;
      }
    }
    blocks[bestIdx].end = blocks[bestIdx + 1].end;
    blocks.splice(bestIdx + 1, 1);
  }

  out.push(blocks.length);
  for (const b of blocks) {
    out.push(b.start & 0xff, (b.start >> 8) & 0xff, b.end & 0xff, (b.end >> 8) & 0xff);
  }
  for (const b of blocks) {
    for (let code = b.start; code <= b.end; code++) pushGlyph(byCode.get(code));
  }
  return Uint8Array.from(out);
}

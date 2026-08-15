// @ts-check
/**
 * u8g2 フォント形式のデコーダ。
 *
 * 参照実装: LovyanGFX v1.2.26 lgfx_fonts.cpp の U8g2font（u8g2 本家 bdfconv の出力形式）。
 * ヘッダ 23 バイト + ASCII 区間（1 バイト encoding + 1 バイト size の連結リスト）
 * + Unicode 区間（ジャンプ表 + 2 バイト encoding + 1 バイト size）。
 * グリフ本体は可変ビット幅フィールド（LSB first）+ 0/1 ランレングス。
 */
import { BitReaderLsb, BitWriterLsb } from '../util/bits.js';
import { TruncatedDataError, FormatError, EncodeConstraintError } from '../util/errors.js';
import { createBitmap, setPixel, getPixel } from '../model/bitmap.js';
import { createFont } from '../model/font.js';

/** @typedef {import('../model/font.js').Font} Font */
/** @typedef {import('../model/font.js').Glyph} Glyph */

const HEADER_SIZE = 23;

/**
 * @param {Uint8Array} data
 * @returns {{
 *   glyphCnt: number, bbxMode: number, bitsPer0: number, bitsPer1: number,
 *   bitsPerCharWidth: number, bitsPerCharHeight: number, bitsPerCharX: number,
 *   bitsPerCharY: number, bitsPerDeltaX: number,
 *   maxCharWidth: number, maxCharHeight: number, xOffset: number, yOffset: number,
 *   ascentA: number, descentG: number, ascentPara: number, descentPara: number,
 *   startPosUpperA: number, startPosLowerA: number, startPosUnicode: number,
 * }}
 */
export function readU8g2Header(data) {
  if (data.length < HEADER_SIZE) {
    throw new TruncatedDataError('u8g2 header needs 23 bytes', { length: data.length });
  }
  const i8 = (/** @type {number} */ v) => (v >= 0x80 ? v - 0x100 : v);
  return {
    glyphCnt: data[0],
    bbxMode: data[1],
    bitsPer0: data[2],
    bitsPer1: data[3],
    bitsPerCharWidth: data[4],
    bitsPerCharHeight: data[5],
    bitsPerCharX: data[6],
    bitsPerCharY: data[7],
    bitsPerDeltaX: data[8],
    maxCharWidth: i8(data[9]),
    maxCharHeight: i8(data[10]),
    xOffset: i8(data[11]),
    yOffset: i8(data[12]),
    ascentA: i8(data[13]),
    descentG: i8(data[14]),
    ascentPara: i8(data[15]),
    descentPara: i8(data[16]),
    startPosUpperA: (data[17] << 8) | data[18],
    startPosLowerA: (data[19] << 8) | data[20],
    startPosUnicode: (data[21] << 8) | data[22],
  };
}

/**
 * グリフ 1 個をビット列からデコードする。
 * @param {Uint8Array} data
 * @param {number} offset - グリフのビットフィールド先頭（encoding/size の後）
 * @param {ReturnType<typeof readU8g2Header>} h
 * @param {number} codepoint
 * @returns {Glyph}
 */
function decodeGlyphBits(data, offset, h, codepoint) {
  const r = new BitReaderLsb(data, offset);
  const w = r.readUnsigned(h.bitsPerCharWidth);
  const height = r.readUnsigned(h.bitsPerCharHeight);
  const gx = r.readSigned(h.bitsPerCharX);
  const gy = r.readSigned(h.bitsPerCharY);
  const dx = r.readSigned(h.bitsPerDeltaX);

  const bitmap = createBitmap(w, height, 1);
  const total = w * height;
  let p = 0;
  while (p < total) {
    const zeros = r.readUnsigned(h.bitsPer0);
    const ones = r.readUnsigned(h.bitsPer1);
    do {
      p += zeros;
      for (let k = 0; k < ones && p < total; k++, p++) {
        setPixel(bitmap, p % w, (p / w) | 0, 1);
      }
      if (p >= total) break;
    } while (r.readUnsigned(1) === 1);
  }

  const yOffset = gy + height === 0 ? 0 : -(gy + height); // -0 を作らない
  return {
    codepoint,
    xOffset: gx,
    yOffset,
    xAdvance: dx,
    bitmap,
  };
}

/**
 * u8g2 フォントバイナリを中立モデルへデコードする。
 * @param {Uint8Array} data
 * @param {{familyName?: string, styleName?: string}} [opts]
 * @returns {Font}
 */
export function decodeU8g2(data, opts = {}) {
  const h = readU8g2Header(data);
  /** @type {import('../model/font.js').FontIssue[]} */
  const issues = [];
  /** @type {Map<number, Glyph>} */
  const glyphs = new Map();

  // ASCII 区間（encoding <= 255）: [enc(1)][size(1)][bits...] の連結。size 0 で終端。
  let pos = HEADER_SIZE;
  while (pos + 1 < data.length && data[pos + 1] !== 0) {
    const enc = data[pos];
    const size = data[pos + 1];
    glyphs.set(enc, decodeGlyphBits(data, pos + 2, h, enc));
    pos += size;
  }

  // Unicode 区間: ジャンプ表（[offsetBE(2)][endEncodingBE(2)] の列）の後に
  // [encBE(2)][size(1)][bits...] の連結。encoding 0 で終端。
  if (h.startPosUnicode !== 0) {
    const base = HEADER_SIZE + h.startPosUnicode;
    if (base + 2 <= data.length) {
      const firstOff = (data[base] << 8) | data[base + 1];
      let gpos = base + firstOff;
      while (gpos + 2 < data.length) {
        const enc = (data[gpos] << 8) | data[gpos + 1];
        if (enc === 0) break;
        const size = data[gpos + 2];
        if (size === 0) {
          issues.push({ level: 'warning', code: 'U8G2_BAD_GLYPH_SIZE', codepoint: enc });
          break;
        }
        glyphs.set(enc, decodeGlyphBits(data, gpos + 3, h, enc));
        gpos += size;
      }
    } else {
      throw new FormatError('TRUNCATED', 'u8g2 unicode section out of range', { base });
    }
  }

  // LGFX U8g2font::getDefaultMetric と同じ:
  // height = max_char_height, baseline = height + y_offset（y_offset は負）
  const height = h.maxCharHeight;
  const baseline = height + h.yOffset;

  return createFont({
    familyName: opts.familyName ?? '',
    styleName: opts.styleName ?? 'Regular',
    ascent: baseline,
    descent: height - baseline,
    lineHeight: height,
    glyphs,
    meta: {
      sourceFormat: 'u8g2',
      drawProfile: 'u8g2',
      fallback: { advance: h.maxCharWidth, width: h.maxCharWidth, xOffset: 0 },
      issues,
      format: { u8g2: h },
    },
  });
}

//----------------------------------------------------------------------------
// エンコーダ（仕様 §7）。
//
// LGFXScreenBuilder fontgen の u8g2enc.js（LovyanGFX のデコーダを正とする
// 実績実装）を本ライブラリの中立モデルと EncodeIssue の流儀へ移植したもの。
//
// フィールド幅の上限は LovyanGFX のデコーダが決める:
//   get_unsigned_bits は 8bit まで正確、get_signed_bits は int_fast8_t を
//   経由するため 7bit（-64〜63）で頭打ち。
// さらにヘッダの max_char_width / max_char_height は int8 で読まれるため
// 127 が別の上限になり、グリフ 1 エントリは 1 バイトのジャンプ値で辿るため
// 255 バイトを超えると参照できない。

const MAX_UNSIGNED_BITS = 8;
const MAX_SIGNED_BITS = 7;

/** @param {number} cnt */
const bias = (cnt) => 1 << (cnt - 1);

/** 0..max を格納できる符号なしビット数 @param {number} max */
function unsignedBits(max) {
  let n = 1;
  while (max >= 1 << n) n++;
  return n;
}

/** [min..max] を格納できるバイアス付き符号ありビット数 @param {number} min @param {number} max */
function signedBits(min, max) {
  let n = 1;
  while (min < -bias(n) || max > bias(n) - 1) n++;
  return n;
}

/**
 * 行優先ピクセル列 → [ゼロ連長, イチ連長, ...]（必ずゼロ連長から始まる）。
 * @param {import('../model/bitmap.js').Bitmap} bmp
 */
function runsOf(bmp) {
  const runs = [];
  let want = 0;
  let n = 0;
  for (let y = 0; y < bmp.height; y++) {
    for (let x = 0; x < bmp.width; x++) {
      const b = getPixel(bmp, x, y);
      if (b === want) {
        n++;
        continue;
      }
      runs.push(n);
      want ^= 1;
      n = 1;
    }
  }
  runs.push(n);
  if (runs.length & 1) runs.push(0); // (ゼロ, イチ) の完全な組で終える
  return runs;
}

/**
 * 連長列を、選んだフィールド幅に収まる (ゼロ, イチ) の組に分割する。
 * @param {number[]} runs @param {number} b0 @param {number} b1
 */
function pairsFor(runs, b0, b1) {
  const m0 = (1 << b0) - 1;
  const m1 = (1 << b1) - 1;
  /** @type {[number, number][]} */
  const pairs = [];
  for (let i = 0; i < runs.length; i += 2) {
    let z = runs[i];
    let o = runs[i + 1];
    while (z > m0) {
      pairs.push([m0, 0]);
      z -= m0;
    }
    while (o > m1) {
      pairs.push([z, m1]);
      z = 0;
      o -= m1;
    }
    pairs.push([z, o]);
  }
  return pairs;
}

/**
 * 組列のビット数（隣接する同一の組は繰り返しビットへ畳む）。
 * @param {[number, number][]} pairs @param {number} b0 @param {number} b1
 */
function pairBits(pairs, b0, b1) {
  let bits = 0;
  for (let i = 0; i < pairs.length; ) {
    let j = i;
    while (j + 1 < pairs.length && pairs[j + 1][0] === pairs[i][0] && pairs[j + 1][1] === pairs[i][1]) j++;
    bits += b0 + b1 + (j - i) + 1;
    i = j + 1;
  }
  return bits;
}

/**
 * @param {BitWriterLsb} bw @param {[number, number][]} pairs @param {number} b0 @param {number} b1
 */
function writePairs(bw, pairs, b0, b1) {
  for (let i = 0; i < pairs.length; ) {
    let j = i;
    while (j + 1 < pairs.length && pairs[j + 1][0] === pairs[i][0] && pairs[j + 1][1] === pairs[i][1]) j++;
    bw.writeUnsigned(pairs[i][0], b0);
    bw.writeUnsigned(pairs[i][1], b1);
    for (let k = i; k < j; k++) bw.writeUnsigned(1, 1);
    bw.writeUnsigned(0, 1);
    i = j + 1;
  }
}

/** エントリ総バイト数 = ペイロード + ジャンプ値が跨ぐヘッダ（2 or 3 バイト）
 * @param {number} code @param {number} payloadBits */
const entryBytes = (code, payloadBits) => Math.ceil(payloadBits / 8) + (code <= 255 ? 2 : 3);

/**
 * (bits_per_0, bits_per_1) の選択。
 * 目的関数は辞書式: まず 255 バイト超で落ちるグリフ数が最少、次に総ビット数が最小。
 * サイズだけを最適化すると、密度の高いグリフ（＝常用漢字）が落ちる側に倒れるため。
 * @param {number[][]} runsPerGlyph
 * @param {{code: number, w: number, h: number}[]} recs
 * @param {number} fixedBitsPerGlyph
 */
function chooseRunBits(runsPerGlyph, recs, fixedBitsPerGlyph) {
  let best = null;
  for (let b0 = 1; b0 <= MAX_UNSIGNED_BITS; b0++) {
    for (let b1 = 1; b1 <= MAX_UNSIGNED_BITS; b1++) {
      let total = 0;
      let lost = 0;
      for (let i = 0; i < runsPerGlyph.length; i++) {
        const g = recs[i];
        const bits = g.w && g.h ? pairBits(pairsFor(runsPerGlyph[i], b0, b1), b0, b1) : 0;
        total += bits;
        if (entryBytes(g.code, fixedBitsPerGlyph + bits) > 255) lost++;
      }
      if (!best || lost < best.lost || (lost === best.lost && total < best.total)) {
        best = { b0, b1, total, lost };
      }
    }
  }
  return /** @type {{b0: number, b1: number, total: number, lost: number}} */ (best);
}

/**
 * 中立モデル → u8g2 のグリフレコードと、静的な制約違反の一覧。
 * @param {Font} font
 */
function planU8g2(font) {
  /** @type {import('./registry.js').EncodeIssue[]} */
  const issues = [];
  /** @type {{code: number, w: number, h: number, x: number, y: number, dx: number,
   *          bitmap: import('../model/bitmap.js').Bitmap}[]} */
  const recs = [];

  const signedMin = -bias(MAX_SIGNED_BITS);
  const signedMax = bias(MAX_SIGNED_BITS) - 1;

  for (const g of [...font.glyphs.values()].sort((a, b) => a.codepoint - b.codepoint)) {
    const w = g.bitmap.width;
    const h = g.bitmap.height;
    const x = g.xOffset;
    const y = -(g.yOffset + h); // BDF 流: ベースラインからビットマップ下端まで
    const dx = g.xAdvance;
    let bad = false;
    /** @param {string} code @param {object} params */
    const err = (code, params) => {
      issues.push({ level: 'error', code, codepoint: g.codepoint, params });
      bad = true;
    };
    // encoding 0x00〜0x1F も形式上は合法（終端はジャンプ値 0 であり encoding 0 ではない）。
    // 実際、LovyanGFX 内蔵の efont 系は encoding 0 のグリフを持っている。
    if (g.bitmap.bpp !== 1) err('BPP_UNSUPPORTED', { bpp: g.bitmap.bpp });
    if (g.codepoint > 0xffff) err('CODEPOINT_OVER_BMP', { value: g.codepoint });
    if (w > (1 << MAX_UNSIGNED_BITS) - 1 || h > (1 << MAX_UNSIGNED_BITS) - 1) {
      err('GLYPH_TOO_LARGE', { width: w, height: h, max: (1 << MAX_UNSIGNED_BITS) - 1 });
    }
    if (x < signedMin || x > signedMax || y < signedMin || y > signedMax) {
      err('BEARING_RANGE', { x, y, min: signedMin, max: signedMax });
    }
    if (dx < signedMin || dx > signedMax) {
      err('XADVANCE_RANGE', { value: dx, min: signedMin, max: signedMax });
    }
    if (!bad) recs.push({ code: g.codepoint, w, h, x, y, dx, bitmap: g.bitmap });
  }

  const height = font.ascent + font.descent;
  if (height > 127) {
    issues.push({ level: 'error', code: 'LINE_BOX_TOO_TALL', params: { value: height, max: 127 } });
  }
  const maxW = Math.max(1, ...recs.map((g) => g.w));
  if (maxW > 127) {
    issues.push({ level: 'error', code: 'MAX_WIDTH_TOO_LARGE', params: { value: maxW, max: 127 } });
  }
  if (recs.length === 0) {
    issues.push({ level: 'error', code: 'EMPTY_FONT' });
    return { issues, recs, height, maxW, bits: null, runsPerGlyph: [], entrySizes: [] };
  }
  if (font.lineHeight !== height) {
    issues.push({
      level: 'warning',
      code: 'LINE_HEIGHT_COLLAPSED',
      params: { lineHeight: font.lineHeight, boxHeight: height },
    });
  }

  const bpw = unsignedBits(Math.max(1, ...recs.map((g) => g.w)));
  const bph = unsignedBits(Math.max(1, ...recs.map((g) => g.h)));
  const bpx = signedBits(Math.min(0, ...recs.map((g) => g.x)), Math.max(0, ...recs.map((g) => g.x)));
  const bpy = signedBits(Math.min(0, ...recs.map((g) => g.y)), Math.max(0, ...recs.map((g) => g.y)));
  const bpd = signedBits(Math.min(0, ...recs.map((g) => g.dx)), Math.max(0, ...recs.map((g) => g.dx)));
  const fixedBits = bpw + bph + bpx + bpy + bpd;

  const runsPerGlyph = recs.map((g) => runsOf(g.bitmap));
  const { b0, b1 } = chooseRunBits(runsPerGlyph, recs, fixedBits);

  // 255 バイト超のエントリはジャンプ値で参照できない
  const entrySizes = recs.map((g, i) => {
    const bits = g.w && g.h ? pairBits(pairsFor(runsPerGlyph[i], b0, b1), b0, b1) : 0;
    return entryBytes(g.code, fixedBits + bits);
  });
  recs.forEach((g, i) => {
    if (entrySizes[i] > 255) {
      issues.push({
        level: 'error',
        code: 'GLYPH_BYTES_OVER',
        codepoint: g.code,
        params: { bytes: entrySizes[i], max: 255 },
      });
    }
  });

  return {
    issues,
    recs,
    height,
    maxW,
    runsPerGlyph,
    entrySizes,
    bits: { b0, b1, bpw, bph, bpx, bpy, bpd },
  };
}

/**
 * u8g2 へエンコードできるか（仕様 §7.1）。
 * @param {Font} font
 * @returns {{ok: boolean, issues: import('./registry.js').EncodeIssue[]}}
 */
export function canEncodeU8g2(font) {
  const plan = planU8g2(font);
  return { ok: !plan.issues.some((i) => i.level === 'error'), issues: plan.issues };
}

/**
 * 中立モデル → u8g2 フォントバイナリ。
 * 制約違反があれば EncodeConstraintError（切り詰めない。仕様 §7.2）。
 * dropInvalid: true なら違反グリフを落として続行する（フォント全体の制約は除く）。
 * @param {Font} font
 * @param {{dropInvalid?: boolean}} [opts]
 * @returns {Uint8Array}
 */
export function encodeU8g2(font, opts = {}) {
  const plan = planU8g2(font);
  const errors = plan.issues.filter((i) => i.level === 'error');
  if (errors.length > 0) {
    const fontLevel = errors.filter((i) => i.codepoint === undefined);
    if (!opts.dropInvalid || fontLevel.length > 0) {
      throw new EncodeConstraintError('font does not fit the u8g2 format', plan.issues);
    }
  }
  const bits = plan.bits;
  if (!bits) throw new EncodeConstraintError('empty font', plan.issues);
  const { b0, b1, bpw, bph, bpx, bpy, bpd } = bits;

  const descent = font.descent;
  const ascent = plan.height - descent;

  /** @type {{code: number, payload: Uint8Array, entry: number}[]} */
  const encoded = [];
  plan.recs.forEach((g, i) => {
    if (plan.entrySizes[i] > 255) return; // dropInvalid でのみ到達する
    const bw = new BitWriterLsb();
    bw.writeUnsigned(g.w, bpw);
    bw.writeUnsigned(g.h, bph);
    bw.writeSigned(g.x, bpx);
    bw.writeSigned(g.y, bpy);
    bw.writeSigned(g.dx, bpd);
    if (g.w && g.h) writePairs(bw, pairsFor(plan.runsPerGlyph[i], b0, b1), b0, b1);
    const payload = bw.toUint8Array();
    encoded.push({ code: g.code, payload, entry: entryBytes(g.code, payload.length * 8) });
  });

  const lo = encoded.filter((g) => g.code <= 255);
  const hi = encoded.filter((g) => g.code > 255);

  // --- セクション A: encoding 0x20..0xFF（ジャンプ値 0 で終端） ---
  /** @type {number[]} */
  const secA = [];
  let posUpperA = 0;
  let posLowerA = 0;
  for (const g of lo) {
    if (!posUpperA && g.code >= 0x41) posUpperA = secA.length;
    if (!posLowerA && g.code >= 0x61) posLowerA = secA.length;
    secA.push(g.code, g.entry, ...g.payload);
  }
  secA.push(0, 0);

  // --- セクション U: ジャンプ表 + encoding > 0xFF（encoding 0 で終端） ---
  const BLOCK = 64;
  /** @type {{code: number, payload: Uint8Array, entry: number}[][]} */
  const blocks = [];
  for (let i = 0; i < hi.length; i += BLOCK) blocks.push(hi.slice(i, i + BLOCK));
  if (blocks.length === 0) blocks.push([]);

  /** @param {number} v */
  const u16be = (v) => [(v >> 8) & 0xff, v & 0xff];
  const blockBytes = (/** @type {typeof blocks[0]} */ blk) => blk.reduce((a, g) => a + g.entry, 0);
  const lutBytes = 4 * blocks.length;
  /** @type {number[]} */
  const lut = [];
  /** @type {number[]} */
  const body = [];
  blocks.forEach((blk, i) => {
    lut.push(...u16be(i === 0 ? lutBytes : blockBytes(blocks[i - 1])));
    const last = i === blocks.length - 1;
    lut.push(...u16be(last ? 0xffff : blk[blk.length - 1].code));
    for (const g of blk) body.push(...u16be(g.code), g.entry, ...g.payload);
  });
  body.push(0, 0);

  const posUnicode = secA.length;

  const header = [
    Math.min(255, encoded.length), // glyph_cnt（参考値。u8 で飽和）
    0, // bbx_mode（LovyanGFX は未使用）
    b0,
    b1,
    bpw,
    bph,
    bpx,
    bpy,
    bpd,
    plan.maxW & 0xff,
    plan.height & 0xff, // max_char_height == 行ボックス高さ
    0, // x_offset
    -descent & 0xff, // y_offset: baseline = height + y_offset
    ascent & 0xff,
    -descent & 0xff,
    ascent & 0xff,
    -descent & 0xff,
    ...u16be(posUpperA),
    ...u16be(posLowerA),
    ...u16be(posUnicode),
  ];

  return Uint8Array.from([...header, ...secA, ...lut, ...body]);
}

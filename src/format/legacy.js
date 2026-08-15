// @ts-check
/**
 * LovyanGFX 内部形式（GLCD / FixedBMP / BMP / RLE）の共通部品。
 *
 * - cp437 再配置: GLCDfont / FixedBMPfont の drawChar は cp437 スタイルが無効
 *   （LovyanGFX の既定）のとき、コードポイント 176 以上を 1 つ後ろのグリフへ
 *   ずらして参照する（Adafruit GFX 由来の 'classic' 挙動）。デコード時にこの
 *   対応をコードポイント→グリフ索引に焼き込む。
 * - 可変幅の旧形式（BMP / RLE）はグリフごとのポインタ表で配布されており
 *   ファイル形式を持たないため、保存用コンテナを定義する:
 *
 *   magic   "LBMP" または "LRLE"
 *   u8      height
 *   u8      baseline
 *   u8      glyphCount           (0x20 起点。Font2/4/6/7/8 は 96)
 *   u8  × glyphCount   widths
 *   u32le × glyphCount  offsets  (blob 先頭からのオフセット)
 *   u32le   blobLength
 *   bytes   blob
 */
import { ByteReader, ByteWriter } from '../util/bytes.js';
import { FormatError } from '../util/errors.js';

/**
 * cp437 無効時のグリフ索引（LGFX の `if (!style->cp437 && (c >= 176)) c++;` 相当）。
 * @param {number} codepoint
 * @param {number} start
 * @param {boolean} cp437
 * @returns {number} グリフ索引
 */
export function legacyGlyphIndex(codepoint, start, cp437) {
  let c = codepoint;
  if (!cp437 && c >= 176) c++;
  return c - start;
}

/**
 * @typedef {object} LegacyVarData
 * @property {number} height
 * @property {number} baseline
 * @property {number[]} widths
 * @property {Uint8Array[]} glyphData - グリフごとのバイト列
 */

/**
 * @param {'LBMP'|'LRLE'} magic
 * @param {LegacyVarData} data
 * @returns {Uint8Array}
 */
export function packLegacyContainer(magic, data) {
  const w = new ByteWriter();
  for (const ch of magic) w.u8(ch.charCodeAt(0));
  w.u8(data.height).u8(data.baseline).u8(data.widths.length);
  for (const width of data.widths) w.u8(width);
  let offset = 0;
  for (const g of data.glyphData) {
    w.u32le(offset);
    offset += g.length;
  }
  w.u32le(offset);
  for (const g of data.glyphData) w.bytes(g);
  return w.toUint8Array();
}

/**
 * @param {'LBMP'|'LRLE'} magic
 * @param {Uint8Array} bytes
 * @returns {LegacyVarData}
 */
export function unpackLegacyContainer(magic, bytes) {
  const r = new ByteReader(bytes);
  for (const ch of magic) {
    if (r.u8() !== ch.charCodeAt(0)) {
      throw new FormatError('DETECT_FAILED', `not a ${magic} container`);
    }
  }
  const height = r.u8();
  const baseline = r.u8();
  const count = r.u8();
  const widths = [];
  for (let i = 0; i < count; i++) widths.push(r.u8());
  const offsets = [];
  for (let i = 0; i < count; i++) offsets.push(r.u32le());
  const blobLength = r.u32le();
  const blob = r.bytes(blobLength);
  /** @type {Uint8Array[]} */
  const glyphData = [];
  for (let i = 0; i < count; i++) {
    const end = i + 1 < count ? offsets[i + 1] : blobLength;
    glyphData.push(new Uint8Array(blob.subarray(offsets[i], end)));
  }
  return { height, baseline, widths, glyphData };
}

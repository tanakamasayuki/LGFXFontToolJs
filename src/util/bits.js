// @ts-check
/**
 * u8g2 形式が使う LSB first のビットリーダ / ライタ。
 * u8g2 の decode（u8g2_font_decode_t）と同じ規則: 各バイトの下位ビットから読む。
 */

export class BitReaderLsb {
  /**
   * @param {Uint8Array} data
   * @param {number} [byteOffset]
   */
  constructor(data, byteOffset = 0) {
    this.data = data;
    this.bytePos = byteOffset;
    this.bitPos = 0;
  }

  /**
   * 符号なしで cnt ビット読む（cnt は 1〜8）。
   * @param {number} cnt
   * @returns {number}
   */
  readUnsigned(cnt) {
    const d = this.data;
    let val = (d[this.bytePos] ?? 0) >> this.bitPos;
    let next = this.bitPos + cnt;
    if (next >= 8) {
      next -= 8;
      this.bytePos++;
      val |= (d[this.bytePos] ?? 0) << (8 - this.bitPos);
    }
    this.bitPos = next;
    return val & ((1 << cnt) - 1);
  }

  /**
   * u8g2 の get_signed_bits と同じ: unsigned - (1 << (cnt-1))
   * @param {number} cnt
   * @returns {number}
   */
  readSigned(cnt) {
    return this.readUnsigned(cnt) - (1 << (cnt - 1));
  }
}

export class BitWriterLsb {
  constructor() {
    /** @type {number[]} */
    this.bytes = [];
    this.bitPos = 0;
  }

  /**
   * @param {number} value
   * @param {number} cnt
   */
  writeUnsigned(value, cnt) {
    value &= (1 << cnt) - 1;
    if (this.bitPos === 0) this.bytes.push(0);
    const idx = this.bytes.length - 1;
    this.bytes[idx] |= (value << this.bitPos) & 0xff;
    const next = this.bitPos + cnt;
    if (next >= 8) {
      const written = 8 - this.bitPos;
      const rest = value >> written;
      if (next > 8) {
        this.bytes.push(rest & 0xff);
      }
      this.bitPos = next - 8;
      if (next === 8) this.bitPos = 0;
      if (next > 8 && this.bitPos === 0) {
        // rest がちょうど収まった
      }
    } else {
      this.bitPos = next;
    }
  }

  /**
   * @param {number} value
   * @param {number} cnt
   */
  writeSigned(value, cnt) {
    this.writeUnsigned(value + (1 << (cnt - 1)), cnt);
  }

  /** @returns {Uint8Array} */
  toUint8Array() {
    return Uint8Array.from(this.bytes);
  }
}

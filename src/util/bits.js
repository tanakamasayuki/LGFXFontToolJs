// @ts-check
/**
 * LSB-first bit reader/writer used by u8g2.
 * Matches u8g2_font_decode_t by reading each byte from its least-significant bit.
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
   * Reads cnt unsigned bits (cnt is 1..8).
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
   * Matches u8g2 get_signed_bits: unsigned - (1 << (cnt-1)).
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
    this.cur = 0;
    this.nbits = 0;
  }

  /**
   * @param {number} value
   * @param {number} cnt
   */
  writeUnsigned(value, cnt) {
    for (let i = 0; i < cnt; i++) {
      if ((value >> i) & 1) this.cur |= 1 << this.nbits;
      if (++this.nbits === 8) {
        this.bytes.push(this.cur);
        this.cur = 0;
        this.nbits = 0;
      }
    }
  }

  /**
   * Writes a biased signed value decoded as unsigned - (1 << (cnt-1)).
   * @param {number} value
   * @param {number} cnt
   */
  writeSigned(value, cnt) {
    this.writeUnsigned(value + (1 << (cnt - 1)), cnt);
  }

  /** Returns current contents non-destructively, padding partial bits with zero. @returns {Uint8Array} */
  toUint8Array() {
    const out = [...this.bytes];
    if (this.nbits) out.push(this.cur);
    return Uint8Array.from(out);
  }
}

// @ts-check
/**
 * バイト列の読み書きヘルパ。境界を超えた読み出しは TruncatedDataError を投げる。
 */
import { TruncatedDataError } from './errors.js';

export class ByteReader {
  /**
   * @param {Uint8Array} data
   * @param {number} [offset]
   */
  constructor(data, offset = 0) {
    this.data = data;
    this.pos = offset;
  }

  /** @param {number} n */
  ensure(n) {
    if (this.pos + n > this.data.length) {
      throw new TruncatedDataError(`need ${n} bytes at ${this.pos}, have ${this.data.length}`, {
        pos: this.pos,
        need: n,
        length: this.data.length,
      });
    }
  }

  u8() {
    this.ensure(1);
    return this.data[this.pos++];
  }

  i8() {
    const v = this.u8();
    return v >= 0x80 ? v - 0x100 : v;
  }

  u16le() {
    this.ensure(2);
    const v = this.data[this.pos] | (this.data[this.pos + 1] << 8);
    this.pos += 2;
    return v;
  }

  u16be() {
    this.ensure(2);
    const v = (this.data[this.pos] << 8) | this.data[this.pos + 1];
    this.pos += 2;
    return v;
  }

  u32le() {
    this.ensure(4);
    const d = this.data;
    const v = (d[this.pos] | (d[this.pos + 1] << 8) | (d[this.pos + 2] << 16) | (d[this.pos + 3] << 24)) >>> 0;
    this.pos += 4;
    return v;
  }

  u32be() {
    this.ensure(4);
    const d = this.data;
    const v = ((d[this.pos] << 24) | (d[this.pos + 1] << 16) | (d[this.pos + 2] << 8) | d[this.pos + 3]) >>> 0;
    this.pos += 4;
    return v;
  }

  /** @param {number} n */
  bytes(n) {
    this.ensure(n);
    const v = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
}

export class ByteWriter {
  constructor() {
    /** @type {number[]} */
    this.buf = [];
  }

  /** @param {number} v */
  u8(v) {
    this.buf.push(v & 0xff);
    return this;
  }

  /** @param {number} v */
  i8(v) {
    return this.u8(v < 0 ? v + 0x100 : v);
  }

  /** @param {number} v */
  u16le(v) {
    this.buf.push(v & 0xff, (v >> 8) & 0xff);
    return this;
  }

  /** @param {number} v */
  u16be(v) {
    this.buf.push((v >> 8) & 0xff, v & 0xff);
    return this;
  }

  /** @param {number} v */
  u32le(v) {
    this.buf.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }

  /** @param {Uint8Array|number[]} data */
  bytes(data) {
    for (const b of data) this.buf.push(b & 0xff);
    return this;
  }

  get length() {
    return this.buf.length;
  }

  toUint8Array() {
    return Uint8Array.from(this.buf);
  }
}

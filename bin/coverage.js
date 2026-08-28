// @ts-check
/**
 * Which characters a font file actually contains, read from its `cmap` table.
 *
 * Why this exists: the Node rasterizer draws through Skia, whose font registry
 * has no equivalent of a browser FontFace's `unicode-range`. Skia therefore
 * substitutes a system font for a glyph the registered typeface lacks, and the
 * library's presence check — which compares the typeface against the generic
 * families — reads that substitution as "the typeface has this glyph". The
 * result is glyphs silently taken from whatever the host happens to have
 * installed, which is both wrong and not reproducible.
 *
 * The browser path has no such problem (`unicode-range` keeps the registered
 * family out of the way), so this lives in bin/ rather than src/: the library
 * still parses no font tables (spec §2.3).
 *
 * Only `cmap` is read — no outlines, no hinting. Formats 4 and 12 cover every
 * font in practice; format 0 and 6 are handled because they are trivial.
 */

/** Compressed containers cannot be read without undoing their transforms. */
const WOFF = 0x774f4646; // 'wOFF'
const WOFF2 = 0x774f4632; // 'wOF2'

class Reader {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.b = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  /** @param {number} at */
  u8(at) {
    return this.view.getUint8(at);
  }
  /** @param {number} at */
  u16(at) {
    return this.view.getUint16(at);
  }
  /** @param {number} at */
  i16(at) {
    return this.view.getInt16(at);
  }
  /** @param {number} at */
  u32(at) {
    return this.view.getUint32(at);
  }
}

/**
 * Locates the cmap table in an sfnt container.
 * @param {Reader} r
 * @returns {number | null} table offset
 */
function findCmap(r) {
  let base = 0;
  if (r.u32(0) === 0x74746366) base = r.u32(12); // 'ttcf': use the first face
  const numTables = r.u16(base + 4);
  for (let i = 0; i < numTables; i++) {
    const rec = base + 12 + i * 16;
    if (r.u32(rec) === 0x636d6170) return r.u32(rec + 8); // 'cmap'
  }
  return null;
}

/**
 * Picks the best Unicode subtable: prefer a full-repertoire one (3,10 or 0,4+),
 * then the BMP ones.
 * @param {Reader} r
 * @param {number} cmap
 */
function pickSubtable(r, cmap) {
  const n = r.u16(cmap + 2);
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < n; i++) {
    const rec = cmap + 4 + i * 8;
    const platform = r.u16(rec);
    const encoding = r.u16(rec + 2);
    const offset = r.u32(rec + 4);
    let score = -1;
    if (platform === 3 && encoding === 10) score = 4; // Windows, UCS-4
    else if (platform === 0 && encoding >= 4) score = 3; // Unicode, full
    else if (platform === 3 && encoding === 1) score = 2; // Windows, BMP
    else if (platform === 0) score = 1; // Unicode, BMP
    if (score > bestScore) {
      bestScore = score;
      best = cmap + offset;
    }
  }
  return best;
}

/**
 * @param {Reader} r
 * @param {number} at subtable offset
 * @returns {Set<number> | null} null when the format is not understood
 */
function readSubtable(r, at) {
  /** @type {Set<number>} */
  const out = new Set();
  const format = r.u16(at);
  if (format === 0) {
    for (let c = 0; c < 256; c++) if (r.u8(at + 6 + c) !== 0) out.add(c);
    return out;
  }
  if (format === 4) {
    const segX2 = r.u16(at + 6);
    const ends = at + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const rangeOffsets = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = r.u16(ends + s * 2);
      const start = r.u16(starts + s * 2);
      if (start > end) continue;
      const delta = r.i16(deltas + s * 2);
      const rangeOffset = r.u16(rangeOffsets + s * 2);
      for (let c = start; c <= end && c !== 0x10000; c++) {
        let gid;
        if (rangeOffset === 0) {
          gid = (c + delta) & 0xffff;
        } else {
          const gi = rangeOffsets + s * 2 + rangeOffset + (c - start) * 2;
          if (gi + 1 >= r.b.length) continue;
          gid = r.u16(gi);
          if (gid !== 0) gid = (gid + delta) & 0xffff;
        }
        if (gid !== 0) out.add(c);
      }
    }
    return out;
  }
  if (format === 6) {
    const first = r.u16(at + 6);
    const count = r.u16(at + 8);
    for (let i = 0; i < count; i++) if (r.u16(at + 10 + i * 2) !== 0) out.add(first + i);
    return out;
  }
  if (format === 12) {
    const groups = r.u32(at + 12);
    for (let g = 0; g < groups; g++) {
      const rec = at + 16 + g * 12;
      const start = r.u32(rec);
      const end = r.u32(rec + 4);
      const startGid = r.u32(rec + 8);
      if (startGid === 0 && start === 0) continue;
      // A pathological font could claim a huge range; cap the work.
      for (let c = start; c <= end && c - start < 0x110000; c++) out.add(c);
    }
    return out;
  }
  return null;
}

/**
 * Characters the font file contains.
 * @param {Uint8Array} bytes
 * @returns {{codepoints: Set<number>} | {unavailable: string}}
 */
export function fontCoverage(bytes) {
  if (bytes.length < 12) return { unavailable: 'file is too short to be a font' };
  const r = new Reader(bytes);
  const magic = r.u32(0);
  if (magic === WOFF || magic === WOFF2) {
    return {
      unavailable:
        magic === WOFF2
          ? 'WOFF2 is compressed, so its cmap cannot be read here'
          : 'WOFF is compressed, so its cmap cannot be read here',
    };
  }
  const cmap = findCmap(r);
  if (cmap === null) return { unavailable: 'no cmap table' };
  const sub = pickSubtable(r, cmap);
  if (sub === null) return { unavailable: 'no Unicode cmap subtable' };
  try {
    const codepoints = readSubtable(r, sub);
    if (!codepoints || codepoints.size === 0) return { unavailable: 'cmap subtable is empty' };
    return { codepoints };
  } catch {
    return { unavailable: 'cmap table is malformed' };
  }
}

// @ts-check
/**
 * CellFont packing (docs/formats/cellfont.ja.md v1).
 *
 * Turns the neutral model into the structures a renderer consumes. The format
 * itself is compile-time only, so this module stops at the packed layout and
 * csource.js emits the C.
 *
 * The encoder's job is choosing among four candidates (cell / trimmed × single /
 * chained by width class) and taking the smallest whole C object, breaking ties
 * with a fixed lexicographic order. Everything measured here comes from the
 * glyphs, never from the requested repertoire, so adding a character never
 * rescales the ones already present.
 */
import { getPixel } from '../model/bitmap.js';
import { EncodeConstraintError } from '../util/errors.js';

/** @typedef {import('../model/font.js').Font} Font */
/** @typedef {import('../model/font.js').Glyph} Glyph */

/** sizeof(CellFont) by target ABI (spec §3). Part of the encoder input (§10.4). */
export const ABI_HEADER = { ilp32: 28, avr: 20 };

/** @param {number} a @param {number} b */
const ceilDiv = (a, b) => Math.ceil(a / b);

/** A glyph carries ink when both dimensions are non-zero (spec §10.1). */
/** @param {Glyph} g */
const hasInk = (g) => g.bitmap.width > 0 && g.bitmap.height > 0;

/**
 * Shared cell bounds, computed from inked glyphs only. Ink-less glyphs (the
 * space) carry arbitrary offsets that would widen the box for nothing.
 * @param {Glyph[]} glyphs
 */
function bounds(glyphs) {
  const inked = glyphs.filter(hasInk);
  if (inked.length === 0) return null;
  return {
    L: Math.min(...inked.map((g) => g.xOffset)),
    T: Math.min(...inked.map((g) => g.yOffset)),
    B: Math.max(...inked.map((g) => g.yOffset + g.bitmap.height)),
  };
}

/**
 * Renders one glyph into the shared cell: MSB first, rows top to bottom, no row
 * padding, spare bits in the final byte left 0 (spec §5, §10.4).
 * @param {Glyph} g
 * @param {number} width
 * @param {number} height
 * @param {{L: number, T: number}} box
 */
function renderCell(g, width, height, box) {
  const bytes = new Uint8Array(ceilDiv(width * height, 8));
  if (!hasInk(g) || width === 0 || height === 0) return bytes;
  const dx = g.xOffset - box.L;
  const dy = g.yOffset - box.T;
  for (let y = 0; y < g.bitmap.height; y++) {
    const cy = y + dy;
    if (cy < 0 || cy >= height) continue;
    for (let x = 0; x < g.bitmap.width; x++) {
      const cx = x + dx;
      if (cx < 0 || cx >= width) continue;
      if (!getPixel(g.bitmap, x, y)) continue;
      const bit = cy * width + cx;
      bytes[bit >> 3] |= 0x80 >> (bit & 7);
    }
  }
  return bytes;
}

/**
 * Longest consecutive run, capped at 255 (spec §10.3). Length 1 still pays:
 * `first` and `headCount` already exist, so it removes one code table entry.
 * @param {number[]} cps ascending
 */
function headRun(cps) {
  let best = 1;
  let run = 1;
  let bestStart = 0;
  let start = 0;
  for (let i = 1; i < cps.length; i++) {
    if (cps[i] === cps[i - 1] + 1) {
      run++;
    } else {
      run = 1;
      start = i;
    }
    // Ties go to the smaller code point, so only a strictly longer run wins.
    if (run > best) {
      best = run;
      bestStart = start;
    }
  }
  return { length: Math.min(best, 255), start: bestStart };
}

/**
 * Packs one set of glyphs into a single CellFont.
 * @param {Glyph[]} glyphs
 * @param {'cell'|'trim'} policy
 * @param {number} yAdvance
 * @param {number} header sizeof(CellFont)
 */
function packOne(glyphs, policy, yAdvance, header) {
  const sorted = [...glyphs].sort((a, b) => a.codepoint - b.codepoint);
  const box = bounds(sorted);

  // No glyph has ink: the box cannot be derived, so spec §10.1 fixes the values.
  if (!box) {
    return {
      bitmap: new Uint8Array(0),
      records: sorted.map((g) => ({ offset: 0, width: 0, xAdvance: g.xAdvance })),
      codepoints: sorted.map((g) => g.codepoint),
      height: 1,
      xOffset: 0,
      yOffset: 0,
      yAdvance,
      header,
    };
  }

  const height = box.B - box.T;
  /** @type {{offset: number, width: number, xAdvance: number}[]} */
  const records = [];
  /** @type {Uint8Array[]} */
  const chunks = [];
  let offset = 0;
  for (const g of sorted) {
    const ink = hasInk(g) ? g.xOffset - box.L + g.bitmap.width : 0;
    const width = policy === 'cell' ? Math.max(g.xAdvance, ink) : ink;
    const cell = renderCell(g, width, height, box);
    records.push({ offset, width, xAdvance: g.xAdvance });
    chunks.push(cell);
    offset += cell.length;
  }
  const bitmap = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) {
    bitmap.set(c, at);
    at += c.length;
  }
  return {
    bitmap,
    records,
    codepoints: sorted.map((g) => g.codepoint),
    height,
    xOffset: box.L,
    yOffset: box.T,
    yAdvance,
    header,
  };
}

/**
 * Chooses fixed/variable pitch and contiguous/sparse for a packed set, and
 * returns the layout plus its byte cost (spec §9, §10.3).
 * @param {ReturnType<typeof packOne>} p
 */
function finish(p) {
  const n = p.records.length;
  const widths = new Set(p.records.map((r) => r.width));
  const advances = new Set(p.records.map((r) => r.xAdvance));
  const width = p.records.length ? p.records[0].width : 0;
  const bytesPerGlyph = ceilDiv(width * p.height, 8);
  // bytesPerGlyph is 8-bit, so an oversized cell cannot use fixed pitch (§10.3).
  const fixed = widths.size === 1 && advances.size === 1 && bytesPerGlyph <= 255;

  const cps = p.codepoints;
  const span = n ? cps[n - 1] - cps[0] + 1 : 0;
  const contiguous = span === n;

  let first = n ? cps[0] : 0;
  let headCount = 0;
  /** @type {number[]} */
  let codes = [];
  if (!contiguous) {
    const head = headRun(cps);
    headCount = head.length;
    first = cps[head.start];
    const headSet = new Set(cps.slice(head.start, head.start + headCount));
    codes = cps.filter((c) => !headSet.has(c));
  }

  // Glyph order is the head block, then the tail ascending (spec §6).
  /** @type {number[]} */
  let order;
  if (contiguous) {
    order = cps.map((_, i) => i);
  } else {
    const head = headRun(cps);
    /** @type {number[]} */
    const headIdx = [];
    for (let i = 0; i < headCount; i++) headIdx.push(head.start + i);
    const tailIdx = cps.map((_, i) => i).filter((i) => !headIdx.includes(i));
    order = [...headIdx, ...tailIdx];
  }

  // Re-lay the bitmap in glyph order with running-total offsets (spec §10.4).
  const parts = order.map((i) => {
    const r = p.records[i];
    const len = ceilDiv(r.width * p.height, 8);
    return { r, bytes: p.bitmap.subarray(r.offset, r.offset + len) };
  });
  const total = parts.reduce((s, x) => s + x.bytes.length, 0);
  const bitmap = new Uint8Array(total);
  /** @type {{offset: number, width: number, xAdvance: number}[]} */
  const records = [];
  let at = 0;
  for (const { r, bytes } of parts) {
    records.push({ offset: at, width: r.width, xAdvance: r.xAdvance });
    bitmap.set(bytes, at);
    at += bytes.length;
  }

  const bytes =
    p.header + bitmap.length + (fixed ? 0 : 4 * n) + (contiguous ? 0 : 2 * codes.length);

  return {
    bitmap,
    glyphs: fixed ? null : records,
    codes: contiguous ? null : codes,
    first,
    count: n,
    width: fixed ? width : 0,
    height: p.height,
    xAdvance: fixed && p.records.length ? p.records[0].xAdvance : 0,
    yAdvance: p.yAdvance,
    xOffset: p.xOffset,
    yOffset: p.yOffset,
    bytesPerGlyph: fixed ? bytesPerGlyph : 0,
    headCount: contiguous ? 0 : headCount,
    fixed,
    contiguous,
    bytes,
  };
}

/** @typedef {ReturnType<typeof finish>} CellFontLayout */

/**
 * Splits by (width, xAdvance) class under the given policy. Under the cell
 * policy this is the half/full-width split that makes each part fixed pitch
 * (spec §10.2); under the trimmed policy it groups glyphs whose ink happens to
 * be the same width, which fragments far more.
 * @param {Glyph[]} glyphs
 * @param {'cell'|'trim'} policy
 */
function byWidthClass(glyphs, policy) {
  const box = bounds(glyphs);
  /** @type {Map<string, Glyph[]>} */
  const groups = new Map();
  for (const g of glyphs) {
    const ink = box && hasInk(g) ? g.xOffset - box.L + g.bitmap.width : 0;
    const width = policy === 'cell' ? Math.max(g.xAdvance, ink) : ink;
    const key = `${width}/${g.xAdvance}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(g);
    else groups.set(key, [g]);
  }
  // Chains are ordered by each class's smallest code point (spec §10.4).
  return [...groups.values()].sort(
    (a, b) => Math.min(...a.map((g) => g.codepoint)) - Math.min(...b.map((g) => g.codepoint)),
  );
}

/**
 * Packs one group with whichever policy is smaller. Each font in a chain is
 * independent, so the choice is made per group rather than for the whole chain.
 * @param {Glyph[]} group
 * @param {number} yAdvance
 * @param {number} header
 */
function packGroup(group, yAdvance, header) {
  const cell = finish(packOne(group, 'cell', yAdvance, header));
  const trim = finish(packOne(group, 'trim', yAdvance, header));
  if (trim.bytes < cell.bytes) return trim;
  // Ties go to the cell candidate (spec §10.4).
  return cell;
}

/**
 * Packs a font into a CellFont chain (spec §10.1-§10.4).
 *
 * Candidates are the groupings: one font, split by cell-width class, or split
 * by trimmed-width class. Each group then picks its own policy. Groupings that
 * exceed `maxChain` are not considered.
 *
 * `maxChain` is a generator policy, not a format constraint: the decoder walks
 * `next` to the end whatever its length. It trades data size against the number
 * of font lookups per character, so it is part of the canonical input (§10.4).
 *
 * @param {Font} font
 * @param {{abi?: 'ilp32'|'avr', maxChain?: number}} [opts]
 */
export function packCellFont(font, opts = {}) {
  const header = ABI_HEADER[opts.abi ?? 'ilp32'];
  const maxChain = opts.maxChain ?? 2;
  if (!Number.isInteger(maxChain) || maxChain < 1) {
    throw new RangeError(`packCellFont: maxChain must be a positive integer (got ${maxChain})`);
  }
  const glyphs = [...font.glyphs.values()];
  if (glyphs.length === 0) {
    throw new EncodeConstraintError('CellFont: an empty font is invalid', [
      { level: 'error', code: 'EMPTY_FONT' },
    ]);
  }
  for (const g of glyphs) {
    if (g.codepoint > 0xffff) {
      throw new EncodeConstraintError(
        `CellFont: codes are uint16, so U+${g.codepoint.toString(16).toUpperCase()} cannot be encoded`,
        [{ level: 'error', code: 'CODEPOINT_OUT_OF_RANGE', codepoint: g.codepoint }],
      );
    }
  }
  const yAdvance = font.lineHeight;

  /** @type {{id: string, groups: Glyph[][]}[]} */
  const groupings = [{ id: 'single', groups: [glyphs] }];
  for (const policy of /** @type {const} */ (['cell', 'trim'])) {
    const groups = byWidthClass(glyphs, policy);
    if (groups.length > 1 && groups.length <= maxChain) {
      groupings.push({ id: `${policy}-class`, groups });
    }
  }

  const candidates = groupings.map(({ id, groups }) => {
    const chain = groups.map((g) => packGroup(g, yAdvance, header));
    return { id, chain, bytes: chain.reduce((s, c) => s + c.bytes, 0) };
  });

  const representable = candidates.filter((c) =>
    c.chain.every((f) => f.count <= 65535 && (f.glyphs === null || f.bitmap.length <= 65535)),
  );
  if (representable.length === 0) {
    throw new EncodeConstraintError(
      'CellFont: no candidate fits (variable-pitch bitmap over 65,535 bytes, or over 65,535 glyphs)',
      [{ level: 'error', code: 'CELLFONT_TOO_LARGE' }],
    );
  }

  // Lexicographic tie-break (spec §10.4): size, then fewest fonts, then most
  // fixed-pitch fonts, then grouping order (single first).
  const ORDER = ['single', 'cell-class', 'trim-class'];
  /** @param {{bytes: number, chain: CellFontLayout[], id: string}} c */
  const rank = (c) => [
    c.bytes,
    c.chain.length,
    -c.chain.filter((/** @type {CellFontLayout} */ f) => f.fixed).length,
    ORDER.indexOf(c.id),
  ];
  representable.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  });
  const best = representable[0];
  return {
    chain: best.chain,
    bytes: best.bytes,
    candidate: best.id,
    // Every candidate considered, ranked. Used by the CLI report to explain
    // why a form was chosen.
    candidates: representable.map((c) => ({ id: c.id, bytes: c.bytes, fonts: c.chain.length })),
  };
}

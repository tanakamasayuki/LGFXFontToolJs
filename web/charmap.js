// @ts-check
/**
 * Unicode character map shared by Viewer, Generator, and Inspector.
 * Small fonts use FontCatalog-style character/code-point cells. Large CJK
 * fonts use one text node per block so thousands of glyphs remain responsive.
 */

/** @type {Array<[number, number, string]>} */
const BLOCKS = [
  [0x0000, 0x001f, 'C0 Controls'],
  [0x0020, 0x007e, 'Basic Latin (ASCII)'],
  [0x007f, 0x009f, 'C1 Controls'],
  [0x00a0, 0x00ff, 'Latin-1 Supplement'],
  [0x0100, 0x017f, 'Latin Extended-A'],
  [0x0180, 0x024f, 'Latin Extended-B'],
  [0x02b0, 0x02ff, 'Spacing Modifier Letters'],
  [0x0370, 0x03ff, 'Greek and Coptic'],
  [0x0400, 0x04ff, 'Cyrillic'],
  [0x1e00, 0x1eff, 'Latin Extended Additional'],
  [0x2000, 0x206f, 'General Punctuation'],
  [0x2070, 0x209f, 'Super/Subscripts'],
  [0x20a0, 0x20cf, 'Currency Symbols'],
  [0x2100, 0x214f, 'Letterlike Symbols'],
  [0x2150, 0x218f, 'Number Forms'],
  [0x2190, 0x21ff, 'Arrows'],
  [0x2200, 0x22ff, 'Mathematical Operators'],
  [0x2300, 0x23ff, 'Miscellaneous Technical'],
  [0x2460, 0x24ff, 'Enclosed Alphanumerics'],
  [0x2500, 0x257f, 'Box Drawing'],
  [0x2580, 0x259f, 'Block Elements'],
  [0x25a0, 0x25ff, 'Geometric Shapes'],
  [0x2600, 0x26ff, 'Miscellaneous Symbols'],
  [0x2700, 0x27bf, 'Dingbats'],
  [0x2e80, 0x2eff, 'CJK Radicals Supplement'],
  [0x3000, 0x303f, 'CJK Symbols and Punctuation'],
  [0x3040, 0x309f, 'Hiragana'],
  [0x30a0, 0x30ff, 'Katakana'],
  [0x3100, 0x312f, 'Bopomofo'],
  [0x3130, 0x318f, 'Hangul Compatibility Jamo'],
  [0x3190, 0x319f, 'Kanbun'],
  [0x31f0, 0x31ff, 'Katakana Phonetic Extensions'],
  [0x3200, 0x32ff, 'Enclosed CJK Letters and Months'],
  [0x3300, 0x33ff, 'CJK Compatibility'],
  [0x3400, 0x4dbf, 'CJK Unified Ideographs Extension A'],
  [0x4e00, 0x9fff, 'CJK Unified Ideographs'],
  [0xac00, 0xd7af, 'Hangul Syllables'],
  [0xf900, 0xfaff, 'CJK Compatibility Ideographs'],
  [0xfb00, 0xfb4f, 'Alphabetic Presentation Forms'],
  [0xfe30, 0xfe4f, 'CJK Compatibility Forms'],
  [0xff00, 0xffef, 'Halfwidth and Fullwidth Forms'],
];

/** @param {number} cp */
const hex = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

/** @param {number} cp */
const blockName = (cp) => BLOCKS.find(([lo, hi]) => cp >= lo && cp <= hi)?.[2] ?? 'Other';

/** @param {number} cp */
function glyphLabel(cp) {
  if (cp === 0x20) return '[space]';
  if (cp === 0xa0) return '[NBSP]';
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return '[control]';
  return String.fromCodePoint(cp);
}

/**
 * @param {Iterable<number>} codepoints
 * @returns {Array<{name: string, cps: number[]}>}
 */
export function groupByBlock(codepoints) {
  /** @type {Map<string, number[]>} */
  const groups = new Map();
  const sorted = [...new Set(codepoints)].sort((a, b) => a - b);
  for (const cp of sorted) {
    const name = blockName(cp);
    const group = groups.get(name) ?? [];
    group.push(cp);
    groups.set(name, group);
  }
  return [...groups].map(([name, cps]) => ({ name, cps }));
}

/**
 * Characters suitable for pasting into the Generator.
 * @param {Iterable<number>} codepoints
 */
export function copyableCharacters(codepoints) {
  return [...new Set(codepoints)]
    .filter((cp) => cp >= 0x20 && cp !== 0x7f && !(cp >= 0x80 && cp <= 0x9f))
    .sort((a, b) => a - b)
    .map((cp) => String.fromCodePoint(cp))
    .join('');
}

/** @param {Iterable<number>} codepoints */
export async function copyCharacters(codepoints) {
  const text = copyableCharacters(codepoints);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

/**
 * @param {HTMLElement} host
 * @param {Iterable<number>} codepoints
 * @param {{emptyText?: string, detailedLimit?: number}} [options]
 */
export function renderCharmap(host, codepoints, options = {}) {
  const cps = [...new Set(codepoints)].sort((a, b) => a - b);
  host.textContent = '';
  if (cps.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'sub';
    empty.textContent = options.emptyText ?? '';
    host.appendChild(empty);
    return;
  }

  const detailed = cps.length <= (options.detailedLimit ?? 512);
  const fragment = document.createDocumentFragment();
  for (const group of groupByBlock(cps)) {
    const block = document.createElement('section');
    block.className = 'cm-block';
    const head = document.createElement('div');
    head.className = 'cm-head';
    head.textContent = `${group.name} · ${hex(group.cps[0])}–${hex(group.cps.at(-1) ?? 0)} · ${group.cps.length.toLocaleString()}`;
    const chars = document.createElement('div');
    chars.className = `cm-chars ${detailed ? 'detailed' : 'dense'}`;
    if (detailed) {
      for (const cp of group.cps) {
        const cell = document.createElement('span');
        cell.className = 'glyph-cell';
        const glyph = document.createElement('span');
        glyph.textContent = glyphLabel(cp);
        const code = document.createElement('small');
        code.textContent = hex(cp);
        cell.append(glyph, code);
        chars.appendChild(cell);
      }
    } else {
      chars.textContent = group.cps
        .filter((cp) => cp >= 0x20 && !(cp >= 0x7f && cp <= 0x9f))
        .map((cp) => String.fromCodePoint(cp))
        .join('');
    }
    block.append(head, chars);
    fragment.appendChild(block);
  }
  host.appendChild(fragment);
}

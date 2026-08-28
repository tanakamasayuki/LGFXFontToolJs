// @ts-check
/**
 * Named character sets (spec §5.2 / UC1).
 *
 * Port of the LGFXScreenBuilder fontgen character-set model. Set data lives in
 * charsets-data.js, generated from Unicode source data by LGFXScreenBuilder
 * tools/gen-charsets.mjs so every source remains auditable.
 *
 * - Han tiers are cumulative; moving upward never removes characters.
 * - Han sets are selected independently per language and unioned.
 * - Selection is a flat list of set ids and always resolves as a union.
 */
import { SET_RANGES, SET_COUNTS } from './charsets-data.js';

/**
 * Parses "20-7E,A0" as [0x20..0x7E, 0xA0], ignoring whitespace, empty, and invalid items.
 * @param {string} spec
 * @returns {number[]}
 */
export function parseRanges(spec) {
  const out = [];
  for (const partRaw of String(spec).split(',')) {
    const part = partRaw.trim();
    if (!part) continue;
    const m = /^(?:U\+)?([0-9A-Fa-f]+)(?:\s*-\s*(?:U\+)?([0-9A-Fa-f]+))?$/.exec(part);
    if (!m) continue;
    const a = parseInt(m[1], 16);
    const b = m[2] === undefined ? a : parseInt(m[2], 16);
    for (let c = Math.min(a, b); c <= Math.max(a, b); c++) out.push(c);
  }
  return out;
}

// --- Axes --------------------------------------------------------------------
// kind controls UI: 'multi' uses checkboxes; 'tier' is an exclusive ladder per language.

export const AXES = [
  {
    id: 'latin',
    kind: 'multi',
    sets: ['digits', 'ascii', 'latinExt', 'greek', 'cyrillic'],
  },
  {
    id: 'kana',
    kind: 'multi',
    sets: ['hiragana', 'katakana', 'katakanaHalf', 'jaPunct'],
  },
  {
    id: 'han',
    kind: 'tier',
    languages: [
      {
        id: 'ja',
        // School grades (cumulative) -> Joyo -> Jinmeiyo -> JIS level 1 -> JIS level 2
        tiers: [
          'hanJaG1',
          'hanJaG2',
          'hanJaG3',
          'hanJaG4',
          'hanJaG5',
          'hanJaG6',
          'hanJa1',
          'hanJa2',
          'hanJa3',
          'hanJa4',
        ],
      },
      { id: 'cn', tiers: ['hanCn1', 'hanCn2'] },
      { id: 'tw', tiers: ['hanTw1', 'hanTw2'] },
      { id: 'ko', tiers: ['hanKo1', 'hanKo2'] },
      { id: 'all', tiers: ['hanAll'] },
    ],
  },
  {
    id: 'hangul',
    kind: 'tier',
    languages: [{ id: 'hangul', tiers: ['hangulKs', 'hangulAll'] }],
  },
  {
    id: 'symbols',
    kind: 'multi',
    sets: ['symUnits', 'symMath', 'symArrows', 'symShapes', 'symCurrency', 'symEnclosed', 'symMisc'],
  },
];

/** @type {Map<string, string[]>} set id to its tier ladder */
const TIER_GROUP = new Map();
for (const axis of AXES) {
  if (axis.kind !== 'tier' || !axis.languages) continue;
  for (const lang of axis.languages) {
    for (const id of lang.tiers) TIER_GROUP.set(id, lang.tiers);
  }
}

/** @param {string} id */
export const tierSiblings = (id) => TIER_GROUP.get(id) ?? null;

/** All selectable set ids in axis order. */
export const ALL_SET_IDS = AXES.flatMap((a) =>
  a.kind === 'multi' ? (a.sets ?? []) : (a.languages ?? []).flatMap((l) => l.tiers),
);

/** @param {string} id */
export const countOf = (id) => /** @type {Record<string, number>} */ (SET_COUNTS)[id] ?? 0;

/** @type {Map<string, number[]>} */
const cache = new Map();

/**
 * Returns sorted unique code points for a named set. CJK sets reach roughly
 * 20,000 entries, so expansion is lazy and cached.
 * @param {string} id
 * @returns {number[]}
 */
export function codepointsOfSet(id) {
  const cached = cache.get(id);
  if (cached) return cached;
  const spec = /** @type {Record<string, string>} */ (SET_RANGES)[id];
  if (spec === undefined) return [];
  const cps = [...new Set(parseRanges(spec))].sort((a, b) => a - b);
  cache.set(id, cps);
  return cps;
}

// --- Templates ---------------------------------------------------------------
// One-click common use cases. Templates only populate selection; later edits are free.
// sample is preview text chosen to reveal differences between templates.

export const TEMPLATES = [
  { id: 'clock', sets: ['digits'], text: ':./- ', sample: '12:34' },
  {
    id: 'clockJa',
    sets: ['digits', 'jaPunct'],
    text: ':./- 年月日時分秒曜月火水木金土日午前後',
    sample: '12:34 火曜日',
  },
  { id: 'sensor', sets: ['digits', 'symUnits'], text: ':./%+- ', sample: '25.6℃ 60%' },
  { id: 'latinUi', sets: ['ascii', 'latinExt', 'symUnits'], text: '', sample: 'Hello 25.6℃ 100%' },
  {
    id: 'japaneseUi',
    sets: ['ascii', 'hiragana', 'katakana', 'jaPunct', 'hanJa1', 'symUnits'],
    text: '',
    sample: 'こんにちは 25.6℃ 気温',
  },
  {
    id: 'japaneseFull',
    sets: ['ascii', 'latinExt', 'hiragana', 'katakana', 'jaPunct', 'hanJa4', 'symUnits', 'symMath'],
    text: '',
    sample: 'こんにちは 25.6℃ 薔薇',
  },
  { id: 'chineseUi', sets: ['ascii', 'hanCn1', 'symUnits'], text: '', sample: '你好 25.6℃ 温度' },
  { id: 'chineseTwUi', sets: ['ascii', 'hanTw1', 'symUnits'], text: '', sample: '你好 25.6℃ 溫度' },
  { id: 'koreanUi', sets: ['ascii', 'hangulKs', 'symUnits'], text: '', sample: '안녕하세요 25.6℃' },
  {
    id: 'multilingual',
    sets: ['ascii', 'latinExt', 'hiragana', 'katakana', 'jaPunct', 'hanAll', 'hangulAll', 'symUnits'],
    text: '',
    sample: 'こんにちは 你好 안녕하세요 25.6℃',
  },
];

/** @param {string} id */
export const templateById = (id) => TEMPLATES.find((t) => t.id === id) ?? null;

// --- Resolution ---------------------------------------------------------------

/**
 * Resolves set ids, custom text, and custom ranges into one sorted unique list,
 * dropping non-renderable controls U+0000..001F and U+007F.
 * @param {{sets?: string[], customText?: string, customRanges?: string}} [selection]
 * @returns {number[]}
 */
export function resolveCharset({ sets = [], customText = '', customRanges = '' } = {}) {
  /** @type {Set<number>} */
  const out = new Set();
  for (const id of sets) for (const c of codepointsOfSet(id)) out.add(c);
  for (const ch of String(customText)) out.add(/** @type {number} */ (ch.codePointAt(0)));
  for (const c of parseRanges(customRanges)) out.add(c);
  return [...out].filter((c) => c >= 0x20 && c !== 0x7f).sort((a, b) => a - b);
}

/**
 * Toggles a selection while preserving tier-ladder exclusivity; returns a new array.
 * @param {string[]} sets
 * @param {string} id
 * @param {boolean} on
 */
export function toggleSet(sets, id, on) {
  const siblings = tierSiblings(id);
  const next = siblings ? sets.filter((s) => !siblings.includes(s)) : sets.filter((s) => s !== id);
  if (on) next.push(id);
  return next;
}

/**
 * Splits BMP and non-BMP code points for u8g2 / LovyanGFX uint16 reporting.
 * Even the Jōyō kanji set contains one non-BMP character: U+20B9F.
 * @param {number[]} cps
 */
export const splitBmp = (cps) => ({
  bmp: cps.filter((c) => c <= 0xffff),
  dropped: cps.filter((c) => c > 0xffff),
});

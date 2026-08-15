// @ts-check
/**
 * 名前付き文字集合（仕様 §5.2 / UC1）。
 *
 * LGFXScreenBuilder fontgen の文字集合モデルを移管したもの。集合の実体は
 * Unicode 自身のデータから生成した charsets-data.js（生成元:
 * LGFXScreenBuilder tools/gen-charsets.mjs）で、すべて出所を監査できる。
 *
 * - Han の tier は累積和。上の tier に上げて文字が減ることはない
 * - Han は言語ごとに独立して選び、結果は和集合
 * - 選択はフラットな集合 id の列。解決は常に和集合
 */
import { SET_RANGES, SET_COUNTS } from './charsets-data.js';

/**
 * "20-7E,A0" → [0x20..0x7E, 0xA0]。空白・空要素・不正要素は無視する。
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

// --- 軸 ---------------------------------------------------------------------
// kind が UI を決める: 'multi' はチェックボックス、'tier' は言語ごとに
// 排他的な段階（ladder）。

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
      { id: 'ja', tiers: ['hanJa1', 'hanJa2', 'hanJa3', 'hanJa4'] },
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

/** @type {Map<string, string[]>} 集合 id → 属する tier ladder */
const TIER_GROUP = new Map();
for (const axis of AXES) {
  if (axis.kind !== 'tier' || !axis.languages) continue;
  for (const lang of axis.languages) {
    for (const id of lang.tiers) TIER_GROUP.set(id, lang.tiers);
  }
}

/** @param {string} id */
export const tierSiblings = (id) => TIER_GROUP.get(id) ?? null;

/** 選択可能な全集合 id（軸の順） */
export const ALL_SET_IDS = AXES.flatMap((a) =>
  a.kind === 'multi' ? (a.sets ?? []) : (a.languages ?? []).flatMap((l) => l.tiers),
);

/** @param {string} id */
export const countOf = (id) => /** @type {Record<string, number>} */ (SET_COUNTS)[id] ?? 0;

/** @type {Map<string, number[]>} */
const cache = new Map();

/**
 * 名前付き集合のコードポイント列（昇順・重複なし）。CJK 集合は 2 万件規模なので
 * 遅延展開・キャッシュする。
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

// --- テンプレート ------------------------------------------------------------
// よくある用途をワンクリックで。選択を埋めるだけで、その後の編集は自由。
// sample はプレビューに使う文字列（テンプレートごとの差を見せるため）。

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

// --- 解決 --------------------------------------------------------------------

/**
 * 選択（集合 id + 任意文字列 + 任意範囲）を 1 つのコードポイント列に解決する。
 * 昇順・重複なし。描画できない制御文字（U+0000..1F, U+007F）は落とす。
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
 * 選択の切り替え。tier ladder の排他を保つ。新しい配列を返す。
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
 * BMP 内と BMP 外に分ける。u8g2 / LovyanGFX の uint16 制限の報告に使う
 * （常用漢字にも 1 文字ある: 𠮟 U+20B9F）。
 * @param {number[]} cps
 */
export const splitBmp = (cps) => ({
  bmp: cps.filter((c) => c <= 0xffff),
  dropped: cps.filter((c) => c > 0xffff),
});

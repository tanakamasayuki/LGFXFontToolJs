// @ts-check
/**
 * Web アプリの i18n（仕様 §14）。
 *
 * - 言語は navigator.languages から自動判定し、対応がなければ英語
 * - 優先順位: ?lang= パラメータ > localStorage > ブラウザ言語 > 'en'
 * - 言語の追加 = SUPPORTED_LOCALES に 1 エントリ + locales/<id>.json を置くだけ
 * - 文言は辞書キー経由でのみ参照する。ライブラリ本体（src/）は文言を持たない
 */

/**
 * @typedef {object} LocaleDef
 * @property {string} id     - 辞書ファイル名（locales/<id>.json）
 * @property {string} label  - 言語セレクタに出す自称表記
 * @property {string[]} tags - BCP 47 タグ（小文字）でのマッチ対象。
 *                             先頭一致ではなく完全一致で先に評価される
 */

/** @type {LocaleDef[]} */
export const SUPPORTED_LOCALES = [
  { id: 'en', label: 'English', tags: ['en'] },
  { id: 'ja', label: '日本語', tags: ['ja'] },
  { id: 'zh-Hans', label: '简体中文', tags: ['zh-hans', 'zh-cn', 'zh-sg', 'zh-my', 'zh'] },
  { id: 'zh-Hant', label: '繁體中文', tags: ['zh-hant', 'zh-tw', 'zh-hk', 'zh-mo'] },
];

const FALLBACK = 'en';
const STORAGE_KEY = 'lgfx-font-tool.lang';

/** @type {Record<string, string>} */
let dict = {};
/** @type {Record<string, string>} */
let fallbackDict = {};
let current = FALLBACK;

/**
 * BCP 47 タグ 1 つを対応ロケール id に解決する（できなければ null）。
 * @param {string} tag
 * @returns {string | null}
 */
function resolveTag(tag) {
  const lower = tag.toLowerCase();
  for (const loc of SUPPORTED_LOCALES) {
    if (loc.tags.includes(lower)) return loc.id;
  }
  const primary = lower.split('-')[0];
  for (const loc of SUPPORTED_LOCALES) {
    if (loc.tags.includes(primary)) return loc.id;
  }
  return null;
}

/**
 * 表示言語を決める。?lang= > localStorage > navigator.languages > 'en'。
 * @returns {string}
 */
export function detectLocale() {
  const param = new URLSearchParams(location.search).get('lang');
  if (param) {
    const fromParam = resolveTag(param);
    if (fromParam) return fromParam;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED_LOCALES.some((l) => l.id === stored)) return stored;
  } catch {
    // localStorage 不可（プライベートモード等）は無視
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    if (!tag) continue;
    const id = resolveTag(tag);
    if (id) return id;
  }
  return FALLBACK;
}

/** @param {string} id */
async function loadDict(id) {
  const res = await fetch(new URL(`./locales/${id}.json`, import.meta.url));
  if (!res.ok) throw new Error(`locale load failed: ${id} (${res.status})`);
  return /** @type {Record<string, string>} */ (await res.json());
}

/**
 * 言語を切り替える（初期化にも使う）。
 * @param {string} id
 * @param {{persist?: boolean}} [opts]
 */
export async function setLocale(id, opts = {}) {
  if (!SUPPORTED_LOCALES.some((l) => l.id === id)) id = FALLBACK;
  if (Object.keys(fallbackDict).length === 0) fallbackDict = await loadDict(FALLBACK);
  dict = id === FALLBACK ? fallbackDict : await loadDict(id);
  current = id;
  document.documentElement.lang = id;
  if (opts.persist !== false) {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // 保存できなくても動作に支障はない
    }
  }
}

/** 現在のロケール id */
export function currentLocale() {
  return current;
}

/**
 * 辞書引き。{name} 形式のプレースホルダを params で埋める。
 * 見つからないキーは英語 → キー名の順でフォールバックする。
 * @param {string} key
 * @param {Record<string, string | number>} [params]
 * @returns {string}
 */
export function t(key, params) {
  let s = dict[key] ?? fallbackDict[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/**
 * data-i18n / data-i18n-placeholder / data-i18n-title の付いた要素へ辞書を適用する。
 * @param {ParentNode} [root]
 */
export function applyTranslations(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(/** @type {string} */ (el.getAttribute('data-i18n')));
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    /** @type {HTMLInputElement} */ (el).placeholder = t(
      /** @type {string} */ (el.getAttribute('data-i18n-placeholder')),
    );
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    /** @type {HTMLElement} */ (el).title = t(
      /** @type {string} */ (el.getAttribute('data-i18n-title')),
    );
  }
}

/** 初期化。判定した言語をロードして返す。 */
export async function initI18n() {
  await setLocale(detectLocale(), { persist: false });
  return current;
}

// @ts-check
/**
 * i18n for the web apps (spec §14).
 *
 * - The language is detected from navigator.languages, falling back to English
 * - Priority: ?lang= parameter > localStorage > browser language > 'en'
 * - Adding a language = one SUPPORTED_LOCALES entry + a locales/<id>.json file
 * - Wording is only ever referenced through dictionary keys. The library itself
 *   (src/) carries no user-facing wording
 */

/**
 * @typedef {object} LocaleDef
 * @property {string} id     - Dictionary file name (locales/<id>.json)
 * @property {string} label  - Endonym shown in the language selector
 * @property {string[]} tags - BCP 47 tags (lower case) to match against.
 *                             Exact matches are tried before prefix matches
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
 * Resolves a single BCP 47 tag to a supported locale id (null if it cannot).
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
 * Decides the display language. ?lang= > localStorage > navigator.languages > 'en'.
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
    // Ignore an unavailable localStorage (private mode and the like)
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
 * Switches the language (also used for initialization).
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
      // Failing to persist does not affect anything else
    }
  }
}

/** The current locale id */
export function currentLocale() {
  return current;
}

/**
 * Dictionary lookup. Fills {name}-style placeholders from params.
 * A missing key falls back to English, then to the key name itself.
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
 * Applies the dictionary to elements carrying data-i18n, data-i18n-placeholder
 * or data-i18n-title.
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

/** Initialization. Loads the detected language and returns it. */
export async function initI18n() {
  await setLocale(detectLocale(), { persist: false });
  return current;
}

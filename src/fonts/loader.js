// @ts-check
/**
 * Bundled font collection loader (spec §8.1 / §16).
 *
 * Data resolution order:
 *   1. configureFontData({ baseUrl }); when set, use only this location
 *   2. local ./data/ relative to import.meta.url
 *      — repository clones and GitHub Pages include all 186 fonts; npm / CDN
 *        packages include 70 lightweight LGFX-internal and Latin GFX fonts
 *   3. remote GitHub Pages data; 42MB of CJK fonts is excluded from npm (spec §18)
 *
 * This is the only src/ module that performs I/O, an explicit layer exception (spec §4.1).
 */
import { fontCatalog } from './catalog.js';
import { decode } from '../format/registry.js';
import { CollectionError } from '../util/errors.js';

/** @typedef {import('../model/font.js').Font} Font */

const REMOTE_BASE = 'https://tanakamasayuki.github.io/LGFXFontToolJs/src/fonts/data/';

/** @type {{baseUrl: string | URL | null}} */
const config = { baseUrl: null };

/** @type {Map<string, Promise<Font>>} */
const cache = new Map();

/**
 * Overrides font-data location for offline use, mirrors, or full file:// data.
 * Applies to later loadFont calls and clears the cache.
 * @param {{baseUrl?: string | URL | null}} opts
 */
export function configureFontData(opts) {
  config.baseUrl = opts.baseUrl ?? null;
  cache.clear();
}

/**
 * Returns candidate URLs; exported as a pure function for testing.
 * @param {string} file
 * @param {{baseUrl: string | URL | null}} [cfg]
 * @returns {URL[]}
 */
export function fontDataCandidates(file, cfg = config) {
  if (cfg.baseUrl) {
    const base = String(cfg.baseUrl);
    return [new URL(file, base.endsWith('/') ? base : base + '/')];
  }
  return [new URL(`./data/${file}`, import.meta.url), new URL(file, REMOTE_BASE)];
}

/**
 * @param {URL} url
 * @returns {Promise<Uint8Array | null>} null when absent so another candidate can be tried
 */
async function tryLoad(url) {
  if (url.protocol === 'file:') {
    try {
      const { readFile } = await import('node:fs/promises');
      return new Uint8Array(await readFile(url));
    } catch {
      return null;
    }
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Loads a bundled font by name, reading data once and returning the cache thereafter.
 * @param {string} name - catalog name, e.g. 'lgfxJapanGothic_24', 'FreeSans9pt7b', 'Font2'
 * @returns {Promise<Font>}
 */
export function loadFont(name) {
  let promise = cache.get(name);
  if (promise) return promise;

  const entry = fontCatalog.find((e) => e.name === name);
  if (!entry) {
    throw new CollectionError('UNKNOWN_FONT', `font not in catalog: ${name}`, { name });
  }

  promise = (async () => {
    const candidates = fontDataCandidates(entry.file);
    /** @type {Uint8Array | null} */
    let bytes = null;
    for (const url of candidates) {
      bytes = await tryLoad(url);
      if (bytes) break;
    }
    if (!bytes) {
      throw new CollectionError('FONT_DATA_LOAD_FAILED', `could not load data for ${name}`, {
        name,
        tried: candidates.map(String),
      });
    }
    /** @type {import('../format/registry.js').DecodeOptions} */
    const opts = { format: entry.format, familyName: entry.name };
    if (entry.format === 'glcd') opts.glcd = /** @type {any} */ (entry.params);
    if (entry.format === 'fixedbmp') opts.fixedbmp = /** @type {any} */ (entry.params);
    const font = decode(bytes, opts);
    font.meta.license = entry.license;
    font.meta.copyright = entry.copyright;
    return font;
  })();
  cache.set(name, promise);
  return promise;
}

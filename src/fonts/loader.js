// @ts-check
/**
 * 内蔵フォントコレクションのローダ（仕様 §8.1）。
 *
 * データファイルは import.meta.url 基準で解決する。I/O を行うのは src/ 内で
 * このモジュールだけ（レイヤ規律の明示的な例外。仕様 §4.1）。
 */
import { fontCatalog } from './catalog.js';
import { decode } from '../format/registry.js';
import { CollectionError } from '../util/errors.js';

/** @typedef {import('../model/font.js').Font} Font */

/** @type {Map<string, Promise<Font>>} */
const cache = new Map();

/**
 * @param {URL} url
 * @returns {Promise<Uint8Array>}
 */
async function loadBytes(url) {
  if (url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    return new Uint8Array(await readFile(url));
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new CollectionError('FONT_DATA_LOAD_FAILED', `failed to fetch ${url}: ${res.status}`, {
      url: String(url),
      status: res.status,
    });
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * 内蔵フォントを名前でロードする。初回のみデータを読み、以後はキャッシュを返す。
 * @param {string} name - カタログ名（例: 'lgfxJapanGothic_24', 'FreeSans9pt7b', 'Font2'）
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
    const url = new URL(`./data/${entry.file}`, import.meta.url);
    const bytes = await loadBytes(url);
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

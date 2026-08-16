// @ts-check
/**
 * 内蔵フォントコレクションのローダ（仕様 §8.1 / §16）。
 *
 * データの解決順:
 *   1. configureFontData({ baseUrl }) で指定された場所（指定時はここだけ）
 *   2. import.meta.url 基準のローカル（./data/）
 *      — リポジトリのクローンと GitHub Pages は全 186 本、npm / CDN 配布物は
 *        軽量な 70 本（LGFX 内部形式 + 欧文 GFX）を同梱している
 *   3. GitHub Pages のリモートデータ（CJK 系 42MB は npm に同梱しない。§18）
 *
 * I/O を行うのは src/ 内でこのモジュールだけ（レイヤ規律の明示的な例外。§4.1）。
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
 * フォントデータの取得先を差し替える（オフライン環境・自前ミラー・
 * file:// のフルデータ等）。以後の loadFont に効く（キャッシュは破棄する）。
 * @param {{baseUrl?: string | URL | null}} opts
 */
export function configureFontData(opts) {
  config.baseUrl = opts.baseUrl ?? null;
  cache.clear();
}

/**
 * 解決候補の URL 列（テスト可能なよう純粋関数として公開）。
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
 * @returns {Promise<Uint8Array | null>} 見つからなければ null（他候補へ）
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

// @ts-check
/**
 * A curated set of redistributable web fonts (from LGFXScreenBuilder fontgen).
 *
 * A generated font burns glyphs into the sketch's flash, which is redistribution
 * of the typeface, so this list is limited to SIL OFL 1.1 and Apache-2.0 families
 * (both allow redistribution with attribution). A file the user brings in is
 * their own responsibility, and the UI warns about it.
 *
 * Fonts are fetched through the Google Fonts CSS API (direct gstatic URLs carry a
 * version hash that changes). Network access is the app's responsibility and does
 * not belong in the library itself (spec §2.3).
 */

const OFL = { id: 'OFL-1.1', name: 'SIL Open Font License 1.1', url: 'https://openfontlicense.org/' };
const APACHE = {
  id: 'Apache-2.0',
  name: 'Apache License 2.0',
  url: 'https://www.apache.org/licenses/LICENSE-2.0',
};

/**
 * @typedef {object} CuratedFont
 * @property {string} family
 * @property {string} script - 'latin' | 'display' | 'japanese' | 'symbol' | 'cjk'
 * @property {{id: string, name: string, url: string}} license
 * @property {string} by
 * @property {boolean} [mono]
 * @property {boolean} [pixel] - Bitmap-style face that stays clean at small sizes
 */

/** @type {CuratedFont[]} */
export const FONTS = [
  // --- Latin UI ---
  { family: 'Roboto', script: 'latin', license: APACHE, by: 'Christian Robertson' },
  { family: 'Roboto Mono', script: 'latin', mono: true, license: APACHE, by: 'Christian Robertson' },
  { family: 'Roboto Condensed', script: 'latin', license: APACHE, by: 'Christian Robertson' },
  { family: 'Inter', script: 'latin', license: OFL, by: 'Rasmus Andersson' },
  { family: 'Noto Sans', script: 'latin', license: OFL, by: 'Google' },
  { family: 'JetBrains Mono', script: 'latin', mono: true, license: OFL, by: 'JetBrains' },
  { family: 'Oswald', script: 'latin', license: OFL, by: 'Vernon Adams' },
  { family: 'Montserrat', script: 'latin', license: OFL, by: 'Julieta Ulanovsky' },

  // --- Display / clock ---
  { family: 'Orbitron', script: 'display', license: OFL, by: 'Matt McInerney' },
  { family: 'Share Tech Mono', script: 'display', mono: true, license: OFL, by: 'Carrois Apostrophe' },
  { family: 'VT323', script: 'display', mono: true, pixel: true, license: OFL, by: 'Peter Hull' },
  { family: 'Silkscreen', script: 'display', pixel: true, license: OFL, by: 'Jason Kottke' },
  { family: 'Micro 5', script: 'display', pixel: true, license: OFL, by: 'Ryoichi Tsunekawa' },
  { family: 'Tiny5', script: 'display', pixel: true, license: OFL, by: 'Sabor Design' },
  { family: 'Pixelify Sans', script: 'display', pixel: true, license: OFL, by: 'Elena Kozadaeva' },

  // --- Japanese ---
  { family: 'Noto Sans JP', script: 'japanese', license: OFL, by: 'Google' },
  { family: 'Noto Serif JP', script: 'japanese', license: OFL, by: 'Google' },
  { family: 'M PLUS 1', script: 'japanese', license: OFL, by: 'Coji Morishita' },
  { family: 'M PLUS 1 Code', script: 'japanese', mono: true, license: OFL, by: 'Coji Morishita' },
  { family: 'M PLUS 2', script: 'japanese', license: OFL, by: 'Coji Morishita' },
  { family: 'Kosugi Maru', script: 'japanese', license: APACHE, by: 'MOTOYA' },
  { family: 'Sawarabi Gothic', script: 'japanese', license: OFL, by: 'mshio' },
  { family: 'Zen Maru Gothic', script: 'japanese', license: OFL, by: 'Yoshimichi Ohira' },
  { family: 'BIZ UDGothic', script: 'japanese', license: OFL, by: 'Morisawa' },
  { family: 'BIZ UDPGothic', script: 'japanese', license: OFL, by: 'Morisawa' },
  { family: 'DotGothic16', script: 'japanese', pixel: true, license: OFL, by: 'Fontworks' },

  // --- Symbols (a fill-in source rather than a body face) ---
  { family: 'Noto Sans Symbols 2', script: 'symbol', license: OFL, by: 'Google' },

  // --- Other CJK ---
  { family: 'Noto Sans SC', script: 'cjk', license: OFL, by: 'Google' },
  { family: 'Noto Sans TC', script: 'cjk', license: OFL, by: 'Google' },
  { family: 'Noto Sans KR', script: 'cjk', license: OFL, by: 'Google' },
];

/** @param {string} family */
export const findFont = (family) => FONTS.find((f) => f.family === family) ?? null;

/**
 * The order families are tried when filling in missing characters (fontgen's fb
 * feature, still to be implemented here). Symbols 2 comes first because it exists
 * precisely for the ranges a body typeface does not carry (← ▲ ℃ ≠ ② ☃ Ω and so on).
 */
export const FALLBACK_CHAIN = [
  'Noto Sans Symbols 2',
  'Noto Sans',
  'Noto Sans JP',
  'Noto Sans SC',
  'Noto Sans KR',
];

const CSS_API = 'https://fonts.googleapis.com/css2';

/** @param {string} family @param {number} [weight] @param {boolean} [italic] */
export const cssUrlFor = (family, weight = 400, italic = false) =>
  `${CSS_API}?family=${encodeURIComponent(family).replace(/%20/g, '+')}:` +
  `ital,wght@${italic ? 1 : 0},${weight}&display=swap`;

/** `unicode-range: U+0-7F, U+2000-206F` → [[lo, hi], ...]
 * @param {string} spec */
function parseUnicodeRange(spec) {
  /** @type {[number, number][]} */
  const out = [];
  for (const partRaw of spec.split(',')) {
    const part = partRaw.trim();
    let m = /^U\+([0-9A-Fa-f]+)-([0-9A-Fa-f]+)$/.exec(part);
    if (m) {
      out.push([parseInt(m[1], 16), parseInt(m[2], 16)]);
      continue;
    }
    m = /^U\+([0-9A-Fa-f]*)(\?*)$/.exec(part);
    if (m) {
      const lo = parseInt((m[1] || '0') + '0'.repeat(m[2].length), 16);
      const hi = parseInt((m[1] || '0') + 'F'.repeat(m[2].length), 16);
      out.push([lo, hi]);
    }
  }
  return out;
}

/** Splits a Google Fonts stylesheet into one { url, ranges } per @font-face
 * @param {string} css */
function parseCss(css) {
  /** @type {{url: string, ranges: [number, number][] | null}[]} */
  const faces = [];
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const block = m[1];
    const src = /src:\s*url\(([^)]+)\)/.exec(block);
    if (!src) continue;
    const ur = /unicode-range:\s*([^;]+);/.exec(block);
    faces.push({
      url: src[1].replace(/^['"]|['"]$/g, ''),
      ranges: ur ? parseUnicodeRange(ur[1]) : null, // null = the whole range
    });
  }
  return faces;
}

/** @param {[number, number][] | null} ranges @param {number[]} cps */
const intersects = (ranges, cps) =>
  !ranges || cps.some((c) => ranges.some(([lo, hi]) => c >= lo && c <= hi));

let loadCount = 0;

/**
 * Loads a Google Fonts family into the document, fetching only the subsets that
 * cover the requested code points (a CJK family is split into around a hundred
 * subsets, and pulling all of them for the 20 characters of a clock face would be
 * wrong).
 *
 * FontFace keeps the unicode-range, so the canvas resolves the right subset for
 * each code point.
 *
 * Passing the previous result { family, loaded } as `into` continues that load.
 * Without it, regenerating with a wider character set would keep the old partial
 * load, making missing subsets indistinguishable from "not in this typeface".
 *
 * @param {string} family
 * @param {number[]} codepoints
 * @param {{weight?: number, italic?: boolean, into?: {family: string, loaded: Set<string>} | null}} [opts]
 * @returns {Promise<{family: string, loaded: Set<string>, subsets: number, of: number}>}
 */
export async function loadGoogleFont(family, codepoints, { weight = 400, italic = false, into = null } = {}) {
  const res = await fetch(cssUrlFor(family, weight, italic));
  if (!res.ok) throw new Error(`Google Fonts CSS: HTTP ${res.status}`);
  const all = parseCss(await res.text());
  if (!all.length) throw new Error(`Google Fonts CSS: no @font-face for "${family}"`);
  const wanted = all.filter((f) => intersects(f.ranges, codepoints));
  if (!wanted.length) throw new Error(`"${family}" covers none of the selected characters`);

  // Use a private family name per load so it cannot clash with the page's own webfonts
  const local = into?.family ?? `LGFXFT_GF_${++loadCount}`;
  const loaded = into?.loaded ?? new Set();
  const fresh = wanted.filter((f) => !loaded.has(f.url));

  await Promise.all(
    fresh.map(async (f) => {
      const desc = f.ranges
        ? { unicodeRange: f.ranges.map(([lo, hi]) => `U+${lo.toString(16)}-${hi.toString(16)}`).join(', ') }
        : {};
      const face = new FontFace(local, `url(${f.url})`, desc);
      await face.load();
      document.fonts.add(face);
      loaded.add(f.url);
    }),
  );
  return { family: local, loaded, subsets: wanted.length, of: all.length };
}

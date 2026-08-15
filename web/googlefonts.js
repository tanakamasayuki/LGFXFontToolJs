// @ts-check
/**
 * 再配布可能な Web フォントのキュレーション（LGFXScreenBuilder fontgen 由来）。
 *
 * 生成フォントはスケッチの flash に字形を焼き込む＝書体の再配布になるため、
 * 一覧は SIL OFL 1.1 と Apache-2.0 のファミリに限定する（どちらも帰属表示
 * 付きの再配布を許す）。ユーザーが自分で持ち込むファイルは本人の責任で、
 * UI 側で注意を出す。
 *
 * フォント取得は Google Fonts CSS API 経由（gstatic の直 URL はバージョン
 * ハッシュが変わるため）。ネットワークアクセスはアプリ側の責務であり、
 * ライブラリ本体（src/）には置かない（仕様 §2.3）。
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
 * @property {boolean} [pixel] - 小さいサイズで崩れないビットマップ調
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

  // --- ディスプレイ / 時計 ---
  { family: 'Orbitron', script: 'display', license: OFL, by: 'Matt McInerney' },
  { family: 'Share Tech Mono', script: 'display', mono: true, license: OFL, by: 'Carrois Apostrophe' },
  { family: 'VT323', script: 'display', mono: true, pixel: true, license: OFL, by: 'Peter Hull' },
  { family: 'Silkscreen', script: 'display', pixel: true, license: OFL, by: 'Jason Kottke' },
  { family: 'Micro 5', script: 'display', pixel: true, license: OFL, by: 'Ryoichi Tsunekawa' },
  { family: 'Tiny5', script: 'display', pixel: true, license: OFL, by: 'Sabor Design' },
  { family: 'Pixelify Sans', script: 'display', pixel: true, license: OFL, by: 'Elena Kozadaeva' },

  // --- 日本語 ---
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

  // --- 記号（本文用というより補完元） ---
  { family: 'Noto Sans Symbols 2', script: 'symbol', license: OFL, by: 'Google' },

  // --- その他 CJK ---
  { family: 'Noto Sans SC', script: 'cjk', license: OFL, by: 'Google' },
  { family: 'Noto Sans TC', script: 'cjk', license: OFL, by: 'Google' },
  { family: 'Noto Sans KR', script: 'cjk', license: OFL, by: 'Google' },
];

/** @param {string} family */
export const findFont = (family) => FONTS.find((f) => f.family === family) ?? null;

/**
 * 欠落文字の補完（fontgen の fb 機能。本ツールでは今後実装）で
 * ファミリを試す順序。Symbols 2 が先頭なのは、本文書体が持たない
 * 範囲（← ▲ ℃ ≠ ② ☃ Ω など）のために存在するファミリだから。
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

/** Google Fonts のスタイルシートを @font-face ごとの { url, ranges } に分ける
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
      ranges: ur ? parseUnicodeRange(ur[1]) : null, // null = 全域
    });
  }
  return faces;
}

/** @param {[number, number][] | null} ranges @param {number[]} cps */
const intersects = (ranges, cps) =>
  !ranges || cps.some((c) => ranges.some(([lo, hi]) => c >= lo && c <= hi));

let loadCount = 0;

/**
 * Google Fonts のファミリを document に読み込む。要求コードポイントに掛かる
 * サブセットだけを取得する（CJK ファミリは 100 前後のサブセットに分割されて
 * おり、時計用の 20 文字のために全部を引いてはいけない）。
 *
 * FontFace は unicode-range を保持するので、canvas がコードポイントごとに
 * 正しいサブセットを解決する。
 *
 * `into` は前回の結果 { family, loaded } を渡すと続きから読み込む。
 * 文字集合を広げて再生成するとき、これが無いと古い部分読み込みのままになり
 * 「その書体に無い文字」と区別が付かなくなる。
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

  // ページ自身の webfont と衝突しないよう、読み込みごとに私有ファミリ名を使う
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

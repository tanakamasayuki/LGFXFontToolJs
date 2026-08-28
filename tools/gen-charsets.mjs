// @ts-check
/**
 * Regenerates src/charsets/charsets-data.js.
 *
 *   node tools/gen-charsets.mjs            # use the cached downloads
 *   node tools/gen-charsets.mjs --fetch    # re-download the sources first
 *   node tools/gen-charsets.mjs --check    # regenerate and diff, writing nothing
 *
 * Han and Hangul sets are derived from Unicode's own data so every set is
 * auditable rather than hand-curated. Latin / kana / symbol sets have no such
 * source and are literal lists here.
 *
 * The output depends on the Unicode version, so UNICODE_VERSION is pinned and
 * recorded in the generated header. Bumping it can legitimately change a few
 * characters; run --check to see exactly which.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = resolve(ROOT, '.cache/charsets');
const OUT = resolve(ROOT, 'src/charsets/charsets-data.js');

/** Pinned so the output is reproducible. Bump deliberately, then run --check. */
const UNICODE_VERSION = '17.0.0';
const SOURCES = {
  'Unihan.zip': `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd/Unihan.zip`,
  'KSX1001.TXT': 'https://www.unicode.org/Public/MAPPINGS/OBSOLETE/EASTASIA/KSC/KSX1001.TXT',
};

const args = new Set(process.argv.slice(2));

//--- sources ------------------------------------------------------------------

function fetchSources() {
  mkdirSync(CACHE, { recursive: true });
  for (const [name, url] of Object.entries(SOURCES)) {
    const path = resolve(CACHE, name);
    if (existsSync(path) && !args.has('--fetch')) continue;
    process.stderr.write(`fetching ${url}\n`);
    execFileSync('curl', ['-sSL', '--fail', url, '-o', path], { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  if (!existsSync(resolve(CACHE, 'unihan/Unihan_IRGSources.txt'))) {
    execFileSync('unzip', ['-o', '-q', resolve(CACHE, 'Unihan.zip'), '-d', resolve(CACHE, 'unihan')]);
  }
}

/** Unihan field -> Map<codepoint, value>. @returns {Record<string, Map<number, string>>} */
function readUnihan() {
  /** @type {Record<string, Map<number, string>>} */
  const out = {};
  for (const file of ['Unihan_OtherMappings.txt', 'Unihan_IRGSources.txt', 'Unihan_DictionaryLikeData.txt']) {
    for (const line of readFileSync(resolve(CACHE, 'unihan', file), 'utf8').split('\n')) {
      if (!line || line[0] === '#') continue;
      const [cp, field, value] = line.split('\t');
      if (!field) continue;
      (out[field] ??= new Map()).set(parseInt(cp.slice(2), 16), value);
    }
  }
  return out;
}

/** KS X 1001 mapping -> the Unicode characters it encodes, split by kind. */
function readKsx1001() {
  const hangul = new Set();
  const hanja = new Set();
  for (const line of readFileSync(resolve(CACHE, 'KSX1001.TXT'), 'utf8').split('\n')) {
    if (!line || line[0] === '#') continue;
    const m = /^0x[0-9A-Fa-f]+\s+0x([0-9A-Fa-f]+)/.exec(line);
    if (!m) continue;
    const u = parseInt(m[1], 16);
    if (u >= 0xac00 && u <= 0xd7a3) hangul.add(u);
    // KS X 1001 encodes 268 hanja twice; the duplicates map to the
    // CJK Compatibility Ideographs block, so both blocks count.
    else if ((u >= 0x4e00 && u <= 0x9fff) || (u >= 0xf900 && u <= 0xfaff)) hanja.add(u);
  }
  return { hangul, hanja };
}

//--- set construction ---------------------------------------------------------

/** Characters above U+FFFF can never be encoded by u8g2 (uint16), so they are dropped. */
const bmp = (set) => new Set([...set].filter((c) => c <= 0xffff));
const union = (...sets) => bmp(new Set(sets.flatMap((s) => [...s])));
const keys = (map) => new Set(map.keys());
const range = (lo, hi) => new Set(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));

/** Row-cell fields (kJis0 / kGB0) select by the leading two digits. */
const byRow = (map, lo, hi) =>
  new Set(
    [...map]
      .filter(([, v]) => v.split(' ').some((x) => {
        const row = Number(x.slice(0, 2));
        return row >= lo && row <= hi;
      }))
      .map(([c]) => c),
  );

/** kIRG_KSource entries whose source designator matches. */
const bySource = (map, prefix) =>
  new Set([...map].filter(([, v]) => v.split(' ').some((x) => x.startsWith(prefix))).map(([c]) => c));
void bySource; // kept: the K-source route is the documented alternative to KSX1001.TXT

function buildSets() {
  const U = readUnihan();
  const ks = readKsx1001();

  // Han tiers are CUMULATIVE unions. The underlying standards do not nest
  // (Jōyō kanji has characters outside JIS level 1), so each tier is everything
  // below it plus one more standard; moving up a tier can never drop a character.
  const ja1 = bmp(keys(U.kJoyoKanji));
  const ja2 = union(ja1, keys(U.kJinmeiyoKanji));
  const ja3 = union(ja2, byRow(U.kJis0, 16, 47)); // JIS X 0208 level 1
  const ja4 = union(ja3, byRow(U.kJis0, 48, 84)); // + level 2

  const cn1 = bmp(byRow(U.kGB0, 16, 55)); // GB 2312 level 1
  const cn2 = union(cn1, byRow(U.kGB0, 56, 87)); // + level 2

  const big5 = new Map([...U.kBigFive].filter(([c]) => c <= 0xffff));
  const tw1 = new Set([...big5].filter(([, v]) => parseInt(v, 16) <= 0xc67e).map(([c]) => c)); // 常用字
  const tw2 = bmp(keys(big5)); // + 次常用字

  const ko1 = bmp(keys(U.kKoreanEducationHanja));
  const ko2 = union(ko1, ks.hanja);

  return {
    // Literal sets: no machine-readable standard defines these, so they are curated here.
    digits: range(0x30, 0x39),
    ascii: range(0x20, 0x7e),
    latinExt: range(0xa0, 0xff),
    hiragana: union(range(0x3041, 0x3096), range(0x309b, 0x309f)),
    katakana: range(0x30a1, 0x30ff),
    katakanaHalf: range(0xff61, 0xff9f),
    jaPunct: union(range(0x3000, 0x3019), range(0x301c, 0x301e), range(0x30fb, 0x30fc)),
    greek: union(range(0x391, 0x3a9), range(0x3b1, 0x3c9)),
    cyrillic: union(new Set([0x401, 0x451]), range(0x410, 0x44f)),
    // Derived sets.
    hanJa1: ja1,
    hanJa2: ja2,
    hanJa3: ja3,
    hanJa4: ja4,
    hanCn1: cn1,
    hanCn2: cn2,
    hanTw1: tw1,
    hanTw2: tw2,
    hanKo1: ko1,
    hanKo2: ko2,
    hanAll: range(0x4e00, 0x9fff),
    hangulKs: ks.hangul,
    hangulAll: range(0xac00, 0xd7a3),
    // Literal symbol sets.
    ...SYMBOLS,
  };
}

/** Symbol sets are editorial selections, kept as literal code point lists. */
const SYMBOLS = {
  symUnits: parse('B0,B5,2030,2103,2109,2113,3303,330D,3314,3318,3322-3323,3326-3327,332B,3336,333B,3349-334A,334D,3351,3357,3382-338C,338E-338F,339B-339E,33A1,33A5,33B2-33B3,33C4'),
  symMath: parse('AC,B1,D7,F7,21D2,21D4,2200,2202-2203,2207-2208,220B,220F,2211,221A-221B,221D-221E,2220,2227-222C,2234-2235,223D,2252,2260-2261,2264-2267,226A-226B,2282-2283,22A5,2312'),
  symArrows: parse('2190-2199,21B0-21B3,21D0-21D5,27F5-27F6'),
  symShapes: parse('25A0-25AF,25B2-25B9,25BC-25C3,25C6-25C9,25CB,25CE-25D5,25EF,2605-2606,2660-2667'),
  symCurrency: parse('24,A2-A5,20A9-20AE,20B1-20B2,20B4-20B5,20B8-20BA,20BD,20BF'),
  symEnclosed: parse('2460-2473,24B6-24E9,3297,3299,32A4-32A8'),
  symMisc: parse('A7,B6,2020-2022,2025-2026,2030,2032-2033,203B,2302,231A-231B,23F0-23F1,2600-2603,260E-260F,2611-2612,2669-266B,266D,266F,26A0-26A1,2713-2714,2717-2718'),
};

/** "START-END,SINGLE,..." hex list -> Set<number> */
function parse(spec) {
  const out = new Set();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map((x) => parseInt(x, 16));
    for (let c = a; c <= (b ?? a); c++) out.add(c);
  }
  return out;
}

/** Set<number> -> compact "START-END,SINGLE,..." hex list */
function format(set) {
  const cps = [...set].sort((a, b) => a - b);
  const parts = [];
  const hex = (v) => v.toString(16).toUpperCase();
  for (let i = 0; i < cps.length; ) {
    let j = i;
    while (j + 1 < cps.length && cps[j + 1] === cps[j] + 1) j++;
    parts.push(i === j ? hex(cps[i]) : `${hex(cps[i])}-${hex(cps[j])}`);
    i = j + 1;
  }
  return parts.join(',');
}

//--- emit ---------------------------------------------------------------------

function render(sets) {
  const L = [];
  L.push('// GENERATED by tools/gen-charsets.mjs. Do not edit by hand.');
  L.push('//');
  L.push('// Derived from Unicode\'s own data (Unihan kJoyoKanji / kJinmeiyoKanji / kJis0 /');
  L.push('// kGB0 / kBigFive / kKoreanEducationHanja, plus KSX1001.TXT) so every set is');
  L.push('// auditable, and from the literal symbol lists in that generator.');
  L.push('//');
  L.push('// Han tiers are CUMULATIVE unions: the underlying standards do not nest (Jōyō kanji');
  L.push('// has 34 characters outside JIS level 1), so each tier is defined as everything');
  L.push('// below it plus one more standard. Moving up a tier can therefore never drop a');
  L.push('// character.');
  L.push('//');
  L.push('// Characters above U+FFFF are excluded: the u8g2 format addresses glyphs with a');
  L.push('// uint16 encoding, so they can never be generated and would only produce a');
  L.push('// warning every project that selected them could do nothing about.');
  L.push(`//`);
  L.push(`// Unicode ${UNICODE_VERSION}. The derived sets depend on it; bump deliberately.`);
  L.push('// Values are compact "START-END,SINGLE,..." hex codepoint lists; expand them with');
  L.push('// parseRanges() from ./charsets.js.');
  L.push('export const SET_RANGES = {');
  for (const [id, set] of Object.entries(sets)) L.push(`  ${id}: '${format(set)}',`);
  L.push('};');
  L.push('');
  L.push('export const SET_COUNTS = {');
  for (const [id, set] of Object.entries(sets)) L.push(`  ${id}: ${set.size},`);
  L.push('};');
  L.push('');
  return L.join('\n');
}

fetchSources();
const text = render(buildSets());

if (args.has('--check')) {
  const current = readFileSync(OUT, 'utf8');
  if (current === text) {
    process.stderr.write('charsets-data.js is up to date\n');
  } else {
    process.stderr.write('charsets-data.js differs from a fresh generation\n');
    process.exitCode = 1;
  }
} else {
  writeFileSync(OUT, text);
  process.stderr.write(`wrote ${OUT}\n`);
}

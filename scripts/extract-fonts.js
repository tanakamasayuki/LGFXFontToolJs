// @ts-check
/**
 * LovyanGFX のソースから内蔵フォント 186 本を抽出し、
 * src/fonts/data/ のバイナリと src/fonts/catalog.js、NOTICE を生成する（仕様 §8.3）。
 *
 * 使い方:
 *   node scripts/extract-fonts.js --src <LovyanGFX のルート>
 *   node scripts/extract-fonts.js --fetch   # タグ固定で tarball を取得して展開
 *
 * 生成物はコミットする。利用者と CI はこのスクリプトを実行しない。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { decodeU8g2 } from '../src/format/u8g2.js';
import { decodeGfx, packGfxContainer } from '../src/format/gfxfont.js';
import { decodeGlcd } from '../src/format/glcd.js';
import { decodeFixedBmp } from '../src/format/fixedbmp.js';
import { decodeBmpFont } from '../src/format/bmpfont.js';
import { decodeRleFont } from '../src/format/rlefont.js';
import { packLegacyContainer } from '../src/format/legacy.js';

const LGFX_VERSION = '1.2.26';
const LGFX_TARBALL_URL = `https://github.com/lovyan03/LovyanGFX/archive/refs/tags/${LGFX_VERSION}.tar.gz`;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(repoRoot, 'src', 'fonts', 'data');
const cacheDir = join(repoRoot, '.cache');

// ---------------------------------------------------------------------------
// 入力ソースの用意

/** @returns {Promise<string>} LovyanGFX ルートディレクトリ */
async function resolveSource() {
  const argv = process.argv.slice(2);
  const srcIdx = argv.indexOf('--src');
  if (srcIdx >= 0 && argv[srcIdx + 1]) {
    return argv[srcIdx + 1];
  }
  const cached = join(cacheDir, `LovyanGFX-${LGFX_VERSION}`);
  if (existsSync(cached)) return cached;
  if (!argv.includes('--fetch')) {
    console.error('usage: extract-fonts.js --src <LovyanGFX root>  or  --fetch');
    process.exit(1);
  }
  console.log(`fetching ${LGFX_TARBALL_URL} ...`);
  const res = await fetch(LGFX_TARBALL_URL);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const gz = new Uint8Array(await res.arrayBuffer());
  const tar = gunzipSync(gz);
  mkdirSync(cacheDir, { recursive: true });
  untar(tar, cacheDir);
  if (!existsSync(cached)) throw new Error(`tarball did not contain LovyanGFX-${LGFX_VERSION}/`);
  return cached;
}

/**
 * 最小の tar 展開（通常ファイルのみ）。
 * @param {Uint8Array} tar
 * @param {string} destRoot
 */
function untar(tar, destRoot) {
  let pos = 0;
  const td = new TextDecoder();
  while (pos + 512 <= tar.length) {
    const header = tar.subarray(pos, pos + 512);
    pos += 512;
    if (header.every((b) => b === 0)) break;
    const name = td.decode(header.subarray(0, 100)).replace(/\0.*$/s, '');
    const sizeOctal = td.decode(header.subarray(124, 136)).replace(/\0.*$/s, '').trim();
    const size = parseInt(sizeOctal || '0', 8);
    const type = header[156];
    const prefix = td.decode(header.subarray(345, 500)).replace(/\0.*$/s, '');
    const fullName = prefix ? `${prefix}/${name}` : name;
    const blocks = Math.ceil(size / 512);
    if (type === 0x30 || type === 0) {
      // 通常ファイル
      const path = join(destRoot, fullName);
      if (!path.startsWith(destRoot)) throw new Error(`unsafe tar path: ${fullName}`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, tar.subarray(pos, pos + size));
    }
    pos += blocks * 512;
  }
}

// ---------------------------------------------------------------------------
// C ソースのパース部品

/** @param {string} text - コメントを取り除く（小さいファイル用） */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/**
 * 最小の C プリプロセッサ。ファイル内の #define を集め、
 * #ifdef / #ifndef / #else / #endif の分岐を解決して有効な行だけ残す。
 * （Font16.h の TFT_ESPI_FONT2_DOLLAR 等、フォントヘッダ内の字形切替に必要）
 * @param {string} text
 * @returns {string}
 */
function applyPreprocessor(text) {
  const defined = new Set();
  const out = [];
  /** @type {boolean[]} 各ネストの「この分岐は有効か」 */
  const stack = [];
  const active = () => stack.every((v) => v);
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    let m;
    if ((m = /^#\s*define\s+(\w+)/.exec(trimmed))) {
      if (active()) defined.add(m[1]);
      out.push(line);
    } else if ((m = /^#\s*ifdef\s+(\w+)/.exec(trimmed))) {
      stack.push(defined.has(m[1]));
    } else if ((m = /^#\s*ifndef\s+(\w+)/.exec(trimmed))) {
      stack.push(!defined.has(m[1]));
    } else if (/^#\s*else\b/.test(trimmed)) {
      stack.push(!(/** @type {boolean} */ (stack.pop())));
    } else if (/^#\s*endif\b/.test(trimmed)) {
      stack.pop();
    } else if (active()) {
      out.push(line);
    }
  }
  return out.join('\n');
}

/** @param {string} text - `0x..` / 10 進の数値リストをバイト列にする */
function parseByteList(text) {
  const bytes = [];
  const re = /0[xX][0-9a-fA-F]+|\d+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    bytes.push(Number(m[0]) & 0xff);
  }
  return Uint8Array.from(bytes);
}

/**
 * `NAME [...] = { ... };` の中身を取り出す。
 * @param {string} text
 * @param {string} symbol
 * @returns {string}
 */
function arrayBody(text, symbol) {
  const declRe = new RegExp(`${symbol}\\s*\\[[^\\]]*\\]\\s*(?:PROGMEM\\s*)?=`);
  const m = declRe.exec(text);
  if (!m) throw new Error(`array not found: ${symbol}`);
  const open = text.indexOf('{', m.index);
  const close = text.indexOf('};', open);
  if (open < 0 || close < 0) throw new Error(`array body not found: ${symbol}`);
  return text.slice(open + 1, close);
}

/**
 * C 文字列リテラル（連結された複数行）をバイト列にする。8 進・16 進エスケープ対応。
 * リテラルの外側で `;` に達したら終わる（リテラル内の ';' は데ータとして扱う）。
 * @param {string} text - ファイル全文
 * @param {number} start - `=` の直後
 * @returns {Uint8Array}
 */
function parseCStringLiterals(text, start) {
  const bytes = [];
  let i = start;
  const n = text.length;
  let inString = false;
  while (i < n) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') {
        inString = true;
        i++;
      } else if (ch === ';') {
        break;
      } else {
        i++;
      }
      continue;
    }
    if (ch === '"') {
      inString = false;
      i++;
      continue;
    }
    if (ch === '\\') {
      i++;
      const e = text[i];
      if (e >= '0' && e <= '7') {
        let oct = '';
        while (oct.length < 3 && text[i] >= '0' && text[i] <= '7') {
          oct += text[i++];
        }
        bytes.push(parseInt(oct, 8) & 0xff);
      } else if (e === 'x') {
        i++;
        let hex = '';
        while (/[0-9a-fA-F]/.test(text[i])) hex += text[i++];
        bytes.push(parseInt(hex, 16) & 0xff);
      } else {
        i++;
        const map = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '\\': 92, '"': 34, "'": 39, '?': 63 };
        const v = map[/** @type {keyof typeof map} */ (e)];
        if (v === undefined) throw new Error(`unknown escape \\${e}`);
        bytes.push(v);
      }
    } else {
      bytes.push(ch.charCodeAt(0));
      i++;
    }
  }
  return Uint8Array.from(bytes);
}

/**
 * u8g2 フォント（C 文字列リテラル形式）をファイルから 1 本取り出す。
 * @param {string} text - ファイル全文
 * @param {string} symbol
 * @returns {Uint8Array}
 */
function extractU8g2Array(text, symbol) {
  const declRe = new RegExp(`const uint8_t ${symbol}\\[(\\d+)\\]`);
  const m = declRe.exec(text);
  if (!m) throw new Error(`u8g2 array not found: ${symbol}`);
  const declaredSize = Number(m[1]);
  const eq = text.indexOf('=', m.index);
  const bytes = parseCStringLiterals(text, eq + 1);
  if (bytes.length !== declaredSize && bytes.length !== declaredSize - 1) {
    throw new Error(`${symbol}: parsed ${bytes.length} bytes, declared ${declaredSize}`);
  }
  // C の配列は文字列長 + 終端 NUL。宣言サイズまで 0 で埋めて C の実体と一致させる。
  const out = new Uint8Array(declaredSize);
  out.set(bytes);
  return out;
}

/**
 * GFXfont の .h をパースする。
 * @param {string} raw - ファイル全文
 * @param {string} name - フォント名（配列名の接頭辞）
 */
function parseGfxHeader(raw, name) {
  const text = stripComments(raw);
  const bitmap = parseByteList(arrayBody(text, `${name}Bitmaps`));
  const glyphBody = arrayBody(text, `${name}Glyphs`);
  /** @type {import('../src/format/gfxfont.js').GfxGlyphRec[]} */
  const glyphs = [];
  const tupleRe = /\{\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\}/g;
  let tm;
  while ((tm = tupleRe.exec(glyphBody)) !== null) {
    glyphs.push({
      bitmapOffset: Number(tm[1]),
      width: Number(tm[2]),
      height: Number(tm[3]),
      xAdvance: Number(tm[4]),
      xOffset: Number(tm[5]),
      yOffset: Number(tm[6]),
    });
  }
  const structRe = new RegExp(`const\\s+GFXfont\\s+${name}\\s+PROGMEM\\s*=\\s*\\{([\\s\\S]*?)\\};`);
  const sm = structRe.exec(text);
  if (!sm) throw new Error(`GFXfont struct not found: ${name}`);
  const nums = sm[1].match(/0[xX][0-9a-fA-F]+|\d+/g);
  if (!nums || nums.length < 3) throw new Error(`GFXfont struct malformed: ${name}`);
  const tail = nums.slice(-3).map(Number);
  return {
    first: tail[0],
    last: tail[1],
    yAdvance: tail[2],
    ranges: [],
    glyphs,
    bitmap,
  };
}

/**
 * BMP / RLE 系ヘッダ（Font16.h / Font32rle.h 等）をパースする。
 * @param {string} raw
 * @param {string} prefix - 'f16' | 'f32' | 'f64' | 'f7s' | 'f72'
 */
function parseLegacyVarHeader(raw, prefix) {
  const pre = applyPreprocessor(raw);
  const text = stripComments(pre);
  /** @param {string} key */
  const defineOf = (key) => {
    const m = new RegExp(`#define\\s+${key}\\s+(\\d+)`).exec(pre);
    if (!m) throw new Error(`define not found: ${key}`);
    return Number(m[1]);
  };
  const height = defineOf(`chr_hgt_${prefix}`);
  const baseline = defineOf(`baseline_${prefix}`);
  const widths = [...parseByteList(arrayBody(text, `widtbl_${prefix}`))];
  const orderBody = arrayBody(text, `chrtbl_${prefix}`);
  const order = orderBody.match(new RegExp(`chr_${prefix}_[0-9A-Fa-f]+`, 'g'));
  if (!order) throw new Error(`chrtbl empty: ${prefix}`);
  /** @type {Map<string, Uint8Array>} */
  const glyphArrays = new Map();
  const nameRe = new RegExp(`(chr_${prefix}_[0-9A-Fa-f]+)\\s*\\[[^\\]]*\\]\\s*=`, 'g');
  let nm;
  while ((nm = nameRe.exec(text)) !== null) {
    glyphArrays.set(nm[1], parseByteList(arrayBody(text, nm[1])));
  }
  const glyphData = order.map((sym) => {
    const bytes = glyphArrays.get(sym);
    if (!bytes) throw new Error(`glyph array not found: ${sym}`);
    return bytes;
  });
  if (widths.length !== glyphData.length) {
    throw new Error(`width table (${widths.length}) != glyph table (${glyphData.length}) for ${prefix}`);
  }
  return { height, baseline, widths, glyphData };
}

/**
 * ファイル先頭のブロックコメント（ライセンス表記）を取り出す。
 * @param {string} raw
 */
function leadingComment(raw) {
  const m = /^\s*\/\*([\s\S]*?)\*\//.exec(raw);
  return m ? m[1].trim() : '';
}

// ---------------------------------------------------------------------------
// フォント定義（lgfx_fonts.cpp v1.2.26 の実体定義と一致させる）

function u8g2Definitions() {
  /** @type {{name: string, symbol: string, file: string, license: string, copyright: string}[]} */
  const defs = [];
  const japan = [
    ['JapanMincho', 'mincho'],
    ['JapanMinchoP', 'mincho_p'],
    ['JapanGothic', 'gothic'],
    ['JapanGothicP', 'gothic_p'],
  ];
  for (const [fam, sym] of japan) {
    for (const size of [8, 12, 16, 20, 24, 28, 32, 36, 40]) {
      defs.push({
        name: `lgfx${fam}_${size}`,
        symbol: `lgfx_font_japan_${sym}_${size}`,
        file: 'src/lgfx/Fonts/IPA/lgfx_font_japan.c',
        license: 'IPA Font License Agreement v1.0',
        copyright: 'Copyright (c) Information-technology Promotion Agency, Japan (IPA), 2003-2019',
      });
    }
  }
  for (const cc of ['CN', 'JA', 'KR', 'TW']) {
    const lower = cc.toLowerCase();
    for (const size of [10, 12, 14, 16, 24]) {
      for (const variant of ['', '_b', '_bi', '_i']) {
        defs.push({
          name: `efont${cc}_${size}${variant}`,
          symbol: `lgfx_efont_${lower}_${size}${variant}`,
          file: `src/lgfx/Fonts/efont/lgfx_efont_${lower}.c`,
          license: 'efont (BSD-style, see NOTICE)',
          copyright: 'Copyright (c) 2000-2001 /efont/ The Electronic Font Open Laboratory',
        });
      }
    }
  }
  return defs;
}

function gfxDefinitions() {
  /** @type {{name: string, file: string, license: string, copyright: string}[]} */
  const defs = [];
  const freeStyles = ['', 'Bold', 'Oblique', 'BoldOblique'];
  const freeSerifStyles = ['', 'Bold', 'Italic', 'BoldItalic'];
  const sizes = [9, 12, 18, 24];
  for (const family of ['FreeMono', 'FreeSans', 'FreeSerif']) {
    const styles = family === 'FreeSerif' ? freeSerifStyles : freeStyles;
    for (const style of styles) {
      for (const size of sizes) {
        defs.push({
          name: `${family}${style}${size}pt7b`,
          file: `src/lgfx/Fonts/GFXFF/${family}${style}${size}pt7b.h`,
          license: 'GNU FreeFont (GPL with font exception, see NOTICE)',
          copyright: 'GNU FreeFont — Copyright the GNU FreeFont authors',
        });
      }
    }
  }
  defs.push({
    name: 'TomThumb',
    file: 'src/lgfx/Fonts/GFXFF/TomThumb.h',
    license: 'see NOTICE',
    copyright: 'Copyright 1999 Brian J. Swetland / Vassilii Khachaturov (see NOTICE)',
  });
  for (const custom of [
    'Orbitron_Light_24',
    'Orbitron_Light_32',
    'Roboto_Thin_24',
    'Satisfy_24',
    'Yellowtail_32',
    'DejaVu9',
    'DejaVu12',
    'DejaVu18',
    'DejaVu24',
    'DejaVu40',
    'DejaVu56',
    'DejaVu72',
  ]) {
    defs.push({
      name: custom,
      file: `src/lgfx/Fonts/Custom/${custom}.h`,
      license: 'see NOTICE',
      copyright: 'see NOTICE',
    });
  }
  return defs;
}

const LEGACY_DEFS = [
  {
    name: 'Font0',
    format: 'glcd',
    file: 'src/lgfx/Fonts/glcdfont.h',
    symbol: 'font',
    params: { width: 6, height: 8, baseline: 7, start: 0, end: 255, datawidth: 5 },
    license: 'BSD (Adafruit Industries, see NOTICE)',
    copyright: 'Copyright (c) 2012 Adafruit Industries',
  },
  {
    name: 'Font8x8C64',
    format: 'glcd',
    file: 'src/lgfx/Fonts/Font8x8C64.h',
    symbol: 'font8x8_c64',
    params: { width: 8, height: 8, baseline: 7, start: 32, end: 143, datawidth: 8 },
    license: 'see NOTICE',
    copyright: 'see NOTICE',
  },
  {
    name: 'AsciiFont8x16',
    format: 'fixedbmp',
    file: 'src/lgfx/Fonts/Ascii8x16.h',
    symbol: 'FontLib8x16',
    params: { width: 8, height: 16, baseline: 13, start: 0, end: 255 },
    license: 'see NOTICE',
    copyright: 'see NOTICE',
  },
  {
    name: 'AsciiFont24x48',
    format: 'fixedbmp',
    file: 'src/lgfx/Fonts/Ascii24x48.h',
    symbol: 'FontLib24x48',
    params: { width: 24, height: 48, baseline: 40, start: 32, end: 126 },
    license: 'see NOTICE',
    copyright: 'see NOTICE',
  },
  { name: 'Font2', format: 'bmp', file: 'src/lgfx/Fonts/Font16.h', prefix: 'f16', license: 'see NOTICE (TFT_eSPI heritage)', copyright: 'see NOTICE' },
  { name: 'Font4', format: 'rle', file: 'src/lgfx/Fonts/Font32rle.h', prefix: 'f32', license: 'see NOTICE (TFT_eSPI heritage)', copyright: 'see NOTICE' },
  { name: 'Font6', format: 'rle', file: 'src/lgfx/Fonts/Font64rle.h', prefix: 'f64', license: 'see NOTICE (TFT_eSPI heritage)', copyright: 'see NOTICE' },
  { name: 'Font7', format: 'rle', file: 'src/lgfx/Fonts/Font7srle.h', prefix: 'f7s', license: 'see NOTICE (TFT_eSPI heritage)', copyright: 'see NOTICE' },
  { name: 'Font8', format: 'rle', file: 'src/lgfx/Fonts/Font72rle.h', prefix: 'f72', license: 'see NOTICE (TFT_eSPI heritage)', copyright: 'see NOTICE' },
];

// ---------------------------------------------------------------------------
// カタログ用の計測

const ASCII_SET = (() => {
  const set = [];
  for (let cp = 0x20; cp <= 0x7e; cp++) set.push(cp);
  return set;
})();
const KANA_SET = (() => {
  const set = [];
  for (let cp = 0x3041; cp <= 0x3093; cp++) set.push(cp);
  for (let cp = 0x30a1; cp <= 0x30f6; cp++) set.push(cp);
  return set;
})();

/** @param {import('../src/model/font.js').Font} font */
function coverageOf(font) {
  const covered = [];
  if (ASCII_SET.every((cp) => font.glyphs.has(cp))) covered.push('ascii');
  if (KANA_SET.every((cp) => font.glyphs.has(cp))) covered.push('kana');
  return covered;
}

// ---------------------------------------------------------------------------

async function main() {
  const srcRoot = await resolveSource();
  console.log(`source: ${srcRoot}`);
  mkdirSync(dataDir, { recursive: true });

  /** @type {any[]} */
  const catalog = [];
  /** @type {string[]} */
  const noticeSections = [];

  /**
   * @param {string} name
   * @param {string} format
   * @param {string} file
   * @param {Uint8Array} bytes
   * @param {import('../src/model/font.js').Font} font
   * @param {object} extra
   */
  const addEntry = (name, format, file, bytes, font, extra) => {
    writeFileSync(join(dataDir, file), bytes);
    catalog.push({
      name,
      format,
      file,
      lineHeight: font.lineHeight,
      ascent: font.ascent,
      descent: font.descent,
      glyphCount: font.glyphs.size,
      dataBytes: bytes.length,
      coverage: coverageOf(font),
      ...extra,
    });
  };

  // --- u8g2 (116) ---
  /** @type {Map<string, string>} */
  const fileCache = new Map();
  const readSrc = (/** @type {string} */ rel) => {
    let text = fileCache.get(rel);
    if (text === undefined) {
      text = readFileSync(join(srcRoot, rel), 'utf8');
      fileCache.set(rel, text);
    }
    return text;
  };

  for (const def of u8g2Definitions()) {
    const text = readSrc(def.file);
    const bytes = extractU8g2Array(text, def.symbol);
    const font = decodeU8g2(bytes, { familyName: def.name });
    addEntry(def.name, 'u8g2', `${def.name}.u8g2`, bytes, font, {
      license: def.license,
      copyright: def.copyright,
    });
    console.log(`u8g2  ${def.name}: ${font.glyphs.size} glyphs, ${bytes.length} bytes`);
  }
  fileCache.clear();

  // --- GFXfont (61) ---
  for (const def of gfxDefinitions()) {
    const raw = readFileSync(join(srcRoot, def.file), 'utf8');
    const gfx = parseGfxHeader(raw, def.name);
    const bytes = packGfxContainer(gfx);
    const font = decodeGfx(bytes, { familyName: def.name });
    addEntry(def.name, 'gfx', `${def.name}.gfx`, bytes, font, {
      license: def.license,
      copyright: def.copyright,
    });
    const comment = leadingComment(raw);
    if (comment) noticeSections.push(`## ${def.name}\n\n${comment}`);
    console.log(`gfx   ${def.name}: ${font.glyphs.size} glyphs, ${bytes.length} bytes`);
  }

  // --- 旧形式 (9) ---
  for (const def of LEGACY_DEFS) {
    const raw = readFileSync(join(srcRoot, def.file), 'utf8');
    /** @type {Uint8Array} */
    let bytes;
    /** @type {import('../src/model/font.js').Font} */
    let font;
    /** @type {object} */
    let extra = { license: def.license, copyright: def.copyright };
    if (def.format === 'glcd') {
      bytes = parseByteList(arrayBody(stripComments(raw), /** @type {string} */ (def.symbol)));
      font = decodeGlcd(bytes, /** @type {any} */ (def.params), { familyName: def.name });
      extra = { ...extra, params: def.params, file: `${def.name}.glcd` };
      addEntry(def.name, 'glcd', `${def.name}.glcd`, bytes, font, extra);
    } else if (def.format === 'fixedbmp') {
      bytes = parseByteList(arrayBody(stripComments(raw), /** @type {string} */ (def.symbol)));
      font = decodeFixedBmp(bytes, /** @type {any} */ (def.params), { familyName: def.name });
      extra = { ...extra, params: def.params };
      addEntry(def.name, 'fixedbmp', `${def.name}.fbmp`, bytes, font, extra);
    } else if (def.format === 'bmp') {
      const parsed = parseLegacyVarHeader(raw, /** @type {string} */ (def.prefix));
      bytes = packLegacyContainer('LBMP', parsed);
      font = decodeBmpFont(bytes, { familyName: def.name });
      addEntry(def.name, 'bmp', `${def.name}.lbmp`, bytes, font, extra);
    } else {
      const parsed = parseLegacyVarHeader(raw, /** @type {string} */ (def.prefix));
      bytes = packLegacyContainer('LRLE', parsed);
      font = decodeRleFont(bytes, { familyName: def.name });
      addEntry(def.name, 'rle', `${def.name}.lrle`, bytes, font, extra);
    }
    const comment = leadingComment(raw);
    if (comment) noticeSections.push(`## ${def.name}\n\n${comment}`);
    console.log(`${def.format.padEnd(5)} ${def.name}: ${font.glyphs.size} glyphs, ${bytes.length} bytes`);
  }

  if (catalog.length !== 186) {
    throw new Error(`expected 186 fonts, got ${catalog.length}`);
  }

  // --- catalog.js ---
  const catalogJs = `// @ts-check
/**
 * Generated file. Regenerate with scripts/extract-fonts.js; do not edit manually.
 * Source: LovyanGFX ${LGFX_VERSION} (${LGFX_TARBALL_URL})
 */

export const collectionInfo = Object.freeze({
  lovyangfxVersion: '${LGFX_VERSION}',
  source: '${LGFX_TARBALL_URL}',
  fontCount: ${catalog.length},
});

/**
 * @typedef {object} CatalogEntry
 * @property {string} name
 * @property {string} format
 * @property {string} file
 * @property {number} lineHeight
 * @property {number} ascent
 * @property {number} descent
 * @property {number} glyphCount
 * @property {number} dataBytes
 * @property {string[]} coverage
 * @property {string} license
 * @property {string} copyright
 * @property {object} [params]
 */

/** @type {CatalogEntry[]} */
export const fontCatalog = ${JSON.stringify(catalog, null, 2)};
`;
  writeFileSync(join(repoRoot, 'src', 'fonts', 'catalog.js'), catalogJs);

  // --- NOTICE ---
  const ipaLicense = readFileSync(join(srcRoot, 'src/lgfx/Fonts/IPA/IPA_Font_License_Agreement_v1.0.txt'), 'utf8');
  const efontCopyright = readFileSync(join(srcRoot, 'src/lgfx/Fonts/efont/COPYRIGHT.txt'), 'utf8');
  const notice = `# NOTICE — 同梱フォントデータの帰属表示

本パッケージの src/fonts/data/ に含まれるフォントデータは
LovyanGFX ${LGFX_VERSION} (${LGFX_TARBALL_URL}) から抽出したものです。
ライブラリ本体のコード (MIT) とは別に、フォントごとに以下のライセンスが適用されます。

## lgfxJapanMincho / lgfxJapanGothic 系 (IPAex フォント由来)

${ipaLicense.trim()}

## efontJA / efontCN / efontKR / efontTW 系 (efont 由来)

${efontCopyright.trim()}

${noticeSections.join('\n\n')}
`;
  writeFileSync(join(repoRoot, 'NOTICE'), notice);

  // --- provenance ---
  writeFileSync(
    join(dataDir, 'README.md'),
    `# 生成物 — 手で編集しないこと

- 抽出元: LovyanGFX ${LGFX_VERSION}
- 取得 URL: ${LGFX_TARBALL_URL}
- 再生成: \`npm run extract-fonts -- --fetch\`
- ライセンス: リポジトリルートの NOTICE を参照
`,
  );

  const total = catalog.reduce((sum, e) => sum + e.dataBytes, 0);
  console.log(`\ndone: ${catalog.length} fonts, ${(total / 1024 / 1024).toFixed(1)} MB total`);
}

await main();

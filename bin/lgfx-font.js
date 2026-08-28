#!/usr/bin/env node
// @ts-check
/**
 * lgfx-font — embedded bitmap fonts from the command line (docs/cli.ja.md).
 *
 * Three commands. `build` is the tool; `inspect` and `charset` support it.
 * Everything works from arguments alone, so a one-off needs no config file and
 * repeated use is the same command saved in an npm script.
 *
 * Exit codes: 0 ok, 1 generation error, 2 --check mismatch, 3 bad arguments.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { dirname, basename, resolve } from 'node:path';
import { subset } from '../src/model/subset.js';
import { encode, listFormats } from '../src/format/registry.js';
import { encodeCSource, sanitizeIdent } from '../src/format/csource.js';
import { estimateSizes } from '../src/inspect/estimate.js';
import { inspect as inspectFont, coverage } from '../src/inspect/inspect.js';
import { parseRanges, codepointsOfSet, TEMPLATES, ALL_SET_IDS, countOf } from '../src/charsets/charsets.js';
import { SET_RANGES } from '../src/charsets/charsets-data.js';
import { packCellFont } from '../src/format/cellfont.js';
import { resolveSource, CliError } from './sources.js';
import { encodePng, renderSheet, renderText } from './render.js';

const C_EXT = /\.(h|hpp|c|cpp)$/i;

const OPTIONS = /** @type {const} */ ({
  // input
  google: { type: 'string' },
  ttf: { type: 'string' },
  font: { type: 'string' },
  input: { type: 'string' },
  'input-format': { type: 'string' },
  'input-symbol': { type: 'string' },
  em: { type: 'string' },
  // characters
  chars: { type: 'string', multiple: true },
  charset: { type: 'string', multiple: true },
  sets: { type: 'string', multiple: true },
  template: { type: 'string', multiple: true },
  // output
  format: { type: 'string' },
  out: { type: 'string' },
  name: { type: 'string' },
  target: { type: 'string' },
  'max-chain': { type: 'string' },
  bpp: { type: 'string' },
  threshold: { type: 'string' },
  // modes
  check: { type: 'boolean' },
  preview: { type: 'string' },
  'preview-text': { type: 'string' },
  'max-height': { type: 'string' },
  'allow-missing': { type: 'boolean' },
  offline: { type: 'boolean' },
  'cache-dir': { type: 'string' },
  // charset / inspect
  normalize: { type: 'boolean' },
  expand: { type: 'boolean' },
  list: { type: 'boolean' },
  write: { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
});

const USAGE = `lgfx-font — embedded bitmap fonts

  lgfx-font build   [options]          make font data
  lgfx-font inspect <file> [options]   report on an existing font
  lgfx-font charset <file> [options]   canonicalize / expand a character set

build — source (exactly one)
  --google <family>     curated Google Fonts family by name (--google --list)
  --ttf <path|url>      any TTF / OTF / WOFF / WOFF2
  --font <name>         bundled bitmap font
  --input <path>        bitmap font file (--input-format, --input-symbol)
  --em <px>             em size; a full-width character advances exactly this
                        much. Required for --google / --ttf.

build — characters (combined as a union)
  --chars <text>        every character in the text
  --charset <path>      character-set file
  --sets <id,...>       named sets (lgfx-font charset --list)
  --template <id>       named combination

build — output
  --format <id>         REQUIRED. cellfont u8g2 gfx vlw bff bdf fontx2
  --out <path>          .h/.hpp/.c/.cpp emit C source, anything else raw
  --name <ident>        C symbol name (default: from --out)
  --target ilp32|avr    cellfont: target ABI for candidate comparison
  --max-chain <n>       cellfont: chain-length limit (default 2)
  --bpp <n>             output depth where the format allows it
  --threshold <n>       1bpp threshold when rasterizing (default 128)

build — modes
  --check               verify the existing output instead of writing it
  --preview <path.png>  write a confirmation image
  --preview-text <text> render this text instead of the glyph sheet
  --max-height <n>      fail when the line box exceeds n pixels
  --allow-missing       warn instead of failing on absent characters
  --offline             use only cached downloads

charset
  --normalize           sort and de-duplicate each literal line
  --expand              expand @named sets to literal characters
  --list                list set and template ids with their sizes
  --write               rewrite the file in place (default: stdout)

inspect
  --json                machine-readable output
`;

/** @param {string} msg @param {number} [code] */
const fail = (msg, code = 1) => {
  throw new CliError(msg, code);
};

/** @param {string|undefined} v @param {string} flag */
function num(v, flag) {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) fail(`${flag}: not a number: ${v}`, 3);
  return n;
}

//--- characters ---------------------------------------------------------------

/**
 * Parses a character-set file: `#` comments, `@id` named sets, `U+..` ranges,
 * and literal characters (docs/cli.ja.md §11).
 * @param {string} text
 */
export function parseCharsetFile(text) {
  /** @type {Set<number>} */
  const out = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('@')) {
      const id = trimmed.slice(1);
      const cps = codepointsOfSet(id);
      if (!cps.length) fail(`unknown set: @${id}`, 3);
      for (const c of cps) out.add(c);
    } else if (/^U\+[0-9A-Fa-f]/.test(trimmed)) {
      for (const c of parseRanges(trimmed)) out.add(c);
    } else {
      for (const ch of line) {
        const cp = ch.codePointAt(0);
        if (cp !== undefined && cp !== 0x0a && cp !== 0x0d) out.add(cp);
      }
    }
  }
  return out;
}

/** @param {Record<string, any>} v */
function collectCodepoints(v) {
  /** @type {Set<number>} */
  const out = new Set();
  for (const text of v.chars ?? []) for (const ch of text) out.add(/** @type {number} */ (ch.codePointAt(0)));
  for (const path of v.charset ?? []) {
    if (!existsSync(path)) fail(`--charset: no such file: ${path}`, 3);
    for (const c of parseCharsetFile(readFileSync(path, 'utf8'))) out.add(c);
  }
  for (const spec of v.sets ?? []) {
    for (const id of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
      const cps = codepointsOfSet(id);
      if (!cps.length) fail(`unknown set: ${id}`, 3);
      for (const c of cps) out.add(c);
    }
  }
  for (const id of v.template ?? []) {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) fail(`unknown template: ${id}`, 3);
    for (const sid of t.sets ?? []) for (const c of codepointsOfSet(sid)) out.add(c);
    for (const ch of t.text ?? '') out.add(/** @type {number} */ (ch.codePointAt(0)));
    for (const c of parseRanges(t.ranges ?? '')) out.add(c);
  }
  return [...out].sort((a, b) => a - b);
}

//--- build --------------------------------------------------------------------

/** @param {Record<string, any>} v */
async function cmdBuild(v) {
  if (v.list && v.google !== undefined) {
    const { FONTS } = await import('../web/googlefonts.js');
    for (const f of FONTS) console.log(`${f.family}  (${f.script}, ${f.license.id})`);
    return;
  }
  if (!v.format) {
    console.error('--format is required. Available formats:');
    for (const f of listFormats().filter((x) => x.encode)) console.error(`  ${f.id.padEnd(10)} ${f.name}`);
    console.error('  cellfont   CellFont v1 (C source only)');
    fail('missing --format', 3);
  }
  if (!v.out) fail('--out is required', 3);

  const codepoints = collectCodepoints(v);
  if (codepoints.length === 0) fail('no characters selected (--chars / --charset / --sets / --template)', 1);

  const cache = v['cache-dir'] ?? resolve('node_modules/.cache/lgfx-font-tool');
  const src = await resolveSource({
    google: v.google,
    ttf: v.ttf,
    font: v.font,
    input: v.input,
    inputFormat: v['input-format'],
    inputSymbol: v['input-symbol'],
    em: num(v.em, '--em'),
    bpp: /** @type {1|8} */ (num(v.bpp, '--bpp') === 8 ? 8 : 1),
    threshold: num(v.threshold, '--threshold'),
    codepoints,
    cache,
    offline: Boolean(v.offline),
  });

  // Bitmap sources hold more than was asked for, so cut them down.
  const font = subset(src.font, codepoints);
  const missing = codepoints.filter((c) => !font.glyphs.has(c));
  if (missing.length) {
    const show = missing.slice(0, 20).map((c) => String.fromCodePoint(c)).join('');
    const msg = `${missing.length} character(s) are not in the source: ${show}${missing.length > 20 ? '…' : ''}`;
    if (!v['allow-missing']) fail(`${msg}\nPass --allow-missing to continue without them.`);
    console.error(`warning: ${msg}`);
  }

  const lineBox = font.ascent + font.descent;
  const maxHeight = num(v['max-height'], '--max-height');
  if (maxHeight !== undefined && lineBox > maxHeight) {
    fail(`line box is ${lineBox}px, over --max-height ${maxHeight}. Try a smaller --em.`);
  }

  const isC = C_EXT.test(v.out);
  const name = sanitizeIdent(v.name ?? basename(v.out).replace(/\.[^.]+$/, ''));
  let output;
  let form = v.format;
  if (v.format === 'cellfont') {
    if (!isC) fail('cellfont has no raw form; --out must be a C source file', 3);
    const packed = packCellFont(font, {
      abi: v.target === 'avr' ? 'avr' : 'ilp32',
      maxChain: num(v['max-chain'], '--max-chain') ?? 2,
    });
    form = `${packed.candidate}, ${packed.chain.length} font(s)`;
    output = Buffer.from(
      encodeCSource(font, {
        format: 'cellfont',
        symbolName: name,
        attribution: src.attribution,
        abi: v.target === 'avr' ? 'avr' : 'ilp32',
        maxChain: num(v['max-chain'], '--max-chain') ?? 2,
      }),
      'utf8',
    );
  } else if (isC) {
    if (!['u8g2', 'gfx', 'vlw', 'bff'].includes(v.format)) {
      fail(`${v.format} has no C source form; use a raw --out extension`, 3);
    }
    output = Buffer.from(
      encodeCSource(font, {
        format: v.format,
        symbolName: name,
        attribution: src.attribution,
        bpp: /** @type {1|2|4} */ (num(v.bpp, '--bpp')),
      }),
      'utf8',
    );
  } else {
    if (v.format === 'cellfont') fail('cellfont has no raw form', 3);
    output = Buffer.from(encode(font, { format: v.format, bpp: num(v.bpp, '--bpp') }));
  }

  const previous = existsSync(v.out) ? readFileSync(v.out) : null;
  if (v.check) {
    if (!previous) fail(`--check: ${v.out} does not exist`, 2);
    if (!previous.equals(output)) {
      fail(`--check: ${v.out} differs from a fresh build. Regenerate and commit it.`, 2);
    }
    console.error(`${v.out}  up to date  ${output.length} B`);
  } else {
    mkdirSync(dirname(resolve(v.out)), { recursive: true });
    writeFileSync(v.out, output);
    const delta = previous ? ` (${output.length - previous.length >= 0 ? '+' : ''}${output.length - previous.length})` : '';
    const maxInk = Math.max(...[...font.glyphs.values()].map((g) => g.bitmap.height));
    console.error(
      `${v.out}  ${output.length} B${delta}  ${font.glyphs.size} glyphs  ` +
        `line ${lineBox}  tallest ink ${maxInk}\n  ${form}`,
    );
  }

  if (v.preview) {
    const img = v['preview-text']
      ? renderText(font, v['preview-text'])
      : renderSheet(font);
    mkdirSync(dirname(resolve(v.preview)), { recursive: true });
    writeFileSync(v.preview, encodePng(img.gray, img.width, img.height));
    console.error(`${v.preview}  ${img.width}x${img.height}`);
  }
}

//--- inspect ------------------------------------------------------------------

/** @param {string} file @param {Record<string, any>} v */
async function cmdInspect(file, v) {
  if (!existsSync(file)) fail(`no such file: ${file}`, 3);
  const src = await resolveSource({
    input: file,
    inputFormat: v['input-format'],
    inputSymbol: v['input-symbol'],
    codepoints: [],
    cache: '',
    offline: true,
  });
  const font = src.font;
  const info = inspectFont(font);
  const sizes = estimateSizes(font);
  if (v.json) {
    console.log(JSON.stringify({ file, info, sizes: Object.fromEntries(Object.entries(sizes).map(([k, s]) => [k, s.bytes])) }, null, 2));
    return;
  }
  console.log(`${file}`);
  console.log(`  family    ${font.familyName || '(unnamed)'} ${font.styleName}`);
  console.log(`  glyphs    ${font.glyphs.size}`);
  console.log(`  metrics   line ${font.lineHeight}  ascent ${font.ascent}  descent ${font.descent}`);
  console.log(`  source    ${font.meta.sourceFormat ?? '?'}`);
  if (font.meta.issues.length) {
    console.log(`  issues    ${font.meta.issues.map((i) => i.code).join(', ')}`);
  }
  console.log('  sizes');
  for (const [id, s] of Object.entries(sizes)) {
    console.log(`    ${id.padEnd(9)} ${s.bytes === null ? 'cannot encode' : `${s.bytes} B`}`);
  }
  void coverage;
  void info;
}

//--- charset ------------------------------------------------------------------

/** @param {string|undefined} file @param {Record<string, any>} v */
function cmdCharset(file, v) {
  if (v.list) {
    console.log('sets');
    for (const id of ALL_SET_IDS) console.log(`  ${id.padEnd(14)} ${countOf(id)}`);
    const extra = Object.keys(SET_RANGES).filter((id) => !ALL_SET_IDS.includes(id));
    if (extra.length) {
      console.log('sets (defined but not offered in the web UI)');
      for (const id of extra) console.log(`  ${id.padEnd(14)} ${countOf(id)}`);
    }
    console.log('templates');
    for (const t of TEMPLATES) console.log(`  ${t.id}`);
    return;
  }
  if (!file) fail('charset needs a file (or --list)', 3);
  const text = readFileSync(file, 'utf8');
  const bom = text.startsWith('﻿') ? '﻿' : '';

  if (v.expand) {
    const cps = [...parseCharsetFile(text)].sort((a, b) => a - b);
    const chars = cps.map((c) => String.fromCodePoint(c)).join('');
    process.stdout.write(bom + chars.replace(/(.{64})/gu, '$1\n') + '\n');
    return;
  }

  // Canonicalize each literal line on its own: moving characters between lines
  // would break the correspondence with the comments around them.
  const out = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#') || t.startsWith('@') || /^U\+/i.test(t)) return line;
      const cps = [...new Set([...line].map((ch) => ch.codePointAt(0)))].sort((a, b) => a - b);
      return cps.map((c) => String.fromCodePoint(/** @type {number} */ (c))).join('');
    })
    .join('\n');
  if (v.write) {
    writeFileSync(file, bom + out);
    console.error(`${file}  normalized`);
  } else {
    process.stdout.write(bom + out);
  }
}

//--- entry --------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE);
    return;
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: argv.slice(1),
      options: /** @type {any} */ (OPTIONS),
      allowPositionals: true,
    });
  } catch (e) {
    throw new CliError(/** @type {Error} */ (e).message, 3);
  }
  const v = /** @type {Record<string, any>} */ (parsed.values);
  if (v.help) {
    process.stdout.write(USAGE);
    return;
  }
  const positionals = parsed.positionals;

  switch (command) {
    case 'build':
      return cmdBuild(v);
    case 'inspect':
      if (!positionals[0]) throw new CliError('inspect needs a file', 3);
      return cmdInspect(positionals[0], v);
    case 'charset':
      return cmdCharset(positionals[0], v);
    default:
      throw new CliError(`unknown command: ${command}\n\n${USAGE}`, 3);
  }
}

main().catch((e) => {
  const code = e instanceof CliError ? e.exitCode : 1;
  console.error(`lgfx-font: ${e.message}`);
  process.exit(code);
});

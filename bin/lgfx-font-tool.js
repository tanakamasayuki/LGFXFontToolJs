#!/usr/bin/env node
// @ts-check
/**
 * lgfx-font-tool — embedded bitmap fonts from the command line (docs/cli.ja.md).
 *
 * Three commands. `build` is the tool; `inspect` and `charset` support it.
 * Everything works from arguments alone, so a one-off needs no config file and
 * repeated use is the same command saved in an npm script.
 *
 * Exit codes: 0 ok, 1 generation error, 2 --check mismatch, 3 bad arguments.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { dirname, basename, resolve, relative } from 'node:path';
import { subset } from '../src/model/subset.js';
import { encode, listFormats } from '../src/format/registry.js';
import { encodeCSource, sanitizeIdent } from '../src/format/csource.js';
import { estimateSizes } from '../src/inspect/estimate.js';
import { inspect as inspectFont, coverage } from '../src/inspect/inspect.js';
import { parseRanges, codepointsOfSet, TEMPLATES, ALL_SET_IDS, countOf } from '../src/charsets/charsets.js';
import { SET_RANGES } from '../src/charsets/charsets-data.js';
import { packCellFont } from '../src/format/cellfont.js';
import { resolveSource, defaultCacheDir, CliError } from './sources.js';
import { encodePng, renderSheet, renderText } from './render.js';

const C_EXT = /\.(h|hpp|c|cpp)$/i;

/**
 * Which version is installed. Read from package.json rather than hardcoded, so
 * `npm version` stays the only place a release number is written.
 */
const VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

/**
 * Flags recorded in the generated file's "Rebuild with" line, in this order.
 *
 * The order is fixed rather than as-typed so that the same build always writes
 * the same line, which is what keeps the output canonical. Flags that do not
 * change the file are left out: --check, --preview, --preview-text,
 * --max-height, --offline, --cache-dir, --json. --allow-missing is kept because
 * without it the rebuild would stop.
 *
 * `--out` is deliberately absent. Where the file is written is not part of what
 * the file contains, and recording it made one font put in four directories into
 * four different files — which defeats copying a generated header around, and
 * strays from the format spec's "same input, same bytes" (the input being the
 * character set, yAdvance, and target ABI). `--name` is recorded instead, and
 * always: the symbol name really is part of the emitted source, and without
 * `--out` there is nothing left to derive it from.
 */
const REPRO_FLAGS = /** @type {const} */ ([
  'google', 'ttf', 'font', 'input', 'input-format', 'input-symbol',
  'em', 'chars', 'charset', 'sets', 'template', 'fallback',
  'format', 'name', 'target', 'max-chain', 'no-wrapper', 'bpp', 'threshold',
  'allow-missing', 'pin-version',
]);

/** Values that name a file, and so need shortening. */
const REPRO_PATHS = new Set(['ttf', 'input', 'charset', 'template', 'fallback']);

/**
 * A path under the working directory is recorded relative to it; anything else
 * is reduced to its file name. The line then neither leaks nor depends on one
 * machine's layout — the cost is that a font from elsewhere has to be put back
 * by hand, which is unavoidable for a local file anyway.
 *
 * The decision is made after resolving, so how the path was written does not
 * matter: `../../elsewhere/x.ttf` is outside the working directory just as
 * `/home/someone/x.ttf` is, and both come out as `x.ttf`. Separators are
 * normalized so the line reads the same whichever OS produced it.
 * @param {string} v
 */
function tidyPath(v) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v; // URL, or google:family
  const rel = relative(process.cwd(), resolve(v));
  const out = rel === '' || rel.startsWith('..') ? basename(v) : rel;
  return out.replaceAll('\\', '/');
}

const NEEDS_QUOTE = /[\s"'\\$&|;<>()*?\[\]{}!#`~]/;

/**
 * Flags whose value is literal text rather than an identifier, path, or id.
 * These are always quoted: `--chars ℃` needs no quoting to run, but it reads as
 * if one went missing, and the quotes are what show where the text ends.
 */
const QUOTE_ALWAYS = new Set(['chars']);

/**
 * @param {string} v
 * @param {boolean} [always]
 */
const shellArg = (v, always) =>
  // A value starting with `-` would be read back as a flag, and an empty one
  // would vanish, so both are quoted whatever they contain.
  always || v === '' || v.startsWith('-') || NEEDS_QUOTE.test(v)
    ? `'${v.split("'").join(`'\\''`)}'`
    : v;

/**
 * The command that reproduces the output file.
 *
 * One line, however long. Wrapping it with a trailing backslash reads better
 * but does not survive being copied: every continuation line is still inside the
 * `//` comment, so what lands in the shell is commented out.
 *
 * The command and the package share one name, so `npx lgfx-font-tool build` both
 * names the package to fetch and the binary to run. Keep them the same: npx
 * resolves its first argument against the registry, so a command named anything
 * else needs the two-part `npx -p <package> <command>` for every reader.
 *
 * The tool version is left out unless `--pin-version` asks for it. Without a
 * version npx resolves the latest, so a rebuild can pick up a release that
 * changes the shape of the output; with one it cannot, but then every upgrade
 * rewrites every generated header. Which of those costs is worth paying is the
 * project's call, so it is a flag rather than a default. The flag records itself,
 * so rerunning the recorded command reproduces the same header.
 *
 * @param {Record<string, any>} v parsed options
 * @param {string} ident the C symbol name actually used
 */
function reproCommand(v, ident) {
  const pin = v['pin-version'] ? `@${VERSION}` : '';
  const parts = [`npx lgfx-font-tool${pin} build`];
  for (const flag of REPRO_FLAGS) {
    // Always the resolved symbol name, whether or not --name was given.
    const val = flag === 'name' ? ident : v[flag];
    if (val === undefined) continue;
    if (val === true) {
      parts.push(`--${flag}`);
      continue;
    }
    for (const one of Array.isArray(val) ? val : [val]) {
      const value = REPRO_PATHS.has(flag) ? tidyPath(one) : one;
      parts.push(`--${flag} ${shellArg(value, QUOTE_ALWAYS.has(flag))}`);
    }
  }
  return parts.join(' ');
}

const OPTIONS = /** @type {const} */ ({
  // input
  google: { type: 'string' },
  ttf: { type: 'string' },
  fallback: { type: 'string', multiple: true },
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
  'no-wrapper': { type: 'boolean' },
  'pin-version': { type: 'boolean' },
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
  'list-google': { type: 'boolean' },
  write: { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
});

const USAGE = `lgfx-font-tool — embedded bitmap fonts

  lgfx-font-tool build   [options]          make font data
  lgfx-font-tool inspect <file> [options]   report on an existing font
  lgfx-font-tool charset <file> [options]   canonicalize / expand a character set
  lgfx-font-tool --version                  print the installed version

build — source (exactly one)
  --google <family>     curated Google Fonts family by name (--list-google)
  --ttf <path|url>      any TTF / OTF / WOFF / WOFF2
  --font <name>         bundled bitmap font
  --input <path>        bitmap font file (--input-format, --input-symbol)
  --em <px>             em size; a full-width character advances exactly this
                        much. Required for --google / --ttf.
  --fallback <spec>     take characters the source lacks from this typeface;
                        repeatable, tried in order. Same notation as the source:
                        google:<family>, or a path / url.

build — characters (combined as a union)
  --chars <text>        every character in the text
  --charset <path>      character-set file
  --sets <id,...>       named sets (lgfx-font-tool charset --list)
  --template <id>       named combination

build — output
  --format <id>         REQUIRED. cellfont u8g2 gfx vlw bff bdf fontx2
  --out <path>          .h/.hpp/.c/.cpp emit C source, anything else raw
  --name <ident>        C symbol name (default: from --out)
  --target ilp32|avr    cellfont: target ABI for candidate comparison
  --max-chain <n>       cellfont: chain-length limit (default 2)
  --no-wrapper          u8g2: emit the data array only, without the
                        lgfx::U8g2font object, for use with upstream u8g2
  --pin-version         record this tool's version in the rebuild command, so
                        the rebuild cannot pick up a different one
  --bpp <n>             output depth where the format allows it
  --threshold <n>       1bpp threshold when rasterizing (default 128)

build — modes
  --check               verify the existing output instead of writing it
  --preview <path.png>  write a confirmation image
  --preview-text <text> render this text instead of the glyph sheet
  --max-height <n>      fail when the line box exceeds n pixels
  --allow-missing       warn instead of failing on absent characters
  --offline             use only cached downloads
  --cache-dir <path>    where downloads are cached (default: the user cache dir)

build — listing
  --list-google         print the curated Google Fonts families

charset (normalizing is the default action)
  --normalize           explicit form of the default: sort and de-duplicate each literal line
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
    for (const id of String(spec).split(',').map((/** @type {string} */ x) => x.trim()).filter(Boolean)) {
      const cps = codepointsOfSet(id);
      if (!cps.length) fail(`unknown set: ${id}`, 3);
      for (const c of cps) out.add(c);
    }
  }
  for (const id of v.template ?? []) {
    const t = /** @type {any} */ (TEMPLATES.find((x) => x.id === id));
    if (!t) return fail(`unknown template: ${id}`, 3);
    for (const sid of t.sets ?? []) for (const c of codepointsOfSet(sid)) out.add(c);
    for (const ch of t.text ?? '') out.add(/** @type {number} */ (ch.codePointAt(0)));
    for (const c of parseRanges(t.ranges ?? '')) out.add(c);
  }
  return [...out].sort((a, b) => a - b);
}

//--- build --------------------------------------------------------------------

/** @param {Record<string, any>} v */
async function cmdBuild(v) {
  if (v['list-google']) {
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
  if (v['no-wrapper'] && v.format !== 'u8g2') {
    fail(`--no-wrapper applies to --format u8g2; ${v.format} declares no LovyanGFX type`, 3);
  }

  const codepoints = collectCodepoints(v);
  if (codepoints.length === 0) fail('no characters selected (--chars / --charset / --sets / --template)', 1);

  const cache = v['cache-dir'] ?? defaultCacheDir();
  const src = await resolveSource({
    google: v.google,
    ttf: v.ttf,
    fallbacks: v.fallback,
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

  const mismatch = src.font.meta.issues.find((i) => i.code === 'MERGE_METRICS_MISMATCH');
  if (mismatch) {
    // The base font's line box is kept, so filled glyphs may sit differently.
    // Say so: the alternative — silently rescaling — is worse.
    console.error(
      'warning: the filled characters were drawn to different metrics than the base font.\n' +
        `  base: ${JSON.stringify(/** @type {any} */ (mismatch.params).base)}\n` +
        `  fill: ${JSON.stringify(/** @type {any} */ (mismatch.params).overlay)}\n` +
        '  The base font\'s line box is kept. Check the result with --preview.',
    );
  }
  for (const f of src.filled ?? []) {
    const show = f.codepoints.slice(0, 20).map((c) => String.fromCodePoint(c)).join('');
    console.error(
      `filled ${f.codepoints.length} character(s) from ${f.spec}: ${show}` +
        (f.codepoints.length > 20 ? '…' : ''),
    );
  }

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
  const attribution = { ...src.attribution, command: reproCommand(v, name) };
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
        attribution,
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
        attribution,
        wrapper: !v['no-wrapper'],
        bpp: /** @type {any} */ (num(v.bpp, '--bpp')),
      }),
      'utf8',
    );
  } else {
    if (v.format === 'cellfont') fail('cellfont has no raw form', 3);
    output = Buffer.from(
      encode(font, { format: v.format, bpp: /** @type {any} */ (num(v.bpp, '--bpp')) }),
    );
  }

  const previous = existsSync(v.out) ? readFileSync(v.out) : null;
  if (v.check) {
    if (!previous) return fail(`--check: ${v.out} does not exist`, 2);
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
    const bytes = Object.fromEntries(Object.entries(sizes).map(([k, s]) => [k, s.bytes]));
    console.log(JSON.stringify({ file, info, sizes: bytes }, null, 2));
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
  if (!file) return fail('charset needs a file (or --list)', 3);
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
      /** @type {number[]} */
      const cps = [...line].map((ch) => /** @type {number} */ (ch.codePointAt(0)));
      return [...new Set(cps)].sort((a, b) => a - b).map((c) => String.fromCodePoint(c)).join('');
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
  // Before parseArgs, so it works without a subcommand — which is how everyone
  // asks a tool its version.
  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write(`${VERSION}\n`);
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
  console.error(`lgfx-font-tool: ${e.message}`);
  process.exit(code);
});

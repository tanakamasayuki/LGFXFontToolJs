// @ts-check
/**
 * Resolving a CLI font source into the neutral model (docs/cli.ja.md §4).
 *
 * Four inputs: a curated Google Fonts family by name, any TTF by path or URL, a
 * bundled bitmap font by name, or a bitmap font file. The first two rasterize
 * and need `em`; the last two are already bitmaps and are fully deterministic.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { decode } from '../src/format/registry.js';
import { decodeCSource } from '../src/format/csource.js';
import { loadFont } from '../src/fonts/loader.js';
import { merge } from '../src/model/subset.js';
import { fontCoverage } from './coverage.js';

/** @typedef {import('../src/model/font.js').Font} Font */

class CliError extends Error {
  /** @param {string} message @param {number} [code] */
  constructor(message, code = 1) {
    super(message);
    this.exitCode = code;
  }
}
export { CliError };

//--- rasterizer ---------------------------------------------------------------

/**
 * The library rasterizer draws with FontFace + canvas, which Node lacks. Skia
 * via @napi-rs/canvas provides both, so a small shim lets the existing code run
 * unchanged (docs/cli.ja.md §13.1).
 *
 * Only the target typeface is registered: inheriting the host's fonts would let
 * a system font draw a glyph the typeface does not have, which the presence
 * check would then report as present.
 */
async function installRasterizer() {
  if (typeof globalThis.FontFace !== 'undefined') return;
  let canvas;
  try {
    canvas = await import('@napi-rs/canvas');
  } catch (e) {
    // Two different failures: the package is absent, or it is present but has
    // no prebuilt binary for this platform. Telling someone to install what
    // they already have sends them in a circle.
    const err = /** @type {any} */ (e);
    if (err?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new CliError(
        'TTF input needs the rasterizer. Install it with:\n' +
          '  npm install @napi-rs/canvas\n' +
          'Bitmap sources (--font / --input) work without it.',
      );
    }
    throw new CliError(
      `TTF input needs the rasterizer, and @napi-rs/canvas has no prebuilt binary for\n` +
        `this platform (${process.platform}/${process.arch}). Reinstalling will not help.\n` +
        'Use --font or --input with a bitmap font, or rasterize on a supported platform.\n' +
        `Underlying error: ${err?.message ?? err}`,
    );
  }
  const { createCanvas, GlobalFonts } = canvas;
  const registered = new Set();
  // @ts-expect-error shimming a browser global
  globalThis.FontFace = class FontFace {
    /** @param {string} family @param {ArrayBuffer|string} src */
    constructor(family, src) {
      this.family = family;
      this._src = src;
      this.unicodeRange = 'U+0-10FFFF';
    }
    async load() {
      const bytes =
        typeof this._src === 'string'
          ? readFileSync(new URL(this._src))
          : Buffer.from(/** @type {ArrayBuffer} */ (this._src));
      GlobalFonts.register(bytes, this.family);
      return this;
    }
  };
  globalThis.document = /** @type {any} */ ({
    fonts: {
      add: (/** @type {any} */ f) => registered.add(f),
      delete: (/** @type {any} */ f) => registered.delete(f),
      get size() {
        return registered.size;
      },
      [Symbol.iterator]: () => registered[Symbol.iterator](),
    },
    createElement: () => createCanvas(1, 1),
  });
  // @ts-expect-error shimming a browser global
  globalThis.OffscreenCanvas = class {
    /** @param {number} w @param {number} h */
    constructor(w, h) {
      return createCanvas(w, h);
    }
  };
}

//--- fetching -----------------------------------------------------------------

/**
 * Where downloaded fonts live. A typeface is shared material rather than a
 * per-project build artifact, so it belongs in the user's cache rather than in
 * one project's node_modules — otherwise running from a subdirectory re-fetches
 * megabytes. CI overrides it with --cache-dir to put it inside the workspace.
 */
export function defaultCacheDir() {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'lgfx-font-tool');
}

/** Google Fonts serves TTF only to a non-browser User-Agent; browsers get sliced woff2. */
const TTF_UA = 'Wget/1.20';

/** @param {Buffer|Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {string} dir */
const cacheDir = (dir) => {
  mkdirSync(dir, { recursive: true });
  return dir;
};

/**
 * @param {string} url
 * @param {{cache: string, offline: boolean, ua?: string}} opts
 * @returns {Promise<Buffer>}
 */
async function fetchCached(url, opts) {
  const key = createHash('sha256').update(url).digest('hex').slice(0, 32);
  const path = join(cacheDir(opts.cache), key);
  if (existsSync(path)) return readFileSync(path);
  if (opts.offline) {
    throw new CliError(`--offline: ${url} is not in the cache (${opts.cache})`);
  }
  const res = await fetch(url, { headers: opts.ua ? { 'user-agent': opts.ua } : {} });
  if (!res.ok) throw new CliError(`fetch failed: ${url} (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  return buf;
}

/**
 * Resolves a curated family name to its TTF.
 * @param {string} family
 * @param {{cache: string, offline: boolean}} opts
 */
async function googleTtf(family, opts) {
  const { FONTS } = await import('../web/googlefonts.js');
  const entry = FONTS.find((f) => f.family.toLowerCase() === family.toLowerCase());
  if (!entry) {
    throw new CliError(
      `unknown Google Fonts family: ${family}\n` +
        'Run `lgfx-font build --google --list` for the curated set, or download the\n' +
        'font yourself and pass it with --ttf.',
      3,
    );
  }
  const cssUrl =
    'https://fonts.googleapis.com/css2?family=' +
    encodeURIComponent(entry.family).replace(/%20/g, '+') +
    ':wght@400';
  const css = (await fetchCached(cssUrl, { ...opts, ua: TTF_UA })).toString('utf8');
  const m = /url\((https:\/\/[^)]+)\)/.exec(css);
  if (!m) throw new CliError(`Google Fonts returned no font URL for ${entry.family}`);
  const ttf = await fetchCached(m[1], { ...opts, ua: TTF_UA });
  return { bytes: ttf, entry };
}

//--- public -------------------------------------------------------------------

/**
 * Resolves one typeface spec into bytes plus its attribution.
 *
 * A spec is `google:<family>` for a curated family, or a path / URL to a font
 * file — the same notation as the primary source, so there is one syntax.
 *
 * @param {string} spec
 * @param {{cache: string, offline: boolean}} opts
 */
export async function resolveTypeface(spec, opts) {
  if (spec.startsWith('google:')) {
    const { bytes, entry } = await googleTtf(spec.slice('google:'.length), opts);
    const origin = `Google Fonts: ${entry.family}`;
    return {
      bytes,
      origin,
      attribution: {
        typeface: entry.family,
        author: entry.by,
        license: entry.license.name,
        licenseUrl: entry.license.url,
        origin,
        sourceHash: sha256(bytes),
      },
    };
  }
  const bytes = /^https?:/.test(spec) ? await fetchCached(spec, opts) : readFileSync(spec);
  // A relative path stays stable across machines; an absolute one would not.
  const origin = /^https?:/.test(spec) ? spec : spec.replace(process.cwd() + '/', '');
  return { bytes, origin, attribution: { origin, sourceHash: sha256(bytes) } };
}

/**
 * Rasterizes the characters this typeface actually contains.
 *
 * Skia substitutes a system font for anything the typeface lacks, so the code
 * points are filtered by the font's own cmap first (see coverage.js). Without
 * that, a Latin face would appear to carry kanji drawn by whatever the host has
 * installed. When the coverage cannot be read the request goes through
 * unfiltered, with a warning, because refusing would be worse than degrading.
 *
 * @param {Uint8Array} bytes
 * @param {number[]} codepoints
 * @param {{em: number, bpp?: 1|8, threshold?: number, label: string}} opts
 */
async function rasterize(bytes, codepoints, opts) {
  const { generateFont } = await import('../src/gen/generate.js');
  const cov = fontCoverage(bytes);
  let wanted = codepoints;
  if ('codepoints' in cov) {
    wanted = codepoints.filter((c) => cov.codepoints.has(c));
  } else {
    process.stderr.write(
      `warning: cannot read the coverage of ${opts.label} (${cov.unavailable}).\n` +
        '  Characters it does not have may be drawn by a system font instead.\n',
    );
  }
  if (wanted.length === 0) return { font: null, missing: codepoints };
  // Sets, not filters over arrays: a full kanji request is several thousand
  // code points and this runs once per typeface.
  const inside = new Set(wanted);
  const outside = codepoints.filter((c) => !inside.has(c));
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const r = await generateFont({
    source: /** @type {ArrayBuffer} */ (buf),
    em: opts.em,
    codepoints: wanted,
    bpp: opts.bpp ?? 1,
    threshold: opts.threshold ?? 128,
  });
  return { font: r.font, missing: [...outside, ...r.missing].sort((a, b) => a - b) };
}

/**
 * Fills what the base font is missing from the fallback typefaces, in order.
 *
 * The same loop serves both kinds of source. A bitmap source starts with a font
 * and no missing set — the characters it lacks are found by subsetting — while a
 * rasterized source starts with what its own cmap could supply.
 *
 * @param {Font | null} base
 * @param {number[]} missing
 * @param {string[]} fallbacks typeface specs, tried in order
 * @param {{em: number, bpp?: 1|8, threshold?: number}} draw
 * @param {{cache: string, offline: boolean}} where
 */
async function fillFrom(base, missing, fallbacks, draw, where) {
  let font = base;
  /** @type {{spec: string, codepoints: number[]}[]} */
  const filled = [];
  /** @type {object[]} */
  const used = [];
  for (const fb of fallbacks) {
    if (missing.length === 0) break;
    const t = await resolveTypeface(fb, where);
    const r = await rasterize(t.bytes, missing, { ...draw, label: t.origin });
    const still = new Set(r.missing);
    const got = missing.filter((c) => !still.has(c));
    missing = r.missing;
    if (got.length === 0) continue;
    font = font === null ? r.font : merge(font, /** @type {Font} */ (r.font));
    filled.push({ spec: fb, codepoints: got });
    // Each contributing typeface keeps its own license block in the output.
    used.push({ ...t.attribution, filled: got.length });
  }
  return { font, missing, filled, used };
}

/**
 * @param {object} opts
 * @param {string} [opts.google]
 * @param {string} [opts.ttf]
 * @param {string} [opts.font]
 * @param {string} [opts.input]
 * @param {string} [opts.inputFormat]
 * @param {string} [opts.inputSymbol]
 * @param {number} [opts.em]
 * @param {1|8} [opts.bpp]
 * @param {number} [opts.threshold]
 * @param {string[]} [opts.fallbacks] - typeface specs tried in order for missing characters
 * @param {number[]} opts.codepoints
 * @param {string} opts.cache
 * @param {boolean} opts.offline
 * @returns {Promise<{font: Font, missing: number[], origin: string, attribution: object,
 *   filled: {spec: string, codepoints: number[]}[]}>}
 */
export async function resolveSource(opts) {
  const o = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (opts));
  const chosen = ['google', 'ttf', 'font', 'input'].filter((k) => o[k] !== undefined);
  if (chosen.length !== 1) {
    throw new CliError('pass exactly one of --google / --ttf / --font / --input', 3);
  }

  // Bitmap sources: no rasterizer, no em, fully deterministic.
  if (opts.font !== undefined || opts.input !== undefined) {
    let font;
    let origin;
    /** @type {string|undefined} */
    let hash;
    if (opts.font !== undefined) {
      font = await loadFont(opts.font);
      origin = `bundled:${opts.font}`;
    } else {
      const path = /** @type {string} */ (opts.input);
      const bytes = new Uint8Array(readFileSync(path));
      // A relative path stays stable across machines; an absolute one would not.
      origin = path.startsWith('/') ? path.replace(process.cwd() + '/', '') : path;
      hash = sha256(bytes);
      if (opts.inputFormat === 'csource' || /\.(h|hpp|c|cpp)$/i.test(path)) {
        const found = decodeCSource(Buffer.from(bytes).toString('utf8'));
        const list = Array.isArray(found) ? found : [found];
        const picked = opts.inputSymbol
          ? list.find((f) => f.name === opts.inputSymbol)
          : list[0];
        if (!picked) {
          // An empty list means the file held nothing this tool can read back.
          // Say which forms are readable rather than reporting a missing symbol.
          if (list.length === 0) {
            throw new CliError(
              `no readable font in ${path}. C source input reads GFXfont and u8g2 headers; ` +
                'CellFont headers cannot be read back. To add characters to a CellFont, ' +
                'rerun the command in its "Rebuild with" comment with the extra characters.',
            );
          }
          throw new CliError(
            `no font named ${opts.inputSymbol ?? '(unnamed)'} in ${path}. Found: ` +
              list.map((f) => f.name).join(', '),
          );
        }
        font = picked.font;
      } else {
        font = decode(bytes, opts.inputFormat ? { format: opts.inputFormat } : {});
      }
    }
    /** @type {object} */
    const own = { typeface: font.familyName || undefined, origin, sourceHash: hash };
    if (!opts.fallbacks?.length) {
      return { font, missing: [], filled: [], origin, attribution: own };
    }
    // Adding characters to a font you already have: the ones it does not carry
    // are rasterized from the fallbacks and merged in. Metrics may not agree —
    // the base font's line box wins, and the caller is warned.
    if (opts.em === undefined) {
      throw new CliError('--em is required when --fallback is used', 3);
    }
    await installRasterizer();
    const r = await fillFrom(
      font,
      opts.codepoints.filter((c) => !font.glyphs.has(c)),
      opts.fallbacks,
      { em: opts.em, bpp: opts.bpp, threshold: opts.threshold },
      { cache: opts.cache, offline: opts.offline },
    );
    return {
      font: /** @type {Font} */ (r.font),
      missing: r.missing,
      filled: r.filled,
      origin,
      attribution: r.used.length ? { ...own, fallbacks: r.used } : own,
    };
  }

  // Rasterized sources.
  if (opts.em === undefined) throw new CliError('--em is required for --google / --ttf', 3);
  await installRasterizer();

  const draw = { em: opts.em, bpp: opts.bpp, threshold: opts.threshold };
  const where = { cache: opts.cache, offline: opts.offline };

  const spec = opts.google !== undefined ? `google:${opts.google}` : /** @type {string} */ (opts.ttf);
  const primary = await resolveTypeface(spec, where);
  const first = await rasterize(primary.bytes, opts.codepoints, { ...draw, label: primary.origin });
  const r = await fillFrom(first.font, first.missing, opts.fallbacks ?? [], draw, where);

  if (r.font === null) {
    throw new CliError(`no requested character is present in ${primary.origin}`, 1);
  }
  return {
    font: r.font,
    missing: r.missing,
    filled: r.filled,
    origin: primary.origin,
    attribution: r.used.length
      ? { ...primary.attribution, fallbacks: r.used }
      : primary.attribution,
  };
}

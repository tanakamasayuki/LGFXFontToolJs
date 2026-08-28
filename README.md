# LGFX Font Tool JS

**JavaScript toolkit for embedded bitmap fonts — decode, encode, convert, render and generate.**

[日本語 README](./README.ja.md) · [Changelog](./CHANGELOG.md) ·
[![npm](https://img.shields.io/npm/v/lgfx-font-tool)](https://www.npmjs.com/package/lgfx-font-tool)
[![CI](https://github.com/tanakamasayuki/LGFXFontToolJs/actions/workflows/ci.yml/badge.svg)](https://github.com/tanakamasayuki/LGFXFontToolJs/actions/workflows/ci.yml)

Decoders and encoders for u8g2 / GFXfont (Adafruit GFX) / BDF / VLW / BFF / FONTX2 /
LovyanGFX internal formats, a text rendering engine that matches LovyanGFX
pixel-for-pixel, and a bundled collection of all 186 fonts built into LovyanGFX v1.2.26.
Plain ESM with zero runtime dependencies and no build step — runs in Node.js and the browser.

- **Read** — decode 11 formats, with auto-detection from magic numbers. A `.h` you
  found on GitHub (GFXfont / u8g2 C source) parses as-is
- **Render** — a faithful port of LovyanGFX v1.2.26 `drawString`. Scaling, text datum
  and per-format quirks included: **byte-exact** against 1,860 cases drawn by the real thing
- **Convert** — any format to any format through a neutral model. When something
  doesn't fit, it never silently truncates — you get a list of violations with stable codes
- **Generate** — rasterize TTF/OTF/WOFF in the browser into a new bitmap font,
  filling missing characters from fallback typefaces
- **Shrink & grow** — subsetting (a clock font can be 11 glyphs / 188 bytes),
  merging from other fonts, and text-coverage checks for CI

## Web apps (no install)

| App | What it does |
| --- | --- |
| [Viewer](https://tanakamasayuki.github.io/LGFXFontToolJs/viewer.html) | Browse all 186 built-in fonts with pixel-exact preview |
| [Generator](https://tanakamasayuki.github.io/LGFXFontToolJs/generator.html) | TTF / Google Fonts → u8g2 / GFXfont / BDF / 8bpp VLW / 1–4bpp BFF, with AA preview, charset selection, fallback fill-in and automatic header attribution |
| [Converter](https://tanakamasayuki.github.io/LGFXFontToolJs/converter.html) | Drop a font file / C source, convert between formats |
| [Inspector](https://tanakamasayuki.github.io/LGFXFontToolJs/inspector.html) | Coverage, metrics, size comparison across every format, text checks |

## Install

[lgfx-font-tool on npm](https://www.npmjs.com/package/lgfx-font-tool):

```sh
npm install lgfx-font-tool
```

Or straight from a CDN in the browser. Pin the version so a future release
cannot change your application without a code change:

```html
<script type="module">
  import { loadFont, drawString }
    from 'https://cdn.jsdelivr.net/npm/lgfx-font-tool@2.2.1/dist/lgfx-font-tool.min.js';
</script>
```

## From the command line

The package ships an `lgfx-font` command. A one-off and a CI run are the same command.

```sh
# A font holding just the characters you need, from a Google Fonts family by name
npx -p lgfx-font-tool lgfx-font build --google "Noto Sans JP" --em 12 \
    --chars "温度設定完了 23.5℃" --format cellfont --out font.h

# With a confirmation image
npx -p lgfx-font-tool lgfx-font build --font lgfxJapanGothic_12 --sets ascii,hiragana \
    --format u8g2 --out font.h --preview font.png

# CI: check the committed output is current, writing nothing
npx -p lgfx-font-tool lgfx-font build ... --check
```

Installing is optional — `npx` fetches it. To pin it, check it, or upgrade it:

```sh
npm i -D lgfx-font-tool          # pin it in the project (do this for CI)
lgfx-font --version              # the version that is running
npm ls lgfx-font-tool            # the version installed here
npm i -D lgfx-font-tool@latest   # upgrade
```

Full reference: [docs/cli.en.md](docs/cli.en.md) ([日本語](docs/cli.ja.md)).

### About the TTF rasterizer

`--ttf` and `--google` rasterize a TTF, which needs a rasterizer
(`@napi-rs/canvas`). **`npm install lgfx-font-tool` brings it along**, so normally
there is nothing to do (33 MB of platform binaries come with it).

| Source | Rasterizer |
| --- | --- |
| `--google <family>` / `--ttf <path\|url>` | **required** |
| `--font <name>` (bundled) / `--input <path>` (a file) | not needed |

It is an **optional dependency** so that **`npm install` still succeeds on an OS or
CPU with no prebuilt binary**. The rasterizer is needed by two of the four sources,
so its absence should not block the whole package.

If you installed with `--omit=optional`, or you are on a platform with no prebuilt
binary, pointing the CLI at a TTF tells you what to do. Bitmap sources keep working.

```
lgfx-font: TTF input needs the rasterizer. Install it with:
  npm install @napi-rs/canvas
Bitmap sources (--font / --input) work without it.
```

## Ten lines to first pixels

```js
import { loadFont, createBitmap, drawString, textWidth, fontHeight, bitmapToText }
  from 'lgfx-font-tool';

const font = await loadFont('lgfxJapanGothic_16');   // from the bundled collection
const bmp = createBitmap(textWidth(font, 'Hello'), fontHeight(font), 1);
drawString(bmp, font, 'Hello', 0, 0);
console.log(bitmapToText(bmp));                      // text-art dump
// bmp.data is a 1bpp bitmap you can send to a device as-is
```

Conversion is decode → encode:

```js
import { decode, canEncode, encode } from 'lgfx-font-tool';

const font = decode(bytes);                     // format auto-detected
const check = canEncode(font, 'u8g2');          // ask before you write
const out = encode(font, { format: 'u8g2' });   // throws with issues if it won't fit
```

Subset and emit an Arduino header:

```js
import { loadFont, subset, encodeCSource } from 'lgfx-font-tool';

const clock = subset(await loadFont('lgfxJapanGothic_24'), '0123456789:./ ');
const header = encodeCSource(clock, { format: 'u8g2', symbolName: 'clockFont' });
// → #include "clockFont.h" and display.setFont(&clockFont);
```

## Supported formats

| Format | Decode | Encode | Used by |
| --- | :-: | :-: | --- |
| u8g2 | ✔ | ✔ | u8g2 / LovyanGFX (RLE-compressed, usually smallest) |
| GFXfont (GFX1) | ✔ | ✔ | Adafruit GFX / LovyanGFX |
| BDF | ✔ | ✔ | X11 / interchange (text format) |
| VLW | ✔ | ✔ | Processing / TFT_eSPI Smooth Font (8bpp anti-aliased) |
| BFF | ✔ | ✔ | LVGL lv_font_conv / LovyanGFX |
| FONTX2 | ✔ | ✔ | Japanese retro/embedded ecosystem (Shift_JIS mapping built in) |
| C source | ✔ | ✔ | Arduino `.h` files (extracts / emits GFXfont and u8g2) |
| GLCD / FixedBMP / LBMP / LRLE | ✔ | — | LovyanGFX internal formats |

## Why you can trust the pixels

The renderer is not "close enough". It is verified byte-for-byte against the **real
LovyanGFX** (built natively with the lang-ship:host core) on 1,860 cases covering all
186 fonts and every drawing condition — plus 36 cases where fonts **encoded by this
library** are loaded and drawn by the real LovyanGFX, proving the encoders write what
LovyanGFX expects ([oracle/](./oracle/README.ja.md)). Fixtures are committed, so a
regular `npm test` needs no native build.

## Bundled fonts and package size

All 186 fonts built into LovyanGFX v1.2.26 ship with a searchable catalog. The npm
package carries the 70 lightweight ones (~320KB); the large CJK fonts (42MB total) are
fetched automatically from GitHub Pages on first `loadFont`. The tarball is 562KB.

For offline use or a private mirror, point the loader elsewhere:

```js
import { configureFontData } from 'lgfx-font-tool';
configureFontData({ baseUrl: 'https://intra.example.com/lgfx-fonts/' });
// In Node, file:///opt/lgfx-fonts/ works too
```

## Documentation

| Document | Contents |
| --- | --- |
| [Beginner's guide](./docs/guide-beginner.en.md) ([日本語](./docs/guide-beginner.ja.md)) | Starts from "what is a font" |
| [Use-case guide](./docs/guide-usecases.en.md) ([日本語](./docs/guide-usecases.ja.md)) | Recipes: pick, render, generate, convert, CI checks… |
| [Advanced guide](./docs/guide-advanced.en.md) ([日本語](./docs/guide-advanced.ja.md)) | Internals, pixel-exactness, encoding constraints, extending |
| [Specification](./docs/spec.en.md) ([日本語](./docs/spec.ja.md)) | Normative spec (use cases, design decisions, format details) |
| [CLI specification](./docs/cli.en.md) ([日本語](./docs/cli.ja.md)) | The `lgfx-font` command: inputs, character sets, outputs, CI use |
| [CellFont format](./docs/formats/cellfont.en.md) ([日本語](./docs/formats/cellfont.ja.md)) | Normative spec for the low-footprint bitmap font format, v1 |

Minimal one-file samples live in [examples/](./examples/) (Node and browser).

## Development

```sh
npm install
npm run check          # tests + typecheck + layer lint + locale lint
npm test               # node:test (includes the oracle exact-match suite)
npm run serve          # web apps at http://localhost:8080/web/, samples at /examples/
npm run build          # dist/ (bundle + bundled fonts)
npm run build:site     # site/ (what GitHub Pages serves)
npm run extract-fonts  # re-extract bundled fonts from LovyanGFX sources
npm run oracle         # regenerate oracle fixtures with a native LovyanGFX build
```

Design in one breath: plain ESM + JSDoc (no TypeScript syntax; `npm run types` emits
.d.ts), zero runtime dependencies, and no I/O inside `src/` (two audited exceptions,
machine-checked in CI). See the [specification](./docs/spec.en.md) for the rest. Publishing to npm is a
three-line copy-paste — see the [release procedure](./docs/release.en.md).

## License

MIT. See [LICENSE](./LICENSE).
Attribution for bundled font data lives in [NOTICE](./NOTICE).
Headers emitted by the Generator carry the source typeface's license and attribution
automatically.

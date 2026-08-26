# LGFXFontToolJs Specification v0.1 (draft)

[日本語版](./spec.ja.md)

- Audience: implementers of this repository
- Status: **Phases 1–4 implemented (including the four web screens: Viewer / Generator / Converter / Inspector).** This document is kept up to date with the implementation
- Last updated: 2026-08-16

Reference material: per-format constraints and the sources of the measured data are documented in [FONT_FORMATS.ja.md (LGFXScreenBuilder)](https://github.com/tanakamasayuki/LGFXScreenBuilder/blob/main/docs/FONT_FORMATS.ja.md).

## 1. Overview

**LGFXFontToolJs** is a general-purpose library for reading, writing, converting, rendering, and generating embedded bitmap fonts from JavaScript.

At its core is a UI-independent library; a browser-based font viewer / converter / generator is provided as the official reference implementation. The web app is published on GitHub Pages.

Tagline:

> JavaScript toolkit for embedded bitmap fonts — decode, encode, convert, render and generate.
> Read, convert, draw, and create embedded bitmap fonts — in JavaScript and the browser.

### 1.1 Positioning — LovyanGFX as the anchor, general-purpose in application

This library is tied to no particular use case and no particular project. However, LovyanGFX v1.2.26 serves as the standard for what counts as correct (the oracle). This relationship is made explicit here.

- **What we borrow from LovyanGFX** — the inventory of supported formats, the data of its 186 built-in fonts, the drawing semantics (rules for advance width, datum, and scaling), and the environment for verifying correctness
- **What we do not depend on LovyanGFX for** — API design, the neutral model, and usage scenarios. u8g2 fonts are directly useful to users of the u8g2 library, GFXfont to users of Adafruit GFX, VLW to users of TFT_eSPI / Processing, and BDF to users of font-authoring tools

### 1.2 Use cases

We first define the usage patterns this library must support. The functional specifications (§5–§11) and the implementation order (§17) must all be traceable back to this table.

| # | Use case | Typical flow | Available from Phase |
| --- | --- | --- | --- |
| **UC1** | **Creating a new font** — build a bitmap font from arbitrary font data (TTF / OTF / WOFF) with the required character set, size, and depth | `generateFont` (§10) → check that it fits with `canEncode` (§7) → `encode` / `encodeCSource` (§6.3) | 2 |
| **UC2** | **Building a font catalog** — list what typeface each existing font is, which characters it includes, and how much space it consumes, as material for font selection | For built-in fonts: `fontCatalog` (§8). For arbitrary fonts: `decode` → `inspect` / `coverage` / `estimateSize` (§11). Type specimens are drawn with `drawString` | Built-in: 1 / arbitrary: 3 |
| **UC3** | **Reproducing the rendering of an existing font** — draw in JS with the exact font data that will ship on the device, to verify layout and character placement (screen builders, print previews, and the like) | `loadFont` / `decode` → `drawString` / `measureText` (§9). Byte-exact match with LovyanGFX at 1bpp (§13.1) | 1 |
| **UC4** | **Growing or shrinking the character set** — drop unneeded characters from an existing font to save space; add missing characters via fallback fill from another font or a TTF | Shrink: `subset` (§5.2) → `encode`. Grow: prepare a fill source (`decode` another font, or generate just the missing part via UC1), then `merge` (§5.2) → `encode` | 2 |
| **UC5** | **Format conversion / porting** — carry fonts across ecosystems: a GFXfont `.h` picked up on GitHub to u8g2, u8g2 to BDF for editing in a font editor and back, and so on | `decode` / `decodeCSource` → `canEncode` (with a report of why something "doesn't fit") → `encode` | 2–3 |
| **UC6** | **Pre-shipping validation of string coverage** — match the app's list of display strings against the font and catch tofu (missing glyphs) before shipping. Runs on Node, so it can be wired into CI | `coverage(font, strings)` (§11) | 3 |
| **UC7** | **Baking in fixed strings** — when there is no room to ship a whole font, render strings at build time and embed them as 1bpp image assets | `loadFont` → `drawString` on Node. Producing an image format is the caller's job (§9.1) | 1 |
| **UC8** | **Hand-editing glyphs / building icon fonts** — fix glyphs in a pixel editor, or assemble a homemade font of nothing but symbol glyphs | The neutral model is a plain `Map` + `Bitmap`, so a UI can edit it directly (§5.2) → `encode` | 2 |
| **UC9** | **Validating and debugging font data** — verify that a font produced by another tool, or one found in the wild, is not broken and draws as intended | `decode` (reads even broken input, attaching issues, §6.1) → `drawString` (the oracle-verified renderer serves as the reference for comparison, §13) | 1–3 |

UC4 may look like a variant of UC1, but it differs in that the input is an existing bitmap font and never passes through a rasterizer. Growing also requires merging with a fill source (`merge`). That source may be another bitmap font, or one generated from a TTF for just the missing characters (UC1) — both end up in the neutral model, so the merge is one and the same operation.

### 1.3 The four design pillars

1. **Library First** — every feature can be invoked without a UI. The web app is merely a consumer of the same public API distributed on npm.
2. **Hub model** — conversion always goes through the neutral model. Decoders map each format → neutral model; encoders map the neutral model → each format. For N formats this takes 2N building blocks instead of N×N converters.
3. **Pixel Exact** — rendering is a byte-exact match with LovyanGFX at 1bpp. "Roughly right" does not count as a result.
4. **Buildless** — the source is plain ESM and can be `import`ed as-is, with no build step. Zero runtime dependencies. `dist/` exists only for convenience.

### 1.4 The big picture

```text
      TTF / WebFont ──(generate)────┐                      ┌─→ u8g2
      u8g2 ─────────────────────────┤                      ├─→ GFXfont
      GFXfont ──────────────────────┤                      ├─→ BDF
      BDF ──────────────────────────┼─→  neutral model  ───┼─→ VLW
      GLCD / BMP / RLE /            │    (Font/Glyph)      ├─→ C/C++ source
      FixedBMP ─────────────────────┤        ↑↓            ├─→ JSON (serialization)
      VLW ──────────────────────────┤   subset / merge     │
      C/C++ source ─────────────────┤   / inspect          └─→ rendering (1bpp / 8bpp)
      built-in collection (186) ────┘
```

---

## 2. Scope

### 2.1 Supported formats

| Format | Primary habitat | Depth | Decoder | Encoder | Phase |
| --- | --- | --- | --- | --- | --- |
| **u8g2** | u8g2 / LovyanGFX (all its built-in CJK fonts use this) | 1 | Required | Required | D:1 / E:2 |
| **GFXfont** | Adafruit GFX / LovyanGFX / countless `.h` files in the wild | 1 | Required | Required | D:1 / E:2 |
| **BDF** | fontforge / otf2bdf / bdfconv / X11 — **the linchpin of interoperability** | 1 | Required | Required | 3 |
| **VLW** | TFT_eSPI (Smooth Font) / Processing / LovyanGFX | 8 | Required | Required | 3 |
| GLCDfont | LovyanGFX (Font0, Font8x8C64) | 1 | Required | Optional | 1 |
| FixedBMPfont | LovyanGFX (AsciiFont8x16, AsciiFont24x48) | 1 | Required | Optional | 1 |
| BMPfont | LovyanGFX (Font2) | 1 | Required | Optional | 1 |
| RLEfont | LovyanGFX (Font4/6/7/8) | 1 | Required | Optional | 1 |
| **C/C++ source** | Arduino sketches / font distribution on GitHub | — | Required | Required | D:3 / E:2 |
| **TTF / OTF / WOFF** | Input for generation | — | **Input only** (§10) | — | 2 |
| BFF | LovyanGFX (in reality the LVGL lv_font_conv format; has kerning) | 1–4 | Supported | Supported | 4 (implemented; kern records are passed through opaquely = preserved across round-trips without interpretation) |
| fontx2 | Veteran format of Japanese embedded work (the FatFs world) | 1 | Supported | Supported | 4 (implemented; SJIS↔Unicode uses the Encoding Standard's shift_jis) |

- "C/C++ source" is treated as an independent format. In substance it is a "text ⇄ byte sequence" layer, orthogonal to binary formats such as u8g2 / GFXfont (§6.3).
- Field-level format specifications are written up as `docs/formats/<format>.ja.md` at implementation time; this document carries only the constraints and key points (§6.2, §7.3).

### 2.2 Built-in font collection

The **186 built-in fonts** of LovyanGFX v1.2.26 (116 u8g2, 61 GFXfont, 2 GLCD, 2 FixedBMP, 1 BMP, 4 RLE) are bundled with the package. They ship as a catalog (name, format, metrics, character count, license) plus binary data, so a font can be loaded instantly by name alone (§8).

### 2.3 Out of scope (things we explicitly do not do)

- **Abstracting the drawing target.** Output stops at the library's own `Bitmap` (1bpp / 8bpp coverage values). Blitting to Canvas / ImageData / terminals and assigning colors is the caller's job (helpers are shown in the examples).
- **Layout.** Line wrapping, columns, rectangle placement, ruby annotations. Single-line rendering and measurement only.
- **Typesetting.** Applying kerning, ligatures, complex text layout. BFF kerning information is **kept in the model but never applied**.
- **Automatic font retrieval / server communication.** Google Fonts integration and the like belong to the caller (LGFXScreenBuilder has a precedent).
- **Outline font output.** TTF is input-only. No reverse conversion from bitmap to outline.
- **A homegrown TTF parser.** Glyph rasterization is delegated to the browser (§10). We do not interpret cmap or hinting ourselves.

### 2.4 Supported environments

- **Browsers** — all features. TTF rasterization (§10) is browser-only.
- **Node.js (>= 20)** — everything except TTF rasterization (decoding, encoding, rendering, inspection, built-in fonts). All tests and CI run on Node.
- No dependence on any particular framework. Just `import` the plain ESM.

---

## 3. Key design decisions

So that "why is it this way" never has to be relitigated during implementation, the decisions and their rationale are recorded here.

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | **Write plain JavaScript (ESM), not TypeScript. Express types with JSDoc** | Same policy as the sibling project (esp-flashjs). `tsc` is used only as a type checker, never as a transpiler |
| 2 | **Zero runtime dependencies. No TTF parser such as opentype.js** | Rasterization is delegated to the browser's `FontFace` + Canvas. The approach is proven in LGFXScreenBuilder's fontgen, and everything the browser accepts (TTF / OTF / WOFF / WOFF2 / variable fonts) becomes valid input |
| 3 | **npm ships a single package with a single entry point** | Font data is not included in the bundle (#5), so with code alone there is little motivation to split. A runtime guard that throws `CapabilityError` when the rasterizer is invoked outside a browser is sufficient. Keeping the `exports` subpaths (`./src/*`) leaves a migration path to splitting later |
| 4 | **Conversion always goes through the neutral model. No direct format-to-format conversion APIs** | 2N instead of N×N. Direct conversions as an optimization are not worth the combinatorial explosion of byte-exact match tests they would cost |
| 5 | **Built-in font binaries are committed to the repository, and are loaded at runtime rather than embedded in the bundle** | Embedding several MB of data in the JS bundle would tax every consumer. As with esp-flashjs's stub JSON, they are individual files resolved relative to `import.meta.url`, so only the fonts actually used are transferred. They are committed so that users are never required to extract them from the LovyanGFX sources (regeneration is `scripts/extract-fonts.js`) |
| 6 | **Neutral-model metrics are int16. Format-specific constraints (u8g2's 7-bit fields, etc.) are kept out of the model** | Matches LovyanGFX's `FontMetrics`. Constraints belong to each encoder and are checked at encode time |
| 7 | **An encoder never silently truncates on a constraint violation; it raises an error** | Silent truncation produces fonts that cannot be read back. `canEncode()` allows checking in advance, and reports "which glyphs do not fit and why" with stable codes (§7) |
| 8 | **Drawing semantics match LovyanGFX v1.2.26 exactly, with LovyanGFX itself as the oracle** | At 1bpp there is no anti-aliasing error, so correctness can be judged by byte-exact match of the output. This doubles as the debugging environment for decoder implementations (§13) |
| 9 | **Code points are allowed up to U+10FFFF in the model. No BMP restriction is imposed** | The BMP restriction is a property of LovyanGFX's text API (`uint16_t`); BDF and TTF can go beyond it. The restriction is reported at encode time by the encoders of BMP-only formats |
| 10 | **C/C++ source is a first-class, independent format** | Fonts in the Arduino world are distributed as `.h` / `.c` files; "paste a GFXfont header from GitHub and it just reads" is decisive for the library's practical value as a general-purpose building block |
| 11 | **The library generates no user-facing text whatsoever. Errors and issues carry stable `code`s** | Translation is the application's responsibility. Same policy as esp-flashjs: the reference app is localized without touching the library |
| 12 | **1bpp bit order is MSB first, with each row padded to a byte boundary** | Close to the native representation of BDF, GFXfont, and other major formats, and easy to debug by eye. Format-specific packing is absorbed by each decoder/encoder |

---

## 4. Architecture

### 4.1 Layer structure

Dependencies flow in one direction only, top to bottom. No back-flow is allowed.

```text
┌────────────────────────────────────────────────────────────┐
│  web/            Web reference implementation              │  DOM / File API
├────────────────────────────────────────────────────────────┤
│  src/index.js    public API (barrel)                       │
├──────────────┬──────────────┬──────────────┬───────────────┤
│  gen/        │  fonts/      │  inspect/    │  render/      │
│  TTF gen.    │  built-in    │  inspection /│  drawing /    │
│  (browser)   │  collection  │  estimation  │  measurement  │
├──────────────┴──────────────┴──────────────┴───────────────┤
│  format/    per-format decode / encode / constraint checks │
├────────────────────────────────────────────────────────────┤
│  model/     Font / Glyph / Bitmap / subset /               │
│             merge / serialize                              │
├───────────────────────────┬────────────────────────────────┤
│  charsets/  character sets│  util/  bit/byte, errors       │
└───────────────────────────┴────────────────────────────────┘
```

**Rules to follow strictly:**

- `model/` `format/` `render/` `inspect/` `charsets/` `util/` are pure. They take `Uint8Array`s / strings / plain objects as input and produce the same kinds as output. They perform no I/O.
- No file under `src/` may reference `document` / `window` / `navigator` / `fetch`. There are exactly two exceptions — `gen/rasterize.js` (`FontFace` / `OffscreenCanvas`) and `fonts/loader.js` (loading the data files: `fetch` in the browser, `node:fs` on Node). Both are explicitly isolated modules.
- No `web/` logic is ever brought into `src/`.

Layering discipline is verified statically in CI by `scripts/check-layers.js` (the same mechanism as esp-flashjs). The script also detects extension-less imports and references to environment globals anywhere outside the two exception files.

### 4.2 Repository layout

```text
LGFXFontToolJs/
├── README.md / README.ja.md
├── LICENSE                   # MIT
├── NOTICE                    # attribution for the bundled fonts (§8.4)
├── package.json
├── tsconfig.json             # exists only for type checking and .d.ts generation
│
├── src/
│   ├── index.js              # public API barrel
│   │
│   ├── util/
│   │   ├── errors.js         # error hierarchy (§12)
│   │   ├── bits.js           # BitReader / BitWriter (needed by u8g2)
│   │   └── bytes.js          # ByteReader / ByteWriter
│   │
│   ├── model/
│   │   ├── font.js           # Font / Glyph (§5)
│   │   ├── bitmap.js         # Bitmap and 1bpp/8bpp operations
│   │   ├── subset.js         # narrowing the character set
│   │   ├── merge.js          # merging fonts (Phase 4)
│   │   └── serialize.js      # JSON serialization of the neutral model (§5.3)
│   │
│   ├── charsets/
│   │   └── charsets.js       # named sets: ascii / kana / joyo kanji / JIS level 1, etc.
│   │
│   ├── format/
│   │   ├── registry.js       # format registration, detect, decode/encode dispatch
│   │   ├── u8g2.js
│   │   ├── gfxfont.js
│   │   ├── glcd.js / fixedbmp.js / bmpfont.js / rlefont.js
│   │   ├── bdf.js
│   │   ├── vlw.js
│   │   └── csource.js        # C/C++ source ⇄ byte sequences (§6.3)
│   │
│   ├── render/
│   │   ├── draw.js           # drawString / drawChar
│   │   ├── measure.js        # textWidth / fontHeight / measureText
│   │   └── datum.js          # resolution of the 12 datums
│   │
│   ├── inspect/
│   │   ├── inspect.js        # coverage and metrics aggregation
│   │   └── estimate.js       # size computation per format
│   │
│   ├── fonts/
│   │   ├── catalog.js        # metadata for the 186 fonts (generated artifact, but committed)
│   │   ├── loader.js         # loadFont(); the fetch / node:fs branch lives only here
│   │   └── data/             # font binaries (generated artifacts, but committed)
│   │       ├── lgfx_font_japan_mincho_16.u8g2
│   │       ├── FreeSans9pt7b.gfx
│   │       └── ...
│   │
│   └── gen/
│       ├── rasterize.js      # FontFace + OffscreenCanvas (browser-only)
│       └── generate.js       # rasterization result → neutral model (incl. thresholding)
│
├── web/                      # reference web app (§14)
│   ├── index.html
│   ├── lgfx-font-tool.js     # ★ the single outward reference to src/ (§4.4)
│   ├── app.js / store.js / actions.js / i18n.js
│   ├── locales/  en.json / ja.json
│   ├── components/           # Custom Elements
│   └── styles/
│
├── examples/                 # minimal single-feature samples (one file each)
│   ├── index.html
│   ├── render-text.html      # built-in font: string → 1bpp → Canvas display
│   ├── convert-font.html     # file → detect → convert → download
│   ├── generate-u8g2.html    # TTF → u8g2 (a minimal fontgen equivalent)
│   ├── inspect-font.html     # coverage and size estimation
│   └── node-render.js        # example of use from Node
│
├── oracle/                   # LovyanGFX host harness (C++; not shipped on npm)
│   ├── README.ja.md          # build instructions and fixture regeneration steps
│   └── ...                   # §13.1
│
├── docs/
│   ├── spec.ja.md            # this document
│   └── formats/              # field-level per-format specs (written at implementation time)
│
├── test/
│   ├── helpers.js
│   ├── fixtures/
│   │   └── oracle/           # reference bitmaps produced by the harness (committed)
│   └── *.test.js
│
├── scripts/
│   ├── extract-fonts.js      # LovyanGFX sources → fonts/data/ + catalog.js (§8.3)
│   ├── build.js              # esbuild → dist/
│   ├── build-site.js         # → site/ (for GitHub Pages)
│   ├── serve.js              # local development server (zero dependencies)
│   ├── check-layers.js       # static layering-discipline check (CI)
│   ├── check-locales.js      # locale check (CI)
│   └── sync-version.js
│
└── .github/workflows/
    ├── ci.yml                # checks + build
    ├── pages.yml             # GitHub Pages deploy
    └── release.yml           # npm publish
```

**Generated artifacts (all `.gitignore`d):**

```text
dist/
├── lgfx-font-tool.js / .min.js   # ESM bundle
└── fonts/                        # same contents as data/; the bundle's relative reference target
types/                            # .d.ts (generated only at release time)
site/                             # the artifact uploaded to GitHub Pages
```

`src/fonts/data/` and `src/fonts/catalog.js` are generated artifacts but **are committed** (design decision #5).

### 4.3 Responsibilities of each directory

| Directory | Responsibility | May depend on |
| --- | --- | --- |
| `src/util/` | errors, bit/byte readers and writers | nothing |
| `src/charsets/` | data for named character sets | nothing |
| `src/model/` | the neutral model and its operations | `util/` |
| `src/format/` | per-format decode / encode / constraint checks. **Pure functions only** | `model/`, `util/` |
| `src/render/` | drawing and measurement | `model/`, `util/` |
| `src/inspect/` | inspection and size estimation | `format/`, `model/`, `charsets/`, `util/` |
| `src/fonts/` | the built-in collection. I/O only in `loader.js` | `format/`, `model/`, `util/` |
| `src/gen/` | TTF rasterization and generation. DOM only in `rasterize.js` | `model/`, `charsets/`, `util/` |
| `web/` | UI. Consumer of the public API | `src/` only through `./lgfx-font-tool.js` |
| `examples/` | minimal samples | `../src/`; never depends on `web/` |
| `oracle/` | C++ host harness | LovyanGFX (no dependence on the JS) |

### 4.4 Module resolution and paths

The esp-flashjs conventions are used as-is.

- `import` specifiers MUST be relative paths with file extensions. Implicit resolution to a directory's `index.js` is treated as nonexistent.
- References from `web/` to `src/` are funneled through `web/lgfx-font-tool.js` (a single line: `export * from '../src/index.js';`). When `build-site.js` assembles `site/`, this is the only file it rewrites.
- Font data is referenced via `new URL('./data/<name>', import.meta.url)`, which resolves regardless of whether the library is loaded from npm, a CDN, Pages, or a local checkout.

### 4.5 Coding conventions

| Item | Convention |
| --- | --- |
| Language | ECMAScript 2022 or later, ESM only. No transpilation |
| Types | JSDoc. `// @ts-check` at the top of every file. `tsc --noEmit` is mandatory in CI |
| Runtime dependencies | Zero. devDependencies are esbuild and typescript only |
| Byte sequences | Always `Uint8Array`. `ArrayBuffer` / `Buffer` never cross an API boundary |
| Numbers | Metrics are JS `number`s (value range in the model is int16, §5.1). Code points are also `number`s |
| Naming | Classes PascalCase, functions camelCase, constants SCREAMING_SNAKE_CASE. Format IDs are lowercase (`'u8g2'`, etc.) |
| Async | Only `fonts/loader.js` and `gen/` perform I/O. All other APIs are synchronous |
| Text | No user-facing display text in `src/`. Errors and issues carry stable `code`s |

---

## 5. Neutral Model

### 5.1 Font / Glyph / Bitmap

```js
/**
 * @typedef {object} Font
 * @property {string} familyName
 * @property {string} styleName        - "Regular" | "Bold" | ...
 * @property {number} ascent           - Baseline to top of the line box (positive, int16)
 * @property {number} descent          - Baseline to bottom of the line box (positive, int16)
 * @property {number} lineHeight       - Line advance (int16). Normally at least ascent + descent
 * @property {Map<number, Glyph>} glyphs   - Codepoint → glyph
 * @property {number} [defaultCodepoint]   - Substitute for characters not in the font (tofu). Optional
 * @property {KerningPair[]} [kerning]     - Retained only. Not applied during rendering (§2.3)
 * @property {FontMeta} meta           - Provenance information (source format, source filename, license, etc.)
 */

/**
 * @typedef {object} Glyph
 * @property {number} codepoint        - 0 to 0x10FFFF
 * @property {number} xOffset          - Pen position to left edge of the bitmap (int16)
 * @property {number} yOffset          - Baseline to top edge of the bitmap (int16, negative above)
 * @property {number} xAdvance         - Advance (int16)
 * @property {Bitmap} bitmap           - width × height are held by the bitmap
 */

/**
 * @typedef {object} Bitmap
 * @property {number} width
 * @property {number} height
 * @property {1|8} bpp                 - 1 = monochrome, 8 = coverage values (0–255, linear)
 * @property {number} stride           - Bytes per row = ceil(width * bpp / 8)
 * @property {Uint8Array} data         - 1bpp is MSB first, rows padded to byte boundaries
 */
```

**Coordinate conventions** (the single set of conventions followed by every format's decoder, encoder, and the renderer):

- The Y axis is positive downward.
- A glyph's origin is the **pen position on the baseline**. `xOffset` / `yOffset` are signed offsets from there to the bitmap's top-left corner. A glyph extending upward has a negative `yOffset` (same direction as GFXfont).
- After rendering, the pen advances right by `xAdvance`.
- The mapping to each format's native conventions (u8g2's BBX, BDF's DWIDTH/BBX, VLW's topExtent, etc.) is absorbed by each decoder and recorded in `docs/formats/`.

**Value ranges**: Metrics must fit in int16. A decoder throws `FormatError` when it finds an out-of-range value (no real-world format exceeds int16). **Format-specific constraints, such as u8g2's 7-bit fields, are not brought into the model.** Constraints are checked by each encoder at encode time (§7).

**Bit depth**: Both 1bpp and 8bpp can be represented. VLW is anti-aliased 8bpp; dropping this would make a VLW encoder impossible. All glyphs within a single font share the same bpp (no real-world format mixes depths).

### 5.2 Model Operations

```js
subset(font, codepoints)          // -> Font   New model keeping only the specified characters
                                  //    codepoints: Iterable<number> | string | named set
merge(base, overlay)              // -> Font   Composite with overlay taking precedence (UC4 supplementation; e.g. Latin A + kana B)
                                  //    Metrics stay those of base; glyphs are imported without rescaling.
                                  //    Combinations whose line boxes do not match accumulate a warning in meta.issues
font.glyphs                       //    A Map, so enumeration and individual replacement use plain Map operations (UC8)
```

`subset` / `merge` do not modify the original model (non-destructive).

Character sets are kept by name under `charsets/`: `ascii` / `latin1` / `kana` / `jouyou` (Jōyō kanji) / `jis1` / `jis2`, and so on. The set definitions held by LGFXScreenBuilder's fontgen are migrated here.

### 5.3 Serialization

A JSON representation of the neutral model is defined. Its purposes are test fixtures, debugging, and interchange between tools; efficiency is not a goal.

```json
{
  "format": "lgfx-font-tool/font",
  "version": 1,
  "familyName": "...", "styleName": "...",
  "ascent": 24, "descent": 6, "lineHeight": 30,
  "glyphs": [
    { "cp": 65, "xOffset": 0, "yOffset": -24, "xAdvance": 14,
      "width": 13, "height": 24, "bpp": 1, "data": "<base64>" }
  ]
}
```

`serializeFont(font)` / `deserializeFont(json)` are provided. Round-tripping is lossless (same criterion as §13.2).

---

## 6. Decode

### 6.1 API

```js
import { decode, detect, listFormats } from 'lgfx-font-tool';

decode(input, { format })   // -> Font
//  input: Uint8Array (binary formats) or string (BDF / C source)
//  When format is omitted, the top result of detect() is used. If confidence is insufficient, FormatError('DETECT_FAILED')

detect(input)               // -> Array<{format, confidence, reasonCode?}>  descending by confidence
listFormats()               // -> FormatInfo[]  Format IDs, names, depths, decode/encode support
```

- Decoding **does not abort on moderately corrupt input**. Glyphs that could be recovered are returned, and problems are accumulated in `font.meta.issues` with stable codes. `FormatError` is thrown only when the input is completely uninterpretable.
- `detect` confidence: formats with a magic marker (BDF's `STARTFONT`, C source syntax) can be identified with high confidence. u8g2 / VLW / GFXfont binaries have no magic, so detection is an inference from structural consistency. **Never read input as the wrong format based on an uncertain automatic guess.** A UI that has the application specify the format explicitly is recommended.

### 6.2 Format-Specific Highlights

Field-level specifications for each format are deferred to `docs/formats/`; only the implementation highlights are noted here.

| Format | Decoding highlights |
| --- | --- |
| u8g2 | 23-byte header + block jump table + variable-bit-width fields per glyph + 0/1 run-length. Requires a `BitReader`. The most troublesome, but all of the built-in CJK fonts use it |
| GFXfont | Glyph array + single bitmap sheet + `EncodeRange` (LovyanGFX extension; the Adafruit original has a single first/last range). **Both must be readable** |
| GLCD / FixedBMP / BMP | Raw bitmap tables. For those with no header at all, dimensions are supplied by the catalog |
| RLE | LovyanGFX's proprietary run-length encoding. Font4/6/7/8 |
| BDF | Text format. `STARTFONT` through `ENDFONT`. Glyphs with ENCODING of −1 are skipped |
| VLW | Glyph count + metadata table + sequence of 8bpp bitmaps. Originates from Processing |

### 6.3 C/C++ Source Input and Output

`format/csource.js` is a "text ⇄ byte array + format hint" layer, orthogonal to the binary formats.

**Decode (Phase 3)** — realizes "paste a `.h` / `.c` file distributed on GitHub or in an Arduino library and it just reads".

```js
decodeCSource(text)  // -> Array<{name, format, font}>  Supports multiple fonts per file
```

- Extracts array literals such as `const uint8_t xxx[] PROGMEM = {...}` / `constexpr uint8_t`, etc.
- Recognizes `GFXfont` struct initializers (`{bitmap, glyphs, first, last, yAdvance}`) and assembles them as GFXfont. u8g2 `.c` fonts (single array) are tried as u8g2 decodes.
- Comments, `#include`, and macros are ignored. A full C preprocessor is not implemented (being able to read real-world font distribution files is sufficient).

**Encode (Phase 2)** — emits source that can be pasted into a sketch.

```js
encodeCSource(font, { format, symbolName, progmem })  // -> string
```

- Matches each output format's idiom: GFXfont as an Adafruit-style `.h`, u8g2 as a `.c` with `U8G2_FONT_SECTION`, and `constexpr uint8_t []` for LovyanGFX.
- The leading comment of the generated output always includes the source font name, character set, generation conditions, and license notice.

---

## 7. Encode and Capability Query

### 7.1 canEncode

Each format can represent a different range, and silently truncating when a value exceeds it produces unreadable fonts. **"It doesn't fit" is information that must be shown to the user.**

```js
canEncode(font, format)   // -> { ok: boolean, issues: EncodeIssue[] }

/**
 * @typedef {object} EncodeIssue
 * @property {'error'|'warning'} level
 * @property {string} code          - 'XADVANCE_RANGE' | 'GLYPH_TOO_LARGE' | 'GLYPH_BYTES_OVER' |
 *                                    'CODEPOINT_OVER_BMP' | 'BPP_UNSUPPORTED' | 'RANGE_COUNT_LARGE' | ...
 * @property {number} [codepoint]   - The glyph in question
 * @property {object} [params]      - {value, min, max} etc. Composing the message text is the application's job
 */
```

LGFXScreenBuilder's `"@" needs dx = 67px … Try 45px or less` becomes a message that **the application** assembles from `{code:'XADVANCE_RANGE', codepoint:0x40, params:{value:67, min:-64, max:63}}`.

### 7.2 encode

```js
encode(font, { format, ...formatOpts })   // -> Uint8Array
```

- Calling it in a state where `canEncode` returns errors throws `EncodeConstraintError` (with the issues attached). **It never silently truncates.**
- The caller's options are: drop the offending glyph with `subset()`, regenerate at a smaller size, or switch formats. All the material for that decision is carried in the issues.
- Warnings (things that do not break anything but affect performance, such as GFXfont's `RANGE_COUNT_LARGE`) do not stop encoding.
- The u8g2 encoder automatically selects the run-length bit widths (m0, m1) by "fewest glyphs dropped to constraints; smallest size on a tie" (following fontgen's implementation).

### 7.3 Per-Format Constraints (Checked by the Encoders)

The figures are the limits actually imposed by LovyanGFX v1.2.26 (based on measurements in FONT_FORMATS.ja.md).

| Format | Main constraints |
| --- | --- |
| u8g2 | Advance and bearings **−64 to 63** (7-bit). Glyph width and height at most 127 (header is int8). At most **255 bytes per glyph**. Codepoints up to the BMP. The practical character-height ceiling is around 45–64px depending on the typeface |
| GFXfont | Advance 0–255, bearings −128 to 127, glyph width and height at most 255. Line box effectively 127. Up to the BMP. Sparse character sets inflate the EncodeRange list (1,774 entries for Jōyō kanji → warning) |
| BDF | Effectively unconstrained (fitting in int16 is enough) |
| VLW | **Fixed 8bpp** (1bpp models are stretched to 0/255 and encoded. Conversely, 8bpp → 1bpp formats are not converted automatically; thresholding must be performed explicitly as a model operation) |
| GLCD / FixedBMP | Fixed size and fixed character set only. General models will simply not fit (encoders are optional) |
| C source | Follows the constraints of the embedded binary format |

---

## 8. Built-in Font Collection

### 8.1 Catalog and Loading

```js
import { fontCatalog, loadFont } from 'lgfx-font-tool';

fontCatalog                 // -> CatalogEntry[]  Metadata for the 186 fonts (does not include the data itself)
await loadFont('lgfxJapanGothic_24')   // -> Font  Loads the data on first call, cached thereafter
```

```js
/**
 * @typedef {object} CatalogEntry
 * @property {string} name        - Uses the LovyanGFX identifier as-is (fonts::lgfxJapanGothic_24 → 'lgfxJapanGothic_24')
 * @property {string} format      - 'u8g2' | 'gfx' | 'glcd' | 'fixedbmp' | 'bmp' | 'rle'
 * @property {number} lineHeight / ascent / descent
 * @property {number} glyphCount
 * @property {string[]} coverage  - Named sets contained ('ascii', 'kana', 'jouyou', ...)
 * @property {number} dataBytes
 * @property {string} license     - SPDX form. 'BSD-3-Clause', 'OFL-1.1', 'GPL-3.0-or-later WITH Font-exception', etc.
 * @property {string} copyright
 */
```

- The catalog is lightweight data included in the code (the equivalent of the `font-metrics.json` that LGFXScreenBuilder generated separately becomes a standard feature of the library).
- The data itself lives in individual files under `fonts/data/`, resolved and loaded by `loadFont()` via `new URL(..., import.meta.url)`. Browsers use `fetch`, Node uses `node:fs`. **It is not embedded in the JS bundle** (design decision #5).
- Once loaded, a font is an ordinary `Font` model, usable for rendering, conversion, and subsetting alike.

### 8.2 Contents

All 186 built-in fonts of LovyanGFX v1.2.26.

| Format | Count | Contents |
| --- | --- | --- |
| u8g2 | 116 | lgfxJapanMincho / Gothic (8–40px), efont JA / CN / KR / TW (10–24px, including b/i variants) |
| GFXfont | 61 | Free Mono / Sans / Serif in each style and size, Orbitron, Roboto, Satisfy, TomThumb, Yellowtail, etc. |
| GLCD | 2 | Font0, Font8x8C64 |
| FixedBMP | 2 | AsciiFont8x16, AsciiFont24x48 |
| BMP | 1 | Font2 |
| RLE | 4 | Font4 / 6 / 7 / 8 |

### 8.3 Extraction Pipeline

The built-in fonts exist as `constexpr uint8_t[]` in `lgfx_fonts.cpp` / `.hpp` and cannot be obtained with `fetch()`. `scripts/extract-fonts.js` handles this:

1. **Fetch the LovyanGFX release tarball pinned to a tag** (default v1.2.26; the source and tag are recorded in `src/fonts/data/README.md`).
2. Extract the array literals and font definitions (format, dimensions, struct initializers) from the source and write them out to `fonts/data/*.{u8g2,gfx,...}`.
3. **Decode each font on the spot** to measure its metrics, glyph count, and coverage, and generate `fonts/catalog.js` (the catalog holds measured values, not estimates).
4. Recover license and copyright notices from source comments and regenerate the corresponding sections of `NOTICE`.

The results are committed. Neither users nor CI are required to parse C++ source. The pipeline is rerun only when the LovyanGFX version is updated.

### 8.4 Licensing

The licenses of the bundled fonts differ per font (BSD-style terms for the efont family, OFL / Apache for the Google Fonts family, GPL + font exception for GNU FreeFont, BSD for the Adafruit family, etc.).

- The library code itself is MIT. Attribution for the font data is listed collectively in `NOTICE` (the approach esp-flashjs took with its stub).
- `CatalogEntry.license` / `copyright` make this machine-readable, and the reference app displays the license in its font selection UI.
- The output header of `encodeCSource()` always embeds the source font's attribution as well (§6.3).
- If a font's license cannot be determined during extraction, **bundling is withheld** and the font is raised as an open issue.

---

## 9. Rendering and Text Measurement

### 9.1 Rendering Target

The rendering target is the library's own `Bitmap` (§5.1). The output consists of coverage values (1bpp: 0/1, 8bpp: 0–255) and carries no color. Pasting to a Canvas and colorization are the caller's responsibility (a working ImageData conversion helper is provided in `render-text.html` under examples).

```js
createBitmap(width, height, bpp)   // -> Bitmap  Zero-initialized
```

### 9.2 API

```js
import { drawString, drawChar, textWidth, fontHeight, measureText } from 'lgfx-font-tool';

drawString(bitmap, font, text, x, y, style?)   // -> {advance, box}  Draws a single line
drawChar(bitmap, font, codepoint, x, y, style?) // -> advance
textWidth(font, text, style?)                   // -> number
fontHeight(font, style?)                        // -> number
measureText(font, text, style?)                 // -> {width, height, ascent, descent, box}

/**
 * @typedef {object} TextStyle
 * @property {number} [sizeX=1] / [sizeY=1]  - Character scale factors. Non-integer values allowed, as in LovyanGFX
 * @property {string} [datum='top-left']     - 12 kinds: top/middle/bottom/baseline × left/center/right
 * @property {number} [clipX1,clipY1,clipX2,clipY2]  - Clip rectangle (defaults to the full bitmap)
 */
```

- Text is accepted as a JS string (UTF-16); surrogate pairs are combined into single codepoints. Codepoints outside the BMP can be drawn if the model holds them (the fact that LovyanGFX hardware cannot draw them is for the application to determine via `canEncode` / the catalog).
- For characters not in the font, `font.defaultCodepoint` is used if present; otherwise the behavior is either **draw nothing and advance the pen** or a zero advance, matched to LovyanGFX's actual behavior (to be pinned down against the oracle during implementation, updating this document).
- No wrapping or line-break handling is performed. `\n` is treated the same as a character not in the font. Multi-line text is rendered by the application calling once per line.

### 9.3 LovyanGFX-Compatible Rules

The ground truth for rendering semantics is `LGFXBase` of LovyanGFX v1.2.26. The fine details of the specification (rounding when scale factors are applied, datum reference points, cursor behavior when `xOffset` is negative, etc.) are not defined twice in prose; **byte-exact match against the oracle of §13.1 is the specification.** Only the outline is listed here:

- The pen advances by `xAdvance × sizeX` at a time, relative to the baseline.
- `datum` resolves the starting position using the result of `measureText` (the 12 kinds equivalent to LovyanGFX's `setTextDatum`).
- Scale factors apply to all of a glyph's bitmap, offsets, and advance. The pixel-replication rule for non-integer scale factors also matches LovyanGFX's implementation.
- 8bpp glyphs (VLW) output their coverage values as-is. The degradation rule when drawing an 8bpp glyph onto a 1bpp bitmap also matches LovyanGFX.

### 9.4 Draw Profiles (Future)

The u8g2 library itself and Adafruit GFX's `print()` differ from LovyanGFX in fine details (reference points, cursor movement) even with the same font data. The scope of this specification is the LovyanGFX profile only; other profiles are a consideration for Phase 4 and later (§18).

---

## 10. Generating from TTF

### 10.1 Who Holds the Ground Truth for Rasterization

The premise inverts relative to §9, so it is stated explicitly.

| Situation | Ground truth belongs to |
| --- | --- |
| **Drawing an existing bitmap font** (preview) | **LovyanGFX**. Substituting the browser's rasterizer yields mismatched glyph shapes |
| **Creating a new font from a TTF** (generation) | **The rasterizer itself**. The emitted bits become the font data as-is, and the device draws them |

On the generation side, rasterizing in the browser is fine. The resulting bitmap becomes the ground truth by definition. Do not conflate the two.

### 10.2 API and Rasterization Method

```js
import { generateFont } from 'lgfx-font-tool';   // implementation lives in src/gen/

await generateFont({
  source,                  // ArrayBuffer | Blob | URL string (TTF/OTF/WOFF/WOFF2)
  family,                  // instead of source: a CSS family name already registered on the page
  px,                      // character height (font size in CSS px)
  codepoints,              // Iterable<number> | string | named set name
  bpp: 1,                  // 1 (thresholded) | 8 (raw coverage values)
  threshold: 128,          // threshold for 1bpp (0-255)
  weight, italic,          // passed to the FontFace descriptor
  sizing,                  // optional: reuse { cssPx, probe, probeHeight } from another generation
  fallbacks: [{ family }], // fill missing characters in order, inheriting the primary cssPx
})  // -> { font, missing, filled, sizing }
```

- The implementation registers the font via `FontFace`, draws glyphs one character at a time on an `OffscreenCanvas` 2D context, and harvests the alpha channel. **opentype.js and the like are not used** (design decision #2). The method is proven in LGFXScreenBuilder's `fontgen/rasterize.js`; that implementation is migrated and cleaned up here.
- Whether the font actually carries a given glyph (tofu exclusion) is likewise determined by cross-checking the rasterization result against `measureText` (following fontgen's existing technique).
- **Division of responsibility for fallback fill (decided)**: fallback fill at generation time (rasterizing missing characters at the primary typeface's `cssPx` / threshold, aligning them on the baseline, and recomputing the line box from all glyphs) is a **library feature** (`fallbacks`; what was filled with what is reported in `filled`, and what remains absent in `missing`). For a separate fill call, pass the returned `sizing` to the next `generateFont`. **Selecting and obtaining** the fill source is the **application's responsibility** (the Generator suggests FALLBACK_CHAIN and never fills on its own). Fallback fill between existing bitmap fonts is **not automated in the library** — it is a `coverage → subset → merge` recipe, and pixel-size compatibility is left to the user's judgment (documented in the usage guide).
- Calling this outside a browser throws `CapabilityError('RASTERIZER_UNAVAILABLE')`. Node support will be considered later as a rasterizer-injection interface (§18).

### 10.3 Determinism

Generation requires that the same input produce the same font.

- Thresholding, metric rounding, and glyph-boundary cropping are performed by **deterministic code** within this library. With identical settings (px, threshold, weight), the output depends only on the input font and the browser.
- Anti-aliasing results may differ across browser engines and operating systems. This is accepted (§10.1 — the generated output is the ground truth as-is, so where reproducibility matters, save the generated output itself as the artifact). This property is stated explicitly in the documentation.
- The generated `Font`'s `meta` records the generation conditions (source file name, px, threshold, UA).

---

## 11. Inspection

The feature set supporting font inventory (UC2) and up-front validation of UI-string coverage (UC6).

```js
inspect(font)                // -> {glyphCount, codepointRanges, metrics, bbox extremes, coverage: {ascii: 1.0, kana: 0.98, ...}}
coverage(font, chars)        // -> {total, present, missing: number[]}
                             //    chars: Iterable<number> | string | named set name (same input surface as subset)
estimateSize(font, format)   // -> {bytes, issues}   exact byte count if encoded
                             //    includes issues, like canEncode, when constraints are violated; computed exactly from the record structure, not approximated
```

Running `estimateSize` across all supported formats yields, for any font, the comparison table from FONT_FORMATS.ja.md — "for this character set and size: u8g2 175KB / GFXfont 189KB / VLW 1.36MB". The reference app's Inspector displays this.

---

## 12. Error Model

```text
FontToolError (base)              — code: string, details?: object
├── FormatError                   — input cannot be interpreted
│   ├── DetectFailedError         (DETECT_FAILED)
│   ├── TruncatedDataError        (TRUNCATED)
│   └── UnsupportedFeatureError   (UNSUPPORTED_FEATURE)   e.g. unsupported BDF properties
├── EncodeConstraintError         (ENCODE_CONSTRAINT)     carries issues: EncodeIssue[]
├── CapabilityError               (RASTERIZER_UNAVAILABLE etc.)  the environment lacks a capability
└── CollectionError               (UNKNOWN_FONT / FONT_DATA_LOAD_FAILED)
```

- Every error carries a stable `code` and `details`. `message` is an English developer-facing string. **The library never generates user-facing UI strings** (design decision #11).
- "Broken but readable" is not an error; it is expressed via `font.meta.issues` / `EncodeIssue` (decoding does not abort, §6.1).

---

## 13. Correctness Guarantees

There are three kinds, and none is dispensable.

### 13.1 Agreement with LovyanGFX (Ground Truth for Decoding and Rendering)

**LovyanGFX itself serves as the oracle.**

```text
same font, string, scale, and datum
  → rendered by C++ (host-built LovyanGFX) → 1bpp   ← ground truth
  → rendered by JS (this library)          → 1bpp
  → the byte sequences must be a byte-exact match
```

- A C++ host harness lives in `oracle/`. LovyanGFX is built natively with lang-ship's host core, and all formats are driven from the same code via the shared `IFont` interface (`updateFontMetric` / `drawChar`).
- Coverage is "**all 186 fonts × representative character sets × representative scales × representative datums**". The output (1bpp bitmaps + metrics) is committed to `test/fixtures/oracle/`.
- The JS-side tests verify a byte-exact match against the fixtures. At 1bpp there is no anti-aliasing error, so there is no reason to settle for "roughly matches."
- **This doubles as the debugging environment for the decoder implementations.** The failure mode of misreading a format specification gets caught here in its entirety.
- Fixture regeneration is a local procedure (`oracle/README.ja.md`); the LovyanGFX version and harness commit used for generation are recorded in the fixtures. Automatic regeneration in CI remains an open question (§18).

### 13.2 Round-Trip (Encoder Self-Consistency)

```text
neutral model → encode → decode → neutral model
  → glyphs and metrics must be a byte-exact match (no information is lost within the format's constraints)
```

The same criterion applies to serialization (§5.3).

### 13.3 Agreement with the Real Thing (Encoder Effectiveness)

Have **the real LovyanGFX actually load and render** the encoded u8g2 / GFXfont / VLW (reusing the harness from 13.1); the result must match what this library renders from the same model.

§13.2 alone only shows that "we can read and write according to the spec as we ourselves wrote it." If our interpretation of the spec drifts from upstream, the round-trip passes yet the output garbles on real hardware. That failure is caught here.

---

## 14. Web Reference App

The same stance as the esp-flashjs web app: no UI framework (Custom Elements + a minimal store), served via GitHub Pages.

i18n covers en / ja / zh-Hans / zh-Hant. The locale is auto-detected from `navigator.languages` (priority: `?lang=` > localStorage > browser language), falling back to English when unsupported. Dictionaries live in `web/locales/<id>.json`, kept such that **adding a language = one entry in `SUPPORTED_LOCALES` + one dictionary file**. Missing keys and placeholder mismatches are checked in CI by `scripts/check-locales.js`. The library core (`src/`) carries no UI strings (design decision #11).

| Screen | Content | APIs used |
| --- | --- | --- |
| **Viewer** | Catalog browsing of the 186 bundled fonts, pixel-exact preview of arbitrary text (zoom and grid display), license display | `fontCatalog` / `loadFont` / `drawString` |
| **Converter** | Drop in a font file / C source → detect → convert → download (implemented 2026-08). Displays detection candidates with manual format override, selection among multiple fonts within a C source, pixel-exact preview, and up-front post-conversion size via `estimateSize`. "It doesn't fit" is visualized by surfacing the issues as-is | `decode` / `detect` / `canEncode` / `encode` / `encodeCSource` / `estimateSize` |
| **Generator** | TTF → u8g2 / GFXfont / BDF / VLW / BFF. A four-step card flow modeled on the fontgen.html UI (typeface → size and name → characters → generate; redesigned 2026-08). Search and selection among Google Fonts' redistributable typefaces (OFL / Apache-2.0), live preview before generation, character-set selection by template and by axis with estimated size, a character list (Ctrl+F searchable), fallback fill of missing characters from another typeface (**suggest → one-click apply**; only the shortfall is generated and `merge`d, candidates come from FALLBACK_CHAIN, and attribution records both typefaces), C source / BDF text / binary output — all implemented. Network access for fetching fonts is the app's responsibility (§2.3); the library only exposes the entry point of passing an already-loaded family and `fallbacks` to `generateFont` | `generateFont` / `subset` / `merge` / `encode` / `encodeCSource` |
| **Inspector** | Coverage, metrics, and a size comparison table across all formats (implemented 2026-08). Targets both the 186 bundled fonts and files. Coverage bars per named set, a list of covered ranges, a UI-string check (enumerating undrawable characters), and a size comparison across all formats counted by the real encoders | `inspect` / `coverage` / `estimateSizes` |

`examples/` holds minimal single-file samples, one each (§4.2). Independent of the app's breadth of features, the goal is to demonstrate that "this API works with just this."

---

## 15. Testing

- The test runner is `node:test`. All tests run on Node alone, keeping runtime dependencies at zero.
- Fixtures come in three lines: (1) oracle output (§13.1, committed), (2) hand-written minimal fonts (boundary cases: empty font, single glyph, negative bearing, codepoints outside the BMP, the 127/255 boundaries), (3) actual real-world fonts (the bundled collection itself doubles as test data).
- Required test cases: successful decode of all 186 bundled fonts, oracle match for all fonts × representative strings, round-trip match for each encoder, constraint detection by canEncode (cases that straddle u8g2's 7-bit / 255-byte boundaries exactly), and loading of real-world distributed C source files.
- `npm run check` = tests + `tsc` type check + layering check + locale check. Identical to CI.

---

## 16. Publishing & Distribution

Follows the esp-flashjs approach.

| Channel | Content |
| --- | --- |
| npm | A single package (measured: 562KB tarball / 1.6MB unpacked). `files` = `dist` / `src` (excluding data) / `types` / NOTICE. **Only the 70 lightweight fonts are bundled (LGFX internal format + Latin GFX ≈ 0.35MB); the 42MB of CJK fonts resolve remotely** (below). `prepack` runs build + types |
| Font data | Loader resolution order: (1) the location set by `configureFontData({baseUrl})` (for self-hosted mirrors and offline use), (2) local relative to `import.meta.url`, (3) GitHub Pages. A repository clone and the web app on Pages are fully self-contained locally; only npm consumers fetch the CJK fonts on first use. The gzip-bundling idea was rejected (based on measurements: u8g2 data is already RLE-compressed and shrinks to only 80%) |
| CDN (jsDelivr etc.) | `dist/lgfx-font-tool.min.js`. Font data resolves relative to `dist/fonts/`, so it works on a CDN as-is. The README states explicitly that version pinning is mandatory |
| GitHub Pages | Reference app + examples + documentation |
| GitHub Actions | `ci.yml` (check + build) / `pages.yml`. `release.yml` is a manual-dispatch backup only |
| npm release procedure | **Published from a local machine (plainbind style; no token stored in the repository)**: `npm login` (first time only) → `npm version <ver>` (preversion runs check; `VERSION`, CDN pins, and the changelog heading are synced automatically) → `npm publish --access public` (prepack runs build + types) → `git push --follow-tags`. CI-based publishing (Trusted Publishing / NPM_TOKEN) remains available as the manual dispatch of `release.yml`. Detailed steps: [release.en.md](./release.en.md) |

Documentation treats Japanese (`.ja.md`) as authoritative; once the content has stabilized, English versions are placed alongside (moving to the same parallel-translation arrangement as esp-flashjs).

---

## 17. Roadmap

The direction of the dependencies makes the order nearly unique: decoders and rendering come first (since the oracle doubles as the debugging environment), generation and encoding build on top of them, and interoperability formats can be added independently.

### Phase 1 — Read & Draw (establishes UC3 / UC7; UC2 for the bundled fonts, UC9 for decode inspection)

- `util/` `model/` and the coordinate conventions
- Decoders: u8g2 / GFXfont / GLCD / FixedBMP / BMP / RLE (= all 186 bundled fonts become readable)
- Rendering and measurement: 1bpp, integer and non-integer scales, 12 datums
- Bundled collection: `extract-fonts.js` → `catalog` / `loadFont`
- Oracle harness and fixtures, CI (the full check suite + a minimal Viewer on Pages)

### Phase 2 — Create (establishes UC1 / UC4 / UC8; UC5 for u8g2 / GFXfont output)

- `gen/`: FontFace + Canvas rasterization, thresholding, character sets (migrating `charsets/`)
- Encoders: u8g2 / GFXfont, `canEncode` / `EncodeIssue`
- `subset` / `merge` (fallback fill for UC4), C source output (`encodeCSource`)
- Real-thing agreement tests (§13.3), the Generator screen

### Phase 3 — Connect (completes UC5 / UC6 / UC9; UC2 expands to arbitrary fonts)

- BDF decode / encode, VLW decode / encode (including 8bpp rendering)
- C source decoding (paste-to-load)
- Serialization, `inspect` / `estimateSize`
- Converter / Inspector screens, English documentation

### Phase 4 — Extend (including exploratory items)

- BFF (waiting for the spec to stabilize on the LovyanGFX side), fontx2
- Real-data validation of kerning preservation
- Rasterizer injection for Node, rendering profiles beyond LovyanGFX

---

## 18. Open Questions

| Topic | Content | Current leaning |
| --- | --- | --- |
| npm package name | The repository is `LGFXFontToolJs`; the npm name is yet to be decided | `lgfx-font-tool` (the code examples in this document are written with it) |
| **Distribution of the bundled font data** | **Decided (2026-08)**: adopt the compromise of bundling the 70 lightweight fonts in npm and resolving the 42MB of CJK fonts remotely from GitHub Pages by default (§16). Replaceable via `configureFontData`. The gzip idea was rejected because compression stalls at 80% (already RLE-compressed data). A separate data package will be reconsidered if demand emerges | Decided |
| CI regeneration of oracle fixtures | Keep it a local procedure, or run all the way to the host build via workflow_dispatch | Local + commit workflow first; move to CI once the harness has stabilized |
| Rendering behavior for uncovered characters | Draw nothing with zero advance, or tofu. Awaiting confirmation of LovyanGFX's actual behavior | Settle via the oracle and update §9.2 |
| BFF | Undocumented, and the spec has not stabilized. Carries kerning and variable bpp | Re-evaluate in Phase 4 |
| Scope of fontx2 and other non-LGFX formats | How far to extend (PCF, u8x8, etc.) | No urgency, since BDF carries interoperability. Demand-driven |
| TTF generation on Node | A rasterizer-injection interface (the caller supplies node-canvas / skia) | Provide only the interface; carry no implementation |
| Handling fonts of unknown license | When attribution could not be established at extraction time | Hold back from bundling; include only those whose attribution is known |
| Extending rendering profiles | The native rendering rules of the u8g2 library / Adafruit GFX | Not started until demand becomes visible |

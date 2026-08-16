# Advanced Guide

[日本語版](./guide-advanced.ja.md)

This guide covers the library's internal conventions, the basis for its guarantees, the details of its constraints, and how to extend it. If you just want to use the API, see the [Use Case Guide](./guide-usecases.en.md); for normative definitions, see the [Specification](./spec.en.md) (section numbers §n refer there).

## 1. Invariants of the Neutral Model

Every format is decoded into `Font` ([src/model/font.js](../src/model/font.js)). Conventions to uphold when writing a decoder/encoder or assembling a model by hand:

- **Coordinate system**: the Y axis is positive downward. The glyph origin is the pen position on the baseline. `yOffset` is baseline → top of the bitmap, so glyphs extending upward have a **negative** value.
- **Integer range**: all metrics are assumed to be int16. Encoders check further, narrower constraints per format (§3).
- **`-0` is forbidden**: if a computation such as `yOffset` produces `-0`, normalize it to `0`. Because `assert.deepEqual` and round-trip comparisons break on `-0 !== +0`, decoders apply the sign with the `v === 0 ? 0 : -v` pattern.
- **Bitmaps**: 1bpp is MSB first, **each row padded to a byte boundary** (`stride = ceil(width / 8)`). 8bpp is a 0–255 coverage value (alpha) and carries no color information.
- **`glyphs` is a `Map<codepoint, Glyph>`**: order has no meaning; encoders sort as needed. `glyphs.get(0)` (U+0000) participates in draw fallback as the "default glyph" (§2).
- **`meta.issues`**: defects noticed during decoding are not thrown as exceptions but accumulated here as warnings (read what can be read). Constraint violations during encoding are exceptions (`EncodeConstraintError`) — the asymmetry is intentional (§3).

## 2. How Pixel-Exact Agreement with LovyanGFX Works

Rendering ([src/render/draw.js](../src/render/draw.js)) is a port of LovyanGFX v1.2.26's `draw_string` and each font class's `drawChar`. To achieve a byte-exact match rather than "roughly the same", the following are reproduced exactly as in the original.

**16.16 fixed point.** The scale factor is converted to fixed point via `toFixed16(size) = Math.trunc(65536 * size)`, and coordinates are always truncated with `(v * sx) >> 16`. Operation order is preserved as well: for example, the negative `xOffset` correction for the first character keeps the LGFX original `sumX = - (metrics.x_offset * sx) >> 16` verbatim (the unary minus applies to the product first, then the shift). The difference vanishes at integer scales, but becomes a 1px discrepancy at non-integer scales such as 1.5x.

**Draw profiles.** How collapsed rows/columns are handled when a scale factor is applied differs per LGFX font class, so it is reproduced via `font.meta.drawProfile` (all profiles are identical at integer scales; the default is `'gfx'`):

| profile | Source class | Handling of runs/rows collapsed by downscaling |
| --- | --- | --- |
| `gfx` | GFXfont | Lift to 1px unless at an edge |
| `u8g2` / `rle` | U8g2font / RLEfont | Do not draw (discard) |
| `bmp` | BMPfont / FixedBMP / BDF | Always lift to 1px (rows: except at the bottom edge) |
| `glcd` | GLCDfont | Scan column-wise and quantize |
| `vlw` | VLWfont | Per pixel. Place the 8bpp coverage value as is |

When placing vlw coverage values onto a 1bpp destination, the rule is "lit if a ≥ 1". This follows from the fact that LGFX's blend expression `(255 * (1 + a)) >> 8` equals a, matching the binarization of white blended onto a black background.

**Fallback chain.** Missing characters resolve in this order: `glyphs.get(cp)` → `glyphs.get(0)` → draw a `drawCharDummy`-equivalent frame (a rectangle inset by 1px) using the metrics from `meta.fallback`. `meta.fallback` is determined by the decoder from the source format's rules (LGFX's behavior when `updateFontMetric` fails). Quirks such as GFXfont's "missing characters get zero advance" are expressed via `fallback.drawAdvance` / `fallback.drawBox`.

**The VLW space special case.** For VLW only, U+0020 draws nothing regardless of whether a glyph exists and advances by `spaceWidth` (a value recomputed at load time as `max(size, ascent+descent) * 2 / 7`). Measurement (`textWidth`) uses the metrics from the table — this asymmetry follows the original exactly.

### The Basis for the Guarantee: Two Kinds of Oracle

That "the port is correct" is guaranteed by tests, not code review ([oracle/](../oracle/README.ja.md)).

1. **oracle_dump** — Have the real LovyanGFX (built natively with the lang-ship:host core) render 1,860 cases across all 186 fonts × draw conditions, dump the output, and compare against this library's output with a **byte-exact match** of the byte sequences. Verifies the decoders and rendering.
2. **oracle_encoded** — 36 cases where byte sequences **encoded** by this library are fed to the real LGFX to read and render. Verifies that the encoders "write things the way LGFX interprets them" (a round trip against our own decoder alone cannot detect cases where both sides share the same misunderstanding).

The fixtures are committed, so a normal `npm test` needs no native build. Regenerate with `npm run oracle` / `npm run oracle:encoded` (requires arduino-cli and the lang-ship:host core).

## 3. Encoding Constraints — Never Silently Truncate

Policy: **encoders never silently transform the source data.** Anything that does not fit stops with an `EncodeConstraintError` (carrying `issues`); only with an explicit `dropInvalid: true` does encoding continue by **dropping violating glyphs entirely** (values are never clamped). Pre-check with `canEncode(font, format)`; `estimateSize(font, format)` returns the size after dropping.

Main constraints and issue codes:

| Format | Constraints (representative examples) | Main codes |
| --- | --- | --- |
| Common | No glyphs / 8bpp into a 1bpp-only format | `EMPTY_FONT`, `BPP_UNSUPPORTED` |
| u8g2 | Dimensions, offsets, and advance are 7-bit signed (−64..63); one glyph's record ≤ 255B | `GLYPH_TOO_LARGE`, `GLYPH_BYTES_OVER` |
| gfx | Dimensions and offsets in the int8/uint8 range, line box ≤ 255 | `GLYPH_TOO_LARGE`, `LINE_BOX_TOO_TALL`, `RANGE_COUNT_LARGE` (warning) |
| bdf | Glyphs that cannot be encoded etc. are recorded as warnings | `BDF_*` |
| vlw | Codepoints within the BMP (u16), line height in the u8 range | `VLW_CODEPOINT_OVER_BMP`, `LINE_HEIGHT_RANGE` |
| bff | Configurations that do not fit in cmap/loca, line height 0 | `LINE_HEIGHT_COLLAPSED` and others |
| fontx2 | Only characters mappable to Shift_JIS, repacking into fixed cells | `FONTX2_UNMAPPED_CODES` |

`level: 'warning'` marks cases that "fit, but information is lost or the shape changes" (e.g. too many range splits in gfx, fontx2's fixed-cell repacking) and never becomes an error.

**For a 16px Japanese font, u8g2 (RLE) is the smallest; at 24px and above, the gap over gfx often widens** — size trade-offs depend on the content. Don't guess; measure with `estimateSizes` (it counts via the same code path as encoding, so the byte counts are exact).

## 4. Lossless Round Trips and `meta.format`

Decoders keep source-format-specific parameters (u8g2's bit-width allocation, VLW's header values, BFF's kern records, and so on) in `font.meta.format.<format-name>` and reuse them when re-encoding to the same format. This is how the "decode → encode reproduces the original bytes" round trip is tested.

For this reason, **`meta` is carried over even after subset / merge**, but if the model has been heavily modified (metrics changes, etc.), the original parameters may no longer be optimal. Even in that case, the encoders recompute values that stay consistent. Note that some data, like BFF's kern, "cannot be edited in the neutral model but is preserved across round trips" (a subset that removes glyphs prunes the kern records to match).

## 5. Distributing Font Data and Offline Use

Of the 186 bundled fonts, only the lightweight 70 (LovyanGFX internal formats + Latin GFX, about 320KB) are included in the npm / CDN package. The 42MB of CJK fonts is resolved at `loadFont` time in the following order ([src/fonts/loader.js](../src/fonts/loader.js)):

1. The location given to `configureFontData({ baseUrl })` (when set, **only** this is consulted)
2. The local `./data/` relative to `import.meta.url` (for a clone and GitHub Pages, all 186 fonts resolve here and nothing goes over the network)
3. The GitHub Pages remote `https://tanakamasayuki.github.io/LGFXFontToolJs/src/fonts/data/`

For offline environments, internal mirrors, and air-gapped setups, copy the repository's `src/fonts/data/` wholesale and point at it:

```js
import { configureFontData } from 'lgfx-font-tool';

configureFontData({ baseUrl: 'https://intra.example.com/lgfx-fonts/' });
// On Node, a local directory also works:
configureFontData({ baseUrl: 'file:///opt/lgfx-fonts/' });
// Restore the default:
configureFontData({});
```

The candidate list can be inspected with the pure function `fontDataCandidates(file)`. `loadFont` caches Promises per font name, and `configureFontData` discards the cache. The only places in the library that perform I/O are this loader (and the browser-only `gen/rasterize.js`).

## 6. Architecture and Layering Discipline

```
src/
  util/     Errors, bit/byte reading and writing (no dependencies)
  model/    Neutral model, subset/merge, serialization (depends only on util)
  format/   Per-format decode/encode/canEncode + registry
  render/   Rendering and measurement (LGFX port)
  inspect/  Inventory, size estimation
  charsets/ Named character sets
  gen/      TTF rasterization (browser only)
  fonts/    Bundled catalog + loader (the only I/O)
```

Discipline: **`src/` must not, as a rule, touch I/O, the DOM, or Node APIs** (the only two exceptions are `fonts/loader.js` and `gen/rasterize.js`). This is checked mechanically by `npm run lint:layers` ([scripts/check-layers.js](../scripts/check-layers.js)). Beware that words like `document` / `fetch(` are detected **even inside comments** (not a false positive — the design forbids even mentioning them).

### How to Add a New Format

1. Implement `decode<Name>` / `canEncode<Name>` / `encode<Name>` in `src/format/<name>.js`. Put source-format parameters in `meta.format.<name>`. Record decoding defects in `meta.issues`, and encoding constraints as `EncodeIssue` with stable codes.
2. Register it in `FORMATS` and in the `detect` / `decode` / `canEncode` / `encode` branches of [registry.js](../src/format/registry.js).
3. Re-export from [src/index.js](../src/index.js).
4. Tests: decode of real data, `decode → encode` round trip, exhaustive coverage of `canEncode` constraints. If possible, an oracle (add cases to oracle_encoded that feed the output to the real thing).
5. `npm run check` (runs tests, types, layers, and locale checks in one pass).

Types are checked via JSDoc + `tsconfig.json` (checkJs), and `npm run types` generates the `.d.ts` files. TypeScript syntax cannot be used.

## 7. Per-Runtime Notes

| Feature | Node | Browser |
| --- | --- | --- |
| decode / encode / render / inspect / subset | ✔ | ✔ |
| `loadFont` (bundled collection) | ✔ (fetch / file:) | ✔ |
| `generateFont` (TTF rasterization) | ✘ `CapabilityError` | ✔ |

- Rasterization depends on `FontFace` + canvas measurement, so it is browser-only. To build from TTF on Node, the practical approach is to generate in a browser (or via Playwright etc.) and export with `serializeFont`.
- Shift_JIS conversion uses `TextDecoder('shift_jis')` (a mandatory encoding of the Encoding Standard), so it works on Node and all major browsers with no extra dependency. The reverse-lookup table is built on first use by decoding every code.
- For huge CJK fonts, `loadFont` incurs network/disk I/O on first use only (§5). Either `await` them all at startup, or show a placeholder in the UI.

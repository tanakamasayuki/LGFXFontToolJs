# Use-Case Guide

[日本語版](./guide-usecases.ja.md)

A recipe collection organized by what you want to do. If you're unfamiliar
with font basics (glyphs, metrics, subsets), start with the
[Beginner Guide](./guide-beginner.en.md). The exact API contract is in the
[Specification](./spec.en.md), and the internals are covered in the
[Advanced Guide](./guide-advanced.en.md).

## 0. Setup — Three Ways to Use It

**Node.js (npm)**

```sh
npm install lgfx-font-tool
```

```js
import { loadFont, drawString } from 'lgfx-font-tool';
```

**Browser (CDN, no build step)**

```html
<script type="module">
  import { loadFont, drawString }
    from 'https://cdn.jsdelivr.net/npm/lgfx-font-tool/dist/lgfx-font-tool.min.js';
</script>
```

**Clone the repository (development, all fonts included)**

```sh
git clone https://github.com/tanakamasayuki/LGFXFontToolJs
cd LGFXFontToolJs && npm install && npm run serve
```

`src/index.js` is the single entry point. The clone includes the full data
for all 186 fonts (npm / CDN bundle a lightweight set of 70; the rest are
fetched automatically on first use).

If you'd rather not write code at all, there are web apps too:
[Viewer](https://tanakamasayuki.github.io/LGFXFontToolJs/viewer.html) (browse the built-in fonts),
[Generator](https://tanakamasayuki.github.io/LGFXFontToolJs/generator.html) (create new fonts),
[Converter](https://tanakamasayuki.github.io/LGFXFontToolJs/converter.html) (format conversion),
[Inspector](https://tanakamasayuki.github.io/LGFXFontToolJs/inspector.html) (inventory, coverage, size comparison).
The Inspector does §1 (selection) and the Converter does §5 (conversion)
on screen, with the same results.

## 1. Picking the Right Built-in Font

A catalog of the 186 built-in fonts from LovyanGFX v1.2.26 is included.
You can narrow the list down by metadata alone, before loading any data.

```js
import { fontCatalog, loadFont, inspect, coverage } from 'lgfx-font-tool';

// Find fonts around 16px that include kana (catalog tags are coarse buckets like 'ascii' / 'kana')
const hits = fontCatalog.filter(
  (e) => e.lineHeight >= 14 && e.lineHeight <= 18 && e.coverage.includes('kana'),
);
console.log(hits.map((e) => `${e.name} (${e.glyphCount} glyphs ${e.dataBytes}B)`));

// Actually loading the font gives you detailed coverage per named character set
const font = await loadFont('lgfxJapanGothic_16');
console.log(inspect(font));
// { glyphCount, ranges, metrics, extremes, bpp,
//   coverage: { ascii: 1, hiragana: 1, hanJa1: 0.999, hanCn1: 0.502, ... } }

// Does the font contain every character in the strings you want to display?
const c = coverage(font, '温度23.5℃ 湿度60%');
console.log(c);  // { total: 12, present: 12, missing: [] }
```

Besides a string, the second argument of `coverage` also accepts the id of
a named character set (`'ascii'`, `'hiragana'`, `'hanJa1'` (JIS level 1),
and so on; see `ALL_SET_IDS` for the full list).

## 2. Reproducing the Device's Display on a PC / in the Browser

The rendering engine is a faithful port of LovyanGFX's `drawString`,
including scaling, the reference point (datum), and each format's
rendering quirks — it is **pixel-identical to real hardware**
(guaranteed by 1,860 byte-exact match test cases; see
[oracle/](../oracle/README.ja.md)). Use it for layout checks, screenshot
generation, and UI previews.

```js
import { loadFont, createBitmap, drawString, textWidth, fontHeight } from 'lgfx-font-tool';

const font = await loadFont('Font4');
const screen = createBitmap(320, 240, 8);

// Feels just like LovyanGFX: setTextDatum + setTextSize + drawString
drawString(screen, font, '12:34', 160, 120, {
  datum: 'middle-center',   // same 12 options as LGFX's textdatum_t
  sizeX: 2,
  sizeY: 2,                 // truncated to 16.16 fixed point, exactly like the hardware
});
```

In the browser you can copy it straight to a canvas:

```js
const img = ctx.createImageData(screen.width, screen.height);
for (let y = 0; y < screen.height; y++) {
  for (let x = 0; x < screen.width; x++) {
    const v = getPixel(screen, x, y);        // even 1bpp fonts yield 255
    const i = (y * screen.width + x) * 4;
    img.data[i + 3] = v;                     // intensity as alpha
  }
}
ctx.putImageData(img, 0, 0);
```

If you only need measurements, you can skip drawing entirely:
`textWidth(font, text, style)` / `fontHeight(font, style)` /
`measureText(...)`.

## 3. Checking String Coverage in CI (Keep Tofu Out of Your Releases)

Whether a subsetted font contains every character your UI strings need can
be checked mechanically — just write `coverage` into a test.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode, coverage } from 'lgfx-font-tool';
import { readFile } from 'node:fs/promises';
import { MESSAGES } from '../src/messages.js';   // all of the app's UI strings

test('UI strings are covered by the font', async () => {
  const font = decode(await readFile('assets/ui-font.u8g2'), { format: 'u8g2' });
  const c = coverage(font, Object.values(MESSAGES).join(''));
  assert.deepEqual(
    c.missing.map((cp) => String.fromCodePoint(cp)),
    [],
    'some characters are missing from the font',
  );
});
```

If a PR adds strings with missing characters, CI fails on the spot.

## 4. Creating a New Font from a TTF

### Without code: the Web Generator

In the [Generator](https://tanakamasayuki.github.io/LGFXFontToolJs/generator.html),
pick a local TTF/OTF/WOFF or a redistributable typeface from Google Fonts,
specify the size and the character set (templates are available, such as a
full Japanese UI set or a clock set), and download the result as a u8g2 /
GFXfont `.h` file and more. A live preview lets you check the typeface and
size before generating, and any characters the typeface lacks are called
out by name — you can fill them in from another typeface (Noto family)
with one click. License attribution (including for the typefaces used for
the fallback fill) is added to the output file automatically.

### With code: `generateFont` (browser only)

Because rasterization uses the browser's canvas, this one feature is
**browser only** (calling it in Node throws `CapabilityError`).

```js
import { generateFont, resolveCharset, encodeCSource } from 'lgfx-font-tool';

const { font, missing, filled } = await generateFont({
  source: ttfArrayBuffer,          // or a URL. For a registered CSS family name, use family: '...'
  px: 24,                          // height of the character ink
  codepoints: resolveCharset({
    sets: ['ascii', 'hiragana', 'katakana', 'jaPunct', 'hanJa1'],
    customText: '℃㎡',            // extra characters to add individually
  }),
  threshold: 128,                  // threshold for 1bpp conversion
  fallbacks: [                     // fill characters missing from the main typeface, in this order (optional)
    { source: symbolsTtfArrayBuffer },
    { family: 'MyRegisteredFallback' },
  ],
});
console.log('which fallback filled what:', filled);
console.log('characters found nowhere:', missing.map((cp) => String.fromCodePoint(cp)));
```

### Where does fallback fill live? — Division of responsibilities

Handling "characters this typeface doesn't have" is deliberately split
across three layers.

1. **Fallback fill at generation time is a library feature** (the
   `fallbacks` above). Rasterize only the missing characters at the same
   px and threshold, then overlay them with baseline alignment — there is
   exactly one correct procedure, and writing it by hand makes it easy to
   get the meaning of px or the metrics handling wrong, so the library
   takes care of it.
2. **Choosing and obtaining the typeface to fill with is the app's
   responsibility**. The Web Generator suggests redistributable Noto-family
   candidates but never fills anything on its own — it names the missing
   characters and the user applies the fill with one click (this is also
   the division that keeps the library core off the network).
3. **Fallback fill between existing bitmap fonts is a recipe** (§7).
   It can be written in three moves — `coverage → subset → merge` — and
   there is a reason the library should not automate it; see the end of
   that section.

## 5. Converting Between Font Formats

Loading is a single `decode` call. Formats with a magic number
(GFXfont binary / FONTX2 / BFF / BDF / LovyanGFX internal format) are
auto-detected, and u8g2 is inferred from its structure. Only headerless
raw data (GLCD and the like) requires an explicit `format` and parameters.

```js
import { decode, canEncode, encode } from 'lgfx-font-tool';

const font = decode(bytes);                    // format is auto-detected
// const font = decode(bdfText);               // BDF / C source can be passed as text

// Check whether it can be written out first (no truncation or silent degradation, by policy)
const check = canEncode(font, 'u8g2');
if (!check.ok) console.log(check.issues);      // list of constraint violations with stable codes

const out = encode(font, { format: 'u8g2' });
// To drop the violating glyphs and continue:
// encode(font, { format: 'u8g2', dropInvalid: true })
```

A rough estimate of which format to target:

| Target | Format | Notes |
| --- | --- | --- |
| LovyanGFX / u8g2 | `u8g2` | RLE compression, usually the smallest |
| Adafruit GFX family | `gfx` | the classic `.h`. Struggles with sparse character sets |
| TFT_eSPI Smooth Font / Processing | `vlw` | 8bpp anti-aliased |
| LVGL | `bff` | lv_font_conv's bin format |
| Legacy Japanese devices / FONTX assets | `fontx2` | Shift_JIS-encodable range only |
| Handoff to other tools / visual editing | `bdf` | text format |

To compare sizes up front, use `estimateSizes(font)` (returns the exact
byte count for every encoder).

## 6. Emitting C Source for Arduino / PlatformIO

`encodeCSource` generates a `.h` file you can `#include` directly.
The original font's license and copyright notice are automatically placed
in the leading comment.

```js
import { loadFont, subset, encodeCSource } from 'lgfx-font-tool';

const base = await loadFont('lgfxJapanGothic_24');
const clock = subset(base, '0123456789:./ ');
const header = encodeCSource(clock, { format: 'u8g2', symbolName: 'clockFont' });
// → save as clockFont.h
```

On the sketch side (LovyanGFX):

```cpp
#include "clockFont.h"   // defines static const lgfx::U8g2font clockFont(...)
display.setFont(&clockFont);
display.drawString("12:34", 0, 0);
```

With `format: 'gfx'` the output is an Adafruit GFX-compatible `GFXfont`
struct (`display.setFont(&clockFont);` stays the same).

## 7. Removing and Adding Characters

**Removing (subsetting)** — non-destructive; returns a new font containing
only the specified characters.

```js
import { subset, estimateSize } from 'lgfx-font-tool';

const small = subset(font, 'ABC0123456789:.');           // specified as a string
console.log(estimateSize(small, 'u8g2').bytes);           // e.g. 4,425 glyphs 163KB → 15 glyphs 243B
```

**Adding (merge / fallback fill)** — `merge(base, overlay)` layers the
overlay's glyphs onto base. Only characters missing from base are added,
and the metrics stay base's. Use it to "borrow characters your main
typeface lacks from another typeface."

```js
import { merge, coverage } from 'lgfx-font-tool';

const missing = coverage(mainFont, requiredText).missing;
const filler = subset(fallbackFont, missing);   // just what's needed from the fill source
const complete = merge(mainFont, filler);
// If the line box heights don't match, a warning appears in complete.meta.issues
```

Not automating this "fallback fill between existing fonts" into a single
library function is deliberate. Layering a 12px Mincho onto a 16px Gothic
still lets `merge` itself succeed — whether the sizes and the look fit is
a judgment made by eye, and it cannot be decided from the data. The
library provides the parts (`coverage` / `subset` / `merge`) and the
warnings (line-box mismatch in `meta.issues`), and leaves the decision to
the user. On the other hand, **when generating from a TTF**, you can
regenerate at the same px, so there is exactly one correct procedure —
and `generateFont`'s `fallbacks` takes care of that case (§4).

## 8. Baking Fixed Strings into a Bitmap

For things that don't need a whole font on the device — like a single line
in a boot logo — baking in just the rendered bitmap is the smallest option.

```sh
node examples/node-render.js lgfxJapanGothic_16 "こんにちは"
```

The contents of [examples/node-render.js](../examples/node-render.js) are
nearly identical to the 10 lines in §0. Take the `bmp.data` from drawing
into `createBitmap(w, h, 1)` (1bpp, MSB first, byte-packed per row), turn
it into a C array as-is, and it can be passed to the `drawBitmap` of most
LCD/OLED libraries.

## 9. Importing FONTX2 / Shift_JIS Assets

FONTX2 fonts from older Japanese devices and the homebrew hardware scene
can be read and written too. Shift_JIS ↔ Unicode conversion is built in
(no dependencies).

```js
import { decode, encode, unicodeToSjis } from 'lgfx-font-tool';

const font = decode(fontxBytes);               // auto-detected by the 'FONTX2' magic
const back = encode(font, { format: 'fontx2', dropInvalid: true });
                                               // characters absent from Shift_JIS are excluded
unicodeToSjis('あ'.codePointAt(0));            // 0x82A0
```

## 10. Saving and Passing Around the Neutral Model

A font mid-conversion can be saved as JSON (the format is stable and
versioned).

```js
import { serializeFont, deserializeFont } from 'lgfx-font-tool';

const json = JSON.stringify(serializeFont(font));   // save / send
const font2 = deserializeFont(JSON.parse(json));    // fully restored
```

Useful for editor working files, handoff to Web Workers, diff review, and
more.

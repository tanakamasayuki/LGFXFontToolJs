# Bitmap Fonts from Zero — Beginner's Guide

[日本語版](./guide-beginner.ja.md)

"I want to put text on a microcontroller's display. Apparently I need
something called a font, but I don't really understand how it works" —
this guide is for you. It assumes no prior knowledge of fonts whatsoever.

The documentation for this library comes in three parts.

| Guide | Audience |
| --- | --- |
| **This guide** | People who want to start with what a font even is |
| [Use-Case Guide](./guide-usecases.en.md) | People who already know what they want to do (a recipe collection) |
| [Advanced Guide](./guide-advanced.en.md) | People who want to understand internals, constraints, and extensions |

The precise specification lives in the [spec](./spec.en.md).

## 1. What Is a Font?

Inside a computer, the character 'あ' is nothing more than a **character
code** (in Unicode, the number U+3042 — called a code point). A number
alone can't be shown on screen, so somewhere there has to be a conversion
from "number → shape of the character".

**A font is exactly that lookup table.**

```
Code point (number)           Glyph (character shape)
U+0041 'A'          ───→      an image or curves shaped like ▲
U+3042 'あ'         ───→      an image or curves shaped like あ
```

Each individual character shape is called a **glyph**. The same "A" has a
different glyph in a gothic (sans-serif) face than in a mincho (serif)
face — that difference is what makes a typeface.

## 2. Outline Fonts and Bitmap Fonts

There are two main ways to store the shape of a character.

- **Outline fonts** (TTF / OTF / WOFF)
  Store the character's contours as curve equations. They scale smoothly
  to any size, but every time you display one, a "curves → pixels"
  computation (rasterization) is required.
  The fonts on your PC or phone are this kind.
- **Bitmap fonts**
  Store the character's shape ahead of time as an **array of pixel dots**
  (a tiny image). Display is just "place the dots as-is", so almost no
  computation is needed.
  The trade-off: they only look good at the size they were made for.

Bitmap fonts are used on microcontrollers (ESP32, Arduino) because:

1. There isn't enough ROM / RAM / CPU headroom to carry a rasterizer
2. "Which pixels light up" is fully determined, so the real device and a
   simulator can produce displays that don't differ by a single pixel

This library deals with bitmap fonts
(TTF appears as the **raw material** for bitmap fonts — see §7).

## 3. Anatomy of a Glyph — Five Numbers

A bitmap font glyph is the combination of "a small black-and-white image"
and "numbers describing where to place it". When laying out text, the
library places glyphs while advancing a pen tip from left to right.

```
                 The pen position (origin) sits on the baseline
                 │
                 │← xOffset →│
                 │            ┌──────────┐ ─┬─ the distance to here is yOffset
                 │            │  ####    │  │   (from the baseline to the top edge;
                 │            │ #    #   │  │    it points upward, so it's negative)
                 │            │ #    #   │  │
                 │            │  ####    │  │
  ──  baseline   ┼────────────┼──────────┼─ ┴─────────────
                 │            │ #        │      ← "g" and "p" stick out below
                 │            │#         │        the baseline
                 │            └──────────┘
                 │←――――― xAdvance ―――――→│
                                          pen position of the next character
```

| Name | Meaning |
| --- | --- |
| `xOffset` | Distance from the pen position to the left edge of the image |
| `yOffset` | Distance from the baseline to the top edge of the image (extends upward, so usually negative) |
| `xAdvance` | How far the pen moves right after drawing this character (the advance) |
| `bitmap.width / height` | The size of the image itself |

The font as a whole has numbers too.

| Name | Meaning |
| --- | --- |
| `ascent` | From the baseline to the top of the line |
| `descent` | From the baseline to the bottom of the line |
| `lineHeight` | The height of one line (distance to the next line) |

A font where "i" and "W" have different widths is called **proportional**;
a font where every character has the same width is called **monospaced**.
The only difference is whether `xAdvance` varies per glyph or not.

### Black-and-White or Gray (1bpp and 8bpp)

- **1bpp** (1 bit per pixel): each pixel is binary — on or off.
  The vast majority of embedded fonts are this kind.
- **8bpp**: each pixel has an intensity from 0 to 255, letting edges
  appear smooth (anti-aliasing). Used by VLW (TFT_eSPI's Smooth Font)
  and others.

## 4. Character Sets — The Biggest Real-World Problem for Bitmap Fonts

Because a bitmap font stores an image for every single character,
**the number of characters you include directly becomes your data size.**

Measured examples (the 16px fonts bundled with this library):

| Contents | Characters | Size |
| --- | ---: | ---: |
| lgfxJapanMincho_16 (the full Japanese set up to JIS level 2) | 4,425 chars | ~163 KB |
| The same font with only alphanumerics and `:.` extracted | 15 chars | 243 bytes |
| Just `0-9` and `:` for a clock display | 11 chars | 188 bytes |

So in the embedded world, the basic strategy is: **include only the
characters you use.** For a clock, just digits and symbols; for a Japanese
UI, just the kanji that actually appear in the strings you display. This
"pick and include" operation is called **subsetting**, and it's one of
this library's main features ([Use-Case Guide §7](./guide-usecases.en.md#7-文字を減らす足す)).

Conversely, trying to display a character you forgot to include produces a
rectangular box (colloquially, **tofu**) or a substitute glyph. There is
also a feature to "verify before shipping that every character in your
strings is included" (`coverage`).

## 5. Font Formats — Same Contents, Different Wrapping

Bitmap font file formats vary from library to library. The contents
(glyph images and numbers) are always what §3 described, yet they're
incompatible simply because the bytes are packed differently.

| Format | Main users | Characteristics |
| --- | --- | --- |
| **u8g2** | u8g2 / LovyanGFX | Small thanks to RLE compression. 1bpp |
| **GFXfont** | Adafruit GFX / LovyanGFX | The classic, distributed as a C header. 1bpp |
| **BDF** | X11 / various tools | Human-readable text format. For interchange |
| **VLW** | Processing / TFT_eSPI | 8bpp anti-aliased (Smooth Font) |
| **BFF** | LVGL (lv_font_conv) / LovyanGFX | 1–4bpp, kerning support |
| **FONTX2** | Older Japanese hardware and the homebrew scene | Shift_JIS-based Japanese format |
| **C source** | Arduino in general | Any of the above embedded in a `.h` file |

This library reads all of these and normalizes them into a common form
called the **neutral model** (exactly the structure from §3). From the
neutral model you can write out to any format, so a conversion like
"u8g2 → GFXfont" is just two steps: read, then write.

## 6. Try It First

### In the Browser (No Installation)

Open the [Web Viewer](https://tanakamasayuki.github.io/LGFXFontToolJs/viewer.html)
to list and preview all 186 fonts built into LovyanGFX.
You can also open a font file of your own and peek inside.

### In Node.js (10 Lines)

```sh
npm install lgfx-font-tool
```

```js
import { loadFont, createBitmap, drawString, textWidth, fontHeight, bitmapToText }
  from 'lgfx-font-tool';

const font = await loadFont('lgfxJapanGothic_16');   // from the bundled collection
const bmp = createBitmap(textWidth(font, 'あ'), fontHeight(font), 1);
drawString(bmp, font, 'あ', 0, 0);
console.log(bitmapToText(bmp));
```

Run it, and you see the 'あ' stored in the font, exactly as it is:

```
......#.........
......#.........
......#####.....
..######........
.....##..#......
.....#######....
.....##.##.##...
...###..#....#..
...#.#.##....#..
..#..###.....#..
..#..##......#..
..#..##.....#...
..###.#.####....
```

The contents of this `bmp` (a byte array) are a bitmap you can send to a
microcontroller and display as-is. What's more, this library's rendering
is guaranteed by tests to be a pixel-for-pixel **byte-exact match** with
what the real LovyanGFX draws. In other words, what you see on your PC is
exactly what appears on the device.

> The large Japanese, Chinese, and other fonts in the bundled collection
> (42MB in total) are not included in the npm package; they are downloaded
> automatically from GitHub Pages on the first `loadFont` call. For
> offline use, see
> [Advanced Guide §5](./guide-advanced.en.md#5-フォントデータの配布とオフライン利用).

## 7. How to Make a New Font

Not by hand-drawing — you **bake it from an outline font (TTF) as raw
material**. Specify "this TTF, at this size, with only these characters",
and the TTF is rasterized into a bitmap font. Using the browser-based
[Generator](https://tanakamasayuki.github.io/LGFXFontToolJs/generator.html)
you can do it without writing any code (redistributable typefaces from
Google Fonts are available to pick from, too).

## 8. Glossary

| Term | Meaning |
| --- | --- |
| Code point | A character's number in Unicode (e.g. U+3042) |
| Glyph | The shape data for one character |
| Baseline | The reference line characters sit on — roughly the bottom of the round part of a "g" |
| Metrics | Collective term for dimensional data like xOffset / xAdvance / ascent |
| Advance | How far the pen moves after drawing one character |
| Subsetting | Shrinking a font by keeping only the characters you use |
| tofu | The box □ shown in place of a missing character |
| 1bpp / 8bpp | Bits per pixel — binary versus grayscale |
| Rasterize | Converting outlines (curves) into pixels |
| Neutral model | This library's internal common font representation |

## Read Next

- For concrete code organized by goal, see the [Use-Case Guide](./guide-usecases.en.md)
- For how byte-exact rendering works and per-format constraints, see the [Advanced Guide](./guide-advanced.en.md)

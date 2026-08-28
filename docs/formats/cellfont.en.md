# CellFont — Bitmap Font Format Specification

[日本語版](./cellfont.ja.md)

- Audience: implementers of generators and renderers for this format
- Status: **v1 (ratified)**
- Spec version: `CELLFONT_SPEC_VERSION == 1`
- Last updated: 2026-08-28

## 0. What this is

CellFont is a format for putting bitmap fonts on microcontrollers with 16–64 KB of flash.
It aims at a small decoder and at making the set of included characters cheap to change.

This document defines **only the contract between the generator and the renderer**.
The two may be written by different people, and this document alone is enough to implement
either. It depends on no particular library or tool.

The primary target is **1bpp pixel-grid fonts with an ink height of 16px or less**, where
the data is densest. **Larger sizes work too, and are often cheaper overall when the
character count is small** (§13).

**CellFont is a compile-time format.** The data is baked into firmware as C source; no
container for loading at run time is defined (§12). The magic `CEL1` is reserved in case
one is defined later.

The name comes from the central property: every glyph shares one **cell**, and each glyph
stores only what varies. The encoder rules (§10) are expressed in the same terms.

## 1. Design goals

1. **Make choices at generation time, not at run time, and express the result as data.**
   The renderer only follows the branches chosen at generation time and **never scans every
   glyph to determine the form** (it does binary-search a sparse index, and it does walk the
   chain for an absent code point).
2. **Changing the character set is cheap.** Adding one character must cost in proportion
   to that one character. A format whose size jumps by an order of magnitude because the
   range became discontiguous is unusable here (§11).
3. **The renderer is small.** Decoder bytes are preferred over expressiveness.
   This is why there is no compression (§13.2).

## 2. Central idea

There are three decisions. Each is expressed by **whether a pointer is `NULL`**.

| Decision | When `NULL` | When non-`NULL` |
| --- | --- | --- |
| `codes` (index) | **Contiguous** — `count` code points from `first` | **Sparse** — binary-search the code table |
| `glyphs` (glyph table) | **Fixed pitch** — one width and advance for all glyphs | **Variable pitch** — 4 bytes per glyph |
| `next` (chain) | **End of chain** | If not in this table, look at the next font |

**Per glyph, only what varies is stored.**
Height, `xOffset`, and `yOffset` are shared by every glyph; this is the main difference
from formats that carry a per-glyph bounding box. Because they are shared, ascent is a
constant and there is no need to scan every glyph when a font is selected.

A single decoder handles every combination. Each decision is one branch, in one place.

## 3. Structure

```c
typedef struct CellGlyph {   /* Variable pitch only. Exactly 4 bytes. */
  uint16_t offset;             /* Byte offset from the start of bitmap */
  uint8_t  width;              /* Glyph width in pixels. 0 is legal (§5) */
  uint8_t  xAdvance;           /* Advance in pixels */
} CellGlyph;

typedef struct CellFont {
  const uint8_t*         bitmap;      /* Glyph bit stream */
  const CellGlyph*       glyphs;      /* NULL = fixed pitch */
  const uint16_t*        codes;       /* NULL = contiguous index. Length is count - headCount */
  const struct CellFont* next;        /* NULL = end of chain */
  uint16_t first;                     /* Start of the contiguous index, or of the head block */
  uint16_t count;                     /* Number of glyphs */
  uint8_t  width, height;             /* width is for fixed pitch. height is shared by all glyphs */
  uint8_t  xAdvance, yAdvance;        /* xAdvance is for fixed pitch. yAdvance is the line advance */
  int8_t   xOffset, yOffset;          /* Shared by all glyphs */
  uint8_t  bytesPerGlyph;             /* Fixed pitch only, so no division at run time */
  uint8_t  headCount;                 /* Head-block length of a sparse index. 0 = no head */
} CellFont;
```

The size of the header is **ABI-dependent**; it is not a value the C language guarantees.

| ABI | `sizeof(CellFont)` |
| --- | --- |
| Typical ILP32 (32-bit pointers, pointer alignment 4) | **28 bytes** |
| Typical 16-bit-pointer ABI | **20 bytes** |

The real value follows `sizeof(CellFont)` on the target ABI. Unless stated otherwise, the
size formulas and comparison tables in this document assume **ILP32**.

For fixed pitch, `bytesPerGlyph` equals `ceil(width * height / 8)`. It exists so that the
renderer performs no multiplication or division at run time.

**On the common ABIs in the table above**, `headCount` fits in the alignment padding, so
**this byte does not grow the header** (`CellGlyph` is 4 bytes with alignment 2, and with
32-bit pointers `CellFont` has alignment 4 and no trailing padding).
These are not guarantees of the C language, so a renderer should confirm them on its target
ABI with, for example, `static_assert(sizeof(CellGlyph) == 4, ...)`.

**Unused fields must be set to 0.** This is required for determinism (§10.4).

| Situation | Fields set to 0 |
| --- | --- |
| Fixed pitch (`glyphs == NULL`) | none |
| Variable pitch | `width`, `xAdvance`, `bytesPerGlyph` |
| Contiguous index (`codes == NULL`) | `headCount` |
| Sparse index with no head block | `first`, `headCount` |

## 4. Drawing coordinate system

**The pen position `(penX, penY)` is a point on the baseline of the line. X increases to the
right and Y increases downward.**

1. Place the top-left pixel of the glyph bitmap at `(penX + xOffset, penY + yOffset)`
2. The bitmap occupies `width` columns by `height` rows
3. After drawing, advance `penX` by the advance (`CellFont.xAdvance` for fixed pitch,
   `glyphs[n].xAdvance` for variable pitch)
4. For the next line, advance `penY` by the `yAdvance` **of the first font in the chain**

`xOffset` and `yOffset` may be negative; the box then overhangs to the left of, or above,
the pen position. **`yOffset` is typically negative**, putting the box above the baseline.

Derived constants (fixed per font):

```text
ascent  = -yOffset            baseline to the top of the box
descent = height + yOffset    baseline to the bottom of the box
```

A drawing API whose origin is the top of the line uses `penY = lineTop + ascent`.

Each font in a chain may carry its own `height` / `xOffset` / `yOffset` (§8).
**The baseline is shared across the chain**, so using each font's own `yOffset` keeps the
glyphs aligned.

## 5. Bitmap layout

**1bpp only. A pixel whose bit is 1 is ink.** Rows run top to bottom, and each row runs
left to right, MSB first. Rows are concatenated into a bit stream and **are not padded to
byte boundaries; only the start of each glyph is byte-aligned.**

One glyph occupies `ceil(width * height / 8)` bytes.

- **Fixed pitch**: glyph `n` starts at `bitmap + n * bytesPerGlyph`. No table lookup.
- **Variable pitch**: glyph `n` starts at `bitmap + glyphs[n].offset`

Every glyph is `height` tall and is drawn at `xOffset` / `yOffset`.
That is, **every glyph sits in a box of the same height.**

**A glyph of width 0 is legal.** In real fonts the space carries no ink (every font
examined stores it as `0x0` with a non-zero advance).

- In variable pitch, set `width = 0`; the glyph consumes no bitmap bytes, and its `offset`
  may equal the following glyph's `offset`
- In fixed pitch every glyph is `width` wide, so the space becomes an **empty cell**
  (an all-zero bit run). The cell rule in §10.1 produces this automatically

**`width` may exceed `xAdvance`** (overhang). The renderer draws `width` columns and
advances the pen by `xAdvance`.

Any spare low bits in a glyph's final byte **must be 0** (required for canonical output, §10.4).

The pixel bit order matches GFXfont. **However, GFXfont bitmaps cannot generally be reused
as-is.** GFXfont carries `width` / `height` / `xOffset` / `yOffset` per glyph, whereas
CellFont shares the height and the offsets, so normalizing to the common cell requires
**rebuilding the bitmap, repositioning and padding each glyph.**

Measured on real fonts, FreeSans 12pt has 18 distinct glyph heights and 11 distinct
`yOffset` values. **Only assets whose glyphs already share one size and offset** can have
their bit streams reused unchanged.

## 6. Glyph order

The bitmap and the glyph table are laid out in this order. **The code table follows the
same order.**

1. **Head block** — `headCount` consecutive code points starting at `first`
   (these do not appear in `codes`)
2. **Tail** — the remaining code points in **ascending order**, corresponding to
   `codes[0 .. count-headCount-1]`

With a contiguous index (`codes == NULL`) there is only the head block, and `headCount`
is unused.

**`codes` must be strictly ascending** (no duplicates). Binary search depends on it, and
violating it silently returns the wrong glyph. Code points in the head block never appear
in `codes`.

## 7. Index

### 7.1 Looking up one font

The structure may live in PROGMEM, so **every field is read through `CELLFONT_READ_*`**
(§12.1). On flat-memory targets these expand to plain dereferences, so nothing is lost.

A glyph number can be as large as 65,534, which cannot coexist with a negative sentinel
where `int` is 16 bits. **Success is the return value; the number is an out-parameter.**

```c
/* Returns 1 and stores the index in *outIndex when found; 0 otherwise. */
int cellFontIndex(const CellFont* f, uint16_t c, uint16_t* outIndex) {
  const uint16_t  first = CELLFONT_READ_U16(&f->first);
  const uint16_t  count = CELLFONT_READ_U16(&f->count);
  const uint16_t* codes = (const uint16_t*)CELLFONT_READ_PTR(&f->codes);

  if (codes == NULL) {                             /* contiguous */
    if (c < first) return 0;
    uint16_t rel = (uint16_t)(c - first);          /* subtraction: safe in 16 bits */
    if (rel >= count) return 0;
    *outIndex = rel;
    return 1;
  }

  uint8_t head = CELLFONT_READ_U8(&f->headCount);
  if (head != 0 && c >= first) {                   /* sparse, head block */
    uint16_t rel = (uint16_t)(c - first);
    if (rel < head) { *outIndex = rel; return 1; }
  }

  uint16_t lo = 0, hi = (uint16_t)(count - head);  /* sparse, tail */
  while (lo < hi) {
    uint16_t mid = (uint16_t)(lo + ((hi - lo) >> 1));   /* lo+hi can wrap */
    uint16_t v = CELLFONT_READ_U16(&codes[mid]);
    if (v == c) { *outIndex = (uint16_t)(head + mid); return 1; }
    if (v < c) lo = (uint16_t)(mid + 1); else hi = mid;
  }
  return 0;
}
```

**Note for 16-bit targets.** Writing `first + count` or `lo + hi` directly wraps where `int`
is 16 bits. The binary-search midpoint is reached in practice for sparse fonts with
`count > 32768` (with `lo=0x8000, hi=0xFFFF`, `(lo+hi)>>1` yields `0x3FFF` instead of
`0xBFFF`). **Write them in the subtraction form shown above.**

**Tail code points may be smaller than `first`.** The head block is the longest consecutive
run, not necessarily the smallest code point (§10.3). Bailing out early on `c < first` is
correct only for a contiguous index.

### 7.2 Looking up a chain

```text
find(chain, c):
  walk each font f in next order; return the first cellFontIndex(f, c) that succeeds

drawing:
  1. if find(chain, c) succeeds, draw that glyph
  2. otherwise, if c != U+FFFD, try find(chain, U+FFFD)
  3. if that also fails, draw nothing and do not advance the pen (advance 0)
```

**Fall back to U+FFFD only after the whole chain has been searched.** Never fall back per
font, or a glyph absent from the first font but present in the second would be replaced by
the first font's U+FFFD. When the requested code point is itself U+FFFD, do not search again.

The format carries no fallback metrics. Whether a tofu box appears becomes a
**generation-time choice** — whether U+FFFD is in the character set — and the result shows
up in the data (§1, goal 1). If renderers each had their own default, the same font would
look different in different implementations, so this is normative.

**Why the head block exists.** Real character sets take the shape "all of ASCII plus a few
symbols". Making the whole thing sparse attaches a 2-byte-per-glyph code table to the 95
contiguous ASCII characters as well. Splitting off the head removes that entirely.

| | Fully sparse | Head + tail | Saved |
| --- | --- | --- | --- |
| 4x8, 95 ASCII + 6 symbols | 990 B | **800 B** | −19.2% |
| 6x12, 95 ASCII + 6 symbols | 1,442 B | **1,252 B** | −13.2% |

## 8. Chaining (`next`)

Fonts are searched in `next` order, and **the first font that has the code point wins.**
Generators must emit chains whose character sets do not overlap.

Each font in a chain may have its own `height` / `xOffset` / `yOffset` (groups of glyphs
with different widths also differ in ink height). However, **`yAdvance` must be identical
across the whole chain**, otherwise line layout breaks. The first font's `yAdvance` is
authoritative.

Why chaining is needed: §10.2 and §11. **`next` lives in the structure rather than in the
renderer's API (an array of fonts) because chaining is the mechanism that delivers goal 2
of §1.** Put it in the API and a generated header would demand a different wiring from
every renderer, which is not portable. The cost is 4 bytes per font (2 with 16-bit
pointers), about 1% of what chaining saves (690 B for the 190-character 8px Japanese set).

## 9. Data size

Notation. **Variable pitch gives each glyph its own width, so a per-glyph b is not
constant**; the total B is used instead.

```text
n = glyph count
h = head-block length
H = sizeof(CellFont)                          28 on ILP32
b = ceil(width * height / 8)                  one glyph, fixed pitch
B = Σ ceil(width_i * height / 8)              total bitmap bytes
```

| Form | Size |
| --- | --- |
| Fixed pitch, contiguous | H + n·b |
| Fixed pitch, head + sparse | H + n·b + 2(n−h) |
| Fixed pitch, sparse | H + n·(b+2) |
| Variable pitch, contiguous | H + B + 4n |
| Variable pitch, head + sparse | H + B + 4n + 2(n−h) |
| Variable pitch, sparse | H + B + 6n |

Under fixed pitch every width is equal, so `B = n·b` and the first three rows are a special
case of the last three.

For reference, GFXfont is `12 + B_gfx + 7·span`. **GFXfont also varies both width and height
per glyph**, so the total is used rather than a per-glyph `b`. `B_gfx` is the sum of the
GFXfont glyph bitmap lengths and **does not equal CellFont's `B`** (GFXfont stores ink boxes,
CellFont stores cells of a shared height). `span` is the **range** from `first` to `last`,
not the glyph count. Holding 500 characters scattered across U+4E00–U+9FA5
requires a 20,902-entry glyph table (**146 KB**).
**This is where the sparse index wins by an order of magnitude.**

## 10. Encoder rules

So that the same input always produces the same data, generators follow these rules.

### 10.1 Cell candidate and trimmed candidate

CellFont has **no per-glyph `xOffset`**, so a glyph's left edge cannot be trimmed
independently. Define trimming first.

**Compute the bounds from inked glyphs only** (those at least 1 pixel wide and tall).
An ink-less glyph such as the space carries arbitrary `xOffset` / `yOffset` values that vary
by typeface, and including them widens the shared box for nothing.

```text
Over the inked glyphs:
  L   = min(xOffset_i)                     shared left edge
  T   = min(yOffset_i)                     shared top edge
  B   = max(yOffset_i + ink height_i)      shared bottom edge
  R_i = xOffset_i + ink width_i            glyph i's ink right edge

Emitted shared metrics:
  xOffset = L,  yOffset = T,  height = B - T

Glyph widths:
  Cell candidate    : width_i = max(xAdvance_i, R_i - L)
  Trimmed candidate : width_i = R_i - L

Pixel placement:
  Place input glyph i's pixel (x, y) at (x + xOffset_i - L, y + yOffset_i - T)
  in the output cell. Every other pixel is 0.

Ink-less glyphs:
  Cell candidate    : width_i = xAdvance_i (all pixels 0)
  Trimmed candidate : width_i = 0

When no glyph has ink (this overrides the ink-less rule above):
  xOffset = 0, yOffset = 0, height = 1, every width = 0, bitmap = NULL
```

### Four candidates; build them all and compare

The cell/trim choice (§10.1) and the single/chained choice (§10.2) are **not independent.**
Fixing one first can miss the minimum.

| # | Candidate |
| --- | --- |
| 1 | Cell candidate, single |
| 2 | Cell candidate, chained by width class |
| 3 | Trimmed candidate, single |
| 4 | Trimmed candidate, chained by width class |

**Build all four representable candidates and take the one whose whole C object
(`sizeof(CellFont)` × number of fonts, plus every array) is smallest.**
Ties are broken in §10.4.

Measured, deciding cell/trim before considering chaining cost up to 147 bytes
(190 Japanese characters at 4x8: 1,620 B sequentially versus 1,473 B comparing all four).

**No other partitioning is searched.** Arbitrary set partitions and optimization beyond two
stages are out of scope for v1.

| 95 ASCII glyphs at 4x8 | Trimmed candidate | Cell candidate |
| --- | --- | --- |
| Size | variable pitch, 726 B | **fixed pitch, 408 B** |

The cell candidate wins here because trimming makes `i` and `W` differ in width, defeating
the fixed-pitch test and attaching a 4-byte-per-glyph table. **Removing the table entirely
beats the padding.** **This reverses for large fonts** (the padding costs more than the
table), so always measure both.

### 10.2 Split by cell-width class and join with `next`

A font mixing glyphs of different widths **almost never passes the fixed-pitch test as a
single font.** Splitting by identical `(width, xAdvance)` and chaining the parts makes each
font fixed pitch, and the glyph table disappears.

| 190 chars (95 ASCII + 95 full-width) | Chained | Single | Classes |
| --- | --- | --- | --- |
| 4x8 / 8x9 | **1,473 B** | 2,163 B | 2 |
| 6x12 / 12x11 | **2,708 B** | 3,245 B | 2 |
| 8x16 / 16x16 | **4,798 B** | 4,924 B | 2 |
| 12x24 / 24x22 | **9,257 B** | 9,972 B | 2 |
| 20x40 / 40x38 | **24,700 B** | 25,958 B | 2 |

**The smaller the font, the bigger the gain.** For typefaces with many classes
(proportional Latin, for example) splitting does not pay, so generators
**compute both and take the smaller.**

Once split by class, each font becomes fixed pitch:

| | CellFont | For reference: u8g2 |
| --- | --- | --- |
| 4x8 fixed, contiguous, 95 glyphs | **408 B** | 764 B |
| 8x9 fixed, head+sparse, 95 glyphs | **1,065 B** | 1,390 B |
| 8x16 fixed, contiguous, 95 glyphs | 1,548 B | **1,282 B** |
| 16x16 fixed, head+sparse, 95 glyphs | 3,250 B | **3,100 B** |

### 10.3 Choosing the index and the glyph table

Do not make the user choose. **Look at the input and take the smaller.**

| Test | Result |
| --- | --- |
| All glyphs share `width` and `xAdvance`, and `ceil(width * height / 8) <= 255` | `glyphs = NULL`, set `bytesPerGlyph` |
| Width and advance are shared but `ceil(width * height / 8) > 255` | **Use variable pitch** (not an error) |
| Code points are contiguous | `codes = NULL`, `headCount = 0` |
| Sparse, longest consecutive run ≥ 2 | Make that run the head block (`first` = its start) |
| Sparse with no consecutive run | `headCount = 0`, all codes in `codes` |

**`bytesPerGlyph` is 8 bits, so fixed pitch tops out at 255 bytes per glyph**
(`width * height <= 2040`, roughly 45×45). 46×46 and 32×64 exceed it and cannot use fixed
pitch even when the widths match. Variable pitch does not use `bytesPerGlyph`, so it can
represent them.

If the head block would exceed 255, clamp it to 255. The remainder goes into the tail and
still works correctly.

**The head block is the longest consecutive run, not necessarily the smallest code point.**
If the longest run sits in the middle, `first` points there and the tail contains code
points below `first`.

### 10.4 Canonical output

**The same input must produce byte-identical output.**

"The same input" means these three things. Normalizing to the common cell (§10.1) is the
generator's job, not part of the input.

| Input | Contents |
| --- | --- |
| **The pre-normalization glyph set** | Each glyph carries a code point, pixels, ink width and height, `xAdvance`, `xOffset`, and `yOffset` |
| **The font-wide `yAdvance`** | It cannot be derived from the glyphs, so it is part of the input |
| **The target ABI's `sizeof(CellFont)`** | Used for candidate comparison (below). Defaults to 28, the ILP32 value |

**The target ABI is an input because it actually changes which candidate wins.**
A chained candidate adds one header per font, so a different `H` reorders the results.
Measured on 190 Japanese characters at 4x12 / 12x11, `H = 28` selects the cell candidate
chained (2,708 B) while `H = 20` selects the trimmed candidate chained (2,626 B).

So **"byte-identical output for the same input" holds only within one target ABI.**
A cross-compiling generator must not use the host's own `sizeof(CellFont)`.

**Base rules**

- Sort code points ascending before laying them out (never depend on input order)
- Do not include timestamps, absolute paths, host names, or the generator version
- Fix the hex digit count, bytes per line, line endings, and trailing newline
- Never emit floating-point numbers

**Tie-breaking**

Without these rules, one input admits several conforming outputs.

| Situation | Rule |
| --- | --- |
| Several longest consecutive runs of equal length | Take the one with the **smaller code point** as the head block |
| Variable-pitch `offset` | **The length of the bitmap array immediately before that glyph is emitted** (the running total of preceding glyphs) |
| `offset` of a `width == 0` glyph | Same rule; it equals the following glyph's `offset` **when one exists** (for the last glyph, the total byte count) |
| Spare bits in a glyph's final byte | **0** (§5) |
| Order of chained width classes | Ascending by each class's **smallest code point** |

**Ranking the candidates**

The four candidates of §10.1 can differ along several axes at once. Independent per-axis
rules can point at different candidates, so the ranking is defined as a **lexicographic
order applied top to bottom**. The first criterion that separates them decides; lower
criteria are not consulted.

| Order | Criterion |
| --- | --- |
| 1 | **Smallest total size** (`sizeof(CellFont)` × font count, plus every array) |
| 2 | **Fewest fonts** |
| 3 | **Most fixed-pitch fonts** |
| 4 | **Is the cell candidate** |

Criterion 2 precedes 3 because chain length **costs on every draw**: a glyph carried by a
later font is found only after every earlier font has been searched and missed. Fixed pitch
saves one table read per draw, which weighs less.

Applying all four always leaves exactly one candidate: criterion 2 separates single from
chained, and criterion 4 separates cell from trimmed. When a chain degenerates to a single
font, that candidate is byte-identical to the single candidate, so there is nothing to
separate.

## 11. Changing the character set

**This is the most important property of the format.** Cost of adding characters to a
4x8 font that starts with 95 ASCII glyphs:

| Character set | n | CellFont | Δ | GFXfont | Δ | u8g2 | Δ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 95 ASCII | 95 | 408 | — | 889 | — | 764 | — |
| +1 | 96 | **437** | **+29** | 1,240 | +351 | 780 | +16 |
| +5 | 100 | **477** | **+40** | 60,180 | **+58,940** | 822 | +42 |
| +10 | 105 | **528** | **+51** | 87,806 | +27,626 | 864 | +42 |
| +20 | 115 | **648** | **+120** | 247,696 | +159,890 | 1,038 | +174 |
| +30 | 125 | **758** | **+110** | 271,430 | +23,734 | 1,195 | +157 |

GFXfont changes by an order of magnitude the moment the range becomes discontiguous
(58,940 bytes to add one character). With the sparse index and chaining, CellFont's
increment stays **proportional to what that character actually costs.**

Three mechanisms make this work.

1. **Sparse index** (§2) — scattered code points still cost 2 bytes each
2. **Head block** (§7) — no code table is attached to the contiguous part
3. **Chaining by cell-width class** (§10.2) — adding a glyph of a different width leaves the
   existing fonts fixed pitch

Without the third, adding a single differently-sized glyph to an ASCII-only font defeats
the fixed-pitch test and attaches a 4-byte table to every glyph: **+394 bytes**.
With chaining it is **+29 bytes**.

## 12. C source output

This is the only distribution form CellFont defines. No binary container for run-time
loading exists.

### 12.1 What the renderer provides

Names are fixed so that a generated header compiles against any renderer.
**A renderer provides `<CellFont.h>`, defining:**

| Name | Contents |
| --- | --- |
| `CellFont` / `CellGlyph` | The structures in §3 |
| `CELLFONT_PROGMEM` | The PROGMEM attribute; expands to nothing where not needed |
| `CELLFONT_READ_U8(p)` | Read a `uint8_t` from PROGMEM |
| `CELLFONT_READ_U16(p)` | Read a `uint16_t` from PROGMEM |
| `CELLFONT_READ_PTR(p)` | Read a pointer from PROGMEM |
| `CELLFONT_SPEC_VERSION` | The spec version the implementation follows. This document is **1** |

**The `CellFont` structure itself lives in PROGMEM** (§12.2), so a plain reference such as
`f->first` does not read correctly on Harvard architectures. **Every read — of the
structure, the glyph table, the code table, and the bitmap — goes through an accessor.**
The `NULL` tests on `codes` / `glyphs` / `next` also apply to the value read via
`CELLFONT_READ_PTR`.

On flat-memory targets all three may expand to plain dereferences, costing nothing.

### 12.2 Shape of a generated header

```c
#pragma once
#include <CellFont.h>

#if !defined(CELLFONT_SPEC_VERSION) || CELLFONT_SPEC_VERSION != 1
#error "This font header requires CellFont spec version 1"
#endif

static const uint8_t   NameBitmaps[] CELLFONT_PROGMEM = { /* ... */ };
static const CellGlyph NameGlyphs[]  CELLFONT_PROGMEM = { /* ... */ };  /* variable pitch only */
static const uint16_t  NameCodes[]   CELLFONT_PROGMEM = { /* ... */ };  /* sparse only */
static const CellFont  Name          CELLFONT_PROGMEM = { /* ... */ };
```

- **The version is checked at compile time.** The structure carries no version field.
  Because the format is baked in, `#error` is enough, and there is no reason to pay
  4 bytes per font at run time
- **Apply the PROGMEM attribute to all four.** On Harvard architectures (AVR and similar),
  omitting it from even one produces garbage
- **Always emit `#pragma once` (or an include guard)** so that including the header more
  than once in a translation unit does not redefine anything
- Record the chosen form (fixed/variable, contiguous/sparse, chained or not) and the size
  in a comment

**`static const` gives every translation unit its own copy.** Including the same font header
from two `.c` / `.cpp` files puts **two copies of the font data in flash**. To use a font
from several translation units, include it in exactly one and expose it with `extern`
rather than relying on linker deduplication. A note in the generated header's comment helps
users notice this.

### 12.3 Symbol naming and emission order

| Item | Name |
| --- | --- |
| Entry-point font | `Name` |
| Second and later fonts in a chain | `Name_2`, `Name_3`, … (in chain order) |
| Arrays | `<font name>Bitmaps` / `Glyphs` / `Codes` (e.g. `Name_2Bitmaps`) |

**Names follow chain order; definitions are emitted in reverse.** C has no forward
references, so define the font that `next` points to first (`Name_3` → `Name_2` → `Name`).
Users only ever refer to `Name`.

## 13. Choosing a size

**CellFont works correctly at any size within the limits in §14.** Size is a question of
efficiency, not of validity, and that efficiency has two axes.

- **Data density** (§13.1–13.3) — three independent mechanisms all reverse at an ink height
  H of about 16; above it, formats with per-glyph bounding boxes and compression carry
  less data
- **Total flash** (§13.4) — moving to another format means carrying one more decoder.
  **When the character count is small, the data difference never covers that cost**

Data density first.

### 13.1 Per-glyph bounding box

95 ASCII glyphs (contiguous):

| Font | H | CellFont | +bbox | GFXfont | u8g2 |
| --- | --- | --- | --- | --- | --- |
| DejaVu 9px | 10 | 1,141 | 1,046 | 1,030 | **945** |
| FreeSans 9pt | 18 | 2,320 | 1,843 | 1,827 | **1,692** |
| FreeSans 12pt | 23 | 3,800 | 2,662 | 2,646 | **2,209** |
| FreeSans 18pt | 35 | 7,730 | 4,852 | 4,836 | **3,336** |
| DejaVu 72px | 75 | 37,769 | 19,632 | 19,616 | **6,646** |

The GFXfont column is **the size that lands in flash as a C structure**
(`12 + B_gfx + 7·span`, §9).

**Adding a bounding box turns this into GFXfont.** When contiguous, `span = n` and `codes`
is empty, so the difference is only the 28-versus-12-byte header: always **+16 bytes**,
regardless of the font (exactly +16 on all five rows above).
**Widening the scope means rebuilding GFXfont**, so there is no reason to widen it.

For a 190-character mixed CJK set the opposite holds: at H ≤ 12 adding a bounding box makes
it **larger** (2,163 → 2,514). At 16px it saves 9%, at 24px 20%, at 40px 27%.

### 13.2 Compression

**No compression.** The gap against RLE is only **1.5% at 16px**, which does not justify
the decoder bytes.

But it is **8% at 24px, 29% at 40px, and 66% at 75px.** The decision not to compress is
safe only within the 16px-and-below scope; outside it, it stops holding.

### 13.3 Totals

190-character mixed CJK set:

| Cells | CellFont | u8g2 | bff | CellFont+bbox |
| --- | --- | --- | --- | --- |
| 4x8 / 8x9 | **1,473** | 2,201 | 2,511 | 2,514 |
| 6x12 / 12x11 | **2,708** | 3,165 | 3,301 | 3,259 |
| 8x16 / 16x16 | 4,798 | **4,408** | 4,570 | 4,474 |
| 12x24 / 24x22 | 9,257 | **7,356** | 8,158 | 8,004 |
| 20x40 / 40x38 | 24,700 | **13,429** | 19,200 | 18,958 |

**CellFont wins at 8–12px, loses from 16px, and is 26% behind at 24px.**

### 13.4 The cost of one more decoder

Everything above compares **data size only**. In practice, moving one large font to another
format means **carrying a second decoder.**

Call that additional cost D bytes. **Until the data difference exceeds D, CellFont is
cheaper in total.** The difference grows with the character count, so the threshold can be
stated as a glyph count.

| Font | H | D=300 | D=500 | D=800 | D=1500 | For reference: difference at 16 glyphs |
| --- | --- | --- | --- | --- | --- | --- |
| DejaVu 9px | 10 | 96+ | 96+ | 96+ | 96+ | −6 B |
| FreeSans 9pt | 18 | 48 | 77 | 96+ | 96+ | +27 B |
| FreeSans 12pt | 23 | 32 | 47 | 53 | 96+ | +79 B |
| FreeSans 18pt | 35 | 14 | 21 | 31 | 48 | +350 B |
| FreeSerif 24pt | 44 | 7 | 14 | 19 | 31 | +631 B |
| DejaVu 56px | 58 | 2 | 5 | 8 | 17 | +1,379 B |
| DejaVu 72px | 75 | 0 | 2 | 4 | 8 | +2,597 B |

The numbers are the largest glyph count at which CellFont is still cheaper in total
(measured by adding ASCII characters in the order digits, symbols, letters; 96+ means the
threshold was not reached within the 96 characters measured).

**Even for a large font, holding it as CellFont is cheaper when there are few glyphs.**
A clock showing `0-9` and `:` — 11 glyphs — wins as CellFont at 24pt (assuming D ≥ 500),
and at 56px if D ≥ 1500.

Two things make small character counts favourable: the glyph table disappears entirely once
fixed pitch applies, and **the shared box is determined only by the characters actually
included.** With nothing but digits, `height` covers just the digit ink, and no padding is
spent on capitals or descenders (FreeSans 18pt is H=35 for all of ASCII, but H=25 for the
digits and `:` alone).

### 13.5 Conclusion

| Situation | Choice |
| --- | --- |
| H ≤ 16 | **CellFont.** Best on both data and total |
| H > 16 with few glyphs (within the table above) | **CellFont.** It loses on data but wins back one decoder |
| H > 16 with many glyphs | A format with per-glyph bounding boxes and compression is smaller |

D depends on the renderer implementation, so when the threshold matters,
**measure the actual increase from carrying both decoders.**

## 14. Limits

| Item | Limit | Where it bites |
| --- | --- | --- |
| `codes` is `uint16_t` | **up to U+FFFF** (BMP only) | Supplementary planes (emoji, U+1F300+) do not fit |
| Variable-pitch offsets are 16-bit | **Each glyph's start is at most 65,535** | Overflows for large full character sets (below) |
| `width` / `height` / `xAdvance` / `yAdvance` | 255 pixels | Not reached in practice |
| `xOffset` / `yOffset` | −128 to 127 | Not reached in practice |
| `bytesPerGlyph` | 255 bytes | Fixed pitch tops out around 45×45 |
| `headCount` | 255 | Longer runs are clamped to 255 (still correct) |
| `count` | 65,535 | Not reached in practice |

**What the format constrains is each glyph's start offset, not the total bitmap size.**
If the last glyph starts at offset 65,000 and consumes 1,000 bytes, the total is 66,000
bytes but every start offset is still representable.

Read these separately:

| | Constraint |
| --- | --- |
| **Format** | Each glyph's start offset is at most 65,535 |
| **v1 generator** | The **total** variable-pitch bitmap is limited to 65,535 bytes |

The second is not a consequence of the format; it is **an additional v1 constraint that
keeps validation simple and conservative.**

**Both concern variable pitch only.** Fixed pitch computes the start as `n * bytesPerGlyph`,
so it has no such limit. Measured (bitmap only, trimmed candidate):

| Font | Glyphs | Bitmap |
| --- | --- | --- |
| DejaVu 72px (95 ASCII) | 95 | 37,361 B — fits |
| Japanese 12px (full set) | 4,425 | 76,628 B — **overflows** |
| Japanese 16px (full set) | 4,425 | 125,884 B — **overflows** |
| Japanese 16px (large set) | 10,839 | 328,240 B — **overflows** |

## 15. Conformance

### 15.1 Invariants of conforming data

Generators guarantee these; renderers may assume them.

| Subject | Invariant |
| --- | --- |
| `count` | `count >= 1`. **An empty font is invalid** |
| Contiguous index | `first + count <= 0x10000` |
| Head block | `headCount <= count`, `first + headCount <= 0x10000` |
| `codes` | Strictly ascending, no duplicates. Length is `count - headCount` |
| | Contains no head-block code point. **May contain code points below `first`** |
| `glyphs` | Non-`NULL` with `count` elements for variable pitch |
| | `NULL` for fixed pitch |
| `bitmap` | Length is `count * bytesPerGlyph` for fixed pitch, `Σ ceil(glyphs[i].width * height / 8)` for variable pitch |
| | May be `NULL` only when that length is 0 (every glyph has `width == 0`) |
| `glyphs[i].offset` | **Equals the total bytes of all glyphs before `i`** (a running total) |
| `next` | The chain **must not contain a cycle**. Character sets do not overlap |
| `height` | `height >= 1` |
| `yAdvance` | `yAdvance >= 1` (identical across the chain, §8) |
| `xAdvance` | May be 0 |
| `bytesPerGlyph` | Equals `ceil(width * height / 8)` for fixed pitch, and is at most 255 |

Standard C has no zero-length array, so emit `NULL` when the bitmap would be empty rather
than a dummy byte.

**The running-total offset is a condition on all conforming data, not only on canonical
output (§10.4).** Sharing bitmap bytes between glyphs and out-of-order placement are not
permitted. Validation stays simple and renderers may trust `offset`.

However, **a renderer must not derive a glyph's byte count from `offset[i+1] - offset[i]`.**
Take it from `ceil(width * height / 8)`, so that relaxing this condition later would not
break renderers.

### 15.2 Renderer obligations

**A renderer must:**

- Handle all three `NULL` decisions (`codes`, `glyphs`, `next`)
- **Compute fixed-pitch offsets in 32 bits.** Evaluating
  `uint16_t count * uint8_t bytesPerGlyph` in 16 bits breaks on large sets
- Follow `next` for an absent code point, and report it absent only after reaching the end
  of the chain
- **Render absent code points as specified in §7** (draw U+FFFD if present, otherwise draw
  nothing and advance 0). Do not apply an implementation-specific default
- Use the first font's `yAdvance` for the whole chain
- Handle a glyph of `width = 0` by advancing without reading any bitmap bytes
- **Perform every read through `CELLFONT_READ_*`** (§12.1), including the `NULL` tests on
  `codes` / `glyphs` / `next`
- **Write the index arithmetic to be safe on 16-bit targets** (the subtraction form of §7.1).
  Never write `first + count` or `lo + hi` directly
- Never return a glyph number as an `int` (it can reach 65,534)
- Provide the names of §12.1 as `<CellFont.h>`

### 15.3 Generator obligations

**A generator must:**

- Follow the encoder rules in §10
- **Fail with an error when a variable-pitch bitmap would exceed 65,535 bytes.**
  It must never silently discard the high bits
- Fail with an error when a code point exceeds U+FFFF
- Verify that `codes` is strictly ascending with no duplicates
- Set unused fields to 0 (§3)
- When emitting a chain, guarantee that the character sets do not overlap and that
  `yAdvance` is identical across it
- Verify every invariant in §15.1, in particular that the chain has no cycle
- **Verify after normalization that every field of §14 is within range, and fail otherwise.**
  Depending on the input's left edge and vertical extent, a normalized `width` / `height` can
  exceed 255, or `xOffset` / `yOffset` can fall outside `int8_t`
- Fail on duplicate code points
- **`count` is counted per emitted `CellFont`.** If any font in a candidate would exceed
  `count > 65535`, **discard that candidate as unrepresentable** (§10.1). Fail only when no
  candidate is representable. Since `codes` is `uint16_t` the input holds at most 65,536
  code points (the whole BMP), and **only an input that lands entirely in one width class
  is unrepresentable**
- Confirm `ceil(width * height / 8) <= 255` before choosing fixed pitch (§10.3)
- Follow the tie-breaking rules of §10.4 so one input always yields one byte sequence
- Emit headers following the version guard and `#pragma once` of §12.2 and the naming rules
  of §12.3

## 16. Rejected alternatives

| Alternative | Why not |
| --- | --- |
| **Per-glyph bounding box** | §13.1. At H ≤ 12 it makes fonts **larger**. It pays above 16px, which is out of scope |
| **Compression** | §13.2. Only 1.5% at 16px, which does not justify the decoder bytes |
| **Width-class table** (1–2 bits per glyph plus class descriptors) | Losing the ability to trim costs more than the table saves above 16px. **Chaining (§10.2) is cheaper and stronger**, and needs no format change |
| **Remapping code points** to a dense range | Only 9% smaller than a sparse index, and **string literals stop working directly** |
| **Range table** (arrays of `{start, end, base}`) | 6 bytes per range. Real character sets are dominated by isolated code points, so it costs more than a 2-byte-per-glyph code table |
| **32-bit offsets** | 16 bits covers 64 KB. Anything larger does not fit the target devices. The §15 guard is enough |
| **32-bit `codes`** (supplementary planes) | Doubles every code table. If needed, add it as a separate form |
| **A version field in the structure** | The format is baked in, so the `#error` of §12.2 gives the same safety for **0 bytes**. As a field it would grow the structure from 28 to 32 bytes |
| **A split two-byte offset** (`offsetLo` / `offsetHi`) | Same 4 bytes as `uint16_t`, but costs a shift and an OR on every glyph drawn, and turns one `pgm_read_word` into two on AVR. Its byte-order independence exists for a binary container, which is out of scope |
| **Fallback metrics** (dimensions of the tofu box) | The U+FFFD convention of §7 costs **0 bytes**, and it surfaces the choice of showing tofu as part of the character set |
| **`next` in the renderer's API** | Saves 4 bytes, but a generated header would then demand renderer-specific wiring and stop being portable (§8) |
| **A binary container** (run-time loading) | The use case does not match the target devices. Machines with a filesystem land in the region where other formats are smaller once the character count grows (§13). Only the magic `CEL1` is reserved |

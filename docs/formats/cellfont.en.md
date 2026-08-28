# CellFont — Bitmap Font Format Specification

[日本語版](./cellfont.ja.md)

- Audience: implementers of generators and renderers for this format
- Status: **v1 (final)**  `CELLFONT_SPEC_VERSION == 1`
- Last updated: 2026-08-28

## 0. What this is

CellFont is a format for putting bitmap fonts on microcontrollers with 16–64 KB of flash.
It aims at a small decoder and at making the set of included characters cheap to change.

This document defines **only the contract between the generator and the renderer**.
The two may be written by different people, and this document alone is enough to implement
either. It depends on no particular library or tool.

The primary target is **1bpp pixel-grid fonts with an ink height of 16px or less**, where
the data is densest. **Larger sizes work too, and are often cheaper overall when the
character count is small** (§12).

**CellFont is a compile-time format.** The data is baked into firmware as C source; no
container for loading at run time is defined (§11). The magic `CEL1` is reserved in case
one is defined later.

The name comes from the central property: every glyph shares one **cell**, and each glyph
stores only what varies. The encoder rules (§9) are expressed in the same terms.

## 1. Design goals

1. **Make choices at generation time, not at run time, and express the result as data.**
   The renderer only follows branches; it never searches or scans.
2. **Changing the character set is cheap.** Adding one character must cost in proportion
   to that one character. A format whose size jumps by an order of magnitude because the
   range became discontiguous is unusable here (§10).
3. **The renderer is small.** Decoder bytes are preferred over expressiveness.
   This is why there is no compression (§12.2).

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
  uint8_t  width;              /* Glyph width in pixels. 0 is legal (§4) */
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

The header is **28 bytes** with 32-bit pointers, **20 bytes** with 16-bit pointers.

For fixed pitch, `bytesPerGlyph` equals `ceil(width * height / 8)`. It exists so that the
renderer performs no multiplication or division at run time.

`headCount` fits in the alignment padding, so **this byte does not grow the header.**

`CellGlyph` is 4 bytes with alignment 2. With 32-bit pointers, `CellFont` has alignment 4
and no trailing padding.

**Unused fields must be set to 0.** This is required for determinism (§9.4).

| Situation | Fields set to 0 |
| --- | --- |
| Fixed pitch (`glyphs == NULL`) | none |
| Variable pitch | `width`, `xAdvance`, `bytesPerGlyph` |
| Contiguous index (`codes == NULL`) | `headCount` |
| Sparse index with no head block | `first`, `headCount` |

## 4. Bitmap layout

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
  (an all-zero bit run). The cell rule in §9.1 produces this automatically

**`width` may exceed `xAdvance`** (overhang). The renderer draws `width` columns and
advances the pen by `xAdvance`.

This layout matches GFXfont, so existing GFXfont assets can reuse their bitmaps unchanged;
only the metadata is rearranged.

## 5. Glyph order

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

## 6. Index

Resolving a code point `c` to a glyph number:

```c
int cellFontIndex(const CellFont* f, uint16_t c) {
  if (f->codes == NULL) {                       /* contiguous */
    if (c < f->first || c >= f->first + f->count) return -1;
    return c - f->first;
  }
  if (f->headCount && c >= f->first && c < f->first + f->headCount) {
    return c - f->first;                        /* sparse, head block */
  }
  uint16_t lo = 0, hi = f->count - f->headCount;   /* sparse, tail */
  while (lo < hi) {
    uint16_t mid = (lo + hi) >> 1;
    uint16_t v = f->codes[mid];
    if (v == c) return f->headCount + mid;
    if (v < c) lo = mid + 1; else hi = mid;
  }
  return -1;
}
```

If not found, follow `f->next`.

**When no font in the chain has the code point (absent), the behaviour is:**

1. If any font in the chain contains **U+FFFD**, draw that glyph
2. Otherwise draw nothing and do not advance the pen (advance 0)

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

## 7. Chaining (`next`)

Fonts are searched in `next` order, and **the first font that has the code point wins.**
Generators must emit chains whose character sets do not overlap.

Each font in a chain may have its own `height` / `xOffset` / `yOffset` (groups of glyphs
with different widths also differ in ink height). However, **`yAdvance` must be identical
across the whole chain**, otherwise line layout breaks. The first font's `yAdvance` is
authoritative.

Why chaining is needed: §9.2 and §10. **`next` lives in the structure rather than in the
renderer's API (an array of fonts) because chaining is the mechanism that delivers goal 2
of §1.** Put it in the API and a generated header would demand a different wiring from
every renderer, which is not portable. The cost is 4 bytes per font (2 with 16-bit
pointers), about 1% of what chaining saves (690 B for the 190-character 8px Japanese set).

## 8. Data size

With b bytes of bitmap per glyph, n glyphs, and a head block of length h:

| Form | Size |
| --- | --- |
| Fixed pitch, contiguous | 28 + n·b |
| Fixed pitch, head + sparse | 28 + n·b + 2(n−h) |
| Fixed pitch, sparse | 28 + n·(b+2) |
| Variable pitch, contiguous | 28 + n·(b+4) |
| Variable pitch, head + sparse | 28 + n·(b+4) + 2(n−h) |
| Variable pitch, sparse | 28 + n·(b+6) |

For reference, GFXfont is `12 + n·b + 7·span`, where `span` is the **range** from `first`
to `last`, not the glyph count. Holding 500 characters scattered across U+4E00–U+9FA5
requires a 20,902-entry glyph table (**146 KB**).
**This is where the sparse index wins by an order of magnitude.**

## 9. Encoder rules

So that the same input always produces the same data, generators follow these rules.

### 9.1 Emit cells, do not trim

Put **the cell width (at least `xAdvance`), not the ink width**, into `width`.

Trimming makes `i` and `W` differ in width, which defeats the fixed-pitch test and attaches
a 4-byte-per-glyph table. Emitting cells grows the bitmap by the padding, but
**removing the table entirely wins by more.**

| 95 ASCII glyphs at 4x8 | Trimmed | Cell |
| --- | --- | --- |
| Size | variable pitch, 726 B | **fixed pitch, 408 B** |

**This reverses for large fonts** (the padding costs more than the table).
Generators **compute both and take the smaller.**

### 9.2 Split by cell-width class and join with `next`

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

### 9.3 Choosing the index and the glyph table

Do not make the user choose. **Look at the input and take the smaller.**

| Test | Result |
| --- | --- |
| All glyphs share `width` and `xAdvance` | `glyphs = NULL`, set `bytesPerGlyph` |
| Code points are contiguous | `codes = NULL`, `headCount = 0` |
| Sparse, longest consecutive run ≥ 2 | Make that run the head block (`first` = its start) |
| Sparse with no consecutive run | `headCount = 0`, all codes in `codes` |

If the head block would exceed 255, clamp it to 255. The remainder goes into the tail and
still works correctly.

### 9.4 Canonical output

**The same input must produce byte-identical output.**

- Sort code points ascending before laying them out (never depend on input order)
- Do not include timestamps, absolute paths, host names, or the generator version
- Fix the hex digit count, bytes per line, line endings, and trailing newline
- Never emit floating-point numbers

## 10. Changing the character set

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
2. **Head block** (§6) — no code table is attached to the contiguous part
3. **Chaining by cell-width class** (§9.2) — adding a glyph of a different width leaves the
   existing fonts fixed pitch

Without the third, adding a single differently-sized glyph to an ASCII-only font defeats
the fixed-pitch test and attaches a 4-byte table to every glyph: **+394 bytes**.
With chaining it is **+29 bytes**.

## 11. C source output

This is the only distribution form CellFont defines. No binary container for run-time
loading exists.

### 11.1 What the renderer provides

Names are fixed so that a generated header compiles against any renderer.
**A renderer provides `<CellFont.h>`, defining:**

| Name | Contents |
| --- | --- |
| `CellFont` / `CellGlyph` | The structures in §3 |
| `CELLFONT_PROGMEM` | The PROGMEM attribute; expands to nothing where not needed |
| `CELLFONT_SPEC_VERSION` | The spec version the implementation follows. This document is **1** |

### 11.2 Shape of a generated header

```c
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
- Record the chosen form (fixed/variable, contiguous/sparse, chained or not) and the size
  in a comment

### 11.3 Symbol naming and emission order

| Item | Name |
| --- | --- |
| Entry-point font | `Name` |
| Second and later fonts in a chain | `Name_2`, `Name_3`, … (in chain order) |
| Arrays | `<font name>Bitmaps` / `Glyphs` / `Codes` (e.g. `Name_2Bitmaps`) |

**Names follow chain order; definitions are emitted in reverse.** C has no forward
references, so define the font that `next` points to first (`Name_3` → `Name_2` → `Name`).
Users only ever refer to `Name`.

## 12. Choosing a size

**CellFont works correctly at any size within the limits in §13.** Size is a question of
efficiency, not of validity, and that efficiency has two axes.

- **Data density** (§12.1–12.3) — three independent mechanisms all reverse at an ink height
  H of about 16; above it, formats with per-glyph bounding boxes and compression carry
  less data
- **Total flash** (§12.4) — moving to another format means carrying one more decoder.
  **When the character count is small, the data difference never covers that cost**

Data density first.

### 12.1 Per-glyph bounding box

95 ASCII glyphs (contiguous):

| Font | H | CellFont | +bbox | GFXfont | u8g2 |
| --- | --- | --- | --- | --- | --- |
| DejaVu 9px | 10 | 1,141 | 1,046 | 1,030 | **945** |
| FreeSans 9pt | 18 | 2,320 | 1,843 | 1,827 | **1,692** |
| FreeSans 12pt | 23 | 3,800 | 2,662 | 2,646 | **2,209** |
| FreeSans 18pt | 35 | 7,730 | 4,852 | 4,836 | **3,336** |
| DejaVu 72px | 75 | 37,769 | 19,632 | 19,616 | **6,646** |

The GFXfont column is **the size that lands in flash as a C structure**
(`12 + bitmap + 7·span`).

**Adding a bounding box turns this into GFXfont.** When contiguous, `span = n` and `codes`
is empty, so the difference is only the 28-versus-12-byte header: always **+16 bytes**,
regardless of the font (exactly +16 on all five rows above).
**Widening the scope means rebuilding GFXfont**, so there is no reason to widen it.

For a 190-character mixed CJK set the opposite holds: at H ≤ 12 adding a bounding box makes
it **larger** (2,163 → 2,514). At 16px it saves 9%, at 24px 20%, at 40px 27%.

### 12.2 Compression

**No compression.** The gap against RLE is only **1.5% at 16px**, which does not justify
the decoder bytes.

But it is **8% at 24px, 29% at 40px, and 66% at 75px.** The decision not to compress is
safe only within the 16px-and-below scope; outside it, it stops holding.

### 12.3 Totals

190-character mixed CJK set:

| Cells | CellFont | u8g2 | bff | CellFont+bbox |
| --- | --- | --- | --- | --- |
| 4x8 / 8x9 | **1,473** | 2,201 | 2,511 | 2,514 |
| 6x12 / 12x11 | **2,708** | 3,165 | 3,301 | 3,259 |
| 8x16 / 16x16 | 4,798 | **4,408** | 4,570 | 4,474 |
| 12x24 / 24x22 | 9,257 | **7,356** | 8,158 | 8,004 |
| 20x40 / 40x38 | 24,700 | **13,429** | 19,200 | 18,958 |

**CellFont wins at 8–12px, loses from 16px, and is 26% behind at 24px.**

### 12.4 The cost of one more decoder

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

### 12.5 Conclusion

| Situation | Choice |
| --- | --- |
| H ≤ 16 | **CellFont.** Best on both data and total |
| H > 16 with few glyphs (within the table above) | **CellFont.** It loses on data but wins back one decoder |
| H > 16 with many glyphs | A format with per-glyph bounding boxes and compression is smaller |

D depends on the renderer implementation, so when the threshold matters,
**measure the actual increase from carrying both decoders.**

## 13. Limits

| Item | Limit | Where it bites |
| --- | --- | --- |
| `codes` is `uint16_t` | **up to U+FFFF** (BMP only) | Supplementary planes (emoji, U+1F300+) do not fit |
| Variable-pitch offsets are 16-bit | **64 KB of bitmap** | Overflows for large full character sets (below) |
| `width` / `height` / `xAdvance` / `yAdvance` | 255 pixels | Not reached in practice |
| `xOffset` / `yOffset` | −128 to 127 | Not reached in practice |
| `bytesPerGlyph` | 255 bytes | Fixed pitch tops out around 45×45 |
| `headCount` | 255 | Longer runs are clamped to 255 (still correct) |
| `count` | 65,535 | Not reached in practice |

**Only variable pitch can overflow the 16-bit offset.** Fixed pitch computes the start as
`n * bytesPerGlyph`, so it has no such limit. Measured (bitmap only, trimmed policy):

| Font | Glyphs | Bitmap |
| --- | --- | --- |
| DejaVu 72px (95 ASCII) | 95 | 37,361 B — fits |
| Japanese 12px (full set) | 4,425 | 76,628 B — **overflows** |
| Japanese 16px (full set) | 4,425 | 125,884 B — **overflows** |
| Japanese 16px (large set) | 10,839 | 328,240 B — **overflows** |

## 14. Conformance

**A renderer must:**

- Handle all three `NULL` decisions (`codes`, `glyphs`, `next`)
- **Compute fixed-pitch offsets in 32 bits.** Evaluating
  `uint16_t count * uint8_t bytesPerGlyph` in 16 bits breaks on large sets
- Follow `next` for an absent code point, and report it absent only after reaching the end
  of the chain
- **Render absent code points as specified in §6** (draw U+FFFD if present, otherwise draw
  nothing and advance 0). Do not apply an implementation-specific default
- Use the first font's `yAdvance` for the whole chain
- Handle a glyph of `width = 0` by advancing without reading any bitmap bytes
- Provide the four names of §11.1 as `<CellFont.h>`

**A generator must:**

- Follow the encoder rules in §9
- **Fail with an error when a variable-pitch bitmap would exceed 65,535 bytes.**
  It must never silently discard the high bits
- Fail with an error when a code point exceeds U+FFFF
- Verify that `codes` is strictly ascending with no duplicates
- Set unused fields to 0 (§3)
- When emitting a chain, guarantee that the character sets do not overlap and that
  `yAdvance` is identical across it
- Emit headers following the version guard of §11.2 and the naming rules of §11.3

## 15. Rejected alternatives

| Alternative | Why not |
| --- | --- |
| **Per-glyph bounding box** | §12.1. At H ≤ 12 it makes fonts **larger**. It pays above 16px, which is out of scope |
| **Compression** | §12.2. Only 1.5% at 16px, which does not justify the decoder bytes |
| **Width-class table** (1–2 bits per glyph plus class descriptors) | Losing the ability to trim costs more than the table saves above 16px. **Chaining (§9.2) is cheaper and stronger**, and needs no format change |
| **Remapping code points** to a dense range | Only 9% smaller than a sparse index, and **string literals stop working directly** |
| **Range table** (arrays of `{start, end, base}`) | 6 bytes per range. Real character sets are dominated by isolated code points, so it costs more than a 2-byte-per-glyph code table |
| **32-bit offsets** | 16 bits covers 64 KB. Anything larger does not fit the target devices. The §14 guard is enough |
| **32-bit `codes`** (supplementary planes) | Doubles every code table. If needed, add it as a separate form |
| **A version field in the structure** | The format is baked in, so the `#error` of §11.2 gives the same safety for **0 bytes**. As a field it would grow the structure from 28 to 32 bytes |
| **A split two-byte offset** (`offsetLo` / `offsetHi`) | Same 4 bytes as `uint16_t`, but costs a shift and an OR on every glyph drawn, and turns one `pgm_read_word` into two on AVR. Its byte-order independence exists for a binary container, which is out of scope |
| **Fallback metrics** (dimensions of the tofu box) | The U+FFFD convention of §6 costs **0 bytes**, and it surfaces the choice of showing tofu as part of the character set |
| **`next` in the renderer's API** | Saves 4 bytes, but a generated header would then demand renderer-specific wiring and stop being portable (§7) |
| **A binary container** (run-time loading) | The use case does not match the target devices. Machines with a filesystem land in the region where other formats are smaller once the character count grows (§12). Only the magic `CEL1` is reserved |

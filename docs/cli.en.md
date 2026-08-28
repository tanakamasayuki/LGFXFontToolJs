# lgfx-font — CLI specification

[日本語版](./cli.ja.md)

- Status: **v1 — implemented and tested** (see §14 for what is still open)
- Audience: people implementing and people using this CLI
- Last updated: 2026-08-28
- Everything here is implemented in `bin/`, and `test/cli.test.js` checks the exit-code
  and output contracts

## 1. Where this fits

**The division of labour with the web apps (Viewer / Generator / Converter / Inspector).**

The web apps are for finding a typeface, assembling a character set, and deciding by eye.
The CLI takes on **only what a browser fundamentally cannot do**.

| | Web app | CLI |
| --- | --- | --- |
| Find and choose a typeface | ○ | × |
| Assemble a character set and look at it | ○ | × |
| Convert something once and download it | ○ | △ |
| **Repeat the same operation every build** | × | **○** |
| **Reproduce the same result in CI** | × | **○** |

### Not in scope

- **Scanning source code** (collecting which characters are used) — project-specific, so it
  belongs to the user
- **git operations** — CI's job
- **Choosing typefaces, assembling character sets in a UI** — the web app's job
- **Elaborate image output** — an image is not a deliverable, it is how you **check** the
  deliverable (§8)

## 2. Design principles

1. **Arguments alone are enough.** This is not a tool that produces nothing until you write
   a config file. A one-off is the starting point; repeated use is only "arguments saved
   somewhere".
2. **Prefer simplicity.** Some network and local resource use is fine. Fewer commands and
   fewer concepts matter more than avoiding a few megabytes of download and cache.
3. **The output is what counts.** The same input in the same environment produces the same
   bytes.

### Repeated use is the same command in another mode

| Use | Form |
| --- | --- |
| One-off | `lgfx-font build <args>` |
| Day-to-day edits | `npm run font` (a saved `build`) |
| CI verification | `npm run font -- --check` |

**There is no config file.** Several targets are handled by `&&` in an npm script. If one is
ever needed it can be added compatibly later, as nothing more than saved arguments.

## 3. Commands

```
lgfx-font build   [options]              make font data (§4-§8)
lgfx-font inspect <file> [options]       report on an existing font (§9)
lgfx-font charset <file> [options]       canonicalize / list character sets (§11)
```

Three. `build` is the tool; the other two support it. **Everything on `build` is an option**
— it takes no positionals, and the source, the characters, and the output are combined from
flags.

## 4. Source (the typeface)

Four kinds. Give exactly one.

| Flag | Meaning | Rasterizes |
| --- | --- | --- |
| `--google <family>` | A curated family **by name alone** (§4.1) | yes |
| `--ttf <path\|url>` | Any TTF / OTF / WOFF / WOFF2 | yes |
| `--font <name>` | A bundled bitmap font (§4.2) | no |
| `--input <path>` | A bitmap font file of your own (§4.3) | no |

The two that rasterize need `--em` (§4.5). The two that do not are already bitmaps, so they
need no size — and with neither a download nor a rasterizer in the way, they are **fully
deterministic**.

### 4.1 `--google`

Pick by name from the typefaces confirmed to be redistributable (SIL OFL 1.1 / Apache-2.0).
`web/googlefonts.js` is the source of truth for the list and it changes;
`lgfx-font build --list-google` prints the current one. Burning glyphs into firmware is
redistribution of the typeface, so the default is limited to that set.

It covers Latin UI faces, display and clock faces, Japanese, symbols, and other CJK.

**v1 is Regular / weight 400 only.** Other weights and italics of the same family cannot be
selected (the library carries `weight` / `italic`, so `--weight` / `--italic` can be added
when needed).

**The list is a shortcut, not a restriction.** For anything not on it, obtain the `.ttf`
yourself and pass it with `--ttf`. Checking the licence is then your responsibility.

Fetching goes through the Google Fonts CSS API. **One whole TTF per family is downloaded and
cached** (5.1 MB for Noto Sans JP). The CSS API varies the format it returns by User-Agent,
so a User-Agent that yields TTF is used.

> For reference: with a modern browser's User-Agent the response is woff2 split into 124
> `unicode-range` slices. Fetching only the slices you need is far lighter, but it means
> owning the per-character slice resolution, which risks **being unable to distinguish "the
> typeface lacks this glyph" from "that slice was never fetched"**. v1 takes the whole font.
> Swapping in the optimization later changes nothing observable from outside.

### 4.2 `--font` (bundled fonts)

Refer to one by name, as in `--font lgfxJapanGothic_16`. It is already a bitmap, so there is
no `--em` and **no rasterizer**.

Two uses:

- **Format conversion.** Turn an existing u8g2 font into CellFont or BDF (UC5)
- The only generation route **where the rasterizer will not run**

Some bundled data is not in the npm package, in which case it is fetched from GitHub Pages
(`src/fonts/loader.js`). **`--offline` applies to that fetch too.** For CI, keeping the file
locally and reading it with `--input` (§4.3) is more dependable.

### 4.3 `--input` (a font file of your own)

Reads an existing bitmap font by path: `.u8g2`, `.bdf`, `.gfx`, C source, and so on. The
format is detected from the content, and `--input-format <id>` overrides that when detection
cannot work (VLW and raw formats need it stated). When a C source holds several fonts,
`--input-symbol <name>` picks one.

**This is also the entry point for converting existing fonts** (u8g2 → CellFont, say). With
neither a rasterizer nor a download involved, it is the most reproducible of the four.

### 4.4 Cache

Downloaded fonts go in the **user's cache directory**: `$XDG_CACHE_HOME/lgfx-font-tool`, or
`~/.cache/lgfx-font-tool` when that is unset.

**Not under the project (`node_modules/.cache`).** A typeface is material shared across
projects, not one project's build artifact. Keying it to the working directory means
**running from a subdirectory re-fetches megabytes**.

`--cache-dir <path>` changes it. In CI, point it inside the workspace so `actions/cache` can
pick it up. `--offline` uses only the cache and fails when something is missing.

### When the remote changes

The cache is keyed by URL, so **once fetched, the same bytes come back forever**. An updated
remote does not reach an existing checkout. That is what you want for reproducibility, but it
is a problem if you cannot tell that your machine and CI are using different typefaces.

So **the SHA-256 of the source font is recorded in the generated header's comment.**

```
// Obtained : Google Fonts: Noto Sans JP
// Source   : sha256:ae7b7855e115a5966d8b1b3f80f254cc…
```

The same input gives the same value, so canonical output (format spec §10.4) is intact, and a
typeface that changed underneath **shows up as one line in `git diff`** — which is why
`--check` failed.

Stricter options already exist: `--offline` confines you to the cache, or put the `.ttf` in
your own repository and use `--ttf ./font.ttf`. **No dedicated flag (an `--expect-sha256` or
similar) is added** — record it first, and add one when the need is real.

### 4.5 Size — `--em`

**`--em N` gives the em (the design size) in pixels.**

The em is the typeface's design square for one character, and **a full-width character
advances exactly one em**. Note that the definition is **horizontal**, not vertical.

```
--em 16  →  a full-width character advances 16 pixels
```

Measured (Noto Sans JP). `--em` and the full-width advance always agree, odd values included.

| `--em` | Line height | Tallest ink | Full-width advance | Latin advance |
| --- | --- | --- | --- | --- |
| 8 | 10 | 10 | **8** | 6 |
| 10 | 12 | 12 | **10** | 7 |
| 12 | 14 | 14 | **12** | 9 |
| 14 | 16 | 16 | **14** | 10 |
| 16 | 19 | 18 | **16** | 12 |
| 20 | 23 | 22 | **20** | 15 |
| 24 | 29 | 28 | **24** | 17 |

**The line height comes out larger than the em**, because of the space above and below and
because glyphs such as `|` and brackets extend past the em. **To fit a 16-pixel row, pick
`--em 14`, not `--em 16`** — the correspondence differs by typeface, so the measured values
are printed at generation time.

A Latin-only typeface has no full-width characters, so no advance matches the em, but the em
works the same way as a scale.

| `--em` (DejaVu Sans) | Line height | Tallest ink | `H` advance |
| --- | --- | --- | --- |
| 12 | 14 | 13 | 9 |
| 16 | 17 | 16 | 12 |
| 24 | 26 | 25 | 18 |

### Why not "the height of a reference glyph"

**The em involves no measurement, so changing the character set never moves the scale.**
That is what decides it.

The earlier implementation scaled by "the ink height of whichever of
`[漢 国 日 가 H E N 0]` is **present in the requested repertoire**". That had two problems.

- **Adding one character shrank the existing ones.** Adding `日` to 95 ASCII characters moved
  the reference from `H` to `日`, and **the dimensions of 92 existing glyphs and the line
  height changed** (measured). That breaks the premise that characters are cheap to add and
  remove
- **The number guaranteed nothing.** Asking for `16` could still give a tallest ink of 24
  pixels and a line height of 25, because the reference glyph is not necessarily the tallest

`--em` measures nothing, so neither happens. Adding 7 kanji to 95 ASCII characters changes
**0 of 95** glyphs (measured).

`--em` also matches how the bundled bitmap fonts are named: `lgfxJapanGothic_16` has a
full-width advance of 16, which is what `--em 16` means.

### Checking that it fits

The line height depends on the typeface, so **whether it fits is a check, not a setting**.

```
--max-height 16    fail when the line box exceeds 16 (exit code 1)
```

### 4.6 Filling in what the source lacks (`--fallback`)

Now that presence detection is right (§13.1), the gaps can be filled from another typeface.

```
lgfx-font build --google Roboto --fallback google:"Noto Sans JP" \
  --em 16 --sets ascii,hiraganaKatakana,hanJaG1 \
  --format cellfont --out font.h
```

- `--fallback` is repeatable and tried **in the order given**, so the result does not depend
  on which typeface happens to be wider.
- The notation is the same as the source (`google:<family>`, a path, or a URL). Nothing new
  to remember.
- How many characters were filled, and which, goes to stderr.
- **The fallback's attribution goes into the output too.** A typeface that supplied glyphs is
  a source of the derived work just as the primary is, so its name, author, licence, origin,
  and `sha256` are recorded in their own block.
- Filling rasterizes, so `--em` is required.

#### Adding characters to a font you already have

Fallbacks work with `--input` (a bitmap font of your own) as well. **There is no
"concatenate two fonts" feature.** Filling in what is missing needs fewer concepts and
produces one font instead of two.

```sh
# Add kanji to an existing .h and rebuild it
lgfx-font build --input font.h --chars "AB温度" --em 16 \
    --fallback google:"Noto Sans JP" --format cellfont --out font.h
```

For a font this tool made, though, **this is the better route.** The generated header carries
the command that made it (§6), so adding a character means adding it and running that command
again.

```sh
# The header's "Rebuild with" command, plus the new characters
lgfx-font build --google Roboto --em 16 --chars "AB温度" \
    --fallback google:"Noto Sans JP" --format cellfont --out font.h
```

Every glyph then comes from the same typeface at the same `--em`, so **the metrics agree and
the output is as small as it can be.** Adding through `--input` is for when the original
typeface is not at hand, or the source was a bitmap font to begin with.

| | `--input` + `--fallback` | Add to the original command |
| --- | --- | --- |
| Original typeface | Not needed | Needed |
| Metrics | **May disagree** (below) | Agree |
| Output size | Tends to be larger | Smallest |

**Disagreeing metrics are reported.** The input font's line box is what is kept, so filled
glyphs may sit at a different position or size. Silently rescaling them would be worse, so
both sets of numbers are printed and `--preview` is suggested.

```
warning: the filled characters were drawn to different metrics than the base font.
  base: {"ascent":12,"descent":0,"lineHeight":12}
  fill: {"ascent":14,"descent":2,"lineHeight":16}
  The base font's line box is kept. Check the result with --preview.
```

**A CellFont header cannot be read back** (C source input reads GFXfont and u8g2). To add
characters to a CellFont, run the `Rebuild with` command from its header.

## 5. Choosing characters

Four kinds. **They combine, and the result is their union.**

| Flag | Example |
| --- | --- |
| `--chars <text>` | `--chars "温度設定完了℃"` |
| `--charset <path>` | `--charset fonts/chars.txt` (§11) |
| `--sets <id,...>` | `--sets ascii,hiragana,hanJaG6` |
| `--template <id>` | `--template japaneseUi` |

**Selecting no characters at all is an error** (exit code 1). The format does not allow an
empty font (CellFont spec §15.1).

### Set ids and templates

The generated data under `src/charsets/` is the source of truth, and **both the ids and the
sizes change there** (six grade-level kanji sets were in fact added later). **This document
lists neither.** Copying them here guarantees they drift.

```
lgfx-font charset --list      print set and template ids with their current sizes
```

There are five axes: Latin, kana, Han, Hangul, symbols. Han is a **cumulative tier** per
language; Japanese builds up from the school grades (years 1-6, i.e. the Kyōiku kanji)
through Jōyō, Jinmeiyō, and the JIS levels.

`--template` is an alias for a common combination — sugar over `--sets`.
**`--chars` / `--charset` / `--sets` / `--template` all combine as a union.**

## 6. Output

`--out <path>` and `--format <id>`. **`--format` is required and has no default.** This is a
general-purpose tool, so it does not lean towards one format; omitting it prints the list of
formats and stops.

**The container follows from the extension.**

| Extension | Container |
| --- | --- |
| `.h` / `.hpp` / `.c` / `.cpp` | C source (arrays plus structures) |
| anything else | The raw file (each format's binary; BDF is text) |

### Supported formats

| `--format` | C source | Raw file |
| --- | --- | --- |
| `cellfont` | CellFont structures (format spec §12) | — |
| `u8g2` | usable as `lgfx::U8g2font` (`--no-wrapper` for the array alone) | u8g2 binary |
| `gfx` | Adafruit GFX compatible; sparse sets use the LovyanGFX extension | **the GFX1 container** (this tool's own; not Adafruit's raw form) |
| `vlw` | an array for `loadFont` at run time | VLW binary |
| `bff` | an array for `loadFont` at run time. `--bpp 1\|2\|4` | BFF binary |
| `bdf` | — | BDF text |
| `fontx2` | — | FONTX2 binary |

An impossible combination **stops with the reason stated** (for example, `cellfont` has no
raw form, and `bdf` has no C source form).

### What C source output needs

| Flag | Meaning |
| --- | --- |
| `--name <ident>` | The C symbol name. Defaults to the basename of `--out`, canonicalized into an identifier |
| `--target ilp32\|avr` | The `sizeof(CellFont)` used for candidate comparison (28 / 20). Default `ilp32` |
| `--no-wrapper` | u8g2: leave out the `lgfx::U8g2font` declaration |

`--target` matters only for CellFont. **The winning candidate changes with the target ABI**,
which is why format spec §10.4 makes it part of the generator's input. Other formats ignore
it.

#### `--no-wrapper` — u8g2 without LovyanGFX

In the u8g2 output, **only the last line is LovyanGFX-specific**. The byte array itself is
the format the upstream u8g2 library reads, and depends on no library.

```c
static const uint8_t myfont_data[71] LGFXFT_PROGMEM = { ... };   // upstream u8g2 format
static const lgfx::U8g2font myfont(myfont_data);                 // only this is LovyanGFX
```

`--no-wrapper` leaves out the second line and **names the array itself** the font symbol,
which is the shape upstream u8g2 fonts have.

```c
static const uint8_t myfont[71] LGFXFT_PROGMEM = { ... };
// Usage:  u8g2.setFont(myfont);
```

Passing it with any other `--format` is an argument error (3): what the other formats declare
is a type the format itself requires, not a wrapper that can be taken off.

| `--format` | Library-specific type in the output |
| --- | --- |
| `u8g2` | `lgfx::U8g2font`. Removable with `--no-wrapper` |
| `gfx` (one contiguous range) | `GFXfont` / `GFXglyph`. Adafruit GFX's own types — this *is* the format |
| `gfx` (sparse set) | `lgfx::v1::GFXfont` / `EncodeRange`. A LovyanGFX extension, and **not removable**: Adafruit's `GFXfont` can only express a single contiguous range |
| `vlw` / `bff` | None. **Already the array alone** |
| `cellfont` | `CellFont` / `CellGlyph`. The types of format spec §12, which belong to no particular library |

### The generated C source

The typeface name, author, licence, origin, coverage, and size go into a comment at the top
(OFL and Apache require the notice to travel with the data). **Because the coverage is in
that comment, `git diff` alone shows which characters were added or removed.**

**Nothing volatile goes in the comment.** Absolute paths, fetch timestamps, and versioned
temporary URLs would break canonical output (format spec §10.4). The origin records only
things that are the same for the same input: the relative path as given, or the family name
from `--google <family>`.

### Recording the command

The comment at the top of C source output carries the command that produced the file.

```
// Rebuild with:
//   npx lgfx-font build --google Roboto --em 16 --chars AB温度 --fallback 'google:Noto Sans JP' --format cellfont --out font.h
```

- Flags that do not change the file are left out (`--check`, `--preview`, `--preview-text`,
  `--max-height`, `--offline`, `--cache-dir`, `--json`). `--allow-missing` is kept, because
  without it the rebuild would stop.
- The order is **fixed, not as-typed**, so the same build always writes the same line and
  canonical output (§6) is not broken.
- **One line, however long.** Wrapping with a trailing `\` reads better but does not survive
  being copied: the continuation lines are still inside the `//` comment, so what reaches the
  shell is commented out.
- `npx` prefixes it because that runs whether or not the package is installed globally.
- An absolute path outside the working directory is **reduced to its file name**, so no home
  directory layout leaks into the output and the line is the same across machines. The cost
  is that a font of your own has to be put back by hand.

## 7. Verification mode

```
lgfx-font build ... --check
```

**Writes no main output (`--out`); only checks that the existing one matches.** For CI.
A preview is not the main output, so it is still written under `--check`.
A mismatch prints the gist and exits 2. **A missing output is also 2** (not generated =
does not match).

## 8. Confirmation images

**An image is not a deliverable, it is how you check one.** It stays plain.

| Flag | Output |
| --- | --- |
| `--preview <path.png>` | A glyph sheet (did the characters you asked for arrive?) |
| `--preview <path.png> --preview-text "text"` | A sample line (does the real wording read?) |

Where it goes is the project's decision. **Whether to commit it, add it to `.gitignore`, or
upload it as a CI artifact is none of the tool's business.**

PNG, 8-bit grayscale. The only dependency is `node:zlib`.

## 9. `inspect`

Reads an existing font and reports on it (the CLI form of UC2 / UC9).

```
lgfx-font inspect <file> [--input-format <id>] [--input-symbol <name>] [--json]
```

Reports: the format, the glyph count, the coverage, the metrics (em / line height / ascent /
descent), the size in every format, and any issues found while reading.

- The format is detected, and `--input-format` overrides it (VLW and raw formats cannot be
  detected, so they must be stated)
- When a C source holds several fonts, they are listed and `--input-symbol` picks one
- `--json` is the machine-readable form, for budget checks in CI and the like
- Unreadable input exits 1. Damaged input is read as far as it goes, with the rest reported
  as issues

## 10. Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Generation error (absent characters, over `--max-height`, a field out of range, an impossible format/container pair, …) |
| 2 | `--check` mismatch (a missing output is also 2) |
| 3 | Bad arguments (including the format listing printed when `--format` is omitted) |

**Characters the typeface does not have are an error by default (code 1)**, because burning
blanks silently is only discovered on the device. Fill them from another typeface with
`--fallback` (§4.6), or turn the error into a warning with `--allow-missing`.

## 11. Character-set files

The text passed to `--charset`. It uses the same vocabulary as `src/charsets/charsets.js`,
so it speaks the same language as the web app.

```
# fixed wording on the screen
@ascii
@symUnits
U+00B0-U+00B1
温度湿度設定完了異常
```

| Line | Meaning |
| --- | --- |
| `# ...` | Comment |
| `@<id>` | A set id (§5) |
| `U+XXXX` / `U+XXXX-U+YYYY` | A code point or a range |
| anything else | Every character on the line |

### Canonicalization

```
lgfx-font charset fonts/chars.txt              # normalizing is the default action
lgfx-font charset fonts/chars.txt --normalize  # the explicit form; identical
```

**Each literal line is canonicalized on its own. Characters never move between lines.**

| Rule | |
| --- | --- |
| Unit | **One line at a time**: de-duplicated within the line and sorted by code point |
| Line order | Unchanged, so lines still correspond to the comments around them |
| Duplicates across lines | **Kept.** A literal that also appears in `@ascii` is not removed |
| Expanding `@name` | Never (**it would erase why those characters are there**) |
| Encoding | UTF-8. A BOM is preserved. Line endings become LF |
| Writing | To stdout. Only `--write` replaces the file, through a temporary file in the same directory |

Nothing is aggregated across lines because **there is no right answer to which line a
character should go back to**. Keeping it within the line makes the rule unambiguous and
leaves the comments meaningful.

`charset --list` prints set and template ids with their sizes (§5).
`charset --expand` expands `@name` into literal characters — **the starting point for
copy-pasting your own set together**.

## 12. Examples

```sh
# A one-off: just the characters you need, from a bundled font
npx lgfx-font build --font lgfxJapanGothic_16 --chars "温度設定完了" \
    --format cellfont --out font.h

# From Google Fonts, by name alone
npx lgfx-font build --google "Noto Sans JP" --em 16 \
    --sets ascii,hiragana,hanJaG6 --chars "℃" --format cellfont --out font.h

# From your own TTF, with a confirmation image
npx lgfx-font build --ttf ./MyFont.ttf --em 12 --charset chars.txt \
    --format cellfont --out font.h --preview font.png

# A different format
npx lgfx-font build --ttf ./MyFont.ttf --em 12 --sets ascii --format u8g2 --out font.u8g2

# Fill what a Latin typeface does not have from another one
npx lgfx-font build --google Roboto --fallback google:"Noto Sans JP" --em 16 \
    --sets ascii --chars "温度設定" --format cellfont --out font.h

# For upstream u8g2 (no LovyanGFX type in the output)
npx lgfx-font build --ttf ./MyFont.ttf --em 12 --sets ascii \
    --format u8g2 --no-wrapper --out font.h

# Repeated use (package.json)
"scripts": {
  "font": "lgfx-font build --google 'Noto Sans JP' --em 16 --charset fonts/chars.txt --format cellfont --out src/font.h --preview fonts/preview.png"
}
```

Day to day it looks like this.

```
$ vim fonts/chars.txt
$ npm run font
  src/font.h   1,473 B (+29)   191 glyphs (+1)   line 16   tallest ink 16
               fixed 4x8×95 + fixed 8x9×96   chain of 2
$ git add -A && git commit
```

**`(+29)` and `(+1)` are the point.** Every run says what you added and what it cost. The
delta comes from the existing output file when there is one.

**The line height and the tallest ink are printed every time.** `--em` is a horizontal
measurement, so how many pixels tall the result is cannot be known until the typeface is
chosen. Printing it means you notice even without `--max-height`.

## 13. Implementation premises

### 13.1 The rasterizer

`src/gen/rasterize.js` draws with the browser's `FontFace` + canvas, so in Node it raises
`CapabilityError('RASTERIZER_UNAVAILABLE')`. The CLI fills that gap as follows.

| Item | Decision |
| --- | --- |
| Implementation | **`@napi-rs/canvas`** (Skia) plus a shim of about 40 lines |
| What the shim provides | `FontFace` / `document.fonts` / `OffscreenCanvas` |
| Changes to existing code | **None.** `rasterize.js` runs unmodified |
| Kind of dependency | Native (prebuilt binaries; no build tools needed) |
| Version | Pinned in `package.json` |
| Pixel agreement | **Deterministic within one environment is enough.** Matching the browser pixel for pixel is not required |

Verified:

- 95 ASCII characters plus symbols generate at 9 / 12 / 16 px, presence detection included
- **Byte-identical across three separate processes** (same machine, same version)
- woff2 is readable too

**Not verified: the OS and CPU matrix.** Only Linux x64 was checked; what happens where
`@napi-rs/canvas` has no prebuilt binary has not been looked at.

#### Presence is decided from the cmap

The library decides presence by drawing with the target typeface and comparing against the
generic families (`serif` / `monospace`). In a browser this is correct: a `FontFace`'s
`unicode-range` keeps the registered typeface away from every character outside its range.

**In Node it does not hold.** Skia's font registry has no equivalent of `unicode-range`, so
Skia substitutes a system font for any character the typeface lacks, and the comparison reads
that as "the typeface has it". Measured: asking DejaVu Sans, which has no kanji, for `温`
returned a glyph 152 px tall.

Isolating the registry does not help. Calling `GlobalFonts.removeAll()` either before or
after registration (both measured) leaves the family count back at 162 and makes every family
return the same result, so even `A` is reported absent. It is strictly worse.

So the CLI **reads the font file's own `cmap` to decide what it contains**
([bin/coverage.js](../bin/coverage.js)). The rasterizer is only ever handed code points the
typeface actually has. Only `cmap` is read — no outlines, nothing else interpreted — for
formats 0, 4, 6, and 12. Format spec §2.3 (the library parses no font tables) is untouched:
this stays inside `bin/`.

| Input | Presence |
| --- | --- |
| TTF / OTF / TTC | Decided from `cmap` |
| WOFF / WOFF2 | **Cannot be decided.** The `cmap` is compressed, so a warning is printed and the request goes through unfiltered |

With WOFF / WOFF2, a character the typeface lacks may still be drawn by a system font. Pass
an uncompressed TTF / OTF when that matters.

### 13.2 Dependencies and the network

**The CLI ships in the same package** (not a separate one), provided through `bin` in
`package.json` as `lgfx-font`.

The rasterizer is an **`optionalDependency`**.

| | |
| --- | --- |
| `npm i lgfx-font-tool` | **Installs it** (33 MB of platform binaries). TTF works straight away |
| `npm i --omit=optional` | Does not. `--ttf` / `--google` print the install command and stop (code 1) |
| An OS / CPU with no prebuilt binary | **`npm install` still succeeds**; the §13.2 message appears at run time |

**`optionalDependencies` are installed by default.** "Optional" is not about *whether* it
arrives; it means **a failure to install it does not fail `npm install`**.

**The two failures are told apart.** The package being absent
(`ERR_MODULE_NOT_FOUND`) is a different thing from it being present with no binary for this
platform (`Cannot find native binding`), and telling someone in the second case to install it
**sends them back to the same error**.

```
package absent    → npm install @napi-rs/canvas
binary absent     → @napi-rs/canvas has no prebuilt binary for this platform
                    (linux/x64). Reinstalling will not help.
                    Use --font or --input with a bitmap font, …
```

**Why not `dependencies`.** There is exactly one practical difference. Either way 33 MB
arrives by default, so **all that changes is the behaviour where no prebuilt binary exists**.

| Declaration | On an OS / CPU with no prebuilt binary |
| --- | --- |
| `dependencies` | `npm install` **can fail**, taking down people who only wanted the library |
| `optionalDependencies` | **Installation succeeds**; only TTF input fails |

The rasterizer is needed by two of the four sources, so making its absence block the whole
package is too heavy a penalty. Hence the optional dependency.

For people who pass `--omit=optional`, and for platforms with no prebuilt binary, the path
is "run it, get an error, install the extra package" (the §13.2 message).

- **The library itself stays free of runtime dependencies** (spec §3, decision #2).
  `src/` never references `@napi-rs/canvas`; the shim lives in `bin/`
- The network is touched by `--google`, `--ttf <url>`, and `--font` (fetching bundled data).
  **`--offline` applies to all three**

## 14. Decided, and what is left

| Question | Decision |
| --- | --- |
| An OS / CPU with no prebuilt binary | It does not work, and **says so** (§13.2). `--font` / `--input` still do |
| A remote that changes | The cache is the pin in practice; **the source SHA-256 is recorded in the header** so it shows in the diff (§4.4) |
| Cache location | **The user's cache directory**, overridable with `--cache-dir` (§4.4) |
| Presence detection | **Read the font's `cmap`** (§13.1). Comparing rendered output does not work in Node |
| Missing characters | Fill from another typeface with `--fallback`. **Bitmap to bitmap is not automated** (§4.6) |
| Reproducing an output | **Record the command in the header comment**; absolute paths outside the working directory are rounded off (§6) |
| Library-specific types | `u8g2` can drop its wrapper with `--no-wrapper`; `gfx`'s sparse form cannot (§6) |

### Platform coverage

The `rasterizer` job in `.github/workflows/ci.yml` runs on five runners every time, loading
the binding, generating a real font from `--google`, and confirming byte-identical output
with `--check`.

| Runner | Prebuilt binary | State |
| --- | --- | --- |
| `ubuntu-latest` | linux-x64-gnu | **confirmed** |
| `ubuntu-24.04-arm` | linux-arm64-gnu | **confirmed** |
| `macos-latest` | darwin-arm64 | **confirmed** |
| `macos-15-intel` | darwin-x64 | **confirmed** (`macos-13` was retired; the label was replaced) |
| `windows-latest` | win32-x64-msvc | **confirmed** |

**Not exercised**: `win32-arm64-msvc`, `linux-x64-musl`, `linux-arm64-musl`,
`linux-arm-gnueabihf`, `linux-riscv64-gnu`, `android-arm64`. GitHub hosts no runner for
them, so CI cannot reach them. A broken one produces the §13.2 message.

Running `node scripts/check-rasterizer.mjs` locally settles it for one environment.

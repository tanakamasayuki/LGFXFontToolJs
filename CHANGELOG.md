# Changelog / 変更履歴

## Unreleased

## 2.0.0
- (EN) Packaging fix: `web/googlefonts.js` is now included, so `--google` and `--list-google` work from an installed package (they failed with a module-resolution error before, which only shows up outside a repository checkout).
- (JA) 梱包の修正: `web/googlefonts.js` を含めるようにした。公開版で `--google` / `--list-google` が動くようになる（従来はモジュール解決エラーで起動しなかった。リポジトリ内では相対パスで解決できるため気づけない類の不具合）。
- (EN) CI gained a `rasterizer` matrix job that loads the native binding, builds a font from Google Fonts, and verifies byte-identical output on linux-x64, linux-arm64, darwin-arm64, darwin-x64 and win32-x64. `scripts/check-rasterizer.mjs` reports the same for one machine.
- (JA) CI に `rasterizer` マトリクスジョブを追加した。ネイティブバインディングの読み込み、Google Fonts からの実生成、バイト一致の検証を linux-x64 / linux-arm64 / darwin-arm64 / darwin-x64 / win32-x64 で行う。手元 1 台ぶんの確認は `scripts/check-rasterizer.mjs`。
- (EN) CLI: downloaded fonts now cache in the user's cache directory (`$XDG_CACHE_HOME/lgfx-font-tool`, else `~/.cache/...`) rather than under `node_modules`, so running from a subdirectory no longer re-fetches megabytes; `--cache-dir` overrides it. The source font's SHA-256 is recorded in the generated header, so a typeface that changed underneath appears as one line in `git diff`. A missing platform binary is now reported as such instead of telling you to install a package you already have.
- (JA) CLI: 取得したフォントのキャッシュを `node_modules` 配下からユーザのキャッシュディレクトリ（`$XDG_CACHE_HOME/lgfx-font-tool`、無ければ `~/.cache/...`）へ移した。サブディレクトリから実行しても数 MB を取り直さなくなる。`--cache-dir` で変更可。取得元フォントの SHA-256 を生成ヘッダに記録するようにし、書体が入れ替わったことが `git diff` の 1 行として見えるようにした。プリビルドのバイナリが無い場合は、既に入っているパッケージの再インストールを促すのではなく、その旨を報告する。
- (EN) A generated CellFont header no longer includes `<CellFont.h>`; it includes only `<stdint.h>` and asks the user to include their renderer's header first, matching the other emitters and the 1.1.0 decision to stop auto-including a graphics library. The format no longer names the renderer's header file at all. The version guard is split so that a missing include and a version mismatch report differently.
- (JA) 生成した CellFont ヘッダが `<CellFont.h>` を include しなくなった。`<stdint.h>` だけを include し、描画器のヘッダは利用者が先に include する。他のエミッタおよび 1.1.0 の「描画ライブラリを自動 include しない」決定に揃えた。形式は描画器のヘッダのファイル名を定めない。版ガードは 2 段に分け、include 忘れと版の不一致を区別して報告する。
- (EN) New `lgfx-font` CLI (`bin/`), shipped with the package. `build` / `inspect` / `charset` work from arguments alone, so a one-off needs no config file and CI is the same command with `--check`. Sources: a curated Google Fonts family by name, any TTF by path or URL, a bundled font, or a bitmap font file.
- (JA) `lgfx-font` コマンドを追加（`bin/`、パッケージに同梱）。`build` / `inspect` / `charset` は引数だけで動くので、単発では設定ファイルが要らず、CI は同じコマンドに `--check` を付けるだけ。入力は Google Fonts の書体名、TTF（パス / URL）、同梱フォント、手元のビットマップフォントファイルの 4 系統。
- (EN) TTF input in Node needs `@napi-rs/canvas`, declared as an **optional dependency** so that `npm install` still succeeds where no prebuilt binary exists. It is installed by default (33 MB of platform binaries), so TTF input works out of the box; `--omit=optional` skips it and the CLI then prints the install command. Bitmap sources never need it.
- (JA) Node での TTF 入力には `@napi-rs/canvas` が要る。プリビルドが無い環境でも `npm install` を失敗させないために**任意依存**とした。既定でインストールされる（プラットフォーム別バイナリ 33 MB）ので TTF はそのまま使える。`--omit=optional` で入れなかった場合はインストール方法を案内する。ビットマップ入力には不要。
- (EN) New CellFont v1 format (`docs/formats/cellfont.ja.md` / `.en.md`), a compile-time bitmap font format for 16-64 KB microcontrollers: shared cell metrics, optional glyph table, sparse index with a contiguous head block, and chaining. `encodeCSource({ format: 'cellfont' })` emits it.
- (JA) CellFont v1 形式を追加（`docs/formats/cellfont.ja.md` / `.en.md`）。16〜64 KB のマイコン向けのコンパイル時フォント形式で、共通セルのメトリクス、グリフ表の省略、頭ブロック付き疎索引、連鎖を持つ。`encodeCSource({ format: 'cellfont' })` で出力する。
- (EN) **Breaking:** `generateFont()` and `rasterizeSet()` take `em` (the typeface design size in pixels; a full-width character advances exactly this much) instead of `px`. The old `px` measured a reference glyph chosen from the requested repertoire, so adding one character rescaled the rest — measured at 92 of 95 ASCII glyphs changing when `日` was added. `sizing`, `measureTtf`, and the probe machinery are gone.
- (JA) **破壊的変更:** `generateFont()` と `rasterizeSet()` の指定が `px` から `em`（書体のデザインサイズ。全角 1 文字の送り幅がちょうどこの値）へ変わった。旧 `px` は要求した文字集合から選んだ基準字の墨面高さを尺度にしていたため、1 字足すと既存の字が縮んだ（`日` の追加で ASCII 95 字中 92 字の寸法が変化）。`sizing` / `measureTtf` と probe 機構は削除。
- (EN) `tools/gen-charsets.mjs` restored: it regenerates `src/charsets/charsets-data.js` from Unicode's own data with the Unicode version pinned, and `--check` fails when the committed data drifts. Two errors in the previous data's provenance are corrected (the Korean sets come from `KSX1001.TXT`, and `hanKo2` needs the CJK Compatibility Ideographs that KS X 1001 duplicates).
- (JA) `tools/gen-charsets.mjs` を復元した。Unicode の実データから `src/charsets/charsets-data.js` を再生成し、Unicode のバージョンを固定して記録する。`--check` で手編集や版ずれを検出できる。従来のヘッダにあった出典の誤り 2 件も修正（韓国語系は `KSX1001.TXT` 由来、`hanKo2` は KS X 1001 が重複符号化する CJK 互換漢字を含む）。
- (EN) New Japanese grade-level kanji sets `hanJaG1`-`hanJaG6` (学年別漢字配当表; G6 is the 1,026 Kyōiku kanji), so the smallest Japanese tier is no longer Jōyō at 2,139.
- (JA) 学年別漢字の集合 `hanJaG1`〜`hanJaG6` を追加（G6 = 教育漢字 1,026 字）。日本語の最小ティアが常用漢字 2,139 字ではなくなった。

## 1.1.0
- (EN) Generated C headers no longer auto-include `<LovyanGFX.hpp>`. The `#if` that guarded it tested include-guard macros that never matched (`__LOVYANGFX_HPP__` vs the real `LOVYANGFX_HPP_`, `_M5GFX_H_` vs `__M5GFX_H__`), so for a sketch that included the font header first it could pull LovyanGFX into an M5GFX / M5Unified build. Include your graphics library before the generated header instead; VLW/BFF headers are data only and need no library header at all.
- (JA) 生成した C ヘッダが `<LovyanGFX.hpp>` を自動 include しなくなった。判定していた `#if` は実際とは異なる include ガード名（`__LOVYANGFX_HPP__` / 実際は `LOVYANGFX_HPP_`、`_M5GFX_H_` / 実際は `__M5GFX_H__`）を見ており、フォントヘッダを先に include したスケッチでは M5GFX / M5Unified のビルドに LovyanGFX を引き込む可能性があった。描画ライブラリは生成ヘッダより前に include すること。VLW/BFF はデータのみでライブラリのヘッダを必要としない。
- (EN) Internal `src/` comments and JSDoc are now consistently English; localized character samples and generated-header strings remain data. CI now rejects non-English implementation comments.
- (JA) `src/` 内部のコメントとJSDocを英語へ統一した。各言語の文字サンプルと生成ヘッダ用翻訳文字列はデータとして維持し、英語以外の実装コメントが再混入するとCIで検出する。
- (EN) `encodeCSource()` and the Web Generator can now emit VLW/BFF binaries unchanged as embedded C arrays in `.h` files, ready for LovyanGFX `loadFont()`; raw `.vlw` / `.bff` downloads remain available. Operational comments follow the Generator language (`language` option; English by default).
- (JA) `encodeCSource()` と Web Generator が、VLW/BFF バイナリを変更せず C 配列へ埋め込んだ `.h` を出力できるようになった。LovyanGFX の `loadFont()` で読み込め、従来の `.vlw` / `.bff` ダウンロードも利用できる。操作説明コメントはGeneratorの表示言語に従う（`language`オプション、既定は英語）。
- (EN) `generateFont({ bpp: 8 })` now preserves browser Canvas alpha coverage in the neutral model. The Web Generator emits true 8bpp anti-aliased VLW and selectable 1/2/4bpp BFF, previews coverage levels, and requires regeneration when switching between binary and AA generation.
- (JA) `generateFont({ bpp: 8 })` がブラウザ Canvas のアルファ被覆値を中立モデルへ保持するようになった。Web Generator は真の8bppアンチエイリアスVLWと選択可能な1/2/4bpp BFFを出力し、被覆階調をプレビューする。二値生成とAA生成を切り替えた場合は再生成を必須とする。
- (EN) The existing `generateFont()` default remains 1bpp with `threshold: 128`; BFF quantizes 8bpp model coverage to the requested 2 or 4 bits at encoding time.
- (JA) 既存の `generateFont()` の既定値は `threshold: 128` の1bppのまま維持した。BFFは8bpp中立モデルの被覆値をエンコード時に指定された2bitまたは4bitへ量子化する。

## 1.0.0
- (EN) `generateFont()` now returns `sizing: { cssPx, probe, probeHeight }`, and a later `generateFont({ sizing })` call can reuse it. Passing only `sizing: { cssPx }` is also supported, so a fallback generated separately no longer has to derive its own scale from a different probe character.
- (JA) `generateFont()` が `sizing: { cssPx, probe, probeHeight }` を返し、別の `generateFont({ sizing })` 呼び出しで再利用できるようになった。`sizing: { cssPx }` だけの指定も可能なため、補完を別生成に分けても異なる probe 文字から独自の縮尺を導出する必要がない。
- (EN) `generateFont({ fallbacks })` now rasterizes every fallback at the primary font's `cssPx` instead of measuring it independently, then recomputes `ascent`, `descent`, and `lineHeight` from all merged glyphs. The Web Generator's one-click fill follows the same rule; the generic `merge()` API still preserves the base font's metrics.
- (JA) `generateFont({ fallbacks })` は fallback ごとの独立再計測をやめ、主フォントの `cssPx` でラスタライズした後、合成した全グリフから `ascent` / `descent` / `lineHeight` を再計算するようになった。Web Generator の1クリック補完も同じ規則に従う。汎用 `merge()` が主フォントのメトリクスを維持する既存仕様は変わらない。

## 0.1.0
- (EN) First release: a dependency-free JavaScript toolkit for decoding, encoding, converting, rendering, inspecting, subsetting, merging, and generating embedded bitmap fonts, with Viewer, Generator, Converter, and Inspector web apps.
- (JA) 初回リリース。組込み向けビットマップフォントのデコード・エンコード・変換・描画・検査・サブセット・マージ・生成を行う依存なしの JavaScript ツールキットと、Viewer / Generator / Converter / Inspector の Web アプリを公開。
- (EN) Includes a catalog of all 186 fonts bundled with LovyanGFX v1.2.26 and a renderer verified pixel-for-pixel against LovyanGFX.
- (JA) LovyanGFX v1.2.26 内蔵フォント全186本のカタログと、LovyanGFX に対してピクセル単位で検証したレンダラを収録。

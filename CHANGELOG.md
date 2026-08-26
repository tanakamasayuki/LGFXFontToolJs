# Changelog / 変更履歴

## Unreleased
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

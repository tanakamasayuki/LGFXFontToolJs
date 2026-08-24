# Changelog / 変更履歴

## Unreleased

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

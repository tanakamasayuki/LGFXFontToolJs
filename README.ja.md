# LGFX Font Tool JS

**組込み向けビットマップフォントを、JavaScript とブラウザで読み・変換し・描き・作る。**

[English README](./README.md) · [仕様書](./docs/spec.ja.md)

u8g2 / GFXfont (Adafruit GFX) / BDF / VLW / LovyanGFX 内部形式のデコーダ・エンコーダと、
LovyanGFX とピクセル単位で一致するテキスト描画エンジン、
LovyanGFX v1.2.26 の内蔵フォント 186 本の同梱コレクションからなる汎用部品ライブラリです。

**ステータス: Phase 1 実装中。** 詳細は [docs/spec.ja.md](./docs/spec.ja.md) を参照してください。

## 開発

```sh
npm install
npm run check          # テスト・型検査・レイヤ検査
npm test               # node:test（オラクル完全一致テスト込み）
npm run serve          # http://localhost:8080/web/ で Viewer、/examples/ でサンプル
npm run build:site     # site/（GitHub Pages が配信するもの）
npm run extract-fonts  # LovyanGFX ソースから内蔵フォントを再抽出
npm run oracle         # LovyanGFX ホストビルドでオラクル fixture を再生成
```

描画の正しさは、実物の LovyanGFX（lang-ship:host コアでネイティブビルド）が描いた
1,860 ケースとのバイト列完全一致で担保しています（[oracle/](./oracle/README.ja.md)）。

## ライセンス

MIT。[LICENSE](./LICENSE) を参照してください。
同梱フォントデータの帰属表示は [NOTICE](./NOTICE) にあります。

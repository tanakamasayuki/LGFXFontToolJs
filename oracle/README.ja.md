# oracle/ — LovyanGFX オラクルハーネス

実物の LovyanGFX（v1.2.26、lang-ship:host コアでネイティブビルド）を正解として
fixture を生成する 2 本のハーネス:

- **oracle_dump**（仕様 §13.1）— 全内蔵フォント × 文字列 × 倍率 × datum を描画し、
  デコーダと描画エンジンが完全一致すべき正解ビットマップを吐く
- **oracle_encoded**（仕様 §13.3）— 本ライブラリの**エンコーダが出力した**
  u8g2 / GFXfont バイナリを LovyanGFX に読み込ませて描画する。往復テストでは
  検出できない「書き方の解釈ずれ」（u8g2 のジャンプ表など、自前デコーダが
  読み飛ばす構造）を落とす。再生成は `npm run oracle:encoded`

fixture は `test/fixtures/oracle/` にコミットしてあり、通常のテスト
（`npm test` / CI）は **このハーネスを実行しない**。再生成が必要なのは
ケース行列を変えたときと、照合対象の LovyanGFX バージョンを上げたときだけ。

## 再生成手順

前提: arduino-cli がインストール済みであること（コアと LovyanGFX は
`sketch.yaml` のプロファイルが取得する）。

```sh
npm run oracle
```

内部で行うこと:

1. `gen-fonts-table.js` — カタログから `oracle_dump/fonts_table.h` を生成
2. `arduino-cli compile --profile host` — ネイティブ実行ファイルをビルド
3. `run-oracle.js` — 実行ファイルを起動し（lang-ship:host は TCP クライアント
   接続後に `setup()` へ入る）、`test/fixtures/oracle/` に
   `oracle-index.jsonl` と `oracle-bitmaps.bin` を書かせる

その後 `npm test` を回し、`test/oracle.test.js` の完全一致を確認すること。

## ケース行列

`oracle_dump.ino` の `kConfigs` / `kAscii` / `kCjk` が定義する
（変更したら `test/oracle.test.js` の `TEXTS` も合わせること）:

- 全 186 フォント
- 文字列: ASCII `"Ag9 !~"`（全構成）、CJK `"日本語あア漢A9"`（一部構成。
  未収録フォントでは代替ボックスの一致も検証される）
- 倍率: 1.0 / 2.0 / 1.5 / 2.0×1.0（非等方）
- datum: top-left / baseline-left / middle-center / bottom-right
- 計 1,860 ケース。ビットマップに加えて textWidth / fontHeight /
  drawString の戻り値も照合する

## バージョンの固定

- LovyanGFX: `oracle_dump/sketch.yaml` の `LovyanGFX (1.2.26)`。
  `scripts/extract-fonts.js` の `LGFX_VERSION` と必ず一致させる
- コア: `lang-ship:host (1.4.7)`

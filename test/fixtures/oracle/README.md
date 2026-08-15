# 生成物 — 手で編集しないこと

`npm run oracle` が生成するオラクル fixture（仕様 §13.1）。

- 生成元: LovyanGFX 1.2.26 を lang-ship:host 1.4.7 でネイティブビルドした
  `oracle/oracle_dump/` ハーネスの出力
- `oracle-index.jsonl` — 1 ケース 1 行（描画パラメータ・計測値・オフセット）
- `oracle-bitmaps.bin` — 1bpp ビットマップ（MSB first、行はバイト境界へ
  パディング）の連結
- 照合: `test/oracle.test.js`

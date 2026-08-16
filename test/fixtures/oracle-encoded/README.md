# 生成物 — 手で編集しないこと

`npm run oracle:encoded` が生成する実物一致 fixture（仕様 §13.3）。

- `fonts/` — 本ライブラリのエンコーダが出力した u8g2 / GFX1 / VLW / BFF バイナリ
  （oracle/gen-encoded-fonts.js）
- `oracle-index.jsonl` / `oracle-bitmaps.bin` — それらを LovyanGFX 1.2.26
  （lang-ship:host 1.4.7）に読み込ませて描画した正解
- 照合: `test/oracle-encoded.test.js`

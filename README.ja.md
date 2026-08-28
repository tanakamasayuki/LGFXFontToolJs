# LGFX Font Tool JS

**組込み向けビットマップフォントを、JavaScript とブラウザで読み・変換し・描き・作る。**

[English README](./README.md) · [変更履歴](./CHANGELOG.md) ·
[![npm](https://img.shields.io/npm/v/lgfx-font-tool)](https://www.npmjs.com/package/lgfx-font-tool)
[![CI](https://github.com/tanakamasayuki/LGFXFontToolJs/actions/workflows/ci.yml/badge.svg)](https://github.com/tanakamasayuki/LGFXFontToolJs/actions/workflows/ci.yml)

u8g2 / GFXfont (Adafruit GFX) / BDF / VLW / BFF / FONTX2 / LovyanGFX 内部形式の
デコーダ・エンコーダと、LovyanGFX とピクセル単位で一致するテキスト描画エンジン、
LovyanGFX v1.2.26 の内蔵フォント 186 本の同梱コレクションからなる汎用部品ライブラリです。
実行時依存ゼロ・ビルド不要の素の ESM で、Node.js とブラウザの両方で動きます。

- **読む** — 11 形式をデコード。マジックナンバーからの自動判定付き。GitHub で拾った `.h`(GFXfont / u8g2 の C ソース)もそのまま読めます
- **描く** — LovyanGFX v1.2.26 の `drawString` の忠実な移植。倍率・基準点(datum)・形式ごとの描画の癖まで含めて、実物が描いた 1,860 ケースと**バイト列完全一致**
- **変換する** — 中立モデル経由で任意の形式間を変換。「入らない」ときは黙って切り詰めず、安定コード付きの制約一覧を返します
- **作る** — ブラウザで TTF/OTF/WOFF をラスタライズして新規フォントを生成。足りない文字は別書体から補完
- **削る・足す** — サブセット化(時計用なら 11 文字 188 バイトまで)、別フォントからのマージ、文言カバレッジの CI 検査

## Web アプリ(インストール不要)

| アプリ | できること |
| --- | --- |
| [Viewer](https://tanakamasayuki.github.io/LGFXFontToolJs/viewer.html) | 内蔵 186 本の一覧とピクセル一致プレビュー |
| [Generator](https://tanakamasayuki.github.io/LGFXFontToolJs/generator.html) | TTF / Google Fonts → u8g2 / GFXfont / BDF / 8bpp VLW / 1〜4bpp BFF。AAプレビュー・文字集合選択・補完・ヘッダの帰属表示を自動化 |
| [Converter](https://tanakamasayuki.github.io/LGFXFontToolJs/converter.html) | フォントファイル / C ソースを放り込んで形式変換 |
| [Inspector](https://tanakamasayuki.github.io/LGFXFontToolJs/inspector.html) | 収録・被覆率・全形式サイズ比較・文言チェック |

## インストール

[npm の lgfx-font-tool](https://www.npmjs.com/package/lgfx-font-tool) から:

```sh
npm install lgfx-font-tool
```

ブラウザなら CDN から直接使えます。将来のリリースで意図せず挙動が変わらないよう、
バージョンは必ず固定します:

```html
<script type="module">
  import { loadFont, drawString }
    from 'https://cdn.jsdelivr.net/npm/lgfx-font-tool@2.2.1/dist/lgfx-font-tool.min.js';
</script>
```

## コマンドラインから使う

`lgfx-font` コマンドが付いてきます。単発でも、CI で毎回走らせる形でも同じコマンドです。

```sh
# Google Fonts から名前だけで、必要な文字だけのフォントを作る
npx lgfx-font build --google "Noto Sans JP" --em 12 \
    --chars "温度設定完了 23.5℃" --format cellfont --out font.h

# 確認用の画像も一緒に
npx lgfx-font build --font lgfxJapanGothic_12 --sets ascii,hiragana \
    --format u8g2 --out font.h --preview font.png

# CI: 生成物が最新かどうかだけ見る（何も書かない）
npx lgfx-font build ... --check
```

インストールは任意です（`npx` が都度取ってきます）。固定・確認・更新はこちら。

```sh
npm i -D lgfx-font-tool          # プロジェクトに固定（CI で使うならこちら）
lgfx-font --version              # 動いているツールの版
npm ls lgfx-font-tool            # ここに入っている版
npm i -D lgfx-font-tool@latest   # 最新に上げる
```

くわしくは [docs/cli.ja.md](docs/cli.ja.md)。

### TTF のラスタライザについて

`--ttf` と `--google` は TTF をラスタライズするので、ラスタライザ
（`@napi-rs/canvas`）が要ります。**`npm install lgfx-font-tool` で一緒に入る**ので、
通常は何もしなくて構いません（プラットフォーム別バイナリが 33 MB 入ります）。

| 入力 | ラスタライザ |
| --- | --- |
| `--google <family>` / `--ttf <path\|url>` | **要る** |
| `--font <name>`（同梱） / `--input <path>`（手元のファイル） | 要らない |

**任意依存**にしてあるのは、**プリビルドが無い OS / CPU でも `npm install` を
失敗させない**ためです。ラスタライザは 4 系統の入力のうち 2 つでしか使わないので、
それが入らないからといってパッケージ全体を入れられなくするのは重すぎます。

`--omit=optional` で入れなかった場合や、プリビルドが無い環境では、TTF を指定した時点で
案内が出ます。ビットマップ入力はそのまま動きます。

```
lgfx-font: TTF input needs the rasterizer. Install it with:
  npm install @napi-rs/canvas
Bitmap sources (--font / --input) work without it.
```

## 10 行で動かす

```js
import { loadFont, createBitmap, drawString, textWidth, fontHeight, bitmapToText }
  from 'lgfx-font-tool';

const font = await loadFont('lgfxJapanGothic_16');   // 同梱コレクションから
const bmp = createBitmap(textWidth(font, 'こんにちは'), fontHeight(font), 1);
drawString(bmp, font, 'こんにちは', 0, 0);
console.log(bitmapToText(bmp));                      // テキストアートで表示
// bmp.data はそのままデバイスに送れる 1bpp ビットマップ
```

変換は「読む → 書く」の 2 手です:

```js
import { decode, canEncode, encode } from 'lgfx-font-tool';

const font = decode(bytes);                     // 形式は自動判定
const check = canEncode(font, 'u8g2');          // 入るか先に確認
const out = encode(font, { format: 'u8g2' });   // だめなら issues 付きで止まる
```

サブセット化して Arduino 用の `.h` に:

```js
import { loadFont, subset, encodeCSource } from 'lgfx-font-tool';

const clock = subset(await loadFont('lgfxJapanGothic_24'), '0123456789:./ ');
const header = encodeCSource(clock, { format: 'u8g2', symbolName: 'clockFont' });
// → #include "clockFont.h" して display.setFont(&clockFont);
```

## 対応形式

| 形式 | 読む | 書く | 主な使い手 |
| --- | :-: | :-: | --- |
| u8g2 | ✔ | ✔ | u8g2 / LovyanGFX(RLE 圧縮で小さい) |
| GFXfont (GFX1) | ✔ | ✔ | Adafruit GFX / LovyanGFX |
| BDF | ✔ | ✔ | X11 / 各種ツール(テキスト形式) |
| VLW | ✔ | ✔ | Processing / TFT_eSPI Smooth Font(8bpp) |
| BFF | ✔ | ✔ | LVGL lv_font_conv / LovyanGFX |
| FONTX2 | ✔ | ✔ | 日本語機器の資産(Shift_JIS 変換内蔵) |
| C ソース | ✔ | ✔ | Arduino の `.h`(GFXfont / u8g2 を抽出・生成) |
| GLCD / FixedBMP / LBMP / LRLE | ✔ | — | LovyanGFX 内部形式 |

## 正しさの担保

描画エンジンは「だいたい同じ」ではありません。lang-ship:host コアでネイティブビルドした
**実物の LovyanGFX** が描いた 1,860 ケース(全 186 フォント × 描画条件)とのバイト列
完全一致、さらに本ライブラリが**エンコードした**フォントを実物に読ませて描かせる
36 ケースの完全一致をテストで検証しています([oracle/](./oracle/README.ja.md))。
fixture はコミット済みなので、通常の `npm test` にネイティブビルドは不要です。

## 同梱フォントと配布サイズ

LovyanGFX v1.2.26 の内蔵フォント 186 本をカタログ付きで同梱しています。
npm パッケージには軽量な 70 本(約 320KB)だけが入り、日本語・中国語などの
大きいフォント(計 42MB)は初回の `loadFont` 時に GitHub Pages から自動取得
されます。パッケージは tarball 562KB です。

オフライン環境や自前ミラーでは取得先を差し替えられます:

```js
import { configureFontData } from 'lgfx-font-tool';
configureFontData({ baseUrl: 'https://intra.example.com/lgfx-fonts/' });
// Node なら file:///opt/lgfx-fonts/ も可
```

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [初心者ガイド](./docs/guide-beginner.ja.md) ([English](./docs/guide-beginner.en.md)) | 「フォントとは何か」から始める入門 |
| [用途別ガイド](./docs/guide-usecases.ja.md) ([English](./docs/guide-usecases.en.md)) | やりたいこと別のレシピ集(選ぶ・描く・作る・変換する・CI 検査…) |
| [上級者ガイド](./docs/guide-advanced.ja.md) ([English](./docs/guide-advanced.en.md)) | 内部規約・完全一致の仕組み・エンコード制約・拡張方法 |
| [仕様書](./docs/spec.ja.md) ([English](./docs/spec.en.md)) | 規範的な仕様(ユースケース・設計判断・形式仕様) |
| [CLI 仕様](./docs/cli.ja.md) ([English](./docs/cli.en.md)) | `lgfx-font` コマンドの仕様(入力・文字集合・出力・CI 運用) |
| [CellFont 形式](./docs/formats/cellfont.ja.md) ([English](./docs/formats/cellfont.en.md)) | 省メモリ向けビットマップフォント形式 v1 の規範仕様 |

最小サンプルは [examples/](./examples/) に(Node / ブラウザ各 1 ファイル)。

## 開発

```sh
npm install
npm run check          # テスト・型検査・レイヤ検査・ロケール検査
npm test               # node:test(オラクル完全一致テスト込み)
npm run serve          # http://localhost:8080/web/ で Web アプリ、/examples/ でサンプル
npm run build          # dist/(バンドル + 同梱フォント)
npm run build:site     # site/(GitHub Pages が配信するもの)
npm run extract-fonts  # LovyanGFX ソースから内蔵フォントを再抽出
npm run oracle         # LovyanGFX ホストビルドでオラクル fixture を再生成
```

設計の要点: 素の ESM + JSDoc(TypeScript 構文なし、`npm run types` で .d.ts 生成)、
実行時依存ゼロ、`src/` は I/O 禁止(例外 2 モジュールのみ、CI で機械検査)。
詳しくは[仕様書](./docs/spec.ja.md)へ。npm への公開は[リリース手順](./docs/release.ja.md)(コピペ 3 行)。

## ライセンス

MIT。[LICENSE](./LICENSE) を参照してください。
同梱フォントデータの帰属表示は [NOTICE](./NOTICE) にあります。
Generator が出力する `.h` には、元書体のライセンスと帰属表示が自動で入ります。

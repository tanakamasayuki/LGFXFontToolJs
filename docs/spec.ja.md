# LGFXFontToolJs 仕様書 v0.1（草案）

- 対象読者: 本リポジトリの実装者
- ステータス: **実装進行中（Phase 1〜2 完了、Phase 3 はコア完了・UI 残）。** 本書は実装に合わせて更新する
- 最終更新: 2026-08-16

参考資料: 形式ごとの制約と実測データの出典は [FONT_FORMATS.ja.md（LGFXScreenBuilder）](https://github.com/tanakamasayuki/LGFXScreenBuilder/blob/main/docs/FONT_FORMATS.ja.md)。

## 1. 概要

**LGFXFontToolJs** は、組込み向けビットマップフォントを JavaScript から読み・書き・変換・描画・生成できる汎用ライブラリである。

中心は UI に依存しないコアライブラリであり、ブラウザで動くフォントビューア／コンバータ／ジェネレータを公式リファレンス実装として提供する。Web アプリは GitHub Pages で公開する。

キャッチコピー:

> JavaScript toolkit for embedded bitmap fonts — decode, encode, convert, render and generate.
> 組込み向けビットマップフォントを、JavaScript とブラウザで読み・変換し・描き・作る。

### 1.1 位置づけ — LovyanGFX が錨、用途は汎用

本ライブラリは特定の用途にもプロジェクトにも紐づけない。ただし「何をもって正しいとするか」の基準（オラクル）には LovyanGFX v1.2.26 を使う。この関係を明確にしておく。

- **LovyanGFX から借りるもの** — 対応形式の目録、内蔵フォント 186 本のデータ、描画セマンティクス（送り幅・datum・倍率の規則）、正しさの検証環境
- **LovyanGFX に依存しないもの** — API 設計、中立モデル、利用シーン。u8g2 フォントは u8g2 ライブラリの利用者に、GFXfont は Adafruit GFX の利用者に、VLW は TFT_eSPI / Processing の利用者に、BDF はフォント制作ツールの利用者に、そのまま役立つ

### 1.2 ユースケース

本ライブラリが成立させる使い方を先に定義する。機能仕様（§5〜§11）と実装順序（§17）は、すべてここへ遡れること。

| # | ユースケース | 典型的な流れ | 成立する Phase |
| --- | --- | --- | --- |
| **UC1** | **新規フォントの作成** — 自由なフォントデータ（TTF / OTF / WOFF）から、必要な文字集合・サイズ・深度でビットマップフォントを作る | `generateFont`（§10）→ `canEncode` で入るか確認（§7）→ `encode` / `encodeCSource`（§6.3） | 2 |
| **UC2** | **フォントカタログの作成** — 既存フォントがどんな書体で、どの文字を収録し、どれだけ容量を食うかを一覧化し、選定の材料にする | 内蔵フォントは `fontCatalog`（§8）。任意のフォントは `decode` → `inspect` / `coverage` / `estimateSize`（§11）。書体見本は `drawString` で描く | 内蔵: 1 / 任意: 3 |
| **UC3** | **既存フォントのレンダリング再現** — デバイスに載せる本物のフォントデータで JS 上に描画し、レイアウトや文字位置を確認する（画面ビルダー・印刷プレビューの類） | `loadFont` / `decode` → `drawString` / `measureText`（§9）。LovyanGFX と 1bpp 完全一致（§13.1） | 1 |
| **UC4** | **文字集合の増減** — 既存フォントから不要文字を落として容量を削る。足りない文字を別フォントや TTF から補って増やす | 減: `subset`（§5.2）→ `encode`。増: 補完元を用意（別フォントを `decode`、または UC1 で不足分だけ生成）して `merge`（§5.2）→ `encode` | 2 |
| **UC5** | **形式変換・移植** — エコシステム間でフォントを持ち運ぶ。GitHub で拾った GFXfont の `.h` を u8g2 に、u8g2 を BDF にしてフォントエディタで編集して戻す、など | `decode` / `decodeCSource` → `canEncode`（「入らない」理由の報告つき）→ `encode` | 2〜3 |
| **UC6** | **文言カバレッジの事前検証** — アプリが表示する文言一覧とフォントを突き合わせ、tofu（収録漏れ）を出荷前に検出する。Node で動くので CI に組み込める | `coverage(font, 文言)`（§11） | 3 |
| **UC7** | **固定文字列の焼き込み** — フォント全体を積む容量がないとき、ビルド時に文字列を描画して 1bpp 画像アセットとして組み込む | Node で `loadFont` → `drawString`。画像形式化は利用側（§9.1） | 1 |
| **UC8** | **グリフの手作業編集・アイコンフォント作成** — ドットエディタでグリフを直す、記号グリフだけの自作フォントを組む | 中立モデルは素の `Map` + `Bitmap` なので UI から直接編集できる（§5.2）→ `encode` | 2 |
| **UC9** | **フォントデータの検証・デバッグ** — 他ツールが生成した・配布されているフォントが壊れていないか、意図どおりに描けるかを確かめる | `decode`（壊れていても issues 付きで読む、§6.1）→ `drawString`（オラクル検証済みのレンダラが照合基準になる、§13） | 1〜3 |

UC4 は UC1 の変形に見えるが、入力が既存ビットマップフォントでありラスタライザを通らない点が異なる。また「増」には補完元との合成（`merge`）が要る。補完元は別のビットマップフォントでも、TTF から不足分だけ生成したもの（UC1）でもよい — どちらも中立モデルに揃うので、合成は同じ 1 つの操作になる。

### 1.3 設計の四本柱

1. **Library First** — すべての機能は UI なしで呼び出せる。Web アプリは npm で配布しているのと同じ公開 API の consumer にすぎない。
2. **Hub 型** — 変換は必ず中立モデルを経由する。デコーダが各形式 → 中立モデル、エンコーダが中立モデル → 各形式。N 形式に対して N×N の変換ではなく 2N 個の部品で済む。
3. **Pixel Exact** — 描画は LovyanGFX と 1bpp でバイト列完全一致する。「だいたい合う」を成果としない。
4. **Buildless** — ソースは素の ESM で、ビルドせずそのまま `import` できる。実行時依存ゼロ。`dist/` は利便のためにあるだけ。

### 1.4 全体像

```text
      TTF / WebFont ──(生成)─┐                     ┌─→ u8g2
      u8g2 ──────────────────┤                     ├─→ GFXfont
      GFXfont ───────────────┤                     ├─→ BDF
      BDF ───────────────────┼─→  中立モデル  ────┼─→ VLW
      GLCD / BMP / RLE /     │   （Font/Glyph）    ├─→ C/C++ ソース
      FixedBMP ──────────────┤        ↑↓          ├─→ JSON（シリアライズ）
      VLW ───────────────────┤   subset / merge    │
      C/C++ ソース ──────────┤   / inspect         └─→ 描画（1bpp / 8bpp）
      内蔵コレクション(186) ─┘
```

---

## 2. スコープ

### 2.1 対応形式

| 形式 | 主な生息地 | 深度 | デコーダ | エンコーダ | Phase |
| --- | --- | --- | --- | --- | --- |
| **u8g2** | u8g2 / LovyanGFX（CJK 内蔵は全部これ） | 1 | 必須 | 必須 | D:1 / E:2 |
| **GFXfont** | Adafruit GFX / LovyanGFX / 世に大量の `.h` | 1 | 必須 | 必須 | D:1 / E:2 |
| **BDF** | fontforge / otf2bdf / bdfconv / X11 — **相互運用の要** | 1 | 必須 | 必須 | 3 |
| **VLW** | TFT_eSPI (Smooth Font) / Processing / LovyanGFX | 8 | 必須 | 必須 | 3 |
| GLCDfont | LovyanGFX (Font0, Font8x8C64) | 1 | 必須 | 任意 | 1 |
| FixedBMPfont | LovyanGFX (AsciiFont8x16, AsciiFont24x48) | 1 | 必須 | 任意 | 1 |
| BMPfont | LovyanGFX (Font2) | 1 | 必須 | 任意 | 1 |
| RLEfont | LovyanGFX (Font4/6/7/8) | 1 | 必須 | 任意 | 1 |
| **C/C++ ソース** | Arduino スケッチ / GitHub 上のフォント配布 | — | 必須 | 必須 | D:3 / E:2 |
| **TTF / OTF / WOFF** | 生成の入力 | — | **入力のみ**（§10） | — | 2 |
| BFF | LovyanGFX（実体は LVGL lv_font_conv 形式。カーニングあり） | 1–4 | 対応 | 対応 | 4（実装済み。kern レコードは素通し保持 = 解釈せず往復で保存） |
| fontx2 | 日本語組込みの古参形式（FatFs 界隈） | 1 | 対応 | 対応 | 4（実装済み。SJIS↔Unicode は Encoding Standard の shift_jis を使用） |

- 「C/C++ ソース」は独立した形式として扱う。実体は「テキスト ⇄ バイト列」の層で、u8g2 / GFXfont 等のバイナリ形式と直交する（§6.3）。
- 形式のフィールドレベル仕様は実装時に `docs/formats/<format>.ja.md` として起こし、本書は制約と要点のみを持つ（§6.2, §7.3）。

### 2.2 内蔵フォントコレクション

LovyanGFX v1.2.26 の内蔵フォント **186 本**（u8g2 × 116、GFXfont × 61、GLCD × 2、FixedBMP × 2、BMP × 1、RLE × 4）をパッケージに同梱する。カタログ（名前・形式・メトリクス・収録文字数・ライセンス）＋バイナリデータの構成で、フォント名だけで即座にロードできる（§8）。

### 2.3 非対象（明示的にやらないこと）

- **描画先の抽象化。** 出力はライブラリ自身の `Bitmap`（1bpp / 8bpp の被覆値）まで。Canvas / ImageData / 端末への貼り付けと色の割り当ては利用側の仕事（ヘルパは examples で示す）。
- **レイアウト。** 折り返し、列、矩形配置、ルビ。1 行の描画と計測まで。
- **組版。** カーニングの適用、合字、複雑テキストレイアウト。BFF のカーニング情報は**モデルに保持するが適用はしない**。
- **フォントの自動取得・サーバ通信。** Google Fonts 連携などは利用側（LGFXScreenBuilder に前例がある）。
- **アウトラインフォントの出力。** TTF は入力専用。ビットマップ → アウトラインの逆変換はしない。
- **TTF パーサの自前実装。** グリフのラスタライズはブラウザに任せる（§10）。cmap やヒンティングを自前で解釈しない。

### 2.4 対応環境

- **ブラウザ** — 全機能。TTF ラスタライズ（§10）はブラウザ専用。
- **Node.js（>= 20）** — TTF ラスタライズ以外の全機能（デコード・エンコード・描画・検査・内蔵フォント）。テストと CI はすべて Node で回る。
- 特定フレームワークへの依存なし。素の ESM を `import` するだけ。

---

## 3. 主要な設計判断

実装中に「なぜこうなっているのか」を再検討せずに済むよう、判断とその理由を記録する。

| # | 判断 | 理由 |
| --- | --- | --- |
| 1 | **TypeScript ではなく素の JavaScript (ESM) で書く。型は JSDoc で表現する** | 兄弟プロジェクト（esp-flashjs）と同じ方針。`tsc` はトランスパイラではなく型検査ツールとしてのみ使う |
| 2 | **実行時依存ゼロ。opentype.js 等の TTF パーサを持たない** | ラスタライズはブラウザの `FontFace` + Canvas に任せる。LGFXScreenBuilder の fontgen で実証済みの方式で、ブラウザが受け付けるものすべて（TTF / OTF / WOFF / WOFF2 / variable font）が入力になる |
| 3 | **npm は単一パッケージ。エントリポイントも 1 つ** | フォントデータはバンドルに含まれない（#5）ので、コードだけなら分割する動機が薄い。ラスタライザはブラウザ以外で呼ばれたら `CapabilityError` を投げる実行時ガードで足りる。`exports` のサブパス（`./src/*`）を維持すれば後から分割へ移行できる |
| 4 | **変換は必ず中立モデルを経由する。形式間の直接変換 API を作らない** | N×N ではなく 2N。最適化のための直接変換は、完全一致テストの組み合わせ爆発と引き換えにする価値がない |
| 5 | **内蔵フォントのバイナリはリポジトリにコミットし、バンドルには埋め込まず実行時にロードする** | 数 MB のデータを JS バンドルに埋め込むと全利用者に負担させることになる。esp-flashjs の stub JSON と同じく `import.meta.url` 基準の個別ファイルとし、使うフォントだけ転送する。コミットするのは、利用者に LovyanGFX ソースからの抽出を要求しないため（再生成は `scripts/extract-fonts.js`） |
| 6 | **中立モデルのメトリクスは int16。形式固有の制約（u8g2 の 7bit 等）をモデルに持ち込まない** | LovyanGFX の `FontMetrics` に合わせる。制約は各エンコーダが持ち、encode 時に検査する |
| 7 | **エンコーダは制約違反を黙って切り詰めず、エラーにする** | 黙って切り詰めると読めないフォントが出来上がる。`canEncode()` で事前判定でき、「どのグリフがなぜ入らないか」を安定コードで返す（§7） |
| 8 | **描画セマンティクスは LovyanGFX v1.2.26 に完全一致させ、LovyanGFX 自身をオラクルにする** | 1bpp なのでアンチエイリアス誤差がなく、バイト列の完全一致で判定できる。これがデコーダ実装のデバッグ環境も兼ねる（§13） |
| 9 | **コードポイントはモデル上 U+10FFFF まで許す。BMP 制限は課さない** | BMP 制限は LovyanGFX のテキスト API（`uint16_t`）の性質であって、BDF や TTF は超えられる。制限は BMP 限定の形式のエンコーダが encode 時に報告する |
| 10 | **C/C++ ソースを独立形式として一級市民にする** | Arduino 圏のフォントは `.h` / `.c` で配布されており、「GitHub の GFXfont ヘッダを貼り付けたら読める」ことが汎用部品としての実用性を大きく左右する |
| 11 | **ライブラリはユーザー向け文言を一切生成しない。エラーと Issue は安定した `code` を持つ** | 翻訳はアプリケーションの責務。esp-flashjs と同じ方針で、リファレンスアプリはライブラリに手を入れずに多言語化する |
| 12 | **1bpp のビット順は MSB first、行ごとにバイト境界へパディング** | BDF / GFXfont ほか主要形式のネイティブ表現に近く、目視デバッグしやすい。形式固有のパッキングは各デコーダ／エンコーダが吸収する |

---

## 4. アーキテクチャ

### 4.1 レイヤ構造

依存は上から下への一方向のみ。逆流を禁止する。

```text
┌──────────────────────────────────────────────────┐
│  web/            Web リファレンス実装              │  DOM / File API
├──────────────────────────────────────────────────┤
│  src/index.js    公開 API (barrel)                 │
├────────────┬────────────┬────────────┬───────────┤
│  gen/      │  fonts/    │  inspect/  │  render/  │
│  TTF 生成  │  内蔵      │  検査・    │  描画・   │
│  (browser) │  コレクション│  見積り    │  計測     │
├────────────┴────────────┴────────────┴───────────┤
│  format/    各形式の decode / encode / 制約検査    │
├──────────────────────────────────────────────────┤
│  model/     Font / Glyph / Bitmap / subset /      │
│             merge / serialize                     │
├───────────────────────┬──────────────────────────┤
│  charsets/  文字集合   │  util/  bit/byte・エラー  │
└───────────────────────┴──────────────────────────┘
```

**厳守するルール:**

- `model/` `format/` `render/` `inspect/` `charsets/` `util/` は純粋である。`Uint8Array` / 文字列 / プレーンオブジェクトを入力し、同を出力する。I/O をしない。
- `src/` 配下のいかなるファイルも `document` / `window` / `navigator` / `fetch` を参照してはならない。例外は 2 つだけ — `gen/rasterize.js`（`FontFace` / `OffscreenCanvas`）と `fonts/loader.js`（データファイルのロード。ブラウザでは `fetch`、Node では `node:fs`）。どちらも明示的に分離されたモジュールとする。
- `web/` のロジックを `src/` に持ち込まない。

レイヤ規律は `scripts/check-layers.js` が CI で静的に検証する（esp-flashjs と同じ仕組み）。同スクリプトは拡張子なしの import と、例外 2 ファイル以外での環境グローバル参照も検出する。

### 4.2 リポジトリ構成

```text
LGFXFontToolJs/
├── README.md / README.ja.md
├── LICENSE                   # MIT
├── NOTICE                    # 同梱フォントの帰属表示（§8.4）
├── package.json
├── tsconfig.json             # 型検査と .d.ts 生成のためだけに置く
│
├── src/
│   ├── index.js              # 公開 API barrel
│   │
│   ├── util/
│   │   ├── errors.js         # エラー階層（§12）
│   │   ├── bits.js           # BitReader / BitWriter（u8g2 が要る）
│   │   └── bytes.js          # ByteReader / ByteWriter
│   │
│   ├── model/
│   │   ├── font.js           # Font / Glyph（§5）
│   │   ├── bitmap.js         # Bitmap と 1bpp/8bpp 操作
│   │   ├── subset.js         # 文字集合の絞り込み
│   │   ├── merge.js          # フォントの合成（Phase 4）
│   │   └── serialize.js      # 中立モデルの JSON 化（§5.3）
│   │
│   ├── charsets/
│   │   └── charsets.js       # ascii / kana / 常用漢字 / JIS 第1水準 等の named set
│   │
│   ├── format/
│   │   ├── registry.js       # 形式登録・detect・decode/encode ディスパッチ
│   │   ├── u8g2.js
│   │   ├── gfxfont.js
│   │   ├── glcd.js / fixedbmp.js / bmpfont.js / rlefont.js
│   │   ├── bdf.js
│   │   ├── vlw.js
│   │   └── csource.js        # C/C++ ソース ⇄ バイト列（§6.3）
│   │
│   ├── render/
│   │   ├── draw.js           # drawString / drawChar
│   │   ├── measure.js        # textWidth / fontHeight / measureText
│   │   └── datum.js          # 12 datum の解決
│   │
│   ├── inspect/
│   │   ├── inspect.js        # カバレッジ・メトリクス集計
│   │   └── estimate.js       # 形式ごとのサイズ算出
│   │
│   ├── fonts/
│   │   ├── catalog.js        # 186 本のメタデータ（生成物だがコミットする）
│   │   ├── loader.js         # loadFont()。fetch / node:fs の分岐はここだけ
│   │   └── data/             # フォントバイナリ（生成物だがコミットする）
│   │       ├── lgfx_font_japan_mincho_16.u8g2
│   │       ├── FreeSans9pt7b.gfx
│   │       └── ...
│   │
│   └── gen/
│       ├── rasterize.js      # FontFace + OffscreenCanvas（ブラウザ専用）
│       └── generate.js       # ラスタライズ結果 → 中立モデル（閾値処理含む）
│
├── web/                      # リファレンス Web アプリ（§14）
│   ├── index.html
│   ├── lgfx-font-tool.js     # ★ src/ への唯一の外向き参照（§4.4）
│   ├── app.js / store.js / actions.js / i18n.js
│   ├── locales/  en.json / ja.json
│   ├── components/           # Custom Elements
│   └── styles/
│
├── examples/                 # 単機能の最小サンプル（各 1 ファイル）
│   ├── index.html
│   ├── render-text.html      # 内蔵フォントで文字列 → 1bpp → Canvas 表示
│   ├── convert-font.html     # ファイル → detect → 変換 → ダウンロード
│   ├── generate-u8g2.html    # TTF → u8g2（fontgen 相当の最小形）
│   ├── inspect-font.html     # カバレッジ・サイズ見積り
│   └── node-render.js        # Node から使う例
│
├── oracle/                   # LovyanGFX ホストハーネス（C++。npm には含めない）
│   ├── README.ja.md          # ビルド方法・fixture 再生成手順
│   └── ...                   # §13.1
│
├── docs/
│   ├── spec.ja.md            # 本書
│   └── formats/              # 形式ごとのフィールドレベル仕様（実装時に起こす）
│
├── test/
│   ├── helpers.js
│   ├── fixtures/
│   │   └── oracle/           # ハーネスが生成した正解ビットマップ（コミットする）
│   └── *.test.js
│
├── scripts/
│   ├── extract-fonts.js      # LovyanGFX ソース → fonts/data/ + catalog.js（§8.3）
│   ├── build.js              # esbuild → dist/
│   ├── build-site.js         # → site/（GitHub Pages 用）
│   ├── serve.js              # ローカル開発サーバ（依存ゼロ）
│   ├── check-layers.js       # レイヤ規律の静的検査（CI）
│   ├── check-locales.js      # ロケール検査（CI）
│   └── sync-version.js
│
└── .github/workflows/
    ├── ci.yml                # 検査 + ビルド
    ├── pages.yml             # GitHub Pages デプロイ
    └── release.yml           # npm publish
```

**生成物（すべて `.gitignore`）:**

```text
dist/
├── lgfx-font-tool.js / .min.js   # ESM バンドル
└── fonts/                        # data/ と同内容。バンドルからの相対参照先
types/                            # .d.ts（リリース時のみ生成）
site/                             # GitHub Pages へアップロードする成果物
```

`src/fonts/data/` と `src/fonts/catalog.js` は生成物だが**コミットする**（設計判断 #5）。

### 4.3 各ディレクトリの責務

| ディレクトリ | 責務 | 依存してよい先 |
| --- | --- | --- |
| `src/util/` | エラー、bit/byte リーダ・ライタ | なし |
| `src/charsets/` | 名前付き文字集合のデータ | なし |
| `src/model/` | 中立モデルと操作 | `util/` |
| `src/format/` | 各形式の decode / encode / 制約検査。**純粋関数のみ** | `model/`, `util/` |
| `src/render/` | 描画・計測 | `model/`, `util/` |
| `src/inspect/` | 検査・サイズ見積り | `format/`, `model/`, `charsets/`, `util/` |
| `src/fonts/` | 内蔵コレクション。I/O は `loader.js` のみ | `format/`, `model/`, `util/` |
| `src/gen/` | TTF ラスタライズと生成。DOM は `rasterize.js` のみ | `model/`, `charsets/`, `util/` |
| `web/` | UI。公開 API の consumer | `./lgfx-font-tool.js` のみを通じて `src/` |
| `examples/` | 最小サンプル | `../src/`。`web/` には依存しない |
| `oracle/` | C++ ホストハーネス | LovyanGFX（JS には依存しない） |

### 4.4 モジュール解決とパス

esp-flashjs の規約をそのまま使う。

- `import` の指定子は**必ず相対パスで、拡張子付き**。ディレクトリの `index.js` への暗黙解決は存在しないものとして扱う。
- `web/` から `src/` への参照は `web/lgfx-font-tool.js`（`export * from '../src/index.js';` の 1 行）に集約する。`build-site.js` が `site/` を組むとき、書き換えるのはこの 1 ファイルだけになる。
- フォントデータの参照は `new URL('./data/<name>', import.meta.url)`。npm / CDN / Pages / ローカルのいずれから読み込まれても解決できる。

### 4.5 コーディング規約

| 項目 | 規約 |
| --- | --- |
| 言語 | ECMAScript 2022 以上、ESM のみ。トランスパイルしない |
| 型 | JSDoc。全ファイル先頭に `// @ts-check`。CI の `tsc --noEmit` を必須とする |
| 実行時依存 | ゼロ。devDependencies は esbuild と typescript のみ |
| バイト列 | 常に `Uint8Array`。`ArrayBuffer` / `Buffer` を API 境界に出さない |
| 数値 | メトリクスは JS の `number`（モデル上の値域は int16、§5.1）。コードポイントも `number` |
| 命名 | クラス PascalCase、関数 camelCase、定数 SCREAMING_SNAKE_CASE。形式 ID は小文字（`'u8g2'` 等） |
| 非同期 | I/O を持つのは `fonts/loader.js` と `gen/` のみ。それ以外の API は同期 |
| 文言 | `src/` にユーザー向け表示文言を置かない。エラーと Issue は安定した `code` を持つ |

---

## 5. 中立モデル

### 5.1 Font / Glyph / Bitmap

```js
/**
 * @typedef {object} Font
 * @property {string} familyName
 * @property {string} styleName        - "Regular" | "Bold" | ...
 * @property {number} ascent           - ベースラインから行ボックス上端まで（正、int16）
 * @property {number} descent          - ベースラインから行ボックス下端まで（正、int16）
 * @property {number} lineHeight       - 行送り（int16）。通常 ascent + descent 以上
 * @property {Map<number, Glyph>} glyphs   - コードポイント → グリフ
 * @property {number} [defaultCodepoint]   - 収録外文字の代替（tofu）。無指定可
 * @property {KerningPair[]} [kerning]     - 保持のみ。描画では適用しない（§2.3）
 * @property {FontMeta} meta           - 由来情報（元形式、元ファイル名、ライセンス等）
 */

/**
 * @typedef {object} Glyph
 * @property {number} codepoint        - 0 〜 0x10FFFF
 * @property {number} xOffset          - ペン位置からビットマップ左端まで（int16）
 * @property {number} yOffset          - ベースラインからビットマップ上端まで（int16、上が負）
 * @property {number} xAdvance         - 送り幅（int16）
 * @property {Bitmap} bitmap           - width × height はビットマップが持つ
 */

/**
 * @typedef {object} Bitmap
 * @property {number} width
 * @property {number} height
 * @property {1|8} bpp                 - 1 = 白黒、8 = 被覆値（0〜255、リニア）
 * @property {number} stride           - 行バイト数 = ceil(width * bpp / 8)
 * @property {Uint8Array} data         - 1bpp は MSB first、行はバイト境界へパディング
 */
```

**座標規約**（全形式のデコーダ・エンコーダ・レンダラが従う唯一の規約）:

- Y 軸は下向きが正。
- グリフの原点は**ベースライン上のペン位置**。`xOffset` / `yOffset` はそこからビットマップ左上への符号付きオフセット。上に伸びるグリフの `yOffset` は負になる（GFXfont と同じ向き）。
- 描画後、ペンは `xAdvance` だけ右へ進む。
- 各形式のネイティブ規約（u8g2 の BBX、BDF の DWIDTH/BBX、VLW の topExtent 等）との対応付けは各デコーダが吸収し、`docs/formats/` に記録する。

**値域**: メトリクスは int16 に収まること。デコーダは範囲外の値を見つけたら `FormatError` を投げる（実在の形式で int16 を超えるものはない）。u8g2 の 7bit のような**形式固有の制約はモデルに持ち込まない**。制約は各エンコーダが encode 時に検査する（§7）。

**ビット深度**: 1bpp と 8bpp の両方を表現できる。VLW はアンチエイリアス付き 8bpp で、ここを落とすと VLW のエンコーダが作れない。1 フォント内の全グリフは同一 bpp とする（混在は実在形式にない）。

### 5.2 モデル操作

```js
subset(font, codepoints)          // -> Font   指定した文字だけ残した新モデル
                                  //    codepoints: Iterable<number> | string | 名前付き集合
merge(base, overlay)              // -> Font   overlay 優先で合成（UC4 の補完。例: 欧文A + かなB）
                                  //    メトリクスは base のものを保ち、グリフは再スケールせず取り込む。
                                  //    行ボックスが合わない組合せは meta.issues に warning を積む
font.glyphs                       //    Map なので列挙・個別差し替えは素の Map 操作で行う（UC8）
```

`subset` / `merge` は元のモデルを変更しない（非破壊）。

文字集合は `charsets/` に名前付きで持つ: `ascii` / `latin1` / `kana` / `jouyou`（常用漢字）/ `jis1` / `jis2` など。LGFXScreenBuilder の fontgen が持つ集合定義を移管する。

### 5.3 シリアライズ

中立モデルの JSON 表現を定義する。用途はテスト fixture・デバッグ・ツール間の受け渡しで、効率は目的にしない。

```json
{
  "format": "lgfx-font-tool/font",
  "version": 1,
  "familyName": "...", "styleName": "...",
  "ascent": 24, "descent": 6, "lineHeight": 30,
  "glyphs": [
    { "cp": 65, "xOffset": 0, "yOffset": -24, "xAdvance": 14,
      "width": 13, "height": 24, "bpp": 1, "data": "<base64>" }
  ]
}
```

`serializeFont(font)` / `deserializeFont(json)` を提供する。往復は無損失（§13.2 と同じ規準）。

---

## 6. デコード

### 6.1 API

```js
import { decode, detect, listFormats } from 'lgfx-font-tool';

decode(input, { format })   // -> Font
//  input: Uint8Array（バイナリ形式）または string（BDF / C ソース）
//  format 省略時は detect() の最上位を使う。確信が持てなければ FormatError('DETECT_FAILED')

detect(input)               // -> Array<{format, confidence, reasonCode?}>  confidence 降順
listFormats()               // -> FormatInfo[]  形式 ID、名前、深度、decode/encode 対応
```

- デコードは**多少壊れていても中断しない**。復元できたグリフは返し、問題は `font.meta.issues` に安定コードで積む。完全に解釈不能なときだけ `FormatError` を投げる。
- `detect` の確度: magic を持つ形式（BDF の `STARTFONT`、C ソースの構文）は高確度で判定できる。u8g2 / VLW / GFXfont バイナリは magic を持たないため構造の整合性からの推定になる。**確信のない自動判定で誤った形式として読まない**。アプリ側で形式を明示させる UI を推奨する。

### 6.2 形式別の要点

各形式のフィールドレベル仕様は `docs/formats/` に譲り、ここでは実装の要点だけ記す。

| 形式 | デコードの要点 |
| --- | --- |
| u8g2 | 23 バイトヘッダ + ブロックジャンプ表 + グリフごとの可変ビット幅フィールド + 0/1 ランレングス。`BitReader` が要る。最も厄介だが CJK 内蔵の全部がこれ |
| GFXfont | glyph 配列 + bitmap 一枚布 + `EncodeRange`（LovyanGFX 拡張。Adafruit オリジナルは first/last の単一範囲）。**両方読めること** |
| GLCD / FixedBMP / BMP | 素のビットマップ表。ヘッダすらないものは寸法をカタログ側で与える |
| RLE | LovyanGFX 独自のランレングス。Font4/6/7/8 |
| BDF | テキスト形式。`STARTFONT` 〜 `ENDFONT`。ENCODING が −1 のグリフは読み飛ばす |
| VLW | グリフ数 + メタデータ表 + 8bpp ビットマップ列。Processing 由来 |

### 6.3 C/C++ ソースの入出力

`format/csource.js` は「テキスト ⇄ バイト列 + 形式ヒント」の層で、バイナリ形式と直交する。

**デコード（Phase 3）** — GitHub や Arduino ライブラリで配布される `.h` / `.c` を貼り付けたら読める、を実現する。

```js
decodeCSource(text)  // -> Array<{name, format, font}>  1 ファイル複数フォント対応
```

- `const uint8_t xxx[] PROGMEM = {...}` / `constexpr uint8_t` 等の配列リテラルを抽出する。
- `GFXfont` 構造体初期化子（`{bitmap, glyphs, first, last, yAdvance}`）を認識して GFXfont として組み立てる。u8g2 の `.c` フォント（単一配列）は u8g2 としてデコードを試みる。
- コメント・`#include`・マクロは無視する。C プリプロセッサの完全実装はしない（実在のフォント配布ファイルが読めれば足りる）。

**エンコード（Phase 2）** — スケッチに貼れるソースを出す。

```js
encodeCSource(font, { format, symbolName, progmem })  // -> string
```

- 出力形式ごとのイディオムに合わせる: GFXfont は Adafruit 流の `.h`、u8g2 は `U8G2_FONT_SECTION` 付きの `.c`、LovyanGFX 向けは `constexpr uint8_t []`。
- 生成物の先頭コメントに、元フォント名・文字集合・生成条件・ライセンス表示を必ず含める。

---

## 7. エンコードと能力問い合わせ

### 7.1 canEncode

形式ごとに表現できる範囲が違い、超えたときに黙って切り詰めると読めないフォントが出来上がる。**「入らない」は利用者に見せるべき情報である**。

```js
canEncode(font, format)   // -> { ok: boolean, issues: EncodeIssue[] }

/**
 * @typedef {object} EncodeIssue
 * @property {'error'|'warning'} level
 * @property {string} code          - 'XADVANCE_RANGE' | 'GLYPH_TOO_LARGE' | 'GLYPH_BYTES_OVER' |
 *                                    'CODEPOINT_OVER_BMP' | 'BPP_UNSUPPORTED' | 'RANGE_COUNT_LARGE' | ...
 * @property {number} [codepoint]   - 問題のグリフ
 * @property {object} [params]      - {value, min, max} 等。文言生成はアプリの仕事
 */
```

LGFXScreenBuilder の `"@" needs dx = 67px … Try 45px or less` は、`{code:'XADVANCE_RANGE', codepoint:0x40, params:{value:67, min:-64, max:63}}` から**アプリが**組み立てる文言になる。

### 7.2 encode

```js
encode(font, { format, ...formatOpts })   // -> Uint8Array
```

- `canEncode` が error を返す状態で呼ぶと `EncodeConstraintError`（issues 同梱）を投げる。**切り詰めない。**
- 呼び出し側の選択肢は「`subset()` でそのグリフを落とす」「小さいサイズで作り直す」「形式を変える」。判断材料は issues にすべて載せる。
- warning（GFXfont の `RANGE_COUNT_LARGE` 等、壊れはしないが性能に効くもの）はエンコードを止めない。
- u8g2 エンコーダはランレングスのビット幅 (m0, m1) を「制約落ちするグリフが最少、同数ならサイズ最小」で自動選択する（fontgen の実装を踏襲）。

### 7.3 形式別制約（エンコーダが検査するもの）

数値は LovyanGFX v1.2.26 が実際に課している上限（FONT_FORMATS.ja.md の実測に基づく）。

| 形式 | 主な制約 |
| --- | --- |
| u8g2 | 送り幅・ベアリング **−64〜63**（7bit）。グリフ幅・高さ 127 以下（ヘッダが int8）。1 グリフ **255 バイト以下**。コードポイントは BMP まで。実用上の文字高さ上限は書体により 45〜64px 程度 |
| GFXfont | 送り幅 0〜255、ベアリング −128〜127、グリフ幅・高さ 255 以下。行ボックスは実質 127。BMP まで。飛び飛びの文字集合では EncodeRange が膨らむ（常用漢字で 1,774 個 → warning） |
| BDF | 実質制約なし（int16 に収まればよい） |
| VLW | **8bpp 固定**（1bpp モデルは 0/255 に引き伸ばして符号化する。逆に 8bpp → 1bpp 形式は自動変換しない。閾値処理はモデル操作として明示的に行わせる） |
| GLCD / FixedBMP | 固定サイズ・固定文字集合のみ。一般のモデルはまず入らない（エンコーダは任意提供） |
| C ソース | 内包するバイナリ形式の制約に従う |

---

## 8. 内蔵フォントコレクション

### 8.1 カタログとロード

```js
import { fontCatalog, loadFont } from 'lgfx-font-tool';

fontCatalog                 // -> CatalogEntry[]  186 本のメタデータ（データ本体は含まない）
await loadFont('lgfxJapanGothic_24')   // -> Font  初回のみデータをロード、以後キャッシュ
```

```js
/**
 * @typedef {object} CatalogEntry
 * @property {string} name        - LovyanGFX での識別子をそのまま使う（fonts::lgfxJapanGothic_24 → 'lgfxJapanGothic_24'）
 * @property {string} format      - 'u8g2' | 'gfx' | 'glcd' | 'fixedbmp' | 'bmp' | 'rle'
 * @property {number} lineHeight / ascent / descent
 * @property {number} glyphCount
 * @property {string[]} coverage  - 含まれる名前付き集合（'ascii', 'kana', 'jouyou', ...）
 * @property {number} dataBytes
 * @property {string} license     - SPDX 形式。'BSD-3-Clause', 'OFL-1.1', 'GPL-3.0-or-later WITH Font-exception' 等
 * @property {string} copyright
 */
```

- カタログはコードに含まれる軽量データ（LGFXScreenBuilder が別途生成していた `font-metrics.json` 相当を、ライブラリの標準機能にする）。
- データ本体は `fonts/data/` の個別ファイルで、`loadFont()` が `new URL(..., import.meta.url)` で解決してロードする。ブラウザは `fetch`、Node は `node:fs`。**JS バンドルには埋め込まない**（設計判断 #5）。
- ロード後は通常の `Font` モデルであり、描画にも変換にもサブセットにも使える。

### 8.2 収録内容

LovyanGFX v1.2.26 の内蔵フォント全 186 本。

| 形式 | 本数 | 内容 |
| --- | --- | --- |
| u8g2 | 116 | lgfxJapanMincho / Gothic（8〜40px）、efont JA / CN / KR / TW（10〜24px、b/i 変種含む） |
| GFXfont | 61 | Free Mono / Sans / Serif の各スタイル・サイズ、Orbitron、Roboto、Satisfy、TomThumb、Yellowtail 等 |
| GLCD | 2 | Font0、Font8x8C64 |
| FixedBMP | 2 | AsciiFont8x16、AsciiFont24x48 |
| BMP | 1 | Font2 |
| RLE | 4 | Font4 / 6 / 7 / 8 |

### 8.3 抽出パイプライン

内蔵フォントは `lgfx_fonts.cpp` / `.hpp` の `constexpr uint8_t[]` として存在し、`fetch()` では取れない。`scripts/extract-fonts.js` が担う:

1. LovyanGFX の**リリース tarball をタグ固定で取得**する（既定 v1.2.26。取得元とタグを `src/fonts/data/README.md` に記録する）。
2. ソースから配列リテラルとフォント定義（形式・寸法・構造体初期化子）を抽出し、`fonts/data/*.{u8g2,gfx,...}` に書き出す。
3. 各フォントを**この場でデコードして**メトリクス・グリフ数・カバレッジを計測し、`fonts/catalog.js` を生成する（カタログは推定値ではなく実測値）。
4. ライセンス・著作権表示をソースコメントから回収し、`NOTICE` の該当節を再生成する。

結果はコミットする。利用者にも CI にも C++ ソースの解析を要求しない。LovyanGFX のバージョン更新時だけ再実行する。

### 8.4 ライセンス

同梱フォントのライセンスはフォントごとに異なる（efont 系の BSD 系条項、Google Fonts 系の OFL / Apache、GNU FreeFont の GPL + font exception、Adafruit 系の BSD 等）。

- 本体コードは MIT。フォントデータの帰属は `NOTICE` に一括記載する（esp-flashjs が stub で取った方式）。
- `CatalogEntry.license` / `copyright` で機械可読にし、リファレンスアプリはフォント選択 UI にライセンスを表示する。
- `encodeCSource()` の出力ヘッダにも元フォントの帰属を必ず埋め込む（§6.3）。
- 抽出時にライセンスを特定できないフォントがあれば、**同梱を保留して**未決事項に挙げる。

---

## 9. 描画とテキスト計測

### 9.1 描画先

描画先はライブラリ自身の `Bitmap`（§5.1）。出力は被覆値（1bpp: 0/1、8bpp: 0〜255）であり、色は持たない。Canvas への貼り付け・色付けは利用側で行う（examples の `render-text.html` に ImageData 化ヘルパの実例を置く）。

```js
createBitmap(width, height, bpp)   // -> Bitmap  ゼロ初期化
```

### 9.2 API

```js
import { drawString, drawChar, textWidth, fontHeight, measureText } from 'lgfx-font-tool';

drawString(bitmap, font, text, x, y, style?)   // -> {advance, box}  1 行を描く
drawChar(bitmap, font, codepoint, x, y, style?) // -> advance
textWidth(font, text, style?)                   // -> number
fontHeight(font, style?)                        // -> number
measureText(font, text, style?)                 // -> {width, height, ascent, descent, box}

/**
 * @typedef {object} TextStyle
 * @property {number} [sizeX=1] / [sizeY=1]  - 文字倍率。LovyanGFX 同様、非整数も可
 * @property {string} [datum='top-left']     - 12 種: top/middle/bottom/baseline × left/center/right
 * @property {number} [clipX1,clipY1,clipX2,clipY2]  - クリップ矩形（省略時は bitmap 全面）
 */
```

- テキストは JS 文字列（UTF-16）で受け、サロゲートペアは 1 コードポイントに合成して扱う。モデルが持っていれば BMP 外も描ける（LovyanGFX 実機では描けないことはアプリが `canEncode` / カタログで判断する）。
- 収録外の文字は `font.defaultCodepoint` があればそれを、なければ**何も描かず送りだけ進める**か 0 送りかを LovyanGFX の実挙動に合わせる（実装時にオラクルで確定し、本書を更新する）。
- 折り返し・改行処理はしない。`\n` は収録外文字と同じ扱い。複数行はアプリが 1 行ずつ呼ぶ。

### 9.3 LovyanGFX 互換の規則

描画セマンティクスの正解は LovyanGFX v1.2.26 の `LGFXBase` である。仕様の細部（倍率適用時の丸め、datum の基準点、`xOffset` が負のときのカーソル挙動など）は文章で二重定義せず、**§13.1 のオラクルとの完全一致を仕様とする**。ここでは骨子だけ列挙する:

- ペンはベースライン基準で `xAdvance × sizeX` ずつ進む。
- `datum` は `measureText` の結果を使って開始位置を解決する（LovyanGFX の `setTextDatum` 相当の 12 種）。
- 倍率はグリフのビットマップ・オフセット・送りのすべてに掛かる。非整数倍率のピクセル複製規則も LovyanGFX の実装に一致させる。
- 8bpp グリフ（VLW）は被覆値をそのまま出力する。8bpp グリフを 1bpp ビットマップへ描く場合の縮退規則も LovyanGFX に合わせる。

### 9.4 描画プロファイル（将来）

u8g2 ライブラリ本体や Adafruit GFX の `print()` は、同じフォントデータでも LovyanGFX と細部が異なる（基準点・カーソル移動）。本仕様の範囲は LovyanGFX プロファイルのみとし、他プロファイルは Phase 4 以降の検討事項とする（§18）。

---

## 10. TTF からの生成

### 10.1 ラスタライズは誰が正解か

前提が §9 と入れ替わるので明示する。

| 状況 | 正解を持つのは |
| --- | --- |
| **既存のビットマップフォントを描く**（プレビュー） | **LovyanGFX**。ブラウザのラスタライザで代用すると字形が合わない |
| **TTF から新しくフォントを作る**（生成） | **ラスタライザ自身**。出力したビットがそのままフォントデータになり、デバイスはそれを描く |

生成側ではブラウザでラスタライズしてよい。そうして出来たビットマップが定義上の正解になる。この 2 つを混同しないこと。

### 10.2 API とラスタライズ方式

```js
import { generateFont } from 'lgfx-font-tool';   // 実体は src/gen/

await generateFont({
  source,                  // ArrayBuffer | Blob | URL 文字列（TTF/OTF/WOFF/WOFF2）
  px,                      // 文字高さ（CSS px でのフォントサイズ）
  codepoints,              // Iterable<number> | string | 名前付き集合名
  bpp: 1,                  // 1（閾値処理）| 8（被覆値のまま）
  threshold: 128,          // 1bpp 時の閾値（0-255）
  weight, italic,          // FontFace descriptor に渡す
})  // -> Font
```

- 実装は `FontFace` でフォントを登録し、`OffscreenCanvas` の 2D コンテキストでグリフを 1 文字ずつ描画してアルファチャネルを回収する。**opentype.js 等は使わない**（設計判断 #2）。LGFXScreenBuilder の `fontgen/rasterize.js` で実証済みの方式であり、その実装を移管・整理する。
- フォントが当該グリフを持つかの判定（tofu 除外）もラスタライズ結果と `measureText` の突き合わせで行う（fontgen の既存手法を踏襲）。
- ブラウザ以外で呼ぶと `CapabilityError('RASTERIZER_UNAVAILABLE')`。Node 対応はラスタライザ注入インタフェースとして将来検討する（§18）。

### 10.3 決定性

同じ入力から同じフォントが出ることを生成の要件とする。

- 閾値処理・メトリクス丸め・グリフ境界の切り出しは、本ライブラリ内の**決定的なコード**で行う。設定（px、閾値、太さ）が同じなら出力は入力フォントとブラウザにのみ依存する。
- ブラウザエンジン間・OS 間でアンチエイリアスの結果は異なりうる。これは許容する（§10.1 — 生成物がそのまま正解になるため、再現性が必要な場面では生成物自体を成果物として保存する）。この性質はドキュメントに明記する。
- 生成した `Font` の `meta` に生成条件（元ファイル名、px、閾値、UA）を記録する。

---

## 11. 検査

フォントの棚卸し（UC2）と文言カバレッジの事前検証（UC6）を支える機能群。

```js
inspect(font)                // -> {glyphCount, codepointRanges, metrics, bbox 極値, coverage: {ascii: 1.0, kana: 0.98, ...}}
coverage(font, chars)        // -> {total, present, missing: number[]}
                             //    chars: Iterable<number> | string | 名前付き集合名（subset と同じ受け口）
estimateSize(font, format)   // -> {bytes, issues}   エンコードした場合の正確なバイト数
                             //    制約違反があれば canEncode 同様の issues 付き。概算ではなくレコード構造から厳密に算出する
```

`estimateSize` を全対応形式に対して回せば、「この文字集合・サイズなら u8g2 175KB / GFXfont 189KB / VLW 1.36MB」という FONT_FORMATS.ja.md の比較表が任意のフォントについて得られる。リファレンスアプリの Inspector はこれを表示する。

---

## 12. エラーモデル

```text
FontToolError (base)              — code: string, details?: object
├── FormatError                   — 入力が解釈できない
│   ├── DetectFailedError         (DETECT_FAILED)
│   ├── TruncatedDataError        (TRUNCATED)
│   └── UnsupportedFeatureError   (UNSUPPORTED_FEATURE)   例: BDF の未対応プロパティ
├── EncodeConstraintError         (ENCODE_CONSTRAINT)     issues: EncodeIssue[] を同梱
├── CapabilityError               (RASTERIZER_UNAVAILABLE 等)  環境に機能がない
└── CollectionError               (UNKNOWN_FONT / FONT_DATA_LOAD_FAILED)
```

- すべてのエラーは安定した `code` と `details` を持つ。`message` は英語の開発者向け文字列。**ライブラリはユーザー向け文言を生成しない**（設計判断 #11）。
- 「壊れているが読める」はエラーではなく `font.meta.issues` / `EncodeIssue` で表現する（デコードは中断しない、§6.1）。

---

## 13. 正しさの担保

3 種類あり、どれも欠かせない。

### 13.1 LovyanGFX との一致（デコーダと描画の正解）

**LovyanGFX 自身をオラクルにする。**

```text
同じフォント・文字列・倍率・datum
  → C++（ホストビルドの LovyanGFX）で描画 → 1bpp   ← 正解
  → JS（本ライブラリ）で描画                → 1bpp
  → バイト列が完全一致すること
```

- `oracle/` に C++ ホストハーネスを置く。lang-ship の host コアで LovyanGFX をネイティブビルドし、`IFont` の共通インタフェース（`updateFontMetric` / `drawChar`）で全形式を同じコードから回す。
- 対象は「**全 186 フォント × 代表文字集合 × 代表倍率 × 代表 datum**」。出力（1bpp ビットマップ + メトリクス）を `test/fixtures/oracle/` にコミットする。
- JS 側テストは fixture との完全一致を検証する。1bpp なのでアンチエイリアスの誤差がなく、「だいたい合う」で妥協する理由がない。
- **これがデコーダ実装のデバッグ環境も兼ねる。** 形式仕様の読み間違いという失敗モードは、ここで全部落ちる。
- fixture の再生成はローカル手順（`oracle/README.ja.md`）とし、生成時の LovyanGFX バージョンとハーネスのコミットを fixture に記録する。CI での自動再生成は未決事項（§18）。

### 13.2 往復（エンコーダの自己整合）

```text
中立モデル → エンコード → デコード → 中立モデル
  → グリフ・メトリクスが完全一致すること（形式の制約に収まる範囲で情報が落ちない）
```

シリアライズ（§5.3）にも同じ規準を適用する。

### 13.3 実物との一致（エンコーダの実効性）

エンコードした u8g2 / GFXfont / VLW を**実際に LovyanGFX に読ませて描かせ**（13.1 のハーネスを流用）、同じモデルから本ライブラリが描いたものと一致すること。

§13.2 だけでは「自分が書いた仕様どおりに読み書きできる」ことしか言えない。仕様の解釈が上流とずれていた場合、往復は通るのに実機で化ける。それをここで落とす。

---

## 14. Web リファレンスアプリ

esp-flashjs Web と同じ構え: UI フレームワークなし（Custom Elements + 極小 store）、GitHub Pages 配信。

i18n は en / ja / zh-Hans / zh-Hant。`navigator.languages` から自動判定し（優先順位: `?lang=` > localStorage > ブラウザ言語）、対応がなければ英語。辞書は `web/locales/<id>.json` で、**言語の追加 = `SUPPORTED_LOCALES` に 1 エントリ + 辞書ファイル 1 枚**になるよう保つ。キー欠落とプレースホルダ不整合は `scripts/check-locales.js` が CI で検査する。ライブラリ本体（`src/`）は文言を持たない（設計判断 #11）。

| 画面 | 内容 | 使う API |
| --- | --- | --- |
| **Viewer** | 内蔵 186 本のカタログ閲覧、任意テキストのピクセル一致プレビュー（拡大・グリッド表示）、ライセンス表示 | `fontCatalog` / `loadFont` / `drawString` |
| **Converter** | フォントファイル / C ソースを放り込む → detect → 変換 → ダウンロード。「入らない」は issues をそのまま可視化 | `decode` / `canEncode` / `encode` |
| **Generator** | TTF → u8g2 / GFXfont。文字集合選択、閾値プレビュー、C ソース出力。**最終的に LGFXScreenBuilder fontgen.html 相当まで作り込む**（決定済み）: Google Fonts 等の再配布可能書体（OFL / Apache-2.0）からの選択（実装済み）、欠落文字の別書体からの補完（`merge` + FALLBACK_CHAIN。未実装）、ライブプレビュー。**現状の UI は暫定で、fontgen.html の UI を手本に全面リデザインする**（利用者フィードバック 2026-08）。フォント取得のネットワークアクセスはアプリ側の責務（§2.3）で、ライブラリは `generateFont` に読み込み済みファミリを渡せる口だけ持つ | `generateFont` / `subset` / `merge` / `encode` / `encodeCSource` |
| **Inspector** | カバレッジ、メトリクス、全形式サイズ比較表 | `inspect` / `estimateSize` |

`examples/` には各 1 ファイルの最小サンプルを置く（§4.2）。アプリの多機能さとは独立に、「この API はこれだけで動く」を示すのが目的。

---

## 15. テスト

- テストランナーは `node:test`。実行時依存ゼロのまま Node だけで全テストが回る。
- fixture は 3 系統: ①オラクル出力（§13.1、コミット）、②手書きの最小フォント（境界値: 空フォント、1 グリフ、負ベアリング、BMP 外コードポイント、127/255 境界）、③実在フォントの現物（内蔵コレクション自体がテストデータを兼ねる）。
- 必須テストケース: 全 186 内蔵フォントのデコード成功、全フォント × 代表文字列のオラクル一致、各エンコーダの往復一致、canEncode の制約検出（u8g2 の 7bit / 255 バイト境界をぴったり跨ぐケース）、C ソースの実在配布ファイル読み込み。
- `npm run check` = テスト + `tsc` 型検査 + レイヤ検査 + ロケール検査。CI と同一。

---

## 16. 公開・配布

esp-flashjs の方式を踏襲する。

| 経路 | 内容 |
| --- | --- |
| npm | 単一パッケージ。`files` = `dist` / `src` / `types` / NOTICE。**フォントデータの配布方法は未決**（§18）— 実測 42.2MB（efont 系 80 本が各 13,000 グリフ超）であり、npm 同梱は重い。リポジトリには全量コミットする（リポジトリサイズは許容と決定済み） |
| CDN (jsDelivr 等) | `dist/lgfx-font-tool.min.js`。フォントデータは `dist/fonts/` から相対解決されるので CDN でもそのまま動く。バージョン固定を README で必須と明記 |
| GitHub Pages | リファレンスアプリ + examples + ドキュメント |
| GitHub Actions | `ci.yml`（check + build）/ `pages.yml` / `release.yml`（npm publish） |

ドキュメントは日本語（`.ja.md`）を正とし、内容が固まった段階で英語版を併置する（esp-flashjs 同様の対訳体制へ移行）。

---

## 17. ロードマップ

依存の向きから順序はほぼ一意に決まる: デコーダと描画が最初（オラクルがデバッグ環境を兼ねるため）、生成と符号化がその上、相互運用形式は独立に足せる。

### Phase 1 — 読む・描く（UC3 / UC7 が成立。UC2 は内蔵フォント分、UC9 はデコード検査分）

- `util/` `model/` と座標規約
- デコーダ: u8g2 / GFXfont / GLCD / FixedBMP / BMP / RLE（= 内蔵 186 本が全部読める）
- 描画・計測: 1bpp、整数・非整数倍率、12 datum
- 内蔵コレクション: `extract-fonts.js` → `catalog` / `loadFont`
- オラクルハーネスと fixture、CI（check 一式 + Pages に Viewer 最小版）

### Phase 2 — 作る（UC1 / UC4 / UC8 が成立。UC5 は u8g2 / GFXfont 出力分）

- `gen/`: FontFace + Canvas ラスタライズ、閾値処理、文字集合（`charsets/` 移管）
- エンコーダ: u8g2 / GFXfont、`canEncode` / `EncodeIssue`
- `subset` / `merge`（UC4 の補完）、C ソース出力（`encodeCSource`）
- 実物一致テスト（§13.3）、Generator 画面

### Phase 3 — 繋ぐ（UC5 / UC6 / UC9 が完成。UC2 が任意フォントへ拡大）

- BDF デコード / エンコード、VLW デコード / エンコード（8bpp 描画含む）
- C ソースのデコード（貼り付け読み込み）
- シリアライズ、`inspect` / `estimateSize`
- Converter / Inspector 画面、英語ドキュメント

### Phase 4 — 広げる（検討込み）

- BFF（LovyanGFX 側の仕様安定を待つ）、fontx2
- カーニング保持の実データ検証
- Node 用ラスタライザ注入、LovyanGFX 以外の描画プロファイル

---

## 18. 未決事項

| 論点 | 内容 | 現時点の傾き |
| --- | --- | --- |
| npm パッケージ名 | リポジトリは `LGFXFontToolJs`。npm 名は要決定 | `lgfx-font-tool`（本書のコード例はこれで書いてある） |
| **内蔵フォントデータの配布方法** | 実測 42.2MB あり npm 同梱は重い。候補: ①npm 同梱（そのまま / gzip。`DecompressionStream` なら依存ゼロを保てる）②GitHub Pages 等から実行時ダウンロード（`loadFont` の解決先を差し替え可能にする）③データ別パッケージ（`lgfx-font-tool-fonts`） | 未決。リポジトリへの全量コミットは決定済み。よく使うフォントだけ同梱し残りをリモート解決とする折衷も検討 |
| オラクル fixture の CI 再生成 | ローカル手順にとどめるか、workflow_dispatch でホストビルドまで回すか | まずローカル + コミット運用。ハーネスが安定したら CI 化 |
| 収録外文字の描画挙動 | 何も描かず送りゼロか、tofu か。LovyanGFX の実挙動確認待ち | オラクルで確定し §9.2 を更新 |
| BFF | 未文書で仕様が安定していない。カーニング・可変 bpp を持つ | Phase 4 で再評価 |
| fontx2 ほか LGFX 外形式の範囲 | どこまで広げるか（PCF、u8x8 等） | BDF が相互運用を担うので急がない。要望駆動 |
| Node での TTF 生成 | ラスタライザ注入インタフェース（node-canvas / skia を利用側が渡す） | インタフェースだけ用意し実装は持たない |
| ライセンス不明フォントの扱い | 抽出時に帰属を特定できなかった場合 | 同梱保留とし、判明分のみ収録 |
| 描画プロファイルの拡張 | u8g2 ライブラリ / Adafruit GFX ネイティブの描画規則 | 需要が見えるまで着手しない |

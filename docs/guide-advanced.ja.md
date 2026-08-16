# 上級者ガイド

ライブラリの内部規約・保証の根拠・制約の詳細・拡張方法をまとめます。
API の使い方だけなら [用途別ガイド](./guide-usecases.ja.md)、規範的な定義は
[仕様書](./spec.ja.md)（節番号 §n はそちらへの参照）を見てください。

## 1. 中立モデルの不変条件

すべての形式は `Font`（[src/model/font.js](../src/model/font.js)）へ
デコードされます。デコーダ・エンコーダを書く／モデルを直接組み立てる
ときに守るべき規約:

- **座標系**: Y 軸は下向きが正。グリフ原点はベースライン上のペン位置。
  `yOffset` はベースライン→ビットマップ上端で、上に伸びる字は**負**。
- **整数域**: メトリクスはすべて int16 想定。エンコーダは形式ごとに
  さらに狭い制約を検査する（§3）。
- **`-0` の禁止**: `yOffset` 等の計算で `-0` が生じたら `0` に正規化する。
  `assert.deepEqual` や往復比較が `-0 !== +0` で壊れるため、デコーダは
  `v === 0 ? 0 : -v` のパターンで負号を付けます。
- **ビットマップ**: 1bpp は MSB first・**行ごとにバイト境界へ詰める**
  （`stride = ceil(width / 8)`）。8bpp は 0–255 の被覆値（アルファ）で、
  色情報は持ちません。
- **`glyphs` は `Map<codepoint, Glyph>`**: 順序に意味はなく、エンコーダが
  必要に応じてソートします。`glyphs.get(0)`（U+0000）は「デフォルト
  グリフ」として描画フォールバックに参加します（§2）。
- **`meta.issues`**: デコード時に気づいた欠陥は例外にせず warning として
  ここへ積む（読めるものは読む）。エンコード時の制約違反は例外
  （`EncodeConstraintError`）にする——非対称なのは意図です（§3）。

## 2. LovyanGFX とピクセル単位で一致する仕組み

描画（[src/render/draw.js](../src/render/draw.js)）は LovyanGFX v1.2.26 の
`draw_string` / 各フォントクラス `drawChar` の移植です。「だいたい同じ」
ではなく完全一致させるため、以下を原文どおり再現しています。

**16.16 固定小数点。** 倍率は `toFixed16(size) = Math.trunc(65536 * size)`
で固定小数点化し、座標は常に `(v * sx) >> 16` で切り捨てます。演算順序も
保存しており、たとえば先頭文字の負の `xOffset` 補正は LGFX 原文の
`sumX = - (metrics.x_offset * sx) >> 16`（単項マイナスが積に先に掛かり、
その後シフト）をそのまま持っています。整数倍率では消える違いですが、
1.5 倍などの非整数倍率で 1px の差になります。

**描画プロファイル。** 倍率適用時に「潰れた行・列」をどう扱うかが
LGFX のフォントクラスごとに違うため、`font.meta.drawProfile` で再現します
（整数倍率では全プロファイル同一。既定は `'gfx'`）:

| profile | 元クラス | 縮小で潰れたラン/行の扱い |
| --- | --- | --- |
| `gfx` | GFXfont | 端でなければ 1px に持ち上げる |
| `u8g2` / `rle` | U8g2font / RLEfont | 描かない（捨てる） |
| `bmp` | BMPfont / FixedBMP / BDF | 常に 1px へ持ち上げ（行は下端以外） |
| `glcd` | GLCDfont | 列方向に走査して量子化 |
| `vlw` | VLWfont | ピクセル単位。8bpp 被覆値をそのまま置く |

vlw の被覆値を 1bpp の描画先に置くときは「a ≥ 1 なら点灯」です。これは
LGFX のブレンド式 `(255 * (1 + a)) >> 8` が a に等しいことから導かれる、
黒地に白でブレンドした結果の 2 値化と一致します。

**フォールバック連鎖。** 未収録文字は
`glyphs.get(cp)` → `glyphs.get(0)` → `meta.fallback` のメトリクスで
`drawCharDummy` 相当の枠（内側 1px 縮めた矩形）を描く、の順で解決します。
`meta.fallback` は元形式の規則（LGFX の `updateFontMetric` 失敗時挙動）から
デコーダが決めます。GFXfont の「未収録文字は送りゼロ」のような癖も
`fallback.drawAdvance` / `drawBox` で表現されています。

**VLW の空白特例。** VLW のみ、U+0020 はグリフの有無にかかわらず
何も描かず `spaceWidth`（ロード時に `max(size, ascent+descent) * 2 / 7` で
再計算される値）だけ進みます。計測 (`textWidth`) は表のメトリクスを使う、
という非対称も原文どおりです。

### 保証の根拠: 2 系統のオラクル

「移植が正しい」ことはコードレビューではなくテストで担保しています
（[oracle/](../oracle/README.ja.md)）。

1. **oracle_dump** — 実物の LovyanGFX（lang-ship:host コアでネイティブ
   ビルド）に全 186 フォント × 描画条件の 1,860 ケースを描かせてダンプし、
   本ライブラリの出力と**バイト列完全一致**で比較。デコーダと描画の検証。
2. **oracle_encoded** — 本ライブラリが**エンコードした**バイト列を実物の
   LGFX に読ませて描かせる 36 ケース。エンコーダが「LGFX の解釈と同じ
   書き方」をしていることの検証（自前デコーダとの往復だけでは、双方が
   同じ誤解をしているケースを検出できないため）。

fixture はコミット済みなので通常の `npm test` はネイティブビルド不要です。
再生成は `npm run oracle` / `npm run oracle:encoded`（arduino-cli と
lang-ship:host コアが必要）。

## 3. エンコード制約 — 黙って切り詰めない

方針: **エンコーダは元データを黙って変形しない。** 入らないものは
`EncodeConstraintError`（`issues` 付き）で止まり、明示的な
`dropInvalid: true` のときだけ違反グリフを**丸ごと落として**続行します
（値のクランプはしません）。事前検査は `canEncode(font, format)`、
落とした場合のサイズは `estimateSize(font, format)` が返します。

主な制約と issue コード:

| 形式 | 制約（代表例） | 主なコード |
| --- | --- | --- |
| 共通 | グリフなし / 1bpp 専用形式への 8bpp | `EMPTY_FONT`, `BPP_UNSUPPORTED` |
| u8g2 | 寸法・オフセット・送りが 7bit 符号付き (−64..63)、1 グリフのレコード ≤ 255B | `GLYPH_TOO_LARGE`, `GLYPH_BYTES_OVER` |
| gfx | 寸法・オフセットが int8/uint8 域、行ボックス ≤ 255 | `GLYPH_TOO_LARGE`, `LINE_BOX_TOO_TALL`, `RANGE_COUNT_LARGE`(warning) |
| bdf | エンコード不能なグリフ等は warning で記録 | `BDF_*` |
| vlw | コードポイントが BMP 内 (u16)、行高の u8 域 | `VLW_CODEPOINT_OVER_BMP`, `LINE_HEIGHT_RANGE` |
| bff | cmap/loca に載らない構成、行高 0 | `LINE_HEIGHT_COLLAPSED` ほか |
| fontx2 | Shift_JIS に写像できる文字のみ、固定セルへの再配置 | `FONTX2_UNMAPPED_CODES` |

`level: 'warning'` は「入るが情報が落ちる/形が変わる」もの
（例: gfx の範囲分割が多すぎる、fontx2 の固定セル化）で、エラーにはなりません。

**16px の日本語フォントでは u8g2 (RLE) が最小、24px 以上ではしばしば
gfx より差が開く**など、サイズの損得は中身に依存します。決め打ちせず
`estimateSizes` で実測してください（エンコードと同じ経路で数えるので
正確なバイト数です)。

## 4. ロスレス往復と `meta.format`

デコーダは元形式固有のパラメータ（u8g2 のビット幅配分、VLW のヘッダ値、
BFF の kern レコードなど）を `font.meta.format.<形式名>` に保持し、
同じ形式へ再エンコードするときに再利用します。これにより
「decode → encode で元とバイト一致」の往復がテストされています。

このため **subset / merge 後も `meta` は引き継がれます**が、モデルを
大きく加工した場合（メトリクス変更など）は元パラメータが最適でなくなる
ことがあります。エンコーダはその場合も矛盾しない値を再計算します。
BFF の kern のように「中立モデルでは編集できないが往復では保持される」
データがあることに注意してください（グリフを減らす subset では kern も
対応して間引かれます）。

## 5. フォントデータの配布とオフライン利用

同梱コレクション 186 本のうち、npm / CDN パッケージに入っているのは
軽量な 70 本（LovyanGFX 内部形式 + 欧文 GFX、約 320KB）だけです。
CJK 系 42MB は `loadFont` 時に次の順で解決されます
（[src/fonts/loader.js](../src/fonts/loader.js)）:

1. `configureFontData({ baseUrl })` の指定先（指定時は**ここだけ**を見る）
2. `import.meta.url` 基準のローカル `./data/`（clone と GitHub Pages は
   全 186 本がここで解決され、ネットワークに出ません）
3. GitHub Pages のリモート `https://tanakamasayuki.github.io/LGFXFontToolJs/src/fonts/data/`

オフライン環境・社内ミラー・エアギャップでは、リポジトリの
`src/fonts/data/` を丸ごと置いて差し替えます:

```js
import { configureFontData } from 'lgfx-font-tool';

configureFontData({ baseUrl: 'https://intra.example.com/lgfx-fonts/' });
// Node ならローカルディレクトリも可:
configureFontData({ baseUrl: 'file:///opt/lgfx-fonts/' });
// 既定に戻す:
configureFontData({});
```

候補列は純関数 `fontDataCandidates(file)` で確認できます。`loadFont` は
フォント名単位で Promise をキャッシュし、`configureFontData` はキャッシュを
破棄します。ライブラリ内で I/O を行うのはこの loader（と ブラウザ専用の
`gen/rasterize.js`）だけです。

## 6. アーキテクチャとレイヤ規律

```
src/
  util/     エラー・ビット/バイト読み書き（依存なし）
  model/    中立モデル・subset/merge・シリアライズ（util のみに依存）
  format/   形式ごとの decode/encode/canEncode + registry
  render/   描画・計測（LGFX 移植）
  inspect/  棚卸し・サイズ見積もり
  charsets/ 名前付き文字集合
  gen/      TTF ラスタライズ（ブラウザ専用）
  fonts/    同梱カタログ + loader（唯一の I/O）
```

規律: **`src/` は原則 I/O・DOM・Node API に触れない**（例外は
`fonts/loader.js` と `gen/rasterize.js` の 2 つだけ）。これは
`npm run lint:layers`（[scripts/check-layers.js](../scripts/check-layers.js)）が
機械的に検査します。`document` / `fetch(` などの語は**コメント内でも**
検出されるので注意（誤検出ではなく「言及すら禁止」の設計です）。

### 新しい形式を足す手順

1. `src/format/<name>.js` に `decode<Name>` / `canEncode<Name>` /
   `encode<Name>` を実装。元形式パラメータは `meta.format.<name>` へ。
   デコード時の欠陥は `meta.issues`、エンコード制約は安定コードの
   `EncodeIssue` で。
2. [registry.js](../src/format/registry.js) の `FORMATS` と
   `detect` / `decode` / `canEncode` / `encode` の分岐に登録。
3. [src/index.js](../src/index.js) から re-export。
4. テスト: 実データの decode、`decode → encode` 往復、`canEncode` の
   制約網羅。可能ならオラクル（oracle_encoded に実物へ読ませるケース追加）。
5. `npm run check`（テスト・型・レイヤ・ロケールの一括検査）。

型は JSDoc + `tsconfig.json`（checkJs）で検査され、`npm run types` が
`.d.ts` を生成します。TypeScript 構文は使えません。

## 7. 実行環境ごとの注意

| 機能 | Node | ブラウザ |
| --- | --- | --- |
| decode / encode / render / inspect / subset | ✔ | ✔ |
| `loadFont`（同梱コレクション） | ✔（fetch / file:） | ✔ |
| `generateFont`（TTF ラスタライズ） | ✘ `CapabilityError` | ✔ |

- ラスタライズは `FontFace` + canvas 計測に依存するためブラウザ専用です。
  Node で TTF から作りたい場合は、ブラウザ（または Playwright 等）で
  生成 → `serializeFont` で持ち出すのが現実的です。
- Shift_JIS 変換は `TextDecoder('shift_jis')`（Encoding Standard の必須
  エンコーディング）を使うため、Node・全主要ブラウザで追加依存なしに
  動きます。逆引き表は初回利用時に全コード復号で構築されます。
- 巨大 CJK フォントの `loadFont` は初回のみネットワーク/ディスク I/O が
  走ります（§5）。起動時にまとめて `await` するか、UI ではプレースホルダ
  を出してください。

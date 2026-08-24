# 用途別ガイド

[English](./guide-usecases.en.md)

「やりたいこと」から引くレシピ集です。フォントの基礎用語
（グリフ・メトリクス・サブセット）が分からない場合は先に
[初心者ガイド](./guide-beginner.ja.md) をどうぞ。API の厳密な仕様は
[仕様書](./spec.ja.md)、内部の仕組みは [上級者ガイド](./guide-advanced.ja.md) にあります。

## 0. 準備 — 3 つの使い方

**Node.js（npm）**

```sh
npm install lgfx-font-tool
```

```js
import { loadFont, drawString } from 'lgfx-font-tool';
```

**ブラウザ（CDN、ビルド不要）**

```html
<script type="module">
  import { loadFont, drawString }
    from 'https://cdn.jsdelivr.net/npm/lgfx-font-tool/dist/lgfx-font-tool.min.js';
</script>
```

**リポジトリを clone（開発・全フォント同梱）**

```sh
git clone https://github.com/tanakamasayuki/LGFXFontToolJs
cd LGFXFontToolJs && npm install && npm run serve
```

`src/index.js` が唯一の入口です。clone には 186 フォント全データが
含まれます（npm / CDN は軽量 70 本を同梱し、残りは初回に自動取得）。

コードを書かずに済ませたい場合は Web アプリもあります:
[Viewer](https://tanakamasayuki.github.io/LGFXFontToolJs/viewer.html)（内蔵フォントの閲覧）、
[Generator](https://tanakamasayuki.github.io/LGFXFontToolJs/generator.html)（新規作成）、
[Converter](https://tanakamasayuki.github.io/LGFXFontToolJs/converter.html)（形式変換）、
[Inspector](https://tanakamasayuki.github.io/LGFXFontToolJs/inspector.html)（棚卸し・被覆率・サイズ比較）。
以下の §1（選定）は Inspector、§5（変換）は Converter が同じことを画面で行います。

## 1. 内蔵フォントから合うものを選ぶ

LovyanGFX v1.2.26 の内蔵フォント 186 本のカタログが入っています。
データを読む前に、メタ情報だけで絞り込めます。

```js
import { fontCatalog, loadFont, inspect, coverage } from 'lgfx-font-tool';

// 16px 前後でかなが入っているものを探す（カタログのタグは 'ascii' / 'kana' の粗い分類）
const hits = fontCatalog.filter(
  (e) => e.lineHeight >= 14 && e.lineHeight <= 18 && e.coverage.includes('kana'),
);
console.log(hits.map((e) => `${e.name} (${e.glyphCount}字 ${e.dataBytes}B)`));

// 実際に読み込むと、名前付き文字集合ごとの詳細な被覆率まで分かる
const font = await loadFont('lgfxJapanGothic_16');
console.log(inspect(font));
// { glyphCount, ranges, metrics, extremes, bpp,
//   coverage: { ascii: 1, hiragana: 1, hanJa1: 0.999, hanCn1: 0.502, ... } }

// 表示したい文言が全部入っているか
const c = coverage(font, '温度23.5℃ 湿度60%');
console.log(c);  // { total: 12, present: 12, missing: [] }
```

`coverage` の第 2 引数には文字列のほか、名前付き文字集合の id
（`'ascii'`, `'hiragana'`, `'hanJa1'`（JIS 第 1 水準）など。全一覧は
`ALL_SET_IDS`）も渡せます。

## 2. デバイスの表示を PC / ブラウザで再現する

描画エンジンは LovyanGFX の `drawString` の忠実な移植で、倍率・基準点
（datum）・形式ごとの描画の癖まで含めて**実機とピクセル単位で一致**します
（1,860 ケースの完全一致テストで担保。[oracle/](../oracle/README.ja.md)）。
レイアウトの確認・スクリーンショット生成・UI プレビューに使えます。

```js
import { loadFont, createBitmap, drawString, textWidth, fontHeight } from 'lgfx-font-tool';

const font = await loadFont('Font4');
const screen = createBitmap(320, 240, 8);

// LovyanGFX と同じ感覚: setTextDatum + setTextSize + drawString
drawString(screen, font, '12:34', 160, 120, {
  datum: 'middle-center',   // LGFX の textdatum_t と同じ 12 種
  sizeX: 2,
  sizeY: 2,                 // 実機同様 16.16 固定小数点に切り捨てて適用
});
```

ブラウザなら canvas にそのまま写せます:

```js
const img = ctx.createImageData(screen.width, screen.height);
for (let y = 0; y < screen.height; y++) {
  for (let x = 0; x < screen.width; x++) {
    const v = getPixel(screen, x, y);        // 1bpp フォントでも 255 が入る
    const i = (y * screen.width + x) * 4;
    img.data[i + 3] = v;                     // 濃さをアルファに
  }
}
ctx.putImageData(img, 0, 0);
```

計測だけなら描かずにできます: `textWidth(font, text, style)` /
`fontHeight(font, style)` / `measureText(...)`。

## 3. 文言カバレッジを CI で検査する（tofu の出荷を防ぐ）

サブセット化したフォントに文言の文字が全部入っているかは、
`coverage` をテストに書いておけば機械的に検査できます。

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode, coverage } from 'lgfx-font-tool';
import { readFile } from 'node:fs/promises';
import { MESSAGES } from '../src/messages.js';   // アプリの全文言

test('UI 文言はフォントに収録済み', async () => {
  const font = decode(await readFile('assets/ui-font.u8g2'), { format: 'u8g2' });
  const c = coverage(font, Object.values(MESSAGES).join(''));
  assert.deepEqual(
    c.missing.map((cp) => String.fromCodePoint(cp)),
    [],
    '未収録の文字があります',
  );
});
```

文言を追加した PR で足りない文字があれば、その場で CI が落ちます。

## 4. TTF から新しいフォントを作る

### コードなしで: Web Generator

[Generator](https://tanakamasayuki.github.io/LGFXFontToolJs/generator.html) で、
手元の TTF/OTF/WOFF か Google Fonts の再配布可能な書体を選び、サイズと
文字集合（日本語 UI 一式・時計用など のテンプレートあり）を指定して、
u8g2 / GFXfont の `.h` などとしてダウンロードできます。生成前のライブ
プレビューで書体とサイズを確認でき、書体に無かった文字は「どの文字が
無いか」を名指しで提示して、別書体（Noto 系）から 1 クリックで補完
できます。ライセンスの帰属表示も（補完に使った書体の分まで）出力
ファイルに自動で入ります。

### コードで: `generateFont`（ブラウザ専用）

ラスタライズにブラウザの canvas を使うため、この機能だけは**ブラウザ専用**
です（Node で呼ぶと `CapabilityError`）。

```js
import { generateFont, resolveCharset, encodeCSource } from 'lgfx-font-tool';

const { font, missing, filled } = await generateFont({
  source: ttfArrayBuffer,          // または URL。登録済み CSS ファミリ名なら family: '...'
  px: 24,                          // 文字インクの高さ
  codepoints: resolveCharset({
    sets: ['ascii', 'hiragana', 'katakana', 'jaPunct', 'hanJa1'],
    customText: '℃㎡',            // 個別に足したい文字
  }),
  threshold: 128,                  // 1bpp 化のしきい値
  fallbacks: [                     // 主書体に無い文字をこの順で補完（省略可）
    { source: symbolsTtfArrayBuffer },
    { family: 'MyRegisteredFallback' },
  ],
});
console.log('どの補完が何を埋めたか:', filled);
console.log('どこにも無かった文字:', missing.map((cp) => String.fromCodePoint(cp)));
```

補完を別の呼び出しに分ける場合は、主生成が返した `sizing` を渡せます。

```js
const primary = await generateFont({ source: ttfArrayBuffer, px: 24, codepoints });
const filler = await generateFont({
  family: 'MyRegisteredFallback',
  px: 24,
  codepoints: primary.missing,
  sizing: primary.sizing,
});
```

### 補完はどこにある？ — 役割分担

「この書体に無い文字」への対処は、意図的に 3 つの層に分かれています。

1. **生成時の補完はライブラリ機能**（上の `fallbacks`）。不足分だけを
   主書体と同じ `cssPx`・閾値でラスタライズし、ベースライン整列で重ね、
   全グリフから行ボックスを再計算する——この
   「正解手順」は 1 つしかなく、手で書くと px の意味やメトリクスの扱いを
   間違えやすいので、ライブラリが面倒を見ます。
2. **どの書体で埋めるかの選定と入手はアプリの責務**。Web Generator は
   再配布可能な Noto 系の候補を提案しますが、勝手には埋めません——
   欠落を名指しし、利用者が 1 クリックで適用します（ライブラリ本体は
   ネットワークに触れない、という分担でもあります）。
3. **既存ビットマップフォント同士の補完はレシピ**（§7）。
   `coverage → subset → merge` の 3 手で書けるうえ、ライブラリが自動化
   すべきでない理由があります——次節の末尾を参照。

## 5. フォント形式を変換する

読み込みは `decode` 一発です。マジックナンバーを持つ形式
（GFXfont バイナリ / FONTX2 / BFF / BDF / LovyanGFX 内部形式）は自動判定され、
u8g2 も構造から推定されます。ヘッダの無い生データ（GLCD など）だけは
`format` とパラメータの明示が必要です。

```js
import { decode, canEncode, encode } from 'lgfx-font-tool';

const font = decode(bytes);                    // 形式は自動判定
// const font = decode(bdfText);               // BDF / C ソースはテキストのまま渡せる

// 書き出せるか先に確認（切り詰めや黙った劣化はしない方針）
const check = canEncode(font, 'u8g2');
if (!check.ok) console.log(check.issues);      // 安定コード付きの制約違反一覧

const out = encode(font, { format: 'u8g2' });
// 違反グリフを落として続行したい場合:
// encode(font, { format: 'u8g2', dropInvalid: true })
```

どの形式に出すべきかの目安:

| 出し先 | 形式 | 備考 |
| --- | --- | --- |
| LovyanGFX / u8g2 | `u8g2` | RLE 圧縮で最小になることが多い |
| Adafruit GFX 系 | `gfx` | 定番の `.h`。飛び飛びの文字集合は苦手 |
| TFT_eSPI Smooth Font / Processing | `vlw` | 8bpp アンチエイリアス |
| LVGL | `bff` | lv_font_conv の bin 形式 |
| 古い日本語機器・FONTX 資産 | `fontx2` | Shift_JIS 収録範囲のみ |
| 他ツールへの受け渡し・目視編集 | `bdf` | テキスト形式 |

サイズを事前に比較するには `estimateSizes(font)`（全エンコーダの正確な
バイト数を返す）が使えます。

## 6. Arduino / PlatformIO 用の C ソースを出す

`encodeCSource` はそのまま `#include` できる `.h` を生成します。
元フォントのライセンス・著作権表示は先頭コメントに自動で入ります。

```js
import { loadFont, subset, encodeCSource } from 'lgfx-font-tool';

const base = await loadFont('lgfxJapanGothic_24');
const clock = subset(base, '0123456789:./ ');
const header = encodeCSource(clock, { format: 'u8g2', symbolName: 'clockFont' });
// → clockFont.h として保存
```

スケッチ側（LovyanGFX）:

```cpp
#include "clockFont.h"   // static const lgfx::U8g2font clockFont(...) が定義される
display.setFont(&clockFont);
display.drawString("12:34", 0, 0);
```

`format: 'gfx'` にすると Adafruit GFX 互換の `GFXfont` 構造体で出力します
（`display.setFont(&clockFont);` は同じ）。

## 7. 文字を減らす・足す

**減らす（サブセット化）** — 非破壊で、指定した文字だけの新しいフォントを
返します。

```js
import { subset, estimateSize } from 'lgfx-font-tool';

const small = subset(font, 'ABC0123456789:.');           // 文字列で指定
console.log(estimateSize(small, 'u8g2').bytes);           // 例: 4,425字163KB → 15字243B
```

**足す（マージ・補完）** — `merge(base, overlay)` は base に overlay の
グリフを重ねます。base に無い文字だけが追加され、メトリクスは base のまま
です。「本命の書体に無い文字を別の書体から借りる」用途に使います。

```js
import { merge, coverage } from 'lgfx-font-tool';

const missing = coverage(mainFont, requiredText).missing;
const filler = subset(fallbackFont, missing);   // 補完元から必要分だけ
const complete = merge(mainFont, filler);
// 行ボックスの高さが合わないときは complete.meta.issues に warning が載る
```

この「既存フォント同士の補完」をライブラリの 1 関数に自動化していないのは
意図的です。16px のゴシックに 12px の明朝を重ねても `merge` 自体は成功して
しまう——サイズや雰囲気が合うかは目で見て決めることで、データからは判定
できません。ライブラリは部品（`coverage` / `subset` / `merge`）と警告
（行ボックス不一致の `meta.issues`）を提供し、判断は利用者に残します。
一方、**TTF から生成するとき**は主書体の `cssPx` を継承して作り直せるので
正解手順が 1 つに決まり、そちらは `generateFont` の `fallbacks` が面倒を
見ます（§4）。

## 8. 固定文言をビットマップに焼き込む

「起動ロゴの 1 行」のようにフォントごと載せる必要がないものは、
描画結果のビットマップだけを焼き込むのが最小です。

```sh
node examples/node-render.js lgfxJapanGothic_16 "こんにちは"
```

[examples/node-render.js](../examples/node-render.js) の中身は
§0 の 10 行とほぼ同じです。`createBitmap(w, h, 1)` に描いた結果の
`bmp.data`（1bpp、MSB first、行ごとにバイト詰め）をそのまま C 配列に
すれば、多くの LCD/OLED ライブラリの `drawBitmap` に渡せます。

## 9. FONTX2 / Shift_JIS 資産を取り込む

日本の古い機器や自作機界隈の FONTX2 フォントも読み書きできます。
Shift_JIS ↔ Unicode の変換は内蔵です（依存ライブラリなし）。

```js
import { decode, encode, unicodeToSjis } from 'lgfx-font-tool';

const font = decode(fontxBytes);               // 'FONTX2' マジックで自動判定
const back = encode(font, { format: 'fontx2', dropInvalid: true });
                                               // Shift_JIS に無い文字は入らない
unicodeToSjis('あ'.codePointAt(0));            // 0x82A0
```

## 10. 中立モデルを保存・受け渡しする

変換途中のフォントを JSON で保存できます（形式は安定・バージョン付き）。

```js
import { serializeFont, deserializeFont } from 'lgfx-font-tool';

const json = JSON.stringify(serializeFont(font));   // 保存・送信
const font2 = deserializeFont(JSON.parse(json));    // 完全に復元
```

エディタの作業ファイル、Web Worker への受け渡し、差分レビューなどに
使えます。

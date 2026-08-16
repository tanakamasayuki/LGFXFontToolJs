// @ts-check
/**
 * §13.3 実物一致テストの入力を生成する。
 * 本ライブラリのエンコーダで作ったフォントバイナリを fixture に置き、
 * oracle_encoded ハーネス（実物の LovyanGFX）に読ませて描かせる。
 *
 * ファイル名は oracle_encoded.ino の kCases と一致させること。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFont } from '../src/fonts/loader.js';
import { encodeU8g2 } from '../src/format/u8g2.js';
import { encodeGfx } from '../src/format/gfxfont.js';
import { encodeVlw } from '../src/format/vlw.js';
import { encodeBff } from '../src/format/bff.js';
import { subset } from '../src/model/subset.js';
import { createFont } from '../src/model/font.js';
import { createBitmap, getPixel } from '../src/model/bitmap.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'test', 'fixtures', 'oracle-encoded', 'fonts');
mkdirSync(outDir, { recursive: true });

/** @param {string} name @param {Uint8Array} bytes */
const put = (name, bytes) => {
  writeFileSync(join(outDir, name), bytes);
  console.log(`${name}: ${bytes.length} bytes`);
};

// u8g2: フル CJK 再エンコード（複数ブロックのジャンプ表を通す）
put('gothic16-full.u8g2', encodeU8g2(await loadFont('lgfxJapanGothic_16')));
// u8g2: サブセット（UC4 の減）
put(
  'gothic16-subset.u8g2',
  encodeU8g2(subset(await loadFont('lgfxJapanGothic_16'), 'こんにちは0123456789 Ag!~')),
);
// u8g2: 75px の大型フォント（高さではなく送り幅が制約であることの実地確認）
put('font8.u8g2', encodeU8g2(await loadFont('Font8')));
// GFX: 単一範囲（rangeCount 0 の素の Adafruit 形）
put('freesans12-re.gfx1', encodeGfx(await loadFont('FreeSans12pt7b')));
// GFX: 飛び飛びの CJK 集合（EncodeRange の線形走査を LovyanGFX に回させる）
put('gothic12-cjk.gfx1', encodeGfx(await loadFont('lgfxJapanGothic_12')));

// VLW: 空白グリフ「あり」（LGFX は描画時に無視して spaceWidth で送る癖の検証）
put(
  'gothic16-sub.vlw',
  encodeVlw(subset(await loadFont('lgfxJapanGothic_16'), 'Ag9 !~日本語あア漢')),
);
// VLW: 空白グリフ「なし」（spaceWidth 合成の検証）
put(
  'gothic16-nospace.vlw',
  encodeVlw(subset(await loadFont('lgfxJapanGothic_16'), 'Ag9!~日本語あア漢')),
);

// BFF: 1bpp 経路（cmap format1 / loca / glyf 生ビット）
put('gothic16-sub.bff', encodeBff(subset(await loadFont('lgfxJapanGothic_16'), 'Ag9 !~日本語あア漢')));

// BFF: 4bpp 経路 + 未収録文字（gid 0 代替グリフ）の検証。
// 収録は 'Ag9' のみで、被覆値 128 の中間アルファに置き換える
{
  const src = subset(await loadFont('lgfxJapanGothic_16'), 'Ag9');
  const glyphs = new Map();
  for (const [cp, g] of src.glyphs) {
    const bmp = createBitmap(g.bitmap.width, g.bitmap.height, 8);
    for (let y = 0; y < bmp.height; y++) {
      for (let x = 0; x < bmp.width; x++) {
        if (getPixel(g.bitmap, x, y)) bmp.data[y * bmp.width + x] = 128;
      }
    }
    glyphs.set(cp, { ...g, bitmap: bmp });
  }
  const gray = createFont({
    familyName: 'gray',
    ascent: src.ascent,
    descent: src.descent,
    lineHeight: src.lineHeight,
    glyphs,
    meta: { drawProfile: 'vlw', fallback: src.meta.fallback, issues: [] },
  });
  put('gray4bpp.bff', encodeBff(gray));
}

console.log('done');

// @ts-check
/**
 * Node.js から使う最小例（UC7: 固定文字列の焼き込み などの入口）。
 *
 *   node examples/node-render.js [フォント名] [テキスト]
 *
 * 1bpp で描画してテキストアートで表示する。バイナリとして保存すれば
 * そのままデバイスに送れるビットマップになる。
 */
import {
  loadFont,
  createBitmap,
  drawString,
  textWidth,
  fontHeight,
  bitmapToText,
} from '../src/index.js';

const fontName = process.argv[2] ?? 'lgfxJapanGothic_16';
const text = process.argv[3] ?? 'こんにちは';

const font = await loadFont(fontName);
const w = textWidth(font, text);
const h = fontHeight(font);
const bmp = createBitmap(w, h, 1);
drawString(bmp, font, text, 0, 0);

console.log(`${fontName} "${text}" -> ${w}x${h}px`);
console.log(bitmapToText(bmp));

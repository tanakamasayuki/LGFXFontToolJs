// @ts-check
/**
 * dist/ の煙試験（CI）。バンドルが Node で動き、同梱データの解決と
 * デコード・描画が通ることを確認する。ネットワークには出ない
 * （同梱フォントのみ使う）。
 */
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const mod = await import(pathToFileURL(join(root, 'dist', 'lgfx-font-tool.js')).href);

const { loadFont, createBitmap, drawString, textWidth, fontHeight, fontCatalog, VERSION } = mod;

if (fontCatalog.length !== 186) throw new Error(`catalog: ${fontCatalog.length}`);

// 同梱フォント（軽量 70 本側）から 1 本
const font = await loadFont('FreeSans9pt7b');
const text = 'Dist OK 123';
const bmp = createBitmap(textWidth(font, text) + 4, fontHeight(font) + 4, 1);
const r = drawString(bmp, font, text, 2, 2);
if (!(r.advance > 0)) throw new Error('drawString advance');
let lit = 0;
for (const b of bmp.data) lit += b ? 1 : 0;
if (lit < 5) throw new Error('no pixels drawn');

console.log(`dist smoke ok (v${VERSION}, ${fontCatalog.length} fonts in catalog)`);

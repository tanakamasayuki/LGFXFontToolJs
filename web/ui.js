// @ts-check
/**
 * Web アプリ共通の小物（DOM ヘルパ・描画・ダウンロード・ファイル読込）。
 * ライブラリ本体には置かない — I/O と DOM はアプリ側の責務（仕様 §2.3）。
 */
import {
  createBitmap,
  drawString,
  textWidth,
  fontHeight,
  getPixel,
  decode,
  decodeCSource,
  detect,
} from './lgfx-font-tool.js';

/** @typedef {import('../src/model/font.js').Font} Font */

/** @param {string} id */
export function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

/** @param {() => void} fn @param {number} ms */
export function debounce(fn, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

/** @param {BlobPart} content @param {string} name @param {string} type */
export function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * ライブラリの描画エンジンで canvas に描く（= 実機と同じ規則）。
 * @param {HTMLCanvasElement} canvas
 * @param {Font} font
 * @param {string} text
 * @param {number} zoom
 */
export function drawFontTo(canvas, font, text, zoom) {
  const w = Math.max(8, Math.min(4000, textWidth(font, text) + 8));
  const h = Math.max(8, fontHeight(font) + 8);
  const z = Math.max(1, Math.min(zoom, Math.floor(8192 / w) || 1));
  const glyphBpp = font.glyphs.values().next().value?.bitmap.bpp ?? 1;
  const bmp = createBitmap(w, h, glyphBpp === 8 ? 8 : 1);
  drawString(bmp, font, text, 4, 4);
  canvas.width = w * z;
  canvas.height = h * z;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle =
    getComputedStyle(document.documentElement).getPropertyValue('--preview-bg').trim() || '#11191d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e8f0ff';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const value = getPixel(bmp, x, y);
      if (!value) continue;
      ctx.globalAlpha = bmp.bpp === 8 ? value / 255 : 1;
      ctx.fillRect(x * z, y * z, z, z);
    }
  }
  ctx.globalAlpha = 1;
}

/** 拡張子からの形式ヒント。VLW はマジックを持たず detect できないため必須 */
const EXT_HINTS = /** @type {Record<string, string>} */ ({
  vlw: 'vlw',
  u8g2: 'u8g2',
  gfx1: 'gfx',
  bff: 'bff',
  fnt: 'fontx2',
  ftx: 'fontx2',
  bdf: 'bdf',
});

/**
 * ファイルのバイト列を判定してデコードする。バイナリのマジックを先に見て、
 * テキスト形式（BDF / C ソース）は UTF-8 として読み直して判定する。
 * マジックの無い形式（VLW 等）は拡張子ヒントで補う。
 * C ソースは複数フォントを含みうるので常に配列で返す。
 * @param {Uint8Array} bytes
 * @param {string} fileName
 * @param {string} [format] - 省略時は自動判定（判定できなければ throw）
 * @returns {{detected: {format: string, confidence: number}[],
 *            format: string, fonts: {label: string, font: Font}[]}}
 */
export function decodeInput(bytes, fileName, format) {
  let detected = detect(bytes);
  /** @type {string | null} */
  let text = null;
  const textExt = /\.(h|c|cc|cpp|hpp|inc|txt|bdf)$/i.test(fileName);
  if (textExt || detected.length === 0) {
    try {
      const s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const dText = detect(s);
      if (dText.length > 0) {
        text = s;
        detected = dText;
      }
    } catch {
      // UTF-8 として読めない = バイナリ。detect(bytes) の結果を使う
    }
  }
  const extHint = EXT_HINTS[(fileName.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase()];
  // マジック一致（高確度）は拡張子より信じる。低確度の推定だけなら拡張子を優先
  const guessed =
    detected[0] && detected[0].confidence >= 0.9 ? detected[0].format : (extHint ?? detected[0]?.format);
  const fmt = format || guessed;
  if (!fmt) throw new Error('cannot detect format');

  if (fmt === 'csource') {
    const src = text ?? new TextDecoder().decode(bytes);
    const fonts = decodeCSource(src);
    if (fonts.length === 0) throw new Error('no fonts found in C source');
    return { detected, format: fmt, fonts: fonts.map((f) => ({ label: f.name, font: f.font })) };
  }
  if (fmt === 'bdf') {
    const src = text ?? new TextDecoder().decode(bytes);
    const font = decode(src, { format: 'bdf', familyName: fileName.replace(/\.[^.]+$/, '') });
    return { detected, format: fmt, fonts: [{ label: font.familyName, font }] };
  }
  const font = decode(bytes, { format: fmt, familyName: fileName.replace(/\.[^.]+$/, '') });
  return { detected, format: fmt, fonts: [{ label: font.familyName, font }] };
}

// @ts-check
/**
 * Viewer 最小版（仕様 §14、Phase 1）。
 * 内蔵フォント 186 本の一覧・ピクセル一致プレビュー・メトリクス表示。
 */
import {
  fontCatalog,
  loadFont,
  createBitmap,
  getPixel,
  drawString,
  textWidth,
  fontHeight,
  DATUM,
} from './lgfx-font-tool.js';

/** @param {string} id */
function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

const searchEl = /** @type {HTMLInputElement} */ ($('search'));
const listEl = $('font-list');
const textEl = /** @type {HTMLInputElement} */ ($('text'));
const sizeXEl = /** @type {HTMLInputElement} */ ($('size-x'));
const sizeYEl = /** @type {HTMLInputElement} */ ($('size-y'));
const datumEl = /** @type {HTMLSelectElement} */ ($('datum'));
const zoomEl = /** @type {HTMLInputElement} */ ($('zoom'));
const gridEl = /** @type {HTMLInputElement} */ ($('grid'));
const canvasEl = /** @type {HTMLCanvasElement} */ ($('preview'));
const infoEl = $('info');
const licenseEl = $('license');

let currentName = fontCatalog[0]?.name ?? '';

for (const name of Object.keys(DATUM)) {
  const opt = document.createElement('option');
  opt.value = name;
  opt.textContent = name;
  datumEl.appendChild(opt);
}
datumEl.value = 'top-left';

function renderList() {
  const q = searchEl.value.trim().toLowerCase();
  listEl.textContent = '';
  for (const e of fontCatalog) {
    if (q && !e.name.toLowerCase().includes(q) && !e.format.includes(q)) continue;
    const li = document.createElement('li');
    li.className = e.name === currentName ? 'selected' : '';
    const kb = (e.dataBytes / 1024).toFixed(e.dataBytes >= 1024 * 100 ? 0 : 1);
    li.innerHTML = `<span class="name"></span><span class="meta">${e.format} · ${e.lineHeight}px · ${kb}KB</span>`;
    const nameSpan = li.querySelector('.name');
    if (nameSpan) nameSpan.textContent = e.name;
    li.addEventListener('click', () => {
      currentName = e.name;
      renderList();
      void renderPreview();
    });
    listEl.appendChild(li);
  }
}

async function renderPreview() {
  const entry = fontCatalog.find((e) => e.name === currentName);
  if (!entry) return;
  const font = await loadFont(entry.name);
  if (entry.name !== currentName) return; // 選択が変わっていたら破棄

  const text = textEl.value;
  const style = {
    sizeX: Number(sizeXEl.value) || 1,
    sizeY: Number(sizeYEl.value) || 1,
    datum: datumEl.value,
  };
  const tw = textWidth(font, text, style);
  const fh = fontHeight(font, style);
  const margin = 8;
  const w = Math.max(8, Math.min(2000, tw + margin * 2));
  const h = Math.max(8, Math.min(1000, fh + margin * 2));

  const bmp = createBitmap(w, h, 1);
  // datum に応じて基準点を選ぶ（プレビューは常に収まる位置に描く）
  const d = /** @type {number} */ (DATUM[/** @type {keyof typeof DATUM} */ (datumEl.value)]);
  const x = d & 1 ? w >> 1 : d & 2 ? w - margin : margin;
  const y = d & 4 ? h >> 1 : d & 8 ? h - margin : d & 16 ? h - margin - Math.ceil(font.descent * style.sizeY) : margin;
  const result = drawString(bmp, font, text, x, y, style);

  const zoom = Number(zoomEl.value) || 1;
  canvasEl.width = w * zoom;
  canvasEl.height = h * zoom;
  const ctx = canvasEl.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#10151c';
  ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
  ctx.fillStyle = '#e8f0ff';
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      if (getPixel(bmp, xx, yy)) ctx.fillRect(xx * zoom, yy * zoom, zoom, zoom);
    }
  }
  if (gridEl.checked && zoom >= 4) {
    ctx.strokeStyle = 'rgba(120,140,170,0.25)';
    ctx.lineWidth = 1;
    for (let xx = 0; xx <= w; xx++) {
      ctx.beginPath();
      ctx.moveTo(xx * zoom + 0.5, 0);
      ctx.lineTo(xx * zoom + 0.5, h * zoom);
      ctx.stroke();
    }
    for (let yy = 0; yy <= h; yy++) {
      ctx.beginPath();
      ctx.moveTo(0, yy * zoom + 0.5);
      ctx.lineTo(w * zoom, yy * zoom + 0.5);
      ctx.stroke();
    }
  }

  infoEl.textContent = '';
  const rows = [
    ['textWidth', `${tw}px`],
    ['fontHeight', `${fh}px`],
    ['advance', `${result.advance}px`],
    ['ascent / descent', `${font.ascent} / ${font.descent}`],
    ['lineHeight', `${font.lineHeight}`],
    ['グリフ数', `${entry.glyphCount}`],
    ['データ', `${(entry.dataBytes / 1024).toFixed(1)} KB (${entry.format})`],
    ['収録', entry.coverage.join(', ') || '—'],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    infoEl.append(dt, dd);
  }
  licenseEl.textContent = `${entry.license} — ${entry.copyright}`;
}

searchEl.addEventListener('input', renderList);
for (const el of [textEl, sizeXEl, sizeYEl, datumEl, zoomEl, gridEl]) {
  el.addEventListener('input', () => void renderPreview());
}

renderList();
void renderPreview();

// @ts-check
/**
 * Viewer 最小版（仕様 §14、Phase 1）。
 * 内蔵フォント 186 本の一覧・ピクセル一致プレビュー・メトリクス表示。
 * 文言はすべて i18n 辞書経由（web/locales/）。
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
import {
  initI18n,
  setLocale,
  currentLocale,
  applyTranslations,
  t,
  SUPPORTED_LOCALES,
} from './i18n.js';

/** @param {string} id */
function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

const langEl = /** @type {HTMLSelectElement} */ ($('lang'));
const searchEl = /** @type {HTMLInputElement} */ ($('search'));
const listEl = $('font-list');
const textEl = /** @type {HTMLInputElement} */ ($('text'));
const sizeXEl = /** @type {HTMLInputElement} */ ($('size-x'));
const sizeYEl = /** @type {HTMLInputElement} */ ($('size-y'));
const datumEl = /** @type {HTMLSelectElement} */ ($('datum'));
const zoomEl = /** @type {HTMLInputElement} */ ($('zoom'));
const zoomValueEl = /** @type {HTMLOutputElement} */ ($('zoom-value'));
const gridEl = /** @type {HTMLInputElement} */ ($('grid'));
const canvasEl = /** @type {HTMLCanvasElement} */ ($('preview'));
const infoEl = $('info');
const licenseEl = $('license');

const fontNameCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const sortedFontCatalog = [...fontCatalog].sort(
  (a, b) => fontNameCollator.compare(a.name, b.name) || a.name.localeCompare(b.name),
);

let currentName = sortedFontCatalog[0]?.name ?? '';

for (const name of Object.keys(DATUM)) {
  const opt = document.createElement('option');
  opt.value = name;
  opt.textContent = name; // datum 名は API 上の識別子なので翻訳しない
  datumEl.appendChild(opt);
}
datumEl.value = 'top-left';

for (const loc of SUPPORTED_LOCALES) {
  const opt = document.createElement('option');
  opt.value = loc.id;
  opt.textContent = loc.label;
  langEl.appendChild(opt);
}

/** 言語依存の静的文言をまとめて更新する */
function applyLanguage() {
  document.title = t('app.docTitle');
  applyTranslations();
  // data-i18n-placeholder はパラメータを持てないので検索欄は上書きする
  searchEl.placeholder = t('search.placeholder', { count: fontCatalog.length });
  langEl.value = currentLocale();
}

function renderList() {
  const q = searchEl.value.trim().toLowerCase();
  listEl.textContent = '';
  for (const e of sortedFontCatalog) {
    if (q && !e.name.toLowerCase().includes(q) && !e.format.includes(q)) continue;
    const li = document.createElement('li');
    li.className = e.name === currentName ? 'selected' : '';
    const kb = (e.dataBytes / 1024).toFixed(e.dataBytes >= 1024 * 100 ? 0 : 1);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = e.name;
    const metaSpan = document.createElement('span');
    metaSpan.className = 'meta';
    metaSpan.textContent = t('list.meta', { format: e.format, height: e.lineHeight, kb });
    li.append(nameSpan, metaSpan);
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
  // datum に応じて、常に収まる位置に基準点を置く
  const d = /** @type {number} */ (DATUM[/** @type {keyof typeof DATUM} */ (datumEl.value)]);
  const x = d & 1 ? w >> 1 : d & 2 ? w - margin : margin;
  const y =
    d & 4 ? h >> 1 : d & 8 ? h - margin : d & 16 ? h - margin - Math.ceil(font.descent * style.sizeY) : margin;
  const result = drawString(bmp, font, text, x, y, style);

  const zoom = Number(zoomEl.value) || 1;
  canvasEl.width = w * zoom;
  canvasEl.height = h * zoom;
  const ctx = canvasEl.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle =
    getComputedStyle(document.documentElement).getPropertyValue('--preview-bg').trim() || '#202a36';
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
    [t('info.textWidth'), `${tw}px`],
    [t('info.fontHeight'), `${fh}px`],
    [t('info.advance'), `${result.advance}px`],
    [t('info.ascentDescent'), `${font.ascent} / ${font.descent}`],
    [t('info.lineHeight'), `${font.lineHeight}`],
    [t('info.glyphCount'), `${entry.glyphCount}`],
    [t('info.data'), `${(entry.dataBytes / 1024).toFixed(1)} KB (${entry.format})`],
    [t('info.coverage'), entry.coverage.join(', ') || '—'],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    infoEl.append(dt, dd);
  }
  licenseEl.textContent = t('license.line', {
    license: entry.license,
    copyright: entry.copyright,
  });
}

function updateZoomValue() {
  zoomValueEl.value = `${Number(zoomEl.value) || 1}×`;
}

langEl.addEventListener('input', async () => {
  await setLocale(langEl.value);
  applyLanguage();
  renderList();
  void renderPreview();
});
searchEl.addEventListener('input', renderList);
for (const el of [textEl, sizeXEl, sizeYEl, datumEl, zoomEl, gridEl]) {
  el.addEventListener('input', () => {
    if (el === zoomEl) updateZoomValue();
    void renderPreview();
  });
}

await initI18n();
applyLanguage();
updateZoomValue();
renderList();
void renderPreview();

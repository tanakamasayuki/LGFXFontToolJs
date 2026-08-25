// @ts-check
/**
 * Inspector（仕様 §14、UC2 / UC6）。内蔵フォントまたはファイルを対象に、
 * 棚卸し（inspect）・名前付き集合ごとの被覆率・文言チェック（coverage）・
 * 全形式の正確なサイズ比較（estimateSizes）を表示する。
 */
import {
  fontCatalog,
  loadFont,
  inspect,
  coverage,
  estimateSizes,
  countOf,
} from './lgfx-font-tool.js';
import {
  initI18n,
  setLocale,
  currentLocale,
  applyTranslations,
  t,
  SUPPORTED_LOCALES,
} from './i18n.js';
import { $, debounce, decodeInput } from './ui.js';
import { renderCharmap, copyCharacters } from './charmap.js';

const langEl = /** @type {HTMLSelectElement} */ ($('lang'));
const tabBuiltinEl = /** @type {HTMLButtonElement} */ ($('tab-builtin'));
const tabFileEl = /** @type {HTMLButtonElement} */ ($('tab-file'));
const srcBuiltinEl = $('src-builtin');
const srcFileEl = $('src-file');
const searchEl = /** @type {HTMLInputElement} */ ($('search'));
const builtinListEl = $('builtin-list');
const fileEl = /** @type {HTMLInputElement} */ ($('file'));
const statusEl = $('status');
const inventoryCardEl = $('inventory-card');
const resGlyphsEl = $('res-glyphs');
const resHeightEl = $('res-height');
const resBppEl = $('res-bpp');
const resRangesEl = $('res-ranges');
const extremesEl = $('extremes');
const rangesEl = $('ranges');
const charmapDetailsEl = /** @type {HTMLDetailsElement} */ ($('font-charmap-details'));
const charmapEl = $('font-charmap');
const charmapCopyEl = /** @type {HTMLButtonElement} */ ($('font-charmap-copy'));
const charmapCopyStatusEl = $('font-charmap-copy-status');
const coverageCardEl = $('coverage-card');
const coverageBarsEl = $('coverage-bars');
const checkTextEl = /** @type {HTMLTextAreaElement} */ ($('check-text'));
const checkResultEl = $('check-result');
const checkMissingEl = $('check-missing');
const sizesCardEl = $('sizes-card');
const sizesBodyEl = $('sizes-body');

let currentName = '';
/** @type {import('../src/model/font.js').Font | null} */
let currentFont = null;
let renderSeq = 0;

for (const loc of SUPPORTED_LOCALES) {
  const opt = document.createElement('option');
  opt.value = loc.id;
  opt.textContent = loc.label;
  langEl.appendChild(opt);
}

function applyLanguage() {
  document.title = t('in.docTitle');
  applyTranslations();
  langEl.value = currentLocale();
  searchEl.placeholder = t('gen.searchFonts');
  renderBuiltinList();
  if (currentFont && charmapDetailsEl.open) renderCurrentCharmap();
  if (currentFont) renderAll();
}

/** @param {'builtin' | 'file'} kind */
function setTab(kind) {
  tabBuiltinEl.classList.toggle('on', kind === 'builtin');
  tabFileEl.classList.toggle('on', kind === 'file');
  srcBuiltinEl.hidden = kind !== 'builtin';
  srcFileEl.hidden = kind !== 'file';
}

function renderBuiltinList() {
  const q = searchEl.value.trim().toLowerCase();
  builtinListEl.textContent = '';
  for (const e of fontCatalog) {
    if (q && !e.name.toLowerCase().includes(q) && !e.format.includes(q)) continue;
    const row = document.createElement('div');
    row.className = 'row' + (e.name === currentName ? ' selected' : '');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = e.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    const kb = (e.dataBytes / 1024).toFixed(e.dataBytes >= 1024 * 100 ? 0 : 1);
    meta.textContent = t('list.meta', { format: e.format, height: e.lineHeight, kb });
    row.append(name, meta);
    row.addEventListener('click', async () => {
      currentName = e.name;
      charmapCopyEl.disabled = true;
      charmapEl.textContent = '';
      charmapCopyStatusEl.textContent = '';
      renderBuiltinList();
      statusEl.textContent = t('in.loading');
      try {
        const font = await loadFont(e.name);
        if (currentName !== e.name) return; // 選択が変わっていたら破棄
        currentFont = font;
        statusEl.textContent = '';
        renderAll();
      } catch (err) {
        statusEl.textContent = String(err);
      }
    });
    builtinListEl.appendChild(row);
  }
}

fileEl.addEventListener('input', async () => {
  const f = fileEl.files?.[0];
  if (!f) return;
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const r = decodeInput(bytes, f.name);
    currentName = '';
    currentFont = r.fonts[0].font;
    statusEl.textContent =
      r.fonts.length > 1 ? t('in.firstOfMany', { count: r.fonts.length }) : '';
    renderAll();
  } catch (e) {
    statusEl.textContent = String(e);
  }
});

const hex = (/** @type {number} */ cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

function renderAll() {
  const font = currentFont;
  if (!font) return;
  const seq = ++renderSeq;
  const info = inspect(font);
  charmapCopyEl.disabled = false;

  inventoryCardEl.hidden = false;
  coverageCardEl.hidden = false;
  sizesCardEl.hidden = false;

  resGlyphsEl.textContent = String(info.glyphCount);
  resHeightEl.textContent = `${info.metrics.lineHeight}px (${info.metrics.ascent}/${info.metrics.descent})`;
  resBppEl.textContent = String(info.bpp);
  resRangesEl.textContent = String(info.ranges.length);

  // 極値は API 上の識別子なので翻訳しない（datum と同じ扱い）
  extremesEl.textContent = Object.entries(info.extremes)
    .map(([k, v]) => `${k.padEnd(11)} ${v}`)
    .join('\n');

  const MAX_RANGES = 500;
  const lines = info.ranges
    .slice(0, MAX_RANGES)
    .map((r) => `${hex(r.start)}–${hex(r.end)} (${r.end - r.start + 1})`);
  if (info.ranges.length > MAX_RANGES) {
    lines.push(t('in.rangesMore', { count: info.ranges.length - MAX_RANGES }));
  }
  rangesEl.textContent = lines.join('\n');
  if (charmapDetailsEl.open) renderCurrentCharmap();

  // 被覆率バー（0% の集合も出す — 「入っていない」ことも情報）
  coverageBarsEl.textContent = '';
  for (const [id, ratio] of Object.entries(info.coverage)) {
    const row = document.createElement('div');
    row.className = 'bar-row';
    const label = document.createElement('span');
    label.className = 'bar-label';
    label.textContent = `${t(`set.${id}`)} (${countOf(id)})`;
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = `${Math.round(ratio * 100)}%`;
    bar.appendChild(fill);
    const pct = document.createElement('span');
    pct.className = 'bar-pct';
    pct.textContent = `${(ratio * 100).toFixed(ratio > 0 && ratio < 0.01 ? 1 : 0)}%`;
    row.append(label, bar, pct);
    coverageBarsEl.appendChild(row);
  }

  renderTextCheck();

  // 全形式サイズ比較（実エンコードなので大きいフォントでは少し掛かる）
  sizesBodyEl.textContent = '';
  const computing = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = 3;
  td.textContent = t('in.computing');
  computing.appendChild(td);
  sizesBodyEl.appendChild(computing);
  setTimeout(() => {
    if (seq !== renderSeq) return;
    const sizes = Object.entries(estimateSizes(font)).filter(
      ([, v]) => !v.issues.some((i) => i.code === 'ENCODER_NOT_IMPLEMENTED'),
    );
    sizes.sort((a, b) => (a[1].bytes ?? Infinity) - (b[1].bytes ?? Infinity));
    sizesBodyEl.textContent = '';
    for (const [format, v] of sizes) {
      const tr = document.createElement('tr');
      const tdF = document.createElement('td');
      tdF.textContent = format;
      const tdB = document.createElement('td');
      tdB.textContent = v.bytes === null ? t('in.sizeNull') : `${v.bytes.toLocaleString()} B`;
      const tdI = document.createElement('td');
      const errors = v.issues.filter((i) => i.level === 'error').length;
      const warnings = v.issues.length - errors;
      tdI.textContent =
        v.issues.length === 0 ? '—' : t('in.issueCounts', { errors, warnings });
      tr.append(tdF, tdB, tdI);
      sizesBodyEl.appendChild(tr);
    }
  }, 30);
}

function renderTextCheck() {
  const font = currentFont;
  if (!font) return;
  const text = checkTextEl.value;
  if (!text.trim()) {
    checkResultEl.textContent = '';
    checkMissingEl.hidden = true;
    return;
  }
  const c = coverage(font, text);
  if (c.missing.length === 0) {
    checkResultEl.textContent = t('in.missingNone', { total: c.total });
    checkMissingEl.hidden = true;
  } else {
    checkResultEl.textContent = t('in.missingSome', { count: c.missing.length, total: c.total });
    checkMissingEl.hidden = false;
    checkMissingEl.textContent = c.missing
      .map((cp) => `${hex(cp)} ${String.fromCodePoint(cp)}`)
      .join('\n');
  }
}

function renderCurrentCharmap() {
  renderCharmap(charmapEl, currentFont?.glyphs.keys() ?? [], { emptyText: t('chars.empty') });
}

tabBuiltinEl.addEventListener('click', () => setTab('builtin'));
tabFileEl.addEventListener('click', () => setTab('file'));
searchEl.addEventListener('input', renderBuiltinList);
checkTextEl.addEventListener('input', debounce(renderTextCheck, 200));
charmapDetailsEl.addEventListener('toggle', () => {
  if (charmapDetailsEl.open) renderCurrentCharmap();
});
charmapCopyEl.addEventListener('click', async () => {
  await copyCharacters(currentFont?.glyphs.keys() ?? []);
  charmapCopyStatusEl.textContent = t('chars.copied');
});
langEl.addEventListener('input', async () => {
  await setLocale(langEl.value);
  applyLanguage();
});

await initI18n();
applyLanguage();
setTab('builtin');

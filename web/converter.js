// @ts-check
/**
 * Converter (spec §14, UC5). Drop in a font file or a C source →
 * detect → neutral model → convert to any format and download.
 * "Does not fit" is surfaced straight from canEncode's issues (spec §7.1).
 */
import {
  listFormats,
  canEncode,
  encode,
  encodeCSource,
  estimateSize,
  sanitizeIdent,
} from './lgfx-font-tool.js';
import {
  initI18n,
  setLocale,
  currentLocale,
  applyTranslations,
  t,
  SUPPORTED_LOCALES,
} from './i18n.js';
import { $, download, drawFontTo, decodeInput } from './ui.js';

const langEl = /** @type {HTMLSelectElement} */ ($('lang'));
const fileEl = /** @type {HTMLInputElement} */ ($('file'));
const formatOverrideEl = /** @type {HTMLSelectElement} */ ($('format-override'));
const fontPickRowEl = $('font-pick-row');
const fontPickEl = /** @type {HTMLSelectElement} */ ($('font-pick'));
const detectStatusEl = $('detect-status');
const loadedCardEl = $('loaded-card');
const resFormatEl = $('res-format');
const resGlyphsEl = $('res-glyphs');
const resHeightEl = $('res-height');
const resBppEl = $('res-bpp');
const decodeIssuesEl = $('decode-issues');
const previewTextEl = /** @type {HTMLInputElement} */ ($('preview-text'));
const zoomEl = /** @type {HTMLSelectElement} */ ($('zoom'));
const previewEl = /** @type {HTMLCanvasElement} */ ($('preview'));
const convertCardEl = $('convert-card');
const targetEl = /** @type {HTMLSelectElement} */ ($('target'));
const symbolRowEl = $('symbol-row');
const symbolEl = /** @type {HTMLInputElement} */ ($('symbol'));
const dropInvalidEl = /** @type {HTMLInputElement} */ ($('drop-invalid'));
const noWrapperEl = /** @type {HTMLInputElement} */ ($('no-wrapper'));
const noWrapperRowEl = $('no-wrapper-row');
const dlEl = /** @type {HTMLButtonElement} */ ($('dl'));
const targetBytesEl = $('target-bytes');
const encodeIssuesEl = $('encode-issues');

/** @type {Uint8Array | null} */
let fileBytes = null;
let fileName = '';
/** @type {{label: string, font: import('../src/model/font.js').Font}[]} */
let fonts = [];
let fontIndex = 0;

// Formats that can be selected by hand (headerless raw glcd / fixedbmp are excluded
// because they need extra parameters)
for (const f of listFormats().filter((f) => f.decode && f.id !== 'glcd' && f.id !== 'fixedbmp')) {
  const opt = document.createElement('option');
  opt.value = f.id;
  opt.textContent = f.name;
  formatOverrideEl.appendChild(opt);
}

for (const loc of SUPPORTED_LOCALES) {
  const opt = document.createElement('option');
  opt.value = loc.id;
  opt.textContent = loc.label;
  langEl.appendChild(opt);
}

function applyLanguage() {
  document.title = t('cv.docTitle');
  applyTranslations();
  langEl.value = currentLocale();
  if (fonts.length > 0) renderAll();
}

const currentFont = () => fonts[fontIndex]?.font ?? null;

function reload() {
  if (!fileBytes) return;
  detectStatusEl.textContent = '';
  try {
    const r = decodeInput(fileBytes, fileName, formatOverrideEl.value || undefined);
    fonts = r.fonts;
    fontIndex = Math.min(fontIndex, fonts.length - 1);
    const guesses = r.detected
      .map((d) => `${d.format} (${Math.round(d.confidence * 100)}%)`)
      .join(', ');
    detectStatusEl.textContent = t('cv.detected', { list: guesses || r.format });
    fontPickRowEl.hidden = fonts.length <= 1;
    fontPickEl.textContent = '';
    for (let i = 0; i < fonts.length; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = fonts[i].label || `#${i + 1}`;
      fontPickEl.appendChild(opt);
    }
    fontPickEl.value = String(fontIndex);
    if (!symbolEl.value || symbolEl.value === 'MyFont') {
      symbolEl.value = sanitizeIdent(fonts[fontIndex].label || fileName.replace(/\.[^.]+$/, ''));
    }
    renderAll();
  } catch (e) {
    fonts = [];
    loadedCardEl.hidden = true;
    convertCardEl.hidden = true;
    detectStatusEl.textContent = String(e);
  }
}

function renderAll() {
  const font = currentFont();
  if (!font) return;
  loadedCardEl.hidden = false;
  convertCardEl.hidden = false;

  resFormatEl.textContent = font.meta.sourceFormat ?? '—';
  resGlyphsEl.textContent = String(font.glyphs.size);
  resHeightEl.textContent = `${font.lineHeight}px (${font.ascent}/${font.descent})`;
  const bpp = [...font.glyphs.values()][0]?.bitmap.bpp ?? 1;
  resBppEl.textContent = String(bpp);

  // Defects noticed while decoding (meta.issues) are shown as warnings
  decodeIssuesEl.textContent = '';
  for (const issue of font.meta.issues.slice(0, 20)) {
    const li = document.createElement('li');
    li.className = issue.level;
    li.textContent = `△ ${issue.code} ${JSON.stringify(issue.params ?? {})}`;
    decodeIssuesEl.appendChild(li);
  }

  drawFontTo(previewEl, font, previewTextEl.value || 'Hello 123', Number(zoomEl.value));
  renderTarget();
}

/** Target format id (a csource target maps back to its underlying format) */
const targetFormat = () => targetEl.value.replace(/^csource-/, '');

function renderTarget() {
  const font = currentFont();
  if (!font) return;
  const isCsource = targetEl.value.startsWith('csource-');
  symbolRowEl.hidden = !isCsource;
  // Only the u8g2 header declares a LovyanGFX object that can be left out.
  noWrapperRowEl.hidden = targetEl.value !== 'csource-u8g2';

  const format = targetFormat();
  const check = canEncode(font, format);
  const errors = check.issues.filter((i) => i.level === 'error');
  const canBuild =
    check.ok || (dropInvalidEl.checked && errors.every((i) => i.codepoint !== undefined));

  targetBytesEl.textContent = '';
  if (canBuild) {
    const est = estimateSize(font, format);
    if (est.bytes !== null) {
      targetBytesEl.textContent = t('cv.targetBytes', { bytes: est.bytes.toLocaleString() });
    }
  }

  encodeIssuesEl.textContent = '';
  if (check.issues.length === 0) {
    const li = document.createElement('li');
    li.className = 'ok';
    li.textContent = t('gen.ok');
    encodeIssuesEl.appendChild(li);
  }
  for (const issue of check.issues.slice(0, 50)) {
    const li = document.createElement('li');
    li.className = issue.level;
    const cp =
      issue.codepoint !== undefined
        ? ` U+${issue.codepoint.toString(16).toUpperCase().padStart(4, '0')} "${String.fromCodePoint(issue.codepoint)}"`
        : '';
    li.textContent = `${issue.level === 'error' ? '✕' : '△'} ${issue.code}${cp} ${JSON.stringify(issue.params ?? {})}`;
    encodeIssuesEl.appendChild(li);
  }
  dlEl.disabled = !canBuild;
}

dlEl.addEventListener('click', () => {
  const font = currentFont();
  if (!font) return;
  const format = targetFormat();
  const base = sanitizeIdent(symbolEl.value || fonts[fontIndex].label || 'MyFont');
  if (targetEl.value.startsWith('csource-')) {
    const src = encodeCSource(font, {
      format: /** @type {'u8g2' | 'gfx'} */ (format),
      symbolName: base,
      dropInvalid: dropInvalidEl.checked,
      wrapper: !(format === 'u8g2' && noWrapperEl.checked),
      attribution: {
        typeface: font.familyName || fonts[fontIndex].label,
        license: font.meta.license,
        origin: fileName,
      },
    });
    download(src, `${base}.h`, 'text/plain');
    return;
  }
  const bytes = encode(font, { format, dropInvalid: dropInvalidEl.checked });
  const ext = { u8g2: 'u8g2', gfx: 'gfx1', bdf: 'bdf', vlw: 'vlw', bff: 'bin', fontx2: 'fnt' }[format] ?? 'bin';
  // Uint8Array is a valid BlobPart, but lib.dom types it as ArrayBuffer only, hence the cast
  download(/** @type {any} */ (bytes), `${base}.${ext}`, 'application/octet-stream');
});

fileEl.addEventListener('input', async () => {
  const f = fileEl.files?.[0];
  if (!f) return;
  fileBytes = new Uint8Array(await f.arrayBuffer());
  fileName = f.name;
  fontIndex = 0;
  reload();
});
formatOverrideEl.addEventListener('input', reload);
fontPickEl.addEventListener('input', () => {
  fontIndex = Number(fontPickEl.value) || 0;
  renderAll();
});
for (const el of [previewTextEl, zoomEl]) {
  el.addEventListener('input', () => {
    const font = currentFont();
    if (font) drawFontTo(previewEl, font, previewTextEl.value || 'Hello 123', Number(zoomEl.value));
  });
}
for (const el of [targetEl, dropInvalidEl]) {
  el.addEventListener('input', renderTarget);
}

langEl.addEventListener('input', async () => {
  await setLocale(langEl.value);
  applyLanguage();
});

await initI18n();
applyLanguage();

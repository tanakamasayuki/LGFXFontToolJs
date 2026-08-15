// @ts-check
/**
 * Generator（仕様 §14、UC1）。TTF / OTF / WOFF → u8g2 / GFXfont。
 * fontgen（LGFXScreenBuilder）の後継。文字集合選択・閾値・制約報告・
 * C ソース / バイナリのダウンロードまでを 1 ページで行う。
 */
import {
  generateFont,
  canEncode,
  encode,
  encodeCSource,
  drawString,
  textWidth,
  fontHeight,
  createBitmap,
  getPixel,
  AXES,
  TEMPLATES,
  templateById,
  resolveCharset,
  toggleSet,
  splitBmp,
  countOf,
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
import { FONTS, findFont, loadGoogleFont } from './googlefonts.js';

/** @param {string} id */
function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

const langEl = /** @type {HTMLSelectElement} */ ($('lang'));
const sourceEl = /** @type {HTMLSelectElement} */ ($('source'));
const gfontEl = /** @type {HTMLSelectElement} */ ($('gfont'));
const gfontRowEl = $('gfont-row');
const fileRowEl = $('file-row');
const fileEl = /** @type {HTMLInputElement} */ ($('file'));
const pxEl = /** @type {HTMLInputElement} */ ($('px'));
const weightEl = /** @type {HTMLSelectElement} */ ($('weight'));
const italicEl = /** @type {HTMLInputElement} */ ($('italic'));
const thresholdEl = /** @type {HTMLInputElement} */ ($('threshold'));
const templateEl = /** @type {HTMLSelectElement} */ ($('template'));
const customTextEl = /** @type {HTMLInputElement} */ ($('custom-text'));
const customRangesEl = /** @type {HTMLInputElement} */ ($('custom-ranges'));
const axesEl = $('axes');
const selectedCountEl = $('selected-count');
const formatEl = /** @type {HTMLSelectElement} */ ($('format'));
const symbolEl = /** @type {HTMLInputElement} */ ($('symbol'));
const typefaceEl = /** @type {HTMLInputElement} */ ($('typeface'));
const licenseEl = /** @type {HTMLInputElement} */ ($('license'));
const dropInvalidEl = /** @type {HTMLInputElement} */ ($('drop-invalid'));
const generateEl = /** @type {HTMLButtonElement} */ ($('generate'));
const statusEl = $('status');
const resultEl = $('result');
const previewTextEl = /** @type {HTMLInputElement} */ ($('preview-text'));
const previewEl = /** @type {HTMLCanvasElement} */ ($('preview'));
const infoEl = $('info');
const issuesEl = $('issues');
const dlHEl = /** @type {HTMLButtonElement} */ ($('dl-h'));
const dlBinEl = /** @type {HTMLButtonElement} */ ($('dl-bin'));

/** @type {string[]} 選択中の集合 id */
let sets = ['ascii'];
let sampleText = 'Hello 123';
/** @type {ArrayBuffer | null} */
let fontData = null;
/** Google Fonts の部分読み込みの続き（文字集合を広げた再生成用）
 * @type {{key: string, family: string, loaded: Set<string>} | null} */
let gfState = null;
/** @type {import('../src/model/font.js').Font | null} */
let generated = null;
let generatedMissing = 0;

// --- 言語 --------------------------------------------------------------------

for (const loc of SUPPORTED_LOCALES) {
  const opt = document.createElement('option');
  opt.value = loc.id;
  opt.textContent = loc.label;
  langEl.appendChild(opt);
}

function applyLanguage() {
  document.title = t('gen.docTitle');
  applyTranslations();
  langEl.value = currentLocale();
  renderTemplates();
  renderAxes();
  renderGoogleFonts();
  renderSelectedCount();
}

// --- フォントソース ------------------------------------------------------------

function renderGoogleFonts() {
  const cur = gfontEl.value || 'Noto Sans JP';
  gfontEl.textContent = '';
  for (const script of ['latin', 'display', 'japanese', 'cjk', 'symbol']) {
    const group = document.createElement('optgroup');
    group.label = t(`gscript.${script}`);
    for (const f of FONTS.filter((f) => f.script === script)) {
      const opt = document.createElement('option');
      opt.value = f.family;
      opt.textContent = `${f.family} — ${f.by} (${f.license.id})`;
      group.appendChild(opt);
    }
    gfontEl.appendChild(group);
  }
  gfontEl.value = cur;
}

function syncSourceRows() {
  const google = sourceEl.value === 'google';
  gfontRowEl.hidden = !google;
  fileRowEl.hidden = google;
}

/** 選択中のソースに合わせて帰属表示と識別子を埋める */
function syncAttribution() {
  if (sourceEl.value === 'google') {
    const f = findFont(gfontEl.value);
    if (f) {
      typefaceEl.value = f.family;
      licenseEl.value = f.license.name;
      symbolEl.value = sanitizeIdent(`${f.family}_${pxEl.value}`);
    }
  }
}

sourceEl.addEventListener('input', () => {
  syncSourceRows();
  syncAttribution();
});
gfontEl.addEventListener('input', () => {
  gfState = null;
  syncAttribution();
});

// --- 文字集合 UI --------------------------------------------------------------

function renderTemplates() {
  const cur = templateEl.value;
  templateEl.textContent = '';
  const custom = document.createElement('option');
  custom.value = '';
  custom.textContent = t('gen.templateCustom');
  templateEl.appendChild(custom);
  for (const tpl of TEMPLATES) {
    const opt = document.createElement('option');
    opt.value = tpl.id;
    opt.textContent = t(`tpl.${tpl.id}`);
    templateEl.appendChild(opt);
  }
  templateEl.value = cur;
}

function renderAxes() {
  axesEl.textContent = '';
  for (const axis of AXES) {
    const box = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = t(`axis.${axis.id}`);
    box.appendChild(legend);

    if (axis.kind === 'multi') {
      for (const id of axis.sets ?? []) {
        const label = document.createElement('label');
        label.className = 'set-check';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = sets.includes(id);
        cb.addEventListener('input', () => {
          sets = toggleSet(sets, id, cb.checked);
          templateEl.value = '';
          renderSelectedCount();
        });
        label.append(cb, ` ${t(`set.${id}`)} (${countOf(id)})`);
        box.appendChild(label);
      }
    } else {
      for (const lang of axis.languages ?? []) {
        const row = document.createElement('label');
        row.className = 'tier-row';
        const span = document.createElement('span');
        span.textContent = t(`lang.${lang.id}`);
        const sel = document.createElement('select');
        const none = document.createElement('option');
        none.value = '';
        none.textContent = t('tier.none');
        sel.appendChild(none);
        for (const id of lang.tiers) {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = `${t(`set.${id}`)} (${countOf(id)})`;
          sel.appendChild(opt);
        }
        sel.value = lang.tiers.find((id) => sets.includes(id)) ?? '';
        sel.addEventListener('input', () => {
          for (const id of lang.tiers) sets = toggleSet(sets, id, false);
          if (sel.value) sets = toggleSet(sets, sel.value, true);
          templateEl.value = '';
          renderSelectedCount();
        });
        row.append(span, sel);
        box.appendChild(row);
      }
    }
    axesEl.appendChild(box);
  }
}

function currentCodepoints() {
  return resolveCharset({
    sets,
    customText: customTextEl.value,
    customRanges: customRangesEl.value,
  });
}

function renderSelectedCount() {
  selectedCountEl.textContent = t('gen.selected', { count: currentCodepoints().length });
}

templateEl.addEventListener('input', () => {
  const tpl = templateById(templateEl.value);
  if (!tpl) return;
  sets = [...tpl.sets];
  customTextEl.value = tpl.text;
  sampleText = tpl.sample;
  previewTextEl.value = tpl.sample;
  renderAxes();
  renderSelectedCount();
});
for (const el of [customTextEl, customRangesEl]) {
  el.addEventListener('input', renderSelectedCount);
}

// --- 生成 --------------------------------------------------------------------

fileEl.addEventListener('input', async () => {
  const f = fileEl.files?.[0];
  if (!f) return;
  fontData = await f.arrayBuffer();
  if (!typefaceEl.value) typefaceEl.value = f.name.replace(/\.[^.]+$/, '');
  if (symbolEl.value === 'MyFont24' || !symbolEl.value) {
    symbolEl.value = sanitizeIdent(`${typefaceEl.value}_${pxEl.value}`);
  }
});

generateEl.addEventListener('click', async () => {
  const useGoogle = sourceEl.value === 'google';
  if (!useGoogle && !fontData) {
    statusEl.textContent = t('gen.needFile');
    return;
  }
  const { bmp, dropped } = splitBmp(currentCodepoints());
  generateEl.disabled = true;
  try {
    const weight = Number(weightEl.value);
    const italic = italicEl.checked;
    /** @type {{source?: ArrayBuffer, family?: string}} */
    const src = {};
    if (useGoogle) {
      // 要求文字に掛かるサブセットだけ取得。文字集合を広げた再生成は続きから
      statusEl.textContent = t('gen.fetching');
      const key = `${gfontEl.value}|${weight}|${italic}`;
      const loaded = await loadGoogleFont(gfontEl.value, bmp, {
        weight,
        italic,
        into: gfState?.key === key ? gfState : null,
      });
      gfState = { key, family: loaded.family, loaded: loaded.loaded };
      src.family = loaded.family;
    } else {
      src.source = /** @type {ArrayBuffer} */ (fontData).slice(0);
    }
    const { font, missing } = await generateFont({
      ...src,
      px: Number(pxEl.value) || 24,
      codepoints: bmp,
      style: { weight, italic },
      threshold: Number(thresholdEl.value) || 128,
      familyName: typefaceEl.value,
      onProgress: ({ done, total }) => {
        statusEl.textContent = t('gen.generating', { done, total });
      },
    });
    generated = font;
    generatedMissing = missing.length;
    statusEl.textContent = '';
    if (dropped.length > 0) {
      statusEl.textContent = t('gen.droppedBmp', { count: dropped.length });
    }
    resultEl.hidden = false;
    if (!previewTextEl.value) previewTextEl.value = sampleText;
    renderResult();
  } catch (e) {
    statusEl.textContent = String(e);
  } finally {
    generateEl.disabled = false;
  }
});

function renderResult() {
  if (!generated) return;
  const font = generated;
  const format = formatEl.value;
  const check = canEncode(font, format);

  // プレビュー（ライブラリの描画エンジン = デバイスと同じ規則）
  const text = previewTextEl.value || sampleText;
  const w = Math.max(8, Math.min(2000, textWidth(font, text) + 8));
  const h = Math.max(8, fontHeight(font) + 8);
  const bmp = createBitmap(w, h, 1);
  drawString(bmp, font, text, 4, 4);
  const zoom = Math.max(1, Math.min(4, Math.floor(480 / w) || 1));
  previewEl.width = w * zoom;
  previewEl.height = h * zoom;
  const ctx = previewEl.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#10151c';
    ctx.fillRect(0, 0, previewEl.width, previewEl.height);
    ctx.fillStyle = '#e8f0ff';
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        if (getPixel(bmp, xx, yy)) ctx.fillRect(xx * zoom, yy * zoom, zoom, zoom);
      }
    }
  }

  // 情報とサイズ
  infoEl.textContent = '';
  /** @type {[string, string][]} */
  const rows = [
    [t('gen.glyphs'), String(font.glyphs.size)],
    [t('info.ascentDescent'), `${font.ascent} / ${font.descent}`],
    ['', ''],
  ];
  rows.pop();
  if (generatedMissing > 0) rows.push([t('gen.missing', { count: generatedMissing }), '']);
  const errors = check.issues.filter((i) => i.level === 'error');
  const canBuild = check.ok || (dropInvalidEl.checked && errors.every((i) => i.codepoint !== undefined));
  if (canBuild) {
    try {
      const bytes = encode(font, { format, dropInvalid: dropInvalidEl.checked });
      rows.push([t('gen.bytes'), `${bytes.length.toLocaleString()} B (${format})`]);
    } catch {
      // 表示だけの失敗は issues 側で伝わる
    }
  }
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    infoEl.append(dt, dd);
  }

  // 制約の報告（仕様 §7.1 — 「入らない」は利用者に見せる）
  issuesEl.textContent = '';
  if (check.issues.length === 0) {
    const li = document.createElement('li');
    li.className = 'ok';
    li.textContent = t('gen.ok');
    issuesEl.appendChild(li);
  }
  for (const issue of check.issues.slice(0, 50)) {
    const li = document.createElement('li');
    li.className = issue.level;
    const cp = issue.codepoint !== undefined
      ? ` U+${issue.codepoint.toString(16).toUpperCase().padStart(4, '0')} "${String.fromCodePoint(issue.codepoint)}"`
      : '';
    li.textContent = `${issue.level === 'error' ? '✕' : '△'} ${issue.code}${cp} ${JSON.stringify(issue.params ?? {})}`;
    issuesEl.appendChild(li);
  }

  dlHEl.disabled = !canBuild;
  dlBinEl.disabled = !canBuild;
}

/** @param {BlobPart} content @param {string} name @param {string} type */
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

dlHEl.addEventListener('click', () => {
  if (!generated) return;
  const ident = sanitizeIdent(symbolEl.value || 'MyFont');
  // Google Fonts 選択時はキュレーション情報から帰属表示を完全に埋める
  const curated = sourceEl.value === 'google' ? findFont(gfontEl.value) : null;
  const src = encodeCSource(generated, {
    format: /** @type {'u8g2' | 'gfx'} */ (formatEl.value),
    symbolName: ident,
    dropInvalid: dropInvalidEl.checked,
    attribution: {
      typeface: typefaceEl.value || curated?.family,
      license: licenseEl.value || curated?.license.name,
      licenseUrl: curated?.license.url,
      author: curated?.by,
      origin: curated ? `Google Fonts (${curated.family})` : undefined,
    },
  });
  download(src, `${ident}.h`, 'text/plain');
});

dlBinEl.addEventListener('click', () => {
  if (!generated) return;
  const ident = sanitizeIdent(symbolEl.value || 'MyFont');
  const bytes = encode(generated, {
    format: formatEl.value,
    dropInvalid: dropInvalidEl.checked,
  });
  const ext = formatEl.value === 'u8g2' ? 'u8g2' : 'gfx1';
  // Uint8Array は BlobPart として有効だが、lib.dom の型定義が ArrayBuffer 固定のため明示キャスト
  download(/** @type {any} */ (bytes), `${ident}.${ext}`, 'application/octet-stream');
});

for (const el of [formatEl, dropInvalidEl, previewTextEl]) {
  el.addEventListener('input', renderResult);
}

langEl.addEventListener('input', async () => {
  await setLocale(langEl.value);
  applyLanguage();
});

pxEl.addEventListener('input', () => {
  if (sourceEl.value === 'google') syncAttribution();
});

await initI18n();
applyLanguage();
syncSourceRows();
syncAttribution();
renderSelectedCount();

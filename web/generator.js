// @ts-check
/**
 * Generator (spec §14, UC1). TTF / OTF / WOFF → u8g2 / GFXfont / BDF / VLW / BFF.
 * The successor to fontgen (LGFXScreenBuilder). Four steps, one card each:
 * typeface → size and name (with a live preview) → characters → generate.
 *
 * Filling in missing characters uses the library's merge / generateFont; only
 * choosing and fetching the family to fill from (FALLBACK_CHAIN, the Google Fonts
 * download) belongs to this app (the layering of spec §2.3). Nothing is filled in
 * behind the user's back — the missing characters are named, a family is offered,
 * and the user applies it with one click.
 */
import {
  generateFont,
  merge,
  canEncode,
  encode,
  encodeCSource,
  textWidth,
  AXES,
  TEMPLATES,
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
import { FONTS, findFont, loadGoogleFont, FALLBACK_CHAIN } from './googlefonts.js';
import { $, debounce, download, drawFontTo } from './ui.js';
import { renderCharmap, copyCharacters } from './charmap.js';

const langEl = /** @type {HTMLSelectElement} */ ($('lang'));
const tabGoogleEl = /** @type {HTMLButtonElement} */ ($('tab-google'));
const tabFileEl = /** @type {HTMLButtonElement} */ ($('tab-file'));
const srcGoogleEl = $('src-google');
const srcFileEl = $('src-file');
const gfontSearchEl = /** @type {HTMLInputElement} */ ($('gfont-search'));
const gfontListEl = $('gfont-list');
const fileEl = /** @type {HTMLInputElement} */ ($('file'));
const weightEl = /** @type {HTMLSelectElement} */ ($('weight'));
const italicEl = /** @type {HTMLInputElement} */ ($('italic'));
const pxEl = /** @type {HTMLInputElement} */ ($('px'));
const thresholdEl = /** @type {HTMLInputElement} */ ($('threshold'));
const thresholdControlEl = $('threshold-control');
const symbolEl = /** @type {HTMLInputElement} */ ($('symbol'));
const liveTextEl = /** @type {HTMLInputElement} */ ($('live-text'));
const liveZoomEl = /** @type {HTMLSelectElement} */ ($('live-zoom'));
const liveCanvasEl = /** @type {HTMLCanvasElement} */ ($('live-canvas'));
const liveStatusEl = $('live-status');
const templatesEl = $('templates');
const axesEl = $('axes');
const customTextEl = /** @type {HTMLTextAreaElement} */ ($('custom-text'));
const customRangesEl = /** @type {HTMLInputElement} */ ($('custom-ranges'));
const charCountEl = $('char-count');
const charEstimateEl = $('char-estimate');
const charmapDetailsEl = /** @type {HTMLDetailsElement} */ ($('charmap-details'));
const charmapEl = $('charmap');
const charmapCopyEl = /** @type {HTMLButtonElement} */ ($('charmap-copy'));
const charmapCopyStatusEl = $('charmap-copy-status');
const formatEl = /** @type {HTMLSelectElement} */ ($('format'));
const bppEl = /** @type {HTMLSelectElement} */ ($('bpp'));
const typefaceEl = /** @type {HTMLInputElement} */ ($('typeface'));
const licenseEl = /** @type {HTMLInputElement} */ ($('license'));
const dropInvalidEl = /** @type {HTMLInputElement} */ ($('drop-invalid'));
const generateEl = /** @type {HTMLButtonElement} */ ($('generate'));
const statusEl = $('status');
const outputEl = $('output');
const resBytesEl = $('res-bytes');
const resGlyphsEl = $('res-glyphs');
const resHeightEl = $('res-height');
const issuesEl = $('issues');
const fbOfferEl = $('fb-offer');
const fbTextEl = $('fb-text');
const fbPickEl = /** @type {HTMLSelectElement} */ ($('fb-pick'));
const fbApplyEl = /** @type {HTMLButtonElement} */ ($('fb-apply'));
const fbClearEl = /** @type {HTMLButtonElement} */ ($('fb-clear'));
const fbStatusEl = $('fb-status');
const previewTextEl = /** @type {HTMLInputElement} */ ($('preview-text'));
const zoomEl = /** @type {HTMLSelectElement} */ ($('zoom'));
const previewEl = /** @type {HTMLCanvasElement} */ ($('preview'));
const resultPreviewEl = $('result-preview');
const resultPreviewNoteEl = $('result-preview-note');
const dlHEl = /** @type {HTMLButtonElement} */ ($('dl-h'));
const copyEl = /** @type {HTMLButtonElement} */ ($('copy'));
const dlBinEl = /** @type {HTMLButtonElement} */ ($('dl-bin'));
const codeNoteEl = $('code-note');
const codeEl = $('code');
const howtoCodeEl = $('howto-code');

// --- State --------------------------------------------------------------------

/** @type {'google' | 'file'} */
let sourceKind = 'google';
let gFamily = 'Noto Sans JP';
/** @type {ArrayBuffer | null} */
let fontData = null;
/** @type {string[]} Ids of the selected character sets */
let sets = ['ascii', 'hiragana', 'katakana', 'jaPunct', 'hanJa1', 'symUnits'];
let activeTemplate = '';
let sampleText = 'こんにちは 25.6℃ 気温';
let symbolTouched = false;

/** Continuation of a partial Google Fonts load (for regenerating with a wider set)
 * @type {{key: string, family: string, loaded: Set<string>} | null} */
let gfState = null;
/** Load state of the fill-in family (kept separately from the main source)
 * @type {{key: string, family: string, loaded: Set<string>} | null} */
let fbState = null;

/** @type {import('../src/model/font.js').Font | null} Result of the main generation (before filling in) */
let baseFont = null;
/** @type {number[]} Characters the typeface did not have in the main generation */
let baseMissing = [];
/** @type {import('../src/gen/rasterize.js').FontSizing | null} Sizing of the main generation */
let baseSizing = null;
/** @type {import('../src/model/font.js').Font | null} What is displayed and exported (including any fill-in) */
let generated = null;
/** @type {{family: string, filled: number, still: number[]} | null} */
let fbApplied = null;
/** @type {string | null} Text output built by renderResult (reused by download / copy) */
let currentTextOutput = null;

/** @type {Record<string, {ext: string, mime: string, textExt?: string, bpps: number[]}>} */
const OUTPUT_FORMATS = {
  u8g2: { ext: 'u8g2', mime: 'application/octet-stream', textExt: 'h', bpps: [1] },
  gfx: { ext: 'gfx1', mime: 'application/octet-stream', textExt: 'h', bpps: [1] },
  bdf: { ext: 'bdf', mime: 'text/plain;charset=utf-8', textExt: 'bdf', bpps: [1] },
  vlw: { ext: 'vlw', mime: 'application/octet-stream', textExt: 'h', bpps: [8] },
  bff: { ext: 'bff', mime: 'application/octet-stream', textExt: 'h', bpps: [1, 2, 4] },
};

// --- Shared helpers -------------------------------------------------------------

const pxNum = () => Number(pxEl.value) || 24;
const thresholdNum = () => Math.min(255, Math.max(1, Number(thresholdEl.value) || 128));
const styleNow = () => ({ weight: Number(weightEl.value), italic: italicEl.checked });
const outputBpp = () => Number(bppEl.value) || 1;
/** BFF 2/4bpp and VLW 8bpp all use the same 8bpp alpha Bitmap internally. */
const modelBpp = () => /** @type {1|8} */ (outputBpp() === 1 ? 1 : 8);

/** @param {import('../src/model/font.js').Font} font */
function fontBpp(font) {
  const first = font.glyphs.values().next().value;
  return first?.bitmap.bpp ?? /** @type {any} */ (font.meta.format)?.gen?.bpp ?? 1;
}

function encodeOptions() {
  return {
    format: formatEl.value,
    dropInvalid: dropInvalidEl.checked,
    language: /** @type {'en'|'ja'|'zh-Hans'|'zh-Hant'} */ (langEl.value),
    ...(formatEl.value === 'bff' ? { bpp: /** @type {1|2|4} */ (outputBpp()) } : {}),
  };
}

function syncFormatControls() {
  const supported = OUTPUT_FORMATS[formatEl.value].bpps;
  const previous = outputBpp();
  bppEl.textContent = '';
  for (const bpp of supported) {
    const option = document.createElement('option');
    option.value = String(bpp);
    option.textContent = `${bpp}bpp${bpp > 1 ? ' AA' : ''}`;
    bppEl.appendChild(option);
  }
  bppEl.value = String(supported.includes(previous) ? previous : supported[0]);
  thresholdControlEl.hidden = modelBpp() !== 1;
}

/**
 * Merges in the generated fallback and recomputes the line box from the actual ink
 * of every glyph. This does not change the general merge() contract of keeping the
 * base metrics.
 * @param {import('../src/model/font.js').Font} base
 * @param {import('../src/model/font.js').Font} overlay
 */
function mergeGenerated(base, overlay) {
  const merged = merge(base, overlay);
  let ascent = 0;
  let descent = 0;
  for (const g of merged.glyphs.values()) {
    if (!g.bitmap.height) continue;
    ascent = Math.max(ascent, -g.yOffset);
    descent = Math.max(descent, g.yOffset + g.bitmap.height);
  }
  ascent = Math.max(1, Math.ceil(ascent));
  descent = Math.max(0, Math.ceil(descent));
  return {
    ...merged,
    ascent,
    descent,
    lineHeight: ascent + descent,
    meta: { ...merged.meta, issues: merged.meta.issues.slice(0, base.meta.issues.length) },
  };
}

/** @param {number[]} cps @param {number} max */
function charsPreview(cps, max) {
  const shown = cps.slice(0, max).map((cp) => String.fromCodePoint(cp)).join(' ');
  return cps.length > max ? `${shown} …` : shown;
}

/**
 * Turns the current source (a Google family or a local file) into something
 * generateFont accepts. For Google, only the subsets covering the requested
 * characters are fetched, continuing from what is already loaded.
 * @param {number[]} cps
 * @returns {Promise<{source?: ArrayBuffer, family?: string}>}
 */
async function resolveSource(cps) {
  if (sourceKind === 'google') {
    const { weight, italic } = styleNow();
    const key = `${gFamily}|${weight}|${italic}`;
    const loaded = await loadGoogleFont(gFamily, cps, {
      weight,
      italic,
      into: gfState?.key === key ? gfState : null,
    });
    gfState = { key, family: loaded.family, loaded: loaded.loaded };
    return { family: loaded.family };
  }
  if (!fontData) throw new Error(t('gen.needFile'));
  return { source: fontData.slice(0) };
}

// --- Language -------------------------------------------------------------------

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
  renderGoogleList();
  renderTemplates();
  renderAxes();
  renderCharSummary();
  renderHowto();
  if (generated) renderResult();
}

// --- 1. Typeface ----------------------------------------------------------------

/** @param {'google' | 'file'} kind */
function setSourceKind(kind) {
  sourceKind = kind;
  tabGoogleEl.classList.toggle('on', kind === 'google');
  tabFileEl.classList.toggle('on', kind === 'file');
  srcGoogleEl.hidden = kind !== 'google';
  srcFileEl.hidden = kind !== 'file';
  syncAttribution();
  scheduleLive();
}

function renderGoogleList() {
  const filter = gfontSearchEl.value.trim().toLowerCase();
  gfontListEl.textContent = '';
  for (const f of FONTS) {
    if (filter && !f.family.toLowerCase().includes(filter) && !f.script.includes(filter)) continue;
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'font-option' + (f.family === gFamily ? ' selected' : '');
    option.title = f.by;
    option.setAttribute('aria-pressed', String(f.family === gFamily));
    const name = document.createElement('span');
    name.className = 'name';
    name.style.fontFamily = `'${f.family}', sans-serif`;
    name.textContent = f.family;
    const meta = document.createElement('span');
    meta.className = 'meta';
    const tags = [t(`gscript.${f.script}`), f.license.id];
    if (f.mono) tags.push('mono');
    if (f.pixel) tags.push('pixel');
    meta.textContent = tags.join(' · ');
    option.append(name, meta);
    option.addEventListener('click', () => {
      gFamily = f.family;
      gfState = null;
      renderGoogleList();
      syncAttribution();
      scheduleLive();
    });
    gfontListEl.appendChild(option);
  }
}

/** Fills in the attribution and the identifier to match the selected source */
function syncAttribution() {
  if (sourceKind === 'google') {
    const f = findFont(gFamily);
    if (f) {
      typefaceEl.value = f.family;
      licenseEl.value = f.license.name;
      if (!symbolTouched) symbolEl.value = sanitizeIdent(`${f.family}_${pxEl.value}`);
    }
  } else if (fontData) {
    if (!symbolTouched) symbolEl.value = sanitizeIdent(`${typefaceEl.value || 'MyFont'}_${pxEl.value}`);
  }
  renderHowto();
}

fileEl.addEventListener('input', async () => {
  const f = fileEl.files?.[0];
  if (!f) return;
  fontData = await f.arrayBuffer();
  typefaceEl.value = f.name.replace(/\.[^.]+$/, '');
  licenseEl.value = '';
  syncAttribution();
  scheduleLive();
});

tabGoogleEl.addEventListener('click', () => setSourceKind('google'));
tabFileEl.addEventListener('click', () => setSourceKind('file'));
gfontSearchEl.addEventListener('input', renderGoogleList);
for (const el of [weightEl, italicEl]) {
  el.addEventListener('input', () => {
    gfState = null;
    fbState = null;
    scheduleLive();
  });
}

// --- 2. Size and name + live preview --------------------------------------------

let liveSeq = 0;

async function updateLive() {
  const seq = ++liveSeq;
  const text = liveTextEl.value || sampleText;
  const cps = [...new Set([...text].map((ch) => /** @type {number} */ (ch.codePointAt(0))))].filter(
    (cp) => cp >= 0x20,
  );
  if (cps.length === 0) return;
  if (sourceKind === 'file' && !fontData) {
    liveStatusEl.textContent = t('gen.needFile');
    return;
  }
  try {
    liveStatusEl.textContent = t('gen.fetching');
    const src = await resolveSource(cps);
    if (seq !== liveSeq) return;
    const { font, missing } = await generateFont({
      ...src,
      px: pxNum(),
      codepoints: cps,
      style: styleNow(),
      bpp: modelBpp(),
      threshold: thresholdNum(),
    });
    if (seq !== liveSeq) return;
    drawFontTo(
      liveCanvasEl,
      font,
      text,
      Number(liveZoomEl.value),
      /** @type {1|2|4|8} */ (outputBpp()),
    );
    let s = t('gen.liveInfo', {
      px: pxNum(),
      line: font.lineHeight,
      width: textWidth(font, text),
    });
    if (missing.length > 0) s += ' — ' + t('gen.missing', { count: missing.length });
    liveStatusEl.textContent = s;
  } catch (e) {
    if (seq === liveSeq) liveStatusEl.textContent = String(e);
  }
}

const scheduleLive = debounce(updateLive, 400);

for (const el of [liveTextEl, liveZoomEl, thresholdEl]) {
  el.addEventListener('input', scheduleLive);
}
pxEl.addEventListener('input', () => {
  syncAttribution();
  renderCharSummary();
  scheduleLive();
});
symbolEl.addEventListener('input', () => {
  symbolTouched = true;
  renderHowto();
});

// --- 3. Characters --------------------------------------------------------------

function renderTemplates() {
  templatesEl.textContent = '';
  for (const tpl of TEMPLATES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (tpl.id === activeTemplate ? ' on' : '');
    chip.textContent = t(`tpl.${tpl.id}`);
    chip.addEventListener('click', () => {
      activeTemplate = tpl.id;
      sets = [...tpl.sets];
      customTextEl.value = tpl.text;
      sampleText = tpl.sample;
      liveTextEl.value = tpl.sample;
      previewTextEl.value = tpl.sample;
      renderTemplates();
      renderAxes();
      renderCharSummary();
      scheduleLive();
    });
    templatesEl.appendChild(chip);
  }
}

/** Clears the template selection (when a set is toggled by hand) */
function clearTemplate() {
  if (!activeTemplate) return;
  activeTemplate = '';
  renderTemplates();
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
          clearTemplate();
          renderCharSummary();
        });
        label.append(cb, ` ${t(`set.${id}`)} (${countOf(id)})`);
        box.appendChild(label);
      }
    } else {
      for (const lang of axis.languages ?? []) {
        const row = document.createElement('div');
        row.className = 'tier-row';
        const span = document.createElement('span');
        span.textContent = t(`lang.${lang.id}`);
        row.appendChild(span);
        const choices = document.createElement('div');
        choices.className = 'tier-choices';
        choices.setAttribute('role', 'radiogroup');
        choices.setAttribute('aria-label', t(`lang.${lang.id}`));
        const selected = lang.tiers.find((id) => sets.includes(id)) ?? '';
        for (const id of ['', ...lang.tiers]) {
          const label = document.createElement('label');
          label.className = 'tier-option';
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = `tier-${axis.id}-${lang.id}`;
          radio.value = id;
          radio.checked = id === selected;
          radio.addEventListener('input', () => {
            if (!radio.checked) return;
            for (const tierId of lang.tiers) sets = toggleSet(sets, tierId, false);
            if (radio.value) sets = toggleSet(sets, radio.value, true);
            clearTemplate();
            renderAxes();
            renderCharSummary();
          });
          const text = document.createElement('span');
          text.textContent = id
            ? `${t(`set.${id}`)} (${countOf(id).toLocaleString()})`
            : t('tier.none');
          label.append(radio, text);
          choices.appendChild(label);
        }
        row.appendChild(choices);
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

function renderCharSummary() {
  charmapCopyStatusEl.textContent = '';
  const count = currentCodepoints().length;
  charCountEl.textContent = t('gen.selected', { count });
  // Rough u8g2 size estimate (record header + RLE; dense CJK runs over this)
  const px = pxNum();
  const kb = (count * (6 + (px * px) / 10)) / 1024;
  charEstimateEl.textContent =
    count > 0 ? t('gen.estimate', { kb: kb < 10 ? kb.toFixed(1) : String(Math.round(kb)) }) : '';
  if (charmapDetailsEl.open) renderSelectedCharmap();
}

function renderSelectedCharmap() {
  renderCharmap(charmapEl, currentCodepoints(), { emptyText: t('chars.empty') });
}

for (const el of [customTextEl, customRangesEl]) {
  el.addEventListener('input', () => {
    clearTemplate();
    renderCharSummary();
  });
}
charmapDetailsEl.addEventListener('toggle', () => {
  if (charmapDetailsEl.open) renderSelectedCharmap();
});
charmapCopyEl.addEventListener('click', async () => {
  await copyCharacters(currentCodepoints());
  charmapCopyStatusEl.textContent = t('chars.copied');
});

// --- 4. Generate ----------------------------------------------------------------

generateEl.addEventListener('click', async () => {
  if (sourceKind === 'file' && !fontData) {
    statusEl.textContent = t('gen.needFile');
    return;
  }
  const { bmp, dropped } = splitBmp(currentCodepoints());
  generateEl.disabled = true;
  try {
    statusEl.textContent = t('gen.fetching');
    const src = await resolveSource(bmp);
    const { font, missing, sizing } = await generateFont({
      ...src,
      px: pxNum(),
      codepoints: bmp,
      style: styleNow(),
      bpp: modelBpp(),
      threshold: thresholdNum(),
      familyName: typefaceEl.value,
      onProgress: ({ done, total }) => {
        statusEl.textContent = t('gen.generating', { done, total });
      },
    });
    baseFont = font;
    baseMissing = missing;
    baseSizing = sizing;
    generated = font;
    fbApplied = null;
    statusEl.textContent = dropped.length > 0 ? t('gen.droppedBmp', { count: dropped.length }) : '';
    outputEl.hidden = false;
    if (!previewTextEl.value) previewTextEl.value = sampleText;
    renderResult();
  } catch (e) {
    statusEl.textContent = String(e);
  } finally {
    generateEl.disabled = false;
  }
});

// --- Filling in (offering and applying a fallback) ------------------------------

function renderFallbackOffer() {
  const missing = fbApplied ? fbApplied.still : baseMissing;
  if (baseMissing.length === 0) {
    fbOfferEl.hidden = true;
    return;
  }
  fbOfferEl.hidden = false;
  fbTextEl.textContent = '';
  const line = document.createElement('div');
  if (fbApplied) {
    line.textContent =
      t('gen.fbFilled', { count: fbApplied.filled, family: fbApplied.family }) +
      (missing.length > 0 ? ` ${t('gen.fbStill', { count: missing.length })}` : '');
  } else {
    line.textContent = t('gen.missing', { count: baseMissing.length });
  }
  fbTextEl.appendChild(line);
  if (missing.length > 0) {
    const chars = document.createElement('div');
    chars.className = 'miss-chars';
    chars.textContent = charsPreview(missing, 80);
    fbTextEl.appendChild(chars);
  }
  // Candidate fill-in families (the main source's own family is excluded)
  const cur = fbPickEl.value;
  fbPickEl.textContent = '';
  for (const fam of FALLBACK_CHAIN) {
    if (sourceKind === 'google' && fam === gFamily) continue;
    const opt = document.createElement('option');
    opt.value = fam;
    opt.textContent = fam;
    fbPickEl.appendChild(opt);
  }
  if (cur) fbPickEl.value = cur;
  fbClearEl.hidden = !fbApplied;
}

fbApplyEl.addEventListener('click', async () => {
  if (!baseFont || baseMissing.length === 0) return;
  const fam = fbPickEl.value;
  fbApplyEl.disabled = true;
  try {
    fbStatusEl.textContent = t('gen.fetching');
    const { weight, italic } = styleNow();
    const key = `${fam}|${weight}|${italic}`;
    /** @type {Awaited<ReturnType<typeof loadGoogleFont>>} */
    let loaded;
    try {
      loaded = await loadGoogleFont(fam, baseMissing, {
        weight,
        italic,
        into: fbState?.key === key ? fbState : null,
      });
    } catch {
      // The fill-in family may not have that weight. Retry at 400
      loaded = await loadGoogleFont(fam, baseMissing, { weight: 400, italic: false, into: null });
    }
    fbState = { key, family: loaded.family, loaded: loaded.loaded };
    const r = await generateFont({
      family: loaded.family,
      px: pxNum(),
      codepoints: baseMissing,
      style: styleNow(),
      bpp: /** @type {1|8} */ (fontBpp(baseFont)),
      threshold: thresholdNum(),
      sizing: baseSizing ?? undefined,
      onProgress: ({ done, total }) => {
        fbStatusEl.textContent = t('gen.generating', { done, total });
      },
    });
    generated = mergeGenerated(baseFont, r.font);
    fbApplied = { family: fam, filled: baseMissing.length - r.missing.length, still: r.missing };
    fbStatusEl.textContent = '';
    renderResult();
  } catch (e) {
    fbStatusEl.textContent = String(e);
  } finally {
    fbApplyEl.disabled = false;
  }
});

fbClearEl.addEventListener('click', () => {
  generated = baseFont;
  fbApplied = null;
  fbStatusEl.textContent = '';
  renderResult();
});

// --- Result display -------------------------------------------------------------

function renderResult() {
  if (!generated) return;
  const font = generated;
  const format = formatEl.value;
  const output = OUTPUT_FORMATS[format];
  const baseCheck = canEncode(font, format);
  const check = { ok: baseCheck.ok, issues: [...baseCheck.issues] };
  const bppMismatch = fontBpp(font) !== modelBpp();
  if (bppMismatch) {
    check.ok = false;
    check.issues.unshift({
      level: 'error',
      code: 'REGENERATE_FOR_BPP',
      params: { generated: fontBpp(font), selected: outputBpp() },
    });
  }
  currentTextOutput = null;

  resGlyphsEl.textContent = String(font.glyphs.size);
  resHeightEl.textContent = `${font.lineHeight}px (${font.ascent}/${font.descent})`;

  const errors = check.issues.filter((i) => i.level === 'error');
  const canBuild =
    check.ok || (dropInvalidEl.checked && errors.every((i) => i.codepoint !== undefined));
  resBytesEl.textContent = '—';
  if (canBuild) {
    try {
      const bytes = encode(font, encodeOptions());
      resBytesEl.textContent = `${bytes.length.toLocaleString()} B (${format})`;
    } catch {
      // A failure that only affects the size readout is already reported in issues
    }
  }

  // Reporting the constraints (spec §7.1 — "does not fit" is shown to the user)
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
    const cp =
      issue.codepoint !== undefined
        ? ` U+${issue.codepoint.toString(16).toUpperCase().padStart(4, '0')} "${String.fromCodePoint(issue.codepoint)}"`
        : '';
    li.textContent = `${issue.level === 'error' ? '✕' : '△'} ${issue.code}${cp} ${JSON.stringify(issue.params ?? {})}`;
    issuesEl.appendChild(li);
  }

  renderFallbackOffer();

  // Preview (shown only when the generated model's bpp matches the chosen format)
  resultPreviewEl.hidden = bppMismatch;
  resultPreviewNoteEl.hidden = bppMismatch;
  if (!bppMismatch) {
    drawFontTo(
      previewEl,
      font,
      previewTextEl.value || sampleText,
      Number(zoomEl.value),
      /** @type {1|2|4|8} */ (outputBpp()),
    );
  }

  const hasTextOutput = output.textExt !== undefined;
  dlHEl.hidden = !hasTextOutput;
  copyEl.hidden = !hasTextOutput;
  dlBinEl.hidden = format === 'bdf';
  dlHEl.disabled = !canBuild;
  dlBinEl.disabled = !canBuild;
  copyEl.disabled = !canBuild;
  dlHEl.textContent = t('gen.downloadFormat', { ext: output.textExt ?? output.ext });
  dlBinEl.textContent = t('gen.downloadFormat', { ext: output.ext });

  // Head-of-file preview of the .h / BDF output
  codeEl.textContent = '';
  codeNoteEl.textContent = '';
  if (canBuild && hasTextOutput) {
    try {
      currentTextOutput = buildTextOutput();
      const lines = currentTextOutput.split('\n');
      const shown = Math.min(lines.length, 30);
      codeEl.textContent = lines.slice(0, shown).join('\n') + (lines.length > shown ? '\n…' : '');
      if (lines.length > shown) {
        codeNoteEl.textContent = t('gen.codeNote', { shown, total: lines.length });
      }
    } catch {
      // A combination encode rejects is already listed in issues
    }
  }
  renderHowto();
}

/** Builds a text output such as a `.h` or a BDF. */
function buildTextOutput() {
  if (!generated) throw new Error('no font');
  if (formatEl.value === 'bdf') {
    return new TextDecoder().decode(
      encode(generated, { format: 'bdf', dropInvalid: dropInvalidEl.checked }),
    );
  }
  return buildHeader();
}

/** Builds the .h including attribution. When a fill-in was applied, both typefaces are recorded */
function buildHeader() {
  if (!generated) throw new Error('no font');
  const ident = sanitizeIdent(symbolEl.value || 'MyFont');
  const curated = sourceKind === 'google' ? findFont(gFamily) : null;
  const fbCurated = fbApplied ? findFont(fbApplied.family) : null;
  let typeface = typefaceEl.value || curated?.family || '';
  let license = licenseEl.value || curated?.license.name || '';
  let author = curated?.by;
  let origin = curated ? `Google Fonts (${curated.family})` : undefined;
  if (fbApplied && fbCurated) {
    typeface += ` + ${fbCurated.family} (${fbApplied.filled} glyphs)`;
    if (fbCurated.license.name !== license) license += ` / ${fbCurated.license.name}`;
    if (author && fbCurated.by !== author) author += ` / ${fbCurated.by}`;
    origin = origin ? `${origin} + ${fbCurated.family}` : `Google Fonts (${fbCurated.family})`;
  }
  return encodeCSource(generated, {
    format: /** @type {'u8g2' | 'gfx' | 'vlw' | 'bff'} */ (formatEl.value),
    symbolName: ident,
    dropInvalid: dropInvalidEl.checked,
    ...(formatEl.value === 'bff' ? { bpp: /** @type {1|2|4} */ (outputBpp()) } : {}),
    attribution: {
      typeface,
      license,
      licenseUrl: curated?.license.url,
      author,
      origin,
    },
  });
}

function renderHowto() {
  const ident = sanitizeIdent(symbolEl.value || 'MyFont');
  if (formatEl.value === 'bdf') {
    howtoCodeEl.textContent = t('gen.howtoBdf');
    return;
  }
  if (formatEl.value === 'vlw') {
    howtoCodeEl.textContent = `#include <M5Unified.h>      // or <LovyanGFX.hpp>
#include "${ident}.h"

void setup() {
  M5.begin();
  if (!M5.Display.loadFont(${ident}_data)) return;
  M5.Display.drawString("${sampleText.replaceAll('"', '\\"')}", 10, 10);
}`;
    return;
  }
  if (formatEl.value === 'bff') {
    howtoCodeEl.textContent = `#include <M5Unified.h>      // or <LovyanGFX.hpp>
#include "${ident}.h"

void setup() {
  M5.begin();
  if (!M5.Display.loadFont(${ident}_data, lgfx::IFont::font_type_t::ft_lvgl)) return;
  M5.Display.drawString("${sampleText.replaceAll('"', '\\"')}", 10, 10);
}`;
    return;
  }
  howtoCodeEl.textContent = `#include <M5Unified.h>      // or <LovyanGFX.hpp>
#include "${ident}.h"

void setup() {
  M5.begin();
  M5.Display.setFont(&${ident});
  M5.Display.drawString("${sampleText.replaceAll('"', '\\"')}", 10, 10);
}`;
}

dlHEl.addEventListener('click', () => {
  if (!generated) return;
  const output = OUTPUT_FORMATS[formatEl.value];
  if (!output.textExt) return;
  const src = currentTextOutput ?? buildTextOutput();
  download(src, `${sanitizeIdent(symbolEl.value || 'MyFont')}.${output.textExt}`, 'text/plain');
});

copyEl.addEventListener('click', async () => {
  if (!generated) return;
  const src = currentTextOutput ?? buildTextOutput();
  await navigator.clipboard.writeText(src);
  statusEl.textContent = t('gen.copied');
});

dlBinEl.addEventListener('click', () => {
  if (!generated) return;
  const ident = sanitizeIdent(symbolEl.value || 'MyFont');
  const bytes = encode(generated, encodeOptions());
  const output = OUTPUT_FORMATS[formatEl.value];
  // Uint8Array is a valid BlobPart, but lib.dom types it as ArrayBuffer only, hence the cast
  download(/** @type {any} */ (bytes), `${ident}.${output.ext}`, output.mime);
});

for (const el of [dropInvalidEl, previewTextEl, zoomEl]) {
  el.addEventListener('input', renderResult);
}

formatEl.addEventListener('input', () => {
  syncFormatControls();
  scheduleLive();
  renderHowto();
  renderResult();
});
bppEl.addEventListener('input', () => {
  thresholdControlEl.hidden = modelBpp() !== 1;
  scheduleLive();
  renderHowto();
  renderResult();
});

langEl.addEventListener('input', async () => {
  await setLocale(langEl.value);
  applyLanguage();
});

// --- Initialization -------------------------------------------------------------

await initI18n();
liveTextEl.value = sampleText;
syncFormatControls();
applyLanguage();
setSourceKind('google');
syncAttribution();
renderCharSummary();

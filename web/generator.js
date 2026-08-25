// @ts-check
/**
 * Generator（仕様 §14、UC1）。TTF / OTF / WOFF → u8g2 / GFXfont。
 * fontgen（LGFXScreenBuilder）の後継。カード式の 4 ステップ:
 * 書体 → サイズと名前（ライブプレビュー付き）→ 文字 → 生成。
 *
 * 補完（欠落文字の穴埋め）はライブラリの merge / generateFont を使い、
 * どのファミリで埋めるかの選定・入手（FALLBACK_CHAIN・Google Fonts 取得）
 * だけをこのアプリが持つ（仕様 §2.3 のレイヤ分担）。勝手には埋めない —
 * 欠落を名指しして提案し、利用者が 1 クリックで適用する。
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
const formatEl = /** @type {HTMLSelectElement} */ ($('format'));
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
const dlHEl = /** @type {HTMLButtonElement} */ ($('dl-h'));
const copyEl = /** @type {HTMLButtonElement} */ ($('copy'));
const dlBinEl = /** @type {HTMLButtonElement} */ ($('dl-bin'));
const codeNoteEl = $('code-note');
const codeEl = $('code');
const howtoCodeEl = $('howto-code');

// --- 状態 ---------------------------------------------------------------------

/** @type {'google' | 'file'} */
let sourceKind = 'google';
let gFamily = 'Noto Sans JP';
/** @type {ArrayBuffer | null} */
let fontData = null;
/** @type {string[]} 選択中の集合 id */
let sets = ['ascii', 'hiragana', 'katakana', 'jaPunct', 'hanJa1', 'symUnits'];
let activeTemplate = '';
let sampleText = 'こんにちは 25.6℃ 気温';
let symbolTouched = false;

/** Google Fonts の部分読み込みの続き（文字集合を広げた再生成用）
 * @type {{key: string, family: string, loaded: Set<string>} | null} */
let gfState = null;
/** 補完元ファミリの読み込み状態（主ソースとは別に持つ）
 * @type {{key: string, family: string, loaded: Set<string>} | null} */
let fbState = null;

/** @type {import('../src/model/font.js').Font | null} 主生成の結果（補完前） */
let baseFont = null;
/** @type {number[]} 主生成で書体に無かった文字 */
let baseMissing = [];
/** @type {import('../src/gen/rasterize.js').FontSizing | null} 主生成のサイジング */
let baseSizing = null;
/** @type {import('../src/model/font.js').Font | null} 表示・出力対象（補完適用後を含む） */
let generated = null;
/** @type {{family: string, filled: number, still: number[]} | null} */
let fbApplied = null;
/** @type {string | null} renderResult が組んだ .h（download / copy が使い回す） */
let currentHeader = null;

// --- 共通ヘルパ -----------------------------------------------------------------

const pxNum = () => Number(pxEl.value) || 24;
const thresholdNum = () => Math.min(255, Math.max(1, Number(thresholdEl.value) || 128));
const styleNow = () => ({ weight: Number(weightEl.value), italic: italicEl.checked });

/**
 * 生成済み fallback を合成し、全グリフの実インクから行ボックスを更新する。
 * 汎用 merge() の「base メトリクスを維持する」契約は変えない。
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
 * 現在のソース（Google ファミリ or ローカルファイル）を generateFont に渡せる形へ。
 * Google は要求文字に掛かるサブセットだけを取得し、続きから読み足す。
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

// --- 言語 ----------------------------------------------------------------------

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

// --- 1. 書体 --------------------------------------------------------------------

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

/** 選択中のソースに合わせて帰属表示と識別子を埋める */
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

// --- 2. サイズと名前 + ライブプレビュー -------------------------------------------

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
      threshold: thresholdNum(),
    });
    if (seq !== liveSeq) return;
    drawFontTo(liveCanvasEl, font, text, Number(liveZoomEl.value));
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

// --- 3. 文字 --------------------------------------------------------------------

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

/** テンプレート選択の解除（手動で集合を触ったとき） */
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
  const count = currentCodepoints().length;
  charCountEl.textContent = t('gen.selected', { count });
  // 大雑把な u8g2 サイズ目安（レコードヘッダ + RLE。密な CJK では上振れする）
  const px = pxNum();
  const kb = (count * (6 + (px * px) / 10)) / 1024;
  charEstimateEl.textContent =
    count > 0 ? t('gen.estimate', { kb: kb < 10 ? kb.toFixed(1) : String(Math.round(kb)) }) : '';
  if (charmapDetailsEl.open) renderCharmap();
}

/** 選択中の文字を「近い code point の束」ごとに一覧する（Ctrl+F で探せる形） */
function renderCharmap() {
  const cps = currentCodepoints();
  charmapEl.textContent = '';
  /** @param {number} cp */
  const hex = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  let start = 0;
  for (let i = 1; i <= cps.length; i++) {
    if (i === cps.length || cps[i] - cps[i - 1] > 64) {
      const group = cps.slice(start, i);
      const head = document.createElement('div');
      head.className = 'range-head';
      head.textContent = `${hex(group[0])}–${hex(group[group.length - 1])} · ${group.length}`;
      const body = document.createElement('div');
      body.className = 'range-chars';
      let s = '';
      for (const cp of group) s += String.fromCodePoint(cp);
      body.textContent = s;
      charmapEl.append(head, body);
      start = i;
    }
  }
}

for (const el of [customTextEl, customRangesEl]) {
  el.addEventListener('input', () => {
    clearTemplate();
    renderCharSummary();
  });
}
charmapDetailsEl.addEventListener('toggle', () => {
  if (charmapDetailsEl.open) renderCharmap();
});

// --- 4. 生成 --------------------------------------------------------------------

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

// --- 補完（fallback の提案と適用） ------------------------------------------------

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
  // 補完元の候補（主ソースと同じファミリは除く）
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
      // 補完元がその weight を持たないことがある。400 で取り直す
      loaded = await loadGoogleFont(fam, baseMissing, { weight: 400, italic: false, into: null });
    }
    fbState = { key, family: loaded.family, loaded: loaded.loaded };
    const r = await generateFont({
      family: loaded.family,
      px: pxNum(),
      codepoints: baseMissing,
      style: styleNow(),
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

// --- 結果表示 -------------------------------------------------------------------

function renderResult() {
  if (!generated) return;
  const font = generated;
  const format = formatEl.value;
  const check = canEncode(font, format);
  currentHeader = null;

  resGlyphsEl.textContent = String(font.glyphs.size);
  resHeightEl.textContent = `${font.lineHeight}px (${font.ascent}/${font.descent})`;

  const errors = check.issues.filter((i) => i.level === 'error');
  const canBuild =
    check.ok || (dropInvalidEl.checked && errors.every((i) => i.codepoint !== undefined));
  resBytesEl.textContent = '—';
  if (canBuild) {
    try {
      const bytes = encode(font, { format, dropInvalid: dropInvalidEl.checked });
      resBytesEl.textContent = `${bytes.length.toLocaleString()} B (${format})`;
    } catch {
      // サイズ表示だけの失敗は issues 側で伝わる
    }
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
    const cp =
      issue.codepoint !== undefined
        ? ` U+${issue.codepoint.toString(16).toUpperCase().padStart(4, '0')} "${String.fromCodePoint(issue.codepoint)}"`
        : '';
    li.textContent = `${issue.level === 'error' ? '✕' : '△'} ${issue.code}${cp} ${JSON.stringify(issue.params ?? {})}`;
    issuesEl.appendChild(li);
  }

  renderFallbackOffer();

  // プレビュー（ライブラリの描画エンジン = デバイスと同じ規則）
  drawFontTo(previewEl, font, previewTextEl.value || sampleText, Number(zoomEl.value));

  dlHEl.disabled = !canBuild;
  dlBinEl.disabled = !canBuild;
  copyEl.disabled = !canBuild;

  // .h の頭出しプレビュー
  codeEl.textContent = '';
  codeNoteEl.textContent = '';
  if (canBuild) {
    try {
      currentHeader = buildHeader();
      const lines = currentHeader.split('\n');
      const shown = Math.min(lines.length, 30);
      codeEl.textContent = lines.slice(0, shown).join('\n') + (lines.length > shown ? '\n…' : '');
      if (lines.length > shown) {
        codeNoteEl.textContent = t('gen.codeNote', { shown, total: lines.length });
      }
    } catch {
      // encode が通らない組み合わせは issues に出ている
    }
  }
  renderHowto();
}

/** 帰属表示込みで .h を組む。補完を適用した場合は両書体を記録する */
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
    format: /** @type {'u8g2' | 'gfx'} */ (formatEl.value),
    symbolName: ident,
    dropInvalid: dropInvalidEl.checked,
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
  const src = currentHeader ?? buildHeader();
  download(src, `${sanitizeIdent(symbolEl.value || 'MyFont')}.h`, 'text/plain');
});

copyEl.addEventListener('click', async () => {
  if (!generated) return;
  const src = currentHeader ?? buildHeader();
  await navigator.clipboard.writeText(src);
  statusEl.textContent = t('gen.copied');
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

for (const el of [formatEl, dropInvalidEl, previewTextEl, zoomEl]) {
  el.addEventListener('input', renderResult);
}

langEl.addEventListener('input', async () => {
  await setLocale(langEl.value);
  applyLanguage();
});

// --- 初期化 ---------------------------------------------------------------------

await initI18n();
liveTextEl.value = sampleText;
applyLanguage();
setSourceKind('google');
syncAttribution();
renderCharSummary();

// @ts-check
/**
 * ランディングページ（サイトトップ）。概要と 4 ツールへの導線だけの静的ページで、
 * ここでは i18n と言語セレクタしか動かさない。
 */
import {
  initI18n,
  setLocale,
  currentLocale,
  applyTranslations,
  t,
  SUPPORTED_LOCALES,
} from './i18n.js';
import { $ } from './ui.js';

const langEl = /** @type {HTMLSelectElement} */ ($('lang'));

for (const loc of SUPPORTED_LOCALES) {
  const opt = document.createElement('option');
  opt.value = loc.id;
  opt.textContent = loc.label;
  langEl.appendChild(opt);
}

function applyLanguage() {
  document.title = t('home.docTitle');
  applyTranslations();
  langEl.value = currentLocale();
}

langEl.addEventListener('input', async () => {
  await setLocale(langEl.value);
  applyLanguage();
});

await initI18n();
applyLanguage();

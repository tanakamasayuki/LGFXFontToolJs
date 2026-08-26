// @ts-check
/**
 * Landing page (site root). A static page with nothing but an overview and links
 * to the four tools, so only i18n and the language selector run here.
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

// @ts-check
/**
 * カタログから oracle_dump/fonts_table.h を生成する。
 * カタログ名は LovyanGFX の fonts:: シンボル名と一致している（仕様 §8.1）。
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fontCatalog } from '../src/fonts/catalog.js';

const here = dirname(fileURLToPath(import.meta.url));

const entries = fontCatalog
  .map((e) => `  { "${e.name}", &fonts::${e.name} },`)
  .join('\n');

const header = `// 生成物。oracle/gen-fonts-table.js が再生成する。手で編集しないこと。
#pragma once
#include <LovyanGFX.hpp>

struct FontEntry {
  const char* name;
  const lgfx::v1::IFont* font;
};

static const FontEntry kFonts[] = {
${entries}
};
static const size_t kFontCount = sizeof(kFonts) / sizeof(kFonts[0]);
`;

writeFileSync(join(here, 'oracle_dump', 'fonts_table.h'), header);
console.log(`fonts_table.h: ${fontCatalog.length} fonts`);

// @ts-check
/**
 * GitHub Pages 用の site/ を組み立てる。
 *
 * 配置（web/ の中身をサイトルートへ、src/ と examples/ をその下へ）:
 *   site/
 *   ├── index.html ...        # web/ の中身
 *   ├── lgfx-font-tool.js     # './src/index.js' への再エクスポートに書き換え
 *   ├── src/                  # ライブラリ本体 + フォントデータ
 *   └── examples/             # ../src/ 参照のまま動く
 */
import { cpSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site');

rmSync(site, { recursive: true, force: true });
mkdirSync(site, { recursive: true });

cpSync(join(root, 'web'), site, { recursive: true });
cpSync(join(root, 'src'), join(site, 'src'), { recursive: true });
cpSync(join(root, 'examples'), join(site, 'examples'), { recursive: true });

// web/ から src/ への唯一の参照を、サイト内の相対位置へ書き換える（仕様 §4.4）
writeFileSync(
  join(site, 'lgfx-font-tool.js'),
  "// 生成物。scripts/build-site.js が書き換える。\nexport * from './src/index.js';\n",
);

// GitHub Pages で _* パスを配信させない Jekyll 処理を無効化
writeFileSync(join(site, '.nojekyll'), '');

console.log('site/ ready');

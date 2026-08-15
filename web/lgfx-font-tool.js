// @ts-check
// web/ から src/ への唯一の外向き参照（仕様 §4.4）。
// build-site.js が site/ を組むとき、書き換えるのはこのファイルだけ。
export * from '../src/index.js';

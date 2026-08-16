// @ts-check
/**
 * データ解決の候補列（仕様 §16）。ネットワークには出ない純粋部分だけを検証する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fontDataCandidates } from '../src/fonts/loader.js';

test('既定はローカル → GitHub Pages の順', () => {
  const c = fontDataCandidates('efontJA_16.u8g2', { baseUrl: null });
  assert.equal(c.length, 2);
  assert.ok(String(c[0]).endsWith('/src/fonts/data/efontJA_16.u8g2'));
  assert.equal(
    String(c[1]),
    'https://tanakamasayuki.github.io/LGFXFontToolJs/src/fonts/data/efontJA_16.u8g2',
  );
});

test('baseUrl 指定時はそこだけを見る（末尾スラッシュ補完付き）', () => {
  const c = fontDataCandidates('Font2.lbmp', { baseUrl: 'https://example.com/fonts' });
  assert.equal(c.length, 1);
  assert.equal(String(c[0]), 'https://example.com/fonts/Font2.lbmp');
  const f = fontDataCandidates('Font2.lbmp', { baseUrl: 'file:///opt/fonts/' });
  assert.equal(String(f[0]), 'file:///opt/fonts/Font2.lbmp');
});

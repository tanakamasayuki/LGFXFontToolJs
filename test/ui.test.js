// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quantizeCoverage } from '../web/ui.js';

test('プレビュー被覆値: BFF 2bpp/4bpp と同じ階調へ量子化する', () => {
  assert.deepEqual(
    [0, 17, 96, 136, 255].map((v) => quantizeCoverage(v, 2)),
    [0, 0, 85, 170, 255],
  );
  assert.deepEqual(
    [0, 17, 96, 136, 255].map((v) => quantizeCoverage(v, 4)),
    [0, 17, 102, 136, 255],
  );
  assert.equal(quantizeCoverage(96, 8), 96);
});

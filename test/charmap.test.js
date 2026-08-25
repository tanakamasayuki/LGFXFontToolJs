import test from 'node:test';
import assert from 'node:assert/strict';
import { groupByBlock, copyableCharacters } from '../web/charmap.js';

test('character map: code points are sorted and grouped by Unicode block', () => {
  const groups = groupByBlock([0x3042, 0x42, 0x41, 0x3044]);
  assert.deepEqual(
    groups.map((g) => [g.name, g.cps]),
    [
      ['Basic Latin (ASCII)', [0x41, 0x42]],
      ['Hiragana', [0x3042, 0x3044]],
    ],
  );
});

test('character map: copied text omits controls and keeps printable characters', () => {
  assert.equal(copyableCharacters([0x41, 0x1f, 0x20, 0x7f, 0x80, 0x3042]), ' Aあ');
});

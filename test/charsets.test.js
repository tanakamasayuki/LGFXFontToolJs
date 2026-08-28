// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRanges,
  codepointsOfSet,
  resolveCharset,
  toggleSet,
  splitBmp,
  countOf,
  ALL_SET_IDS,
} from '../src/charsets/charsets.js';
import { SET_RANGES } from '../src/charsets/charsets-data.js';

test('parseRanges: 範囲と単独値、空白・不正の無視', () => {
  assert.deepEqual(parseRanges('30-33'), [0x30, 0x31, 0x32, 0x33]);
  assert.deepEqual(parseRanges('20-22, A0'), [0x20, 0x21, 0x22, 0xa0]);
  assert.deepEqual(parseRanges('U+41-U+43'), [0x41, 0x42, 0x43]);
  assert.deepEqual(parseRanges(' , xyz, '), []);
});

test('codepointsOfSet: 全集合が展開でき、宣言数と一致する', () => {
  // ALL_SET_IDS は AXES 由来なので、UI に出していない定義済み集合も含めて検査する
  for (const id of Object.keys(SET_RANGES)) {
    const cps = codepointsOfSet(id);
    assert.ok(cps.length > 0, id);
    assert.equal(cps.length, countOf(id), id);
    // 昇順・重複なし
    for (let i = 1; i < cps.length; i++) assert.ok(cps[i] > cps[i - 1], id);
  }
});

test('学年別漢字は累積で、教育漢字(G6)は常用漢字に含まれる', () => {
  let prev = new Set();
  for (let g = 1; g <= 6; g++) {
    const cur = new Set(codepointsOfSet(`hanJaG${g}`));
    assert.ok(cur.size > prev.size, `hanJaG${g}`);
    for (const c of prev) assert.ok(cur.has(c), `hanJaG${g} U+${c.toString(16)}`);
    prev = cur;
  }
  assert.equal(prev.size, 1026, '教育漢字は 1,026 字');
  const joyo = new Set(codepointsOfSet('hanJa1'));
  for (const c of prev) assert.ok(joyo.has(c), `常用漢字に含まれない U+${c.toString(16)}`);
});

test('han tier は累積（上の tier は下を包含する）', () => {
  const t1 = new Set(codepointsOfSet('hanJa1'));
  const t2 = new Set(codepointsOfSet('hanJa2'));
  assert.ok(t2.size > t1.size);
  for (const c of t1) assert.ok(t2.has(c), `U+${c.toString(16)}`);
});

test('resolveCharset: 和集合・整列・制御文字の除去', () => {
  const cps = resolveCharset({ sets: ['digits'], customText: 'BA\n0', customRanges: '7F,80' });
  assert.deepEqual(
    cps,
    [0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x41, 0x42, 0x80],
  );
});

test('toggleSet: tier ladder は排他、multi は共存', () => {
  let sets = ['ascii'];
  sets = toggleSet(sets, 'hanJa1', true);
  assert.deepEqual(sets, ['ascii', 'hanJa1']);
  sets = toggleSet(sets, 'hanJa3', true); // 同じ ladder → 置き換え
  assert.deepEqual(sets, ['ascii', 'hanJa3']);
  sets = toggleSet(sets, 'hiragana', true); // 別軸 → 共存
  assert.deepEqual(sets, ['ascii', 'hanJa3', 'hiragana']);
  sets = toggleSet(sets, 'hanJa3', false);
  assert.deepEqual(sets, ['ascii', 'hiragana']);
});

test('splitBmp: BMP 外の分離（常用漢字の 𠮟）', () => {
  const jouyou = codepointsOfSet('hanJa1');
  // hanJa1 は BMP のみ（charsets-data 生成時に除外済み）
  assert.equal(splitBmp(jouyou).dropped.length, 0);
  const { bmp, dropped } = splitBmp([0x20, 0x20b9f]);
  assert.deepEqual(bmp, [0x20]);
  assert.deepEqual(dropped, [0x20b9f]);
});

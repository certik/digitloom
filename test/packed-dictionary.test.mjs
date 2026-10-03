import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { unpackDictionary } from '../web/dictionary.js';

const plain = JSON.parse(await readFile(new URL('../web/data/db.json', import.meta.url)));
const compressed = await readFile(new URL('../web/data/db.txt.gz', import.meta.url));

test('packed asset preserves the entire dictionary, metadata, and ranked lists', () => {
  assert.deepEqual(unpackDictionary(gunzipSync(compressed).toString('utf8')), plain);
  assert.ok(compressed.length < 650_000);
  assert.ok(compressed.length < Buffer.byteLength(JSON.stringify(plain)) * 0.23);
});

test('native decompression yields exactly the same dictionary as gzip tooling', async () => {
  const text = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  assert.deepEqual(unpackDictionary(text), plain);
});

test('packed format handles leading zeros, punctuation, Unicode, and all POS combinations', () => {
  const header = {
    format: 'digitloom-columns', version: 2, dictionaryVersion: 5,
    source: { maxCodeLength: 2, pairCount: 8, codeCount: 1 },
    codes: ['00'], counts: [8]
  };
  const words = ['café', "a's", 'comma,', 'quote"', 'four', 'five', 'six', 'seven'];
  const frequencies = [900, 773, 500, 351, 350, 349, 100, 0];
  const column = frequencies.map((frequency) => frequency.toString(36).padStart(2, '0')).join('');
  const db = unpackDictionary(`${JSON.stringify(header)}\n01234567\n${column}\n${words.join('\n')}`);
  assert.deepEqual(db.byCode['00'], words.map((word, i) =>
    [word, ['', 'n', 'v', 'nv', 'a', 'na', 'va', 'nva'][i], frequencies[i]]));
});

test('malformed packed data is rejected rather than silently omitting entries', () => {
  const header = {
    format: 'digitloom-columns', version: 2, dictionaryVersion: 5,
    source: { maxCodeLength: 1, pairCount: 1, codeCount: 1 },
    codes: ['0'], counts: [1]
  };
  for (const text of [
    '', '{}', 'null\n0\n00\nword', '{\n0\n00\nword',
    `${JSON.stringify(header)}\n8\n00\nword`,
    `${JSON.stringify(header)}\n\n00\nword`,
    `${JSON.stringify(header)}\n0\n00\nword\nextra`,
    `${JSON.stringify(header)}\n0\nword`,
    ...['', '0', '000', 'zz', '-1', 'A0', '??'].map((frequency) => `${JSON.stringify(header)}\n0\n${frequency}\nword`),
    ...[
      { ...header, format: 'unknown' },
      { ...header, version: 1 },
      { ...header, dictionaryVersion: 4 },
      { ...header, counts: [2] },
      { ...header, counts: [-1] },
      { ...header, counts: [0.5] },
      { ...header, codes: ['__proto__'] },
      { ...header, codes: ['0', '0'], counts: [1, 1] },
      { ...header, codes: [0] }
    ].map((meta) => `${JSON.stringify(meta)}\n0\n00\nword`)
  ]) {
    assert.throws(() => unpackDictionary(text), undefined, text);
  }
});

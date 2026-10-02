import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { unpackDictionary } from '../web/dictionary.js';

const plain = JSON.parse(await readFile(new URL('../web/data/db.json', import.meta.url)));
const compressed = await readFile(new URL('../web/data/db.txt.gz', import.meta.url));

test('packed asset preserves the entire dictionary, metadata, and ranked lists', () => {
  assert.deepEqual(unpackDictionary(gunzipSync(compressed).toString('utf8')), plain);
  assert.ok(compressed.length < 530_000);
  assert.ok(compressed.length < Buffer.byteLength(JSON.stringify(plain)) * 0.23);
});

test('native decompression yields exactly the same dictionary as gzip tooling', async () => {
  const text = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  assert.deepEqual(unpackDictionary(text), plain);
});

test('packed format handles leading zeros, punctuation, Unicode, and all POS combinations', () => {
  const header = {
    format: 'digitloom-columns', version: 1, dictionaryVersion: 3,
    source: { maxCodeLength: 2, pairCount: 8, codeCount: 1 },
    codes: ['00'], counts: [8]
  };
  const words = ['café', "a's", 'comma,', 'quote"', 'four', 'five', 'six', 'seven'];
  const db = unpackDictionary(`${JSON.stringify(header)}\n01234567\n${words.join('\n')}`);
  assert.deepEqual(db.byCode['00'], words.map((word, i) => [word, ['', 'n', 'v', 'nv', 'a', 'na', 'va', 'nva'][i]]));
});

test('malformed packed data is rejected rather than silently omitting entries', () => {
  const header = {
    format: 'digitloom-columns', version: 1, dictionaryVersion: 3,
    source: { maxCodeLength: 1, pairCount: 1, codeCount: 1 },
    codes: ['0'], counts: [1]
  };
  for (const text of [
    '', '{}', 'null\n0\nword', '{\n0\nword',
    `${JSON.stringify(header)}\n8\nword`,
    `${JSON.stringify(header)}\n\nword`,
    `${JSON.stringify(header)}\n0\nword\nextra`,
    ...[
      { ...header, format: 'unknown' },
      { ...header, counts: [2] },
      { ...header, counts: [-1] },
      { ...header, counts: [0.5] },
      { ...header, codes: ['__proto__'] },
      { ...header, codes: ['0', '0'], counts: [1, 1] },
      { ...header, codes: [0] }
    ].map((meta) => `${JSON.stringify(meta)}\n0\nword`)
  ]) {
    assert.throws(() => unpackDictionary(text), undefined, text);
  }
});

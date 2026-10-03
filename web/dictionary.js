import { DICTIONARY_VERSION, validateDatabase } from './logic.js?v=5';

export function unpackDictionary(text) {
  const invalid = () => { throw new Error('Invalid packed word database; rebuild it with npm run build:data.'); };
  const first = text.indexOf('\n');
  const second = text.indexOf('\n', first + 1);
  const third = text.indexOf('\n', second + 1);
  if (first < 0 || second < 0 || third < 0) invalid();
  const header = JSON.parse(text.slice(0, first));
  if (header?.format !== 'digitloom-columns' || header.version !== 2 || header.dictionaryVersion !== DICTIONARY_VERSION ||
      !Array.isArray(header.codes) || !Array.isArray(header.counts) ||
      header.codes.length !== header.counts.length) invalid();
  const flags = text.slice(first + 1, second);
  const frequencies = text.slice(second + 1, third);
  const rest = text.slice(third + 1);
  const words = rest === '' ? [] : rest.split('\n');
  if (flags.length !== words.length || !/^[0-7]*$/.test(flags) ||
      frequencies.length !== words.length * 2 || !/^[0-9a-z]*$/.test(frequencies)) invalid();
  const parts = ['', 'n', 'v', 'nv', 'a', 'na', 'va', 'nva'];
  const byCode = {};
  let offset = 0;
  for (let group = 0; group < header.codes.length; group += 1) {
    const code = header.codes[group];
    const count = header.counts[group];
    if (typeof code !== 'string' || !/^[0-9]+$/.test(code) || Object.hasOwn(byCode, code) ||
        !Number.isSafeInteger(count) || count < 1 || count > words.length - offset) invalid();
    const entries = [];
    for (let i = 0; i < count; i += 1) {
      const frequency = Number.parseInt(frequencies.slice(offset * 2, offset * 2 + 2), 36);
      entries.push([words[offset], parts[Number(flags[offset])], frequency]);
      offset += 1;
    }
    byCode[code] = entries;
  }
  if (offset !== words.length) invalid();
  return validateDatabase({ version: header.dictionaryVersion, source: header.source, byCode });
}

export async function loadDictionary() {
  const nativeGzip = typeof DecompressionStream === 'function';
  const asset = nativeGzip ? './data/db.txt.gz' : './data/db.json';
  const response = await fetch(new URL(`${asset}?v=${DICTIONARY_VERSION}`, import.meta.url));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!nativeGzip) return validateDatabase(await response.json());
  let bytes = await response.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  // Some hosts send Content-Encoding: gzip and fetch has already decompressed it.
  if (signature[0] === 0x1f && signature[1] === 0x8b) {
    bytes = await new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    ).arrayBuffer();
  }
  return unpackDictionary(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

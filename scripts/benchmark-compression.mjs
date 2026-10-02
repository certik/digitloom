import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, brotliDecompressSync, constants, gzipSync, gunzipSync } from 'node:zlib';
import { formats } from './compression-formats.mjs';
import { validateDatabase } from '../web/logic.js';

const root = new URL('../', import.meta.url);
const input = await readFile(new URL('web/data/db.json', root));
const db = validateDatabase(JSON.parse(input));
const output = new URL('.cache/compression/', root);
await mkdir(output, { recursive: true });

const codecs = {
  raw: { compress: (data) => Buffer.from(data), decompress: (data) => data },
  gzip1: { compress: (data) => gzipSync(data, { level: 1 }), decompress: gunzipSync },
  gzip6: { compress: (data) => gzipSync(data, { level: 6 }), decompress: gunzipSync },
  gzip9: { compress: (data) => gzipSync(data, { level: 9 }), decompress: gunzipSync },
  brotli5: {
    compress: (data) => brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }),
    decompress: brotliDecompressSync
  },
  brotli9: {
    compress: (data) => brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }),
    decompress: brotliDecompressSync
  },
  brotli11: {
    compress: (data) => brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
    decompress: brotliDecompressSync
  }
};

const results = [];
for (const [name, format] of Object.entries(formats)) {
  const encoded = name === 'json' ? input : format.encode(db);
  assert.deepEqual(validateDatabase(format.decode(encoded)), db, `${name}: lossless round trip`);
  for (const [codecName, codec] of Object.entries(codecs)) {
    const start = performance.now();
    const compressed = codec.compress(encoded);
    const compressionMs = performance.now() - start;
    const filename = `${name}.${codecName}`;
    await writeFile(new URL(filename, output), compressed);
    assert.deepEqual(validateDatabase(format.decode(codec.decompress(compressed))), db, filename);
    const times = [];
    for (let i = 0; i < 7; i += 1) {
      const before = performance.now();
      validateDatabase(format.decode(codec.decompress(compressed)));
      times.push(performance.now() - before);
    }
    const row = {
      format: name, codec: codecName, bytes: compressed.length,
      compressionMs: Math.round(compressionMs),
      nodeDecodeValidateMs: Math.round(times.sort((a, b) => a - b)[3] * 10) / 10
    };
    results.push(row);
    console.log(`${name.padEnd(13)} ${codecName.padEnd(8)} ${String(row.bytes).padStart(8)} bytes, decode+validate ${row.nodeDecodeValidateMs} ms`);
  }
}

const shardSizes = { raw: [], gzip9: [], brotli11: [] };
for (let digit = 0; digit < 10; digit += 1) {
  const shard = {
    ...db,
    byCode: Object.fromEntries(Object.entries(db.byCode).filter(([code]) => code.startsWith(String(digit))))
  };
  const bytes = Buffer.from(JSON.stringify(shard));
  for (const codec of Object.keys(shardSizes)) shardSizes[codec].push(codecs[codec].compress(bytes).length);
}
const report = {
  inputSha256: createHash('sha256').update(input).digest('hex'),
  baselineBytes: input.length,
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  methodology: 'All representations preserve source metadata, every word/code/POS pair, and within-code rank. Median of 7 warm Node decode+validation trials. Compression uses Node zlib. Browser timings are measured separately.',
  results,
  firstDigitShards: Object.fromEntries(Object.entries(shardSizes).map(([codec, bytes]) => [
    codec, { sizes: bytes, totalBytes: bytes.reduce((sum, n) => sum + n, 0), meanInitialBytes: Math.round(bytes.reduce((sum, n) => sum + n, 0) / 10) }
  ]))
};

const production = await readFile(new URL('web/data/db.txt.gz', root));
const loader = await readFile(new URL('web/dictionary.js', root));
report.selectedImplementation = {
  file: 'web/data/db.txt.gz',
  bytes: production.length,
  sha256: createHash('sha256').update(production).digest('hex'),
  reductionPercent: Math.round((1 - production.length / input.length) * 10000) / 100,
  extraLoaderBytes: loader.length,
  extraLoaderGzipBytes: gzipSync(loader, { level: 9 }).length,
  reason: 'Compact column text with lexicographically ordered codes and gzip level 9. Preserves all metadata and within-code ranks. Works on plain static hosting with native DecompressionStream(gzip), no decoder dependency. Original JSON is a capability-based fallback, not a retry for failed compressed requests.'
};

if (process.argv.includes('--extended')) {
  const python = new URL(process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python', root);
  const script = `
import gzip,json,lzma,msgpack,sys
raw=sys.stdin.buffer.read()
db=json.loads(raw)
packed=msgpack.packb(db,use_bin_type=True)
assert msgpack.unpackb(packed,raw=False)==db
results={}
for name,data in [('json',raw),('messagepack',packed)]:
    compressed=lzma.compress(data,preset=9)
    assert lzma.decompress(compressed)==data
    results[name]={'rawBytes':len(data),'gzip9Bytes':len(gzip.compress(data,compresslevel=9,mtime=0)),'lzma9Bytes':len(compressed)}
print(json.dumps(results))
`;
  report.extended = JSON.parse(execFileSync(fileURLToPath(python), ['-c', script], { input }));
  report.extended.note = 'Python gzip/lzma and MessagePack via the pinned data-build environment. Neither MessagePack nor LZMA has a built-in browser decoder; no extra decoder was added to the app.';
}

if (process.argv.includes('--browser')) {
  const { chromium } = await import('@playwright/test');
  const fixtures = new Map();
  const cases = [
    { name: 'json-raw', format: 'json', codec: 'raw', transport: 'plain' },
    { name: 'json-http-gzip', format: 'json', codec: 'gzip9', transport: 'http' },
    { name: 'json-http-brotli', format: 'json', codec: 'brotli11', transport: 'http' },
    { name: 'json-native-gzip', format: 'json', codec: 'gzip9', transport: 'native' },
    { name: 'columnar-native-gzip', format: 'lexical-columnar', codec: 'gzip9', transport: 'native' },
    { name: 'columnar-http-brotli', format: 'lexical-columnar', codec: 'brotli11', transport: 'http' },
    { name: 'columnar-text-native-gzip', format: 'columnar-text', codec: 'gzip9', transport: 'native' },
    { name: 'production-native-gzip', format: 'production', codec: 'gzip9', transport: 'native' }
  ];
  for (const item of cases) {
    fixtures.set(`/${item.name}`, {
      bytes: await readFile(item.format === 'production' ? new URL('web/data/db.txt.gz', root) : new URL(`${item.format}.${item.codec}`, output)),
      encoding: item.transport === 'http' ? (item.codec.startsWith('brotli') ? 'br' : 'gzip') : null
    });
  }
  fixtures.set('/formats.mjs', { bytes: await readFile(new URL('scripts/compression-formats.mjs', root)), type: 'text/javascript' });
  fixtures.set('/logic.mjs', { bytes: await readFile(new URL('web/logic.js', root)), type: 'text/javascript' });
  fixtures.set('/logic.js', fixtures.get('/logic.mjs'));
  fixtures.set('/dictionary.js', { bytes: await readFile(new URL('web/dictionary.js', root)), type: 'text/javascript' });
  const server = createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Dictionary benchmark</title>');
      return;
    }
    const fixture = fixtures.get(request.url);
    if (!fixture) {
      response.writeHead(404).end();
      return;
    }
    const headers = {
      'Content-Type': fixture.type ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Length': fixture.bytes.length
    };
    if (fixture.encoding) headers['Content-Encoding'] = fixture.encoding;
    response.writeHead(200, headers).end(fixture.bytes);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      window.formats = (await import('/formats.mjs')).formats;
      window.validate = (await import('/logic.mjs')).validateDatabase;
      const { unpackDictionary } = await import('/dictionary.js');
      window.formats.production = { decode: (bytes) => unpackDictionary(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
    });
    const session = await page.context().newCDPSession(page);
    await session.send('Network.enable');
    await session.send('Network.setCacheDisabled', { cacheDisabled: true });
    report.browser = {
      version: browser.version(),
      methodology: 'Fresh HTTP requests, cache disabled; median of 3 trials per condition. Time includes fetch, native/HTTP decompression, decoding and complete database validation. Throttling via Chromium DevTools; loopback server, not a real mobile device. No site assets or rendering included.',
      nativeSupport: await page.evaluate(() => Object.fromEntries(['gzip', 'brotli'].map((name) => {
        try { new DecompressionStream(name); return [name, true]; } catch { return [name, false]; }
      }))),
      results: []
    };
    for (const condition of [
      { name: 'local', latency: 0, throughput: -1, cpu: 1 },
      { name: 'mobile-simulation', latency: 150, throughput: 200000, cpu: 4 }
    ]) {
      await session.send('Network.emulateNetworkConditions', {
        offline: false, latency: condition.latency,
        downloadThroughput: condition.throughput, uploadThroughput: condition.throughput
      });
      await session.send('Emulation.setCPUThrottlingRate', { rate: condition.cpu });
      for (const item of cases) {
        const trials = [];
        for (let i = 0; i < 3; i += 1) {
          trials.push(await page.evaluate(async (item) => {
            const start = performance.now();
            const response = await fetch(`/${item.name}`, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            let bytes = await response.arrayBuffer();
            const downloaded = performance.now();
            if (item.transport === 'native') {
              bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
            }
            const decompressed = performance.now();
            const decoded = window.formats[item.format].decode(new Uint8Array(bytes));
            const db = item.format === 'production' ? decoded : window.validate(decoded);
            if (db.source.pairCount !== 127228) throw new Error('Incomplete dictionary');
            const end = performance.now();
            return {
              totalMs: end - start, downloadMs: downloaded - start,
              decompressMs: decompressed - downloaded, decodeValidateMs: end - decompressed
            };
          }, item));
        }
        const medians = Object.fromEntries(Object.keys(trials[0]).map((key) => [
          key, Math.round(trials.map((row) => row[key]).sort((a, b) => a - b)[1] * 10) / 10
        ]));
        const row = { condition: condition.name, name: item.name, bytes: fixtures.get(`/${item.name}`).bytes.length, ...medians };
        report.browser.results.push(row);
        console.log('Browser:', JSON.stringify(row));
      }
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
await writeFile(new URL('reports/compression-benchmark.json', root), `${JSON.stringify(report, null, 2)}\n`);

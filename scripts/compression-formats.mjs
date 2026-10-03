const encoder = new TextEncoder();
const decoder = new TextDecoder();

function header(db) {
  return JSON.stringify({ version: db.version, source: db.source });
}

function safeText(value) {
  if (/[\t\r\n]/.test(value)) throw new Error('The text experiment cannot represent tabs or newlines.');
  return value;
}

function rowsByWord(db) {
  const rows = new Map();
  for (const [code, entries] of Object.entries(db.byCode)) {
    entries.forEach(([word, pos, frequency], rank) => {
      if (!rows.has(word)) rows.set(word, { pos, frequency, codes: [] });
      const row = rows.get(word);
      if (row.pos !== pos || row.frequency !== frequency) {
        throw new Error('Word-table experiment requires consistent POS tags and frequencies.');
      }
      row.codes.push(`${code}:${rank}`);
    });
  }
  return [...rows].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

function decodeColumns(packed) {
  const words = packed.words.split('\n');
  const byCode = {};
  let index = 0;
  const flags = ['', 'n', 'v', 'nv', 'a', 'na', 'va', 'nva'];
  packed.codes.forEach((code, group) => {
    byCode[code] = [];
    for (let count = 0; count < packed.counts[group]; count += 1) {
      byCode[code].push([words[index], flags[Number(packed.flags[index])],
        Number.parseInt(packed.frequencies.slice(index * 2, index * 2 + 2), 36)]);
      index += 1;
    }
  });
  return { version: packed.version, source: packed.source, byCode };
}

export const formats = {
  json: {
    encode: (db) => encoder.encode(`${JSON.stringify(db)}\n`),
    decode: (bytes) => JSON.parse(decoder.decode(bytes))
  },
  'flat-json': {
    encode: (db) => encoder.encode(JSON.stringify({
      version: db.version, source: db.source,
      byCode: Object.fromEntries(Object.entries(db.byCode).map(([code, entries]) => [code, entries.flat()]))
    })),
    decode: (bytes) => {
      const db = JSON.parse(decoder.decode(bytes));
      for (const code of Object.keys(db.byCode)) {
        const values = db.byCode[code];
        db.byCode[code] = [];
        for (let i = 0; i < values.length; i += 3) db.byCode[code].push(values.slice(i, i + 3));
      }
      return db;
    }
  },
  'grouped-text': {
    encode: (db) => encoder.encode([
      header(db),
      ...Object.entries(db.byCode).map(([code, entries]) => [code, ...entries.flat().map(safeText)].join('\t'))
    ].join('\n')),
    decode: (bytes) => {
      const [meta, ...lines] = decoder.decode(bytes).split('\n');
      const db = { ...JSON.parse(meta), byCode: {} };
      for (const line of lines) {
        const [code, ...values] = line.split('\t');
        const entries = [];
        for (let i = 0; i < values.length; i += 3) entries.push([values[i], values[i + 1], Number(values[i + 2])]);
        db.byCode[code] = entries;
      }
      return db;
    }
  },
  columnar: {
    encode: (db) => {
      const groups = Object.entries(db.byCode);
      const words = groups.flatMap(([, entries]) => entries);
      return encoder.encode(JSON.stringify({
        version: db.version, source: db.source,
        codes: groups.map(([code]) => code),
        counts: groups.map(([, entries]) => entries.length),
        words: words.map(([word]) => safeText(word)).join('\n'),
        flags: words.map(([, pos]) => String((pos.includes('n') ? 1 : 0) |
          (pos.includes('v') ? 2 : 0) | (pos.includes('a') ? 4 : 0))).join(''),
        frequencies: words.map(([, , frequency]) => frequency.toString(36).padStart(2, '0')).join('')
      }));
    },
    decode: (bytes) => decodeColumns(JSON.parse(decoder.decode(bytes)))
  },
  'word-table': {
    encode: (db) => encoder.encode([
      header(db),
      ...rowsByWord(db).map(([word, row]) => [safeText(word), row.pos, row.frequency, ...row.codes].join('\t'))
    ].join('\n')),
    decode: (bytes) => {
      const [meta, ...lines] = decoder.decode(bytes).split('\n');
      const byCode = {};
      for (const line of lines) {
        const [word, pos, frequency, ...codes] = line.split('\t');
        for (const value of codes) {
          const [code, rank] = value.split(':');
          (byCode[code] ??= [])[Number(rank)] = [word, pos, Number(frequency)];
        }
      }
      return { ...JSON.parse(meta), byCode };
    }
  },
  'front-coded': {
    encode: (db) => {
      let previous = '';
      const lines = rowsByWord(db).map(([word, row]) => {
        let prefix = 0;
        while (prefix < previous.length && prefix < word.length && word[prefix] === previous[prefix]) prefix += 1;
        const result = [prefix, safeText(word.slice(prefix)), row.pos, row.frequency, ...row.codes].join('\t');
        previous = word;
        return result;
      });
      return encoder.encode([header(db), ...lines].join('\n'));
    },
    decode: (bytes) => {
      const [meta, ...lines] = decoder.decode(bytes).split('\n');
      const byCode = {};
      let previous = '';
      for (const line of lines) {
        const [prefix, suffix, pos, frequency, ...codes] = line.split('\t');
        const word = previous.slice(0, Number(prefix)) + suffix;
        previous = word;
        for (const value of codes) {
          const [code, rank] = value.split(':');
          (byCode[code] ??= [])[Number(rank)] = [word, pos, Number(frequency)];
        }
      }
      return { ...JSON.parse(meta), byCode };
    }
  }
};

const lexicalGroups = (db) => Object.entries(db.byCode).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);

formats['lexical-json'] = {
  encode: (db) => encoder.encode(`{"version":${db.version},"source":${JSON.stringify(db.source)},"byCode":{${lexicalGroups(db)
    .map(([code, entries]) => `${JSON.stringify(code)}:${JSON.stringify(entries)}`).join(',')}}}`),
  decode: formats.json.decode
};
formats['lexical-text'] = {
  encode: (db) => encoder.encode([
    header(db),
    ...lexicalGroups(db).map(([code, entries]) => [code, ...entries.flat().map(safeText)].join('\t'))
  ].join('\n')),
  decode: formats['grouped-text'].decode
};
formats['lexical-columnar'] = {
  encode: (db) => {
    const packed = JSON.parse(decoder.decode(formats.columnar.encode(db)));
    const groups = lexicalGroups(db);
    const entries = groups.flatMap(([, words]) => words);
    packed.codes = groups.map(([code]) => code);
    packed.counts = groups.map(([, words]) => words.length);
    packed.words = entries.map(([word]) => safeText(word)).join('\n');
    packed.flags = entries.map(([, pos]) => String((pos.includes('n') ? 1 : 0) |
      (pos.includes('v') ? 2 : 0) | (pos.includes('a') ? 4 : 0))).join('');
    packed.frequencies = entries.map(([, , frequency]) => frequency.toString(36).padStart(2, '0')).join('');
    return encoder.encode(JSON.stringify(packed));
  },
  decode: formats.columnar.decode
};
formats['columnar-text'] = {
  encode: (db) => {
    const { words, flags, frequencies, ...meta } = JSON.parse(decoder.decode(formats['lexical-columnar'].encode(db)));
    return encoder.encode([JSON.stringify(meta), flags, frequencies, words].join('\n'));
  },
  decode: (bytes) => {
    const text = decoder.decode(bytes);
    const first = text.indexOf('\n');
    const second = text.indexOf('\n', first + 1);
    const third = text.indexOf('\n', second + 1);
    return decodeColumns({
      ...JSON.parse(text.slice(0, first)),
      flags: text.slice(first + 1, second),
      frequencies: text.slice(second + 1, third),
      words: text.slice(third + 1)
    });
  }
};

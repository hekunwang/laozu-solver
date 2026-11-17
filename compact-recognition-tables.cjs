'use strict';

const vm = require('node:vm');

// This function is emitted into both browser contexts. The low and high bytes
// occupy separate planes so normal HTTP compression can exploit their distinct
// distributions. The public rows and their signature arrays stay mutable.
function decodeRecognitionSignatureRows(metadata, encoded, width, scale) {
  const count = metadata.length * width;
  const bytes = new Uint8Array(count * (scale === 1 ? 1 : 2));
  let written = 0;
  if (typeof atob === 'function') {
    const binary = atob(encoded);
    for (; written < binary.length; written++) bytes[written] = binary.charCodeAt(written);
  } else {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let word = 0, bits = 0;
    for (let i = 0; i < encoded.length; i++) {
      if (encoded[i] === '=') break;
      const digit = alphabet.indexOf(encoded[i]);
      if (digit < 0) throw Error('Invalid recognition signature data');
      word = (word << 6) | digit;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes[written++] = (word >> bits) & 255;
        word &= (1 << bits) - 1;
      }
    }
  }
  if (written !== bytes.length) throw Error('Incomplete recognition signature data');
  let offset = 0;
  return metadata.map(row => {
    const sig = new Array(width);
    for (let column = 0; column < width; column++, offset++) {
      sig[column] = scale === 1 ? bytes[offset] : (bytes[offset] + 256 * bytes[count + offset]) / scale;
    }
    return Array.isArray(row) ? {equipId:row[0], name:row[1], sig} : {equipId:row, sig};
  });
}

function encodeRows(rows, width) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const supported = rows.every(row => row && Number.isSafeInteger(row.equipId) && Array.isArray(row.sig)
    && row.sig.length === width && (Object.keys(row).join(',') === 'equipId,sig'
      || Object.keys(row).join(',') === 'equipId,name,sig' && typeof row.name === 'string'));
  if (!supported) return null;
  const scale = rows.every(row => row.sig.every(Number.isInteger)) ? 1 : 100;
  const count = rows.length * width;
  const bytes = Buffer.alloc(count * (scale === 1 ? 1 : 2));
  let offset = 0;
  for (const row of rows) for (const value of row.sig) {
    const packed = Math.round(value * scale);
    // New schemas or higher-precision source values keep the original JSON.
    // Never round a signature to improve its packing ratio.
    if (value < 0 || value > 255 || !Number.isFinite(value) || !Object.is(packed / scale, value)) return null;
    bytes[offset] = packed & 255;
    if (scale !== 1) bytes[count + offset] = packed >> 8;
    offset++;
  }
  const metadata = rows.map(row => row.name === undefined ? row.equipId : [row.equipId, row.name]);
  return 'decodeRecognitionSignatureRows('+JSON.stringify(metadata)+','+JSON.stringify(bytes.toString('base64'))+','+width+','+scale+')';
}

function uniqueStart(source, anchor) {
  const start = source.indexOf(anchor);
  if (start < 0 || source.indexOf(anchor, start + anchor.length) !== -1) throw Error('Recognition table anchor changed: '+anchor);
  return start;
}

function jsonValueEnd(source, start) {
  let depth = 0, quoted = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '\\') i++;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '[' || char === '{') depth++;
    else if ((char === ']' || char === '}') && --depth === 0) return i + 1;
  }
  throw Error('Incomplete recognition table literal');
}

function replaceJson(source, anchor, render) {
  const start = uniqueStart(source, anchor) + anchor.length;
  if (source[start] !== '[' && source[start] !== '{') throw Error('Expected a recognition table literal');
  const end = jsonValueEnd(source, start);
  const replacement = render(JSON.parse(source.slice(start, end)));
  return replacement === null ? source : source.slice(0, start) + replacement + source.slice(end);
}

function compactRecognitionTables(app) {
  const zeroAnchor = 'const AW_ZERO_SAMPLES=';
  app = replaceJson(app, zeroAnchor, table => {
    const encoded = encodeRows(table.samples, 192);
    if (encoded === null) return null;
    return '{'+Object.keys(table).map(key => JSON.stringify(key)+':'+(key === 'samples' ? encoded : JSON.stringify(table[key]))).join(',')+'}';
  });
  app = replaceJson(app, 'ot.push(...', rows => encodeRows(rows, 48));

  // The archived upstream table is itself a quoted JSON document. Evaluate
  // only the isolated JS string literal, then parse and validate its JSON.
  const builtin = uniqueStart(app, ',ot=JSON.parse(') + ',ot='.length;
  const quotedStart = builtin + 'JSON.parse('.length;
  const quoted = /^(?:'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*")/.exec(app.slice(quotedStart))?.[0];
  if (!quoted || app[quotedStart + quoted.length] !== ')') throw Error('Legacy recognition table literal changed');
  const rows = JSON.parse(vm.runInNewContext(quoted));
  const encoded = encodeRows(rows, 48);
  if (encoded !== null) app = app.slice(0, builtin) + encoded + app.slice(quotedStart + quoted.length + 1);

  const insert = uniqueStart(app, zeroAnchor);
  return app.slice(0, insert) + decodeRecognitionSignatureRows.toString() + '\n' + app.slice(insert);
}

module.exports = compactRecognitionTables;

'use strict';

// These are the three JSON constants injected into both the page and the solver
// by patch-upstream. Keep the original JSON text: public catalog objects can be
// edited after startup, and a later Worker must still get the original program.
const tableNames = ['AWDB', 'ACDB', 'AC_ATTR_NAMES'];

function exactlyOnce(source, token, description) {
  const offset = source.indexOf(token);
  if (offset < 0 || source.indexOf(token, offset + token.length) >= 0) {
    throw Error('Solver table compaction expected exactly one ' + description);
  }
  return offset;
}

function tableLiteral(source, name) {
  const prefix = '\nconst ' + name + '=';
  const offset = exactlyOnce(source, prefix, name + ' declaration');
  const start = offset + prefix.length;
  const end = source.indexOf(';\n', start);
  if (end < 0) throw Error('Missing end of solver table ' + name);
  const json = source.slice(start, end);
  JSON.parse(json);
  return {name, start, end, json};
}

// A single-quoted JS literal keeps the many JSON double quotes unescaped.
function quoteJsonText(text) {
  const escaped = {"'":"\\'",'\\':'\\\\','\n':'\\n','\r':'\\r','\u2028':'\\u2028','\u2029':'\\u2029'};
  return "'" + text.replace(/['\\\n\r\u2028\u2029]/g, c => escaped[c]) + "'";
}

function compactSolverTables(app, worker) {
  const marker = '/* compact-solver-tables-v1 */';
  if (app.includes(marker)) throw Error('Solver tables already compacted');
  const edits = [];
  function replace(original, replacement, description) {
    const start = exactlyOnce(app, original, description);
    edits.push({start, end:start + original.length, replacement});
    return start;
  }

  const tables = tableNames.map(name => {
    const page = tableLiteral(app, name);
    const embedded = tableLiteral(worker, name);
    if (page.json !== embedded.json) throw Error('Main/Worker solver table differs: ' + name);
    const textName = 'solverJson' + name;
    if (app.includes(textName)) throw Error('Solver JSON binding already exists: ' + textName);
    // Keep the original table declaration position and one parsed JS table for
    // normal page code. No stringify or data copying runs on the solver path.
    replace('\nconst ' + name + '=' + page.json + ';',
      '\nconst ' + textName + '=' + quoteJsonText(page.json) + ';\nconst ' + name + '=JSON.parse(' + textName + ');',
      'main ' + name + ' initializer');
    return {page, embedded, textName};
  });
  const acquired = tables.find(table => table.page.name === 'ACDB');
  const catalog = exactlyOnce(app, '\nconst z=', 'catalog declaration');
  // The public rows and the solver's ACDB are independently mutable in r7.
  // Share their packed text and parse each once to retain that isolation.
  const catalogRows = replace('"acquiredTalents":' + acquired.page.json,
    '"acquiredTalents":JSON.parse(' + acquired.textName + ')', 'matching acquired talent catalog');
  const originalBinding = ',ra=' + JSON.stringify(worker) + ',Kt=';
  const binding = exactlyOnce(app, originalBinding, 'embedded solver source');
  if (acquired.page.end >= catalog || catalog >= catalogRows || catalogRows >= binding) throw Error('Unexpected catalog or solver declaration order');

  // Only the ordering within the Worker matters here. It differs from the
  // order on the page. All text between its table literals stays byte-for-byte.
  let cursor = 0;
  const chunks = [];
  for (const {embedded, textName} of [...tables].sort((a,b) => a.embedded.start - b.embedded.start)) {
    chunks.push(JSON.stringify(worker.slice(cursor, embedded.start)), textName);
    cursor = embedded.end;
  }
  chunks.push(JSON.stringify(worker.slice(cursor)));
  const sourceGetter = marker + '(()=>{let source;return ()=>source??=[' + chunks.join(',') + '].join("")})()';
  const blob = 'typeof self<"u"&&self.Blob&&new Blob([ra],{type:"text/javascript;charset=utf-8"})';
  replace(originalBinding + blob + ';',
    ',ra=' + sourceGetter + ',Kt=(()=>{let blob;return ()=>blob??=(typeof self!=="undefined"&&self.Blob&&new Blob([ra()],{type:"text/javascript;charset=utf-8"}))})();',
    'solver source and Blob construction');
  replace('if(e=Kt&&(self.URL||self.webkitURL).createObjectURL(Kt),!e)',
    'const blob=Kt();if(e=blob&&(self.URL||self.webkitURL).createObjectURL(blob),!e)', 'Blob URL solver constructor');
  replace('encodeURIComponent(ra),{name:t?.name}', 'encodeURIComponent(ra()),{name:t?.name}', 'inline solver fallback');
  replace('workerSource:ra,', 'get workerSource(){return ra()},', 'public solver source');

  // Apply non-overlapping ranges from right to left; earlier offsets stay valid.
  let boundary = app.length;
  for (const edit of edits.sort((a,b) => b.start-a.start)) {
    if (edit.end > boundary) throw Error('Overlapping solver table compaction edits');
    app = app.slice(0,edit.start) + edit.replacement + app.slice(edit.end);
    boundary = edit.start;
  }
  return app;
}

module.exports = {compactSolverTables};

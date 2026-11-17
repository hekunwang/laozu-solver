'use strict';

// Keep this function self-contained: its source is embedded before app startup.
function migrate(storage) {
  const targetPrefix = 'wydl-bag:official:v1:';
  const legacyPrefixes = ['wydl-bag:local-2611031142:v1:', 'wydl-bag:prerelease-2610152238:v1:', 'wydl-bag:v1:'];
  const suffixes = ['state', 'plans', 'layouts', 'import-decisions'];
  const markerKey = targetPrefix + 'migration';
  const report = {version: 1, complete: false, keys: {}, errors: []};
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const state = value => object(value) && value.version === 1 && object(value.holdings)
    && Object.values(value.holdings).every(n => Number.isFinite(n) && n >= 0);
  const piece = value => object(value) && Number.isInteger(value.equipId)
    && Array.isArray(value.cells) && value.cells.length > 0
    && value.cells.every(n => Number.isInteger(n) && n >= 0 && n < 42)
    && (value.copyIndex === undefined || (Number.isInteger(value.copyIndex) && value.copyIndex >= 0 && value.copyIndex < 99))
    && (value.awakenLevel === undefined || (Number.isInteger(value.awakenLevel) && value.awakenLevel >= 0 && value.awakenLevel <= 5));
  const layout = row => {
    if (!object(row) || typeof row.name !== 'string' || !row.name.trim()
      || !Array.isArray(row.pieces) || row.pieces.length === 0) return false;
    const occupied = new Set;
    return row.pieces.every(value => piece(value) && value.cells.every(cell => {
      if (occupied.has(cell)) return false;
      occupied.add(cell);
      return true;
    }));
  };
  const valid = (suffix, value) => {
    if (suffix === 'state') return state(value);
    if (!Array.isArray(value)) return false;
    // The original loaders filter individual entries. Preserve the raw array
    // whenever one entry can survive that filtering, including rejected rows;
    // an explicit [] remains authoritative and is never filled from old data.
    if (value.length === 0) return true;
    if (suffix === 'plans') return value.some(row => object(row) && typeof row.name === 'string'
      && object(row.state) && row.state.version === 1);
    // Catalog-specific equipment/shape checks remain with the original loader.
    if (suffix === 'layouts') return value.some(layout);
    return value.some(row => object(row) && Number.isInteger(row.equipId)
      && Array.isArray(row.sig) && row.sig.length === 48);
  };
  const decode = (suffix, raw) => {
    if (raw === null) return 'missing';
    try { return valid(suffix, JSON.parse(raw)) ? 'valid' : 'invalid-schema'; }
    catch { return 'invalid-json'; }
  };
  let operation = 'read-marker';
  try {
    const marker = storage.getItem(markerKey);
    if (marker !== null) {
      let parsed;
      try { parsed = JSON.parse(marker); } catch {}
      // Do not replace an unrecognized marker or infer permission to migrate.
      if (object(parsed) && parsed.version === 1 && parsed.complete === true)
        return {...parsed, skipped: true};
      report.errors.push({operation, reason: 'invalid-marker'});
      return report;
    }
    // Complete every input read before writing anything. A denied read must not
    // be interpreted as absent data, and must not select a different source.
    const snapshots = {};
    for (const suffix of suffixes) {
      snapshots[suffix] = [];
      for (const prefix of [targetPrefix, ...legacyPrefixes]) {
        const key = prefix + suffix;
        operation = 'read:' + key;
        const raw = storage.getItem(key);
        snapshots[suffix].push({key, raw, status: decode(suffix, raw)});
      }
    }
    for (const suffix of suffixes) {
      const [target, ...sources] = snapshots[suffix];
      const entry = report.keys[suffix] = {target: target.key, status: target.status};
      if (target.status !== 'missing') {
        entry.source = target.key;
        entry.action = target.status === 'valid' ? 'keep-target' : 'preserve-invalid-target';
        continue;
      }
      entry.rejectedSources = sources.filter(row => row.status !== 'valid' && row.status !== 'missing')
        .map(row => ({key: row.key, reason: row.status}));
      const source = sources.find(row => row.status === 'valid');
      if (!source) { entry.action = 'default'; continue; }
      entry.source = source.key;
      entry.action = 'copy';
      operation = 'write:' + target.key;
      storage.setItem(target.key, source.raw);
      operation = 'verify:' + target.key;
      if (storage.getItem(target.key) !== source.raw) throw Error('readback-mismatch');
      entry.status = 'valid';
    }
    // Data has already been read back. This final, atomic setItem is the commit;
    // there are no fallible storage calls after it. Reset leaves this marker.
    const committed = {...report, complete: true};
    operation = 'write-marker';
    storage.setItem(markerKey, JSON.stringify(committed));
    return committed;
  } catch (error) {
    report.errors.push({operation, reason: error && typeof error.message === 'string' ? error.message : 'storage-error'});
    return report;
  }
}

function patchOfficialStorage({app}) {
  if (typeof app !== 'string') throw Error('Official storage patch requires app source');
  const matches = [...app.matchAll(/wydl-bag:v1:([a-z0-9:_-]+)/g)];
  const expected = ['import-decisions', 'layouts', 'plans', 'state'];
  if (matches.length !== 4 || matches.map(row => row[1]).sort().join(',') !== expected.join(','))
    throw Error('Expected exactly the four original persistent storage keys');
  if (app.includes('wydl-bag:official:') || app.includes('wydl-bag:prerelease-'))
    throw Error('Official storage patch requires an unnamespaced formal app');
  const rewritten = app.replaceAll('wydl-bag:v1:', 'wydl-bag:official:v1:');
  return ';(()=>{try{const storage=globalThis.localStorage;if(storage)(' + migrate.toString()
    + ')(storage);}catch{}})();\n' + rewritten;
}

module.exports = patchOfficialStorage;
module.exports.migrate = migrate;

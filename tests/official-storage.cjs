'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const patch = require('../patch-official-storage.cjs');
const {migrate} = patch;
const P = 'wydl-bag:prerelease-2610152238:v1:';
const L = 'wydl-bag:v1:';
const T = 'wydl-bag:official:v1:';
const C = 'wydl-bag:local-2611031142:v1:';
const M = T + 'migration';
const names = ['state', 'plans', 'layouts', 'import-decisions'];
const json = JSON.stringify;
const state = (id = 250703) => ({version: 1, holdings: {[id]: 1}, awaken: {[id]: [5]}, budgetMs: 12345, currentLayout: null});
const fixtures = {
  state: state(),
  plans: [{name: '先遣方案', state: state()}],
  layouts: [{name: '先遣收藏', pieces: [{equipId: 250703, copyIndex: 0, awakenLevel: 5, cells: [0, 7, 14, 21]}]}],
  'import-decisions': [{equipId: 250703, sig: Array(48).fill(10)}]
};
function store(entries = [], options = {}) {
  const map = new Map(entries), calls = [];
  return {map, calls,
    getItem(key) { calls.push(['get', key]); if (options.failAt === calls.length) throw Error('read-denied'); return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { calls.push(['set', key]); if (options.failAt === calls.length) throw Error('write-denied'); map.set(key, options.corruptKey === key ? 'corrupted' : String(value)); },
    removeItem(key) { calls.push(['remove', key]); map.delete(key); }
  };
}
const entries = prefix => names.map(name => [prefix + name, ' \n' + json(fixtures[name]) + '\n']);
const checks = [];
function check(name, fn) { fn(); checks.push(name); }
function preserved(s, originals) { for (const [key, raw] of originals) assert.equal(s.map.get(key), raw, 'source bytes: ' + key); }

check('fresh install commits once and later reset never resurrects sources', () => {
  const s = store(); assert.equal(migrate(s).complete, true);
  for (const name of names) assert(!s.map.has(T + name));
  s.map.set(P + 'state', json(state()));
  const result = migrate(s); assert.equal(result.skipped, true); assert(!s.map.has(T + 'state'));
});
check('prerelease beats old formal per key and preserves every source byte', () => {
  const original = [...entries(P), ...entries(L)]; const s = store(original);
  const result = migrate(s); assert.equal(result.complete, true);
  for (const name of names) { assert.equal(s.map.get(T + name), s.map.get(P + name)); assert.equal(result.keys[name].source, P + name); }
  assert.equal(JSON.parse(s.map.get(T + 'state')).awaken[250703][0], 5);
  preserved(s, original);
  s.map.delete(T + 'state');
  assert.equal(migrate(s).skipped, true); assert(!s.map.has(T + 'state'));
});
check('existing target including explicit empty always wins', () => {
  const original = [...entries(P), ...entries(L), [T + 'state', json({version: 1, holdings: {}})], ...names.slice(1).map(n => [T + n, '[]'])];
  const s = store(original), result = migrate(s); assert.equal(result.complete, true);
  for (const name of names) assert.equal(result.keys[name].action, 'keep-target');
  preserved(s, original);
});
check('candidate storage is a read-only fallback and never overwrites released data', () => {
  const original=[...entries(C),...entries(P)],s=store(original),result=migrate(s);
  assert.equal(result.complete,true);
  for(const name of names)assert.equal(result.keys[name].source,C+name);
  preserved(s,original);
  const target=[T+'state',json({version:1,holdings:{}})],existing=store([...original,target]);
  assert.equal(migrate(existing).keys.state.action,'keep-target');
  assert.equal(existing.map.get(T+'state'),target[1]);preserved(existing,original);
});
check('explicit empty prerelease is not filled from populated old formal', () => {
  const original = [...entries(L), [P + 'state', json({version: 1, holdings: {}})], ...names.slice(1).map(n => [P + n, '[]'])];
  const s = store(original); assert.equal(migrate(s).complete, true);
  assert.deepEqual(JSON.parse(s.map.get(T + 'state')).holdings, {});
  for (const name of names.slice(1)) assert.equal(s.map.get(T + name), '[]');
  preserved(s, original);
});
check('missing and corrupt prerelease fall back independently with recorded provenance', () => {
  for (const raw of ['{broken', '', 'null', '{}', '{"version":2,"holdings":{}}', '[]']) {
    const original = [...entries(L), [P + 'state', raw], [P + 'plans', '[]']];
    const s = store(original), result = migrate(s); assert.equal(result.complete, true);
    assert.equal(result.keys.state.source, L + 'state'); assert.equal(result.keys.state.rejectedSources.length, 1);
    assert.equal(result.keys.layouts.source, L + 'layouts'); assert.equal(s.map.get(T + 'plans'), '[]');
    assert.deepEqual(JSON.parse(s.map.get(M)).keys, result.keys); preserved(s, original);
  }
});
check('invalid target remains untouched rather than silently replaced', () => {
  for (const raw of ['{broken', '', 'null', '{}', '[]']) {
    const original = [...entries(P), [T + 'state', raw]]; const s = store(original), result = migrate(s);
    assert.equal(result.complete, true); assert.equal(result.keys.state.action, 'preserve-invalid-target'); preserved(s, original);
  }
});
check('invalid arrays remain at source and are never mistaken for explicit empty', () => {
  for (const name of names.slice(1)) {
    const original = [...entries(L), [P + name, '[null]']]; const s = store(original), result = migrate(s);
    assert.equal(result.keys[name].source, L + name); assert.equal(result.keys[name].rejectedSources[0].reason, 'invalid-schema'); preserved(s, original);
  }
});
check('mixed plans retain recoverable entries, original bytes, and prerelease priority', () => {
  const normal = {name: 'Partial legacy state', state: {version: 1}};
  const raw = ' \n' + json([null, {name: 'bad', state: null}, normal, ...fixtures.plans]) + '\n';
  const original = [...entries(L), [P + 'plans', raw]], s = store(original), result = migrate(s);
  assert.equal(result.complete, true); assert.equal(result.keys.plans.source, P + 'plans');
  assert.equal(s.map.get(T + 'plans'), raw); preserved(s, original);
  const rows = JSON.parse(s.map.get(T + 'plans')).filter(row => row && typeof row.name === 'string' && row.state && row.state.version === 1);
  assert.equal(rows.length, 2); assert.deepEqual(rows[0], normal);
});
check('mixed layouts retain recoverable entries, original bytes, and prerelease priority', () => {
  const overlap = {name: 'overlap', pieces: [{equipId: 250703, cells: [0, 0]}]};
  const badCopy = {name: 'copy too large', pieces: [{equipId: 250703, copyIndex: 99, cells: [0]}]};
  const raw = ' \n' + json([null, {name: 'bad', pieces: null}, overlap, badCopy, ...fixtures.layouts]) + '\n';
  const original = [...entries(L), [P + 'layouts', raw]], s = store(original), result = migrate(s);
  assert.equal(result.complete, true); assert.equal(result.keys.layouts.source, P + 'layouts');
  assert.equal(s.map.get(T + 'layouts'), raw); preserved(s, original);
  const fallback = store([...entries(L), [P + 'layouts', json([null, overlap, badCopy])]]);
  assert.equal(migrate(fallback).keys.layouts.source, L + 'layouts');
});
check('mixed import decisions follow original signature shape check and preserve bytes', () => {
  // Original Ba checks only equipId and signature length, not sample elements.
  const originalLoaderAccepts = {equipId: 250704, sig: Array(48).fill(null)};
  const raw = ' \n' + json([null, {equipId: 250703, sig: []}, originalLoaderAccepts]) + '\n';
  const original = [...entries(L), [P + 'import-decisions', raw]], s = store(original), result = migrate(s);
  assert.equal(result.complete, true); assert.equal(result.keys['import-decisions'].source, P + 'import-decisions');
  assert.equal(s.map.get(T + 'import-decisions'), raw); preserved(s, original);
  const accepted = JSON.parse(s.map.get(T + 'import-decisions')).filter(row => row && Number.isInteger(row.equipId) && Array.isArray(row.sig) && row.sig.length === 48);
  assert.deepEqual(accepted, [originalLoaderAccepts]);
});
check('invalid marker is preserved without any migration writes', () => {
  for (const raw of ['broken', 'null', '{}', '{"version":1,"complete":false}']) {
    const original = [...entries(P), [M, raw]], s = store(original); assert.equal(migrate(s).complete, false);
    assert.equal(s.calls.filter(x => x[0] === 'set').length, 0); preserved(s, original);
  }
});
check('every individual read or write failure leaves marker absent and sources intact; retry is safe', () => {
  const original = entries(P), baseline = store(original); assert.equal(migrate(baseline).complete, true);
  for (let failAt = 1; failAt <= baseline.calls.length; failAt++) {
    const s = store(original, {failAt}); let result; assert.doesNotThrow(() => { result = migrate(s); });
    assert.equal(result.complete, false, 'failure point ' + failAt); assert(!s.map.has(M)); preserved(s, original);
    // The failure is one-shot. Any successfully copied target remains authoritative.
    assert.equal(migrate(s).complete, true, 'retry at ' + failAt); preserved(s, original);
    for (const name of names) assert.equal(s.map.get(T + name), s.map.get(P + name));
  }
});
check('readback mismatch prevents completion and preserves all legacy bytes', () => {
  const original = entries(P), s = store(original, {corruptKey: T + 'state'}), result = migrate(s);
  assert.equal(result.complete, false); assert.equal(result.errors[0].reason, 'readback-mismatch'); assert(!s.map.has(M)); preserved(s, original);
});
const originalApp = 'globalThis.observed=[' + names.map(n => 'localStorage.getItem(' + json(L + n) + ')').join(',') + '];';
check('patch validates exactly four keys and migration precedes every app read', () => {
  const output = patch({app: originalApp}); new vm.Script(output);
  const s = store(entries(P)), context = {localStorage: s}; vm.runInNewContext(output, context);
  assert.deepEqual(Array.from(context.observed), names.map(n => s.map.get(P + n)));
  assert(output.indexOf('complete: false') < output.indexOf('globalThis.observed'));
  assert.throws(() => patch({app: originalApp + json(L + 'unknown')}));
  assert.throws(() => patch({app: originalApp + json(L + 'state')}));
  assert.throws(() => patch({app: originalApp.replace(L + 'plans', L + 'plan')}));
  assert.throws(() => patch({app: originalApp.replace(L + 'plans', L + 'plans:unexpected')}));
  assert.throws(() => patch({app: output}));
});
check('bootstrap catches denied localStorage getter and does not prevent app execution', () => {
  const output = patch({app: names.map(n => 'const k' + names.indexOf(n) + '=' + json(L + n) + ';').join('') + 'globalThis.loaded=true;'});
  const context = {}; Object.defineProperty(context, 'localStorage', {get() { throw Error('SecurityError'); }});
  assert.doesNotThrow(() => vm.runInNewContext(output, context)); assert.equal(context.loaded, true);
});
check('actual frozen app has exactly the expected four persistent keys', () => {
  const actual = fs.readFileSync(path.join(__dirname, '../upstream-bundle.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(patch({app: actual})));
});

console.log(json({passed: true, checks: checks.length, names: checks}, null, 2));

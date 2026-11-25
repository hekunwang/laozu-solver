'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const manifest = JSON.parse(read('web/manifest.json'));
const bundle = read(path.join('web', manifest.app));
const window = {matchMedia: () => ({matches: false}), addEventListener() {}};
const saved = new Map();
const localStorage = {
  getItem: key => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value),
  removeItem: key => saved.delete(key)
};
// Run the built application up to its DOM mount, using its real state and scoring APIs.
const start = bundle.indexOf('var g0');
const mount = bundle.lastIndexOf(',Ha=document.getElementById');
assert(start >= 0 && mount > start);
vm.runInNewContext(bundle.slice(start, mount) + ';', {
  window, localStorage, console, atob, Uint8ClampedArray, navigator: {hardwareConcurrency: 4},
  B: (object, key, value) => { object[key] = value; }, setTimeout: () => 0, clearTimeout() {}
});
const app = window.laozuLocal;
const catalog = app.catalog;
const plain = value => JSON.parse(JSON.stringify(value));
const worker = {postMessage() {}};
const ready = 'q({type:"ready"})';
assert.equal(app.workerSource.split(ready).length, 2);
vm.runInNewContext(app.workerSource.replace(ready,
  'self.engine={compile:mt,Layout:St,tableBuilder:st};' + ready),
  {self: worker, setTimeout: () => 0, performance: {now: () => 0}});

const glyphs = JSON.parse(read('data/talent-glyphs.json'));
const limited = [12021, 12022, 12023];
const placeholders = JSON.parse(read('data/Ability.json'))
  .filter(row => row.iType === 4 && row.iLevel === 0 && row.szDesc === '待补充');
assert.equal(catalog.talents.length, 104);
assert.equal(catalog.acquiredTalents.length, 193);
assert.equal(placeholders.length, 14);
for (const row of placeholders) {
  assert(!catalog.talents.some(talent => talent.id === row.iAbilityID));
  assert(!glyphs.words.some(word => word.id === row.iAbilityID && word.kind === 'innate'));
}
for (const id of limited) {
  const row = catalog.talents.find(talent => talent.id === id);
  assert.equal(row.form, 2);
  assert(row.appliesToAllForms);
  assert(glyphs.words.some(word => word.id === id && word.kind === 'innate' && word.name === row.name));
}

function select(innate, acquired) {
  app.talentReview.apply({innate, acquired});
  return app.objective.value;
}
// Restore a pre-update plan, then round-trip a new plan through the same importer.
select([12001], [208003]);
const oldConfig = plain(app.serialize());
select(limited, [208006]);
const newConfig = plain(app.serialize());
for (const config of [oldConfig, newConfig]) {
  assert(app.importState(config).saved);
  assert.deepEqual(plain(app.talentReview.read()), {
    innate: config.talentPicks, acquired: config.acquiredTalentPicks
  });
}
assert.throws(() => select([12021, 12021], []), /重复/);
assert.throws(() => select([...limited, 12001, 12002], []), /四格/);

const board = {rows: 6, cols: 7, blocked: []};
let placements = 0;
function checkPieces(options, equipment, expected) {
  const engines = [app, worker.engine].map(engine => ({engine, compiled: engine.compile(catalog, options)}));
  for (const equip of equipment) {
    const shape = catalog.shapes.find(row => row.id === equip.shapeId);
    const piece = {equipId: equip.id, name: equip.name, cells: shape.cells.map(([r,c]) => r * 7 + c),
      copyIndex: 0, awakenLevel: 0};
    const detailed = app.score(catalog, [piece], options);
    const result = detailed.pieces[0];
    const {bonuses, advanced, sourceIds} = expected(equip);
    for (const attr of equip.base) {
      const rate = (bonuses[attr.attr] || 0) / 10000;
      const value = Math.round(Math.fround(attr.value * Math.fround(1 + Math.fround(rate))));
      assert.equal(result.base.find(row => row.attr === attr.attr).value, value, equip.name);
    }
    assert.deepEqual(plain(result.accumulated.map(row => [row.attr, row.value])), advanced, equip.name);
    const sources = result.sources.filter(row => row.kind === 'innate').map(row => row.skillName);
    const expectedSources = sourceIds.map(id => catalog.talents.find(row => row.id === id).name);
    assert.deepEqual(plain(sources).sort(), expectedSources.sort());
    for (const {engine, compiled} of engines) {
      const table = engine.tableBuilder([shape], board);
      const candidates = [{...piece, index: 0, equipIndex: compiled.equipIndexById.get(equip.id),
        shapeId: shape.id, tier: equip.tier, element: equip.element}];
      const layout = new engine.Layout(compiled, table, candidates);
      assert(layout.place(0, 0));
      assert(Math.abs(layout.total - detailed.powerTotal) < .001, equip.name + ' incremental score');
    }
    placements++;
  }
}
const examples = ids => ids.map(id => {
  const equip = catalog.equips.find(row => row.id === id);
  assert(equip);
  return equip;
});
const allForms = examples([110101,150106,150208,150205,150506,250104,150108,150504,150508]);
assert.deepEqual(new Set(allForms.map(eq => eq.weaponForm)), new Set(catalog.equips.map(eq => eq.weaponForm)));
checkPieces(select([...limited, 12001], []), allForms, equip => ({
  bonuses: {2001: equip.weaponForm === 2 ? 1500 : 1200, 2002: 1200, 2003: 1200},
  advanced: [], sourceIds: equip.weaponForm === 2 ? [...limited,12001] : limited
}));
const affected = examples([150205,150504,150106]);
for (const [id, forms, attr, value, damage] of [
  [204004,[4],2001,750,300], [204007,[4],2001,1000,600],
  [208003,[8],2002,750,300], [208006,[8],2002,1000,600], [303124,[4,8],2003,1000,500]
]) {
  checkPieces(select([], [id]), affected, equip => forms.includes(equip.weaponForm)
    ? {bonuses: {[attr]: value}, advanced: [[2025, damage]], sourceIds: []}
    : {bonuses: {}, advanced: [], sourceIds: []});
}
checkPieces(select([12022], [208006]), affected, equip => ({
  bonuses: {2002: equip.weaponForm === 8 ? 2200 : 1200},
  advanced: equip.weaponForm === 8 ? [[2025,600]] : [], sourceIds: [12022]
}));
for (const [id, rate, attr, value] of [
  [106003,200,2037,300], [106006,400,2037,600], [107002,200,2082,200], [107005,400,2082,400]
]) {
  const row = catalog.acquiredTalents.find(talent => talent.id === id);
  assert.deepEqual(Object.fromEntries(row.effects.map(effect => [effect.attr,effect.value])),
    {2047: 10000, 2049: rate, [attr]: value});
  checkPieces(select([], [id]), affected, () => ({bonuses: {}, advanced: [], sourceIds: []}));
}
assert.match(catalog.acquiredTalents.find(row => row.id === 204004).desc, /7\.5%/);
for (const [id, text] of [[104,'无法返还'],[207,'并附加自身10%'],[208,'并附加自身30%'],[320,'最多5层']]) {
  assert(catalog.tips.find(row => row.id === id).desc.includes(text));
}
console.log(JSON.stringify({suite:'formal-talent-scoring', placements, forms:allForms.length,
  comparison:['detailed','incremental','solver worker'], innate:catalog.talents.length,
  acquired:catalog.acquiredTalents.length, placeholders:placeholders.length}));

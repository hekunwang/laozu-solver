'use strict';
// Instance identity and cumulative effects regressions. Expected attack values
// below are hand-calculated from the public resource rows, not another scorer.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const executable=source.slice(source.indexOf('var g0'),source.lastIndexOf(',Ha=document.getElementById'))+';';
const window={matchMedia:()=>({matches:false}),addEventListener:()=>{}};
const storage=new Map();
vm.runInNewContext(executable,{
  B:(object,key,value)=>{object[key]=value;},window,console,atob,Uint8ClampedArray,
  setTimeout:()=>0,clearTimeout:()=>{},navigator:{hardwareConcurrency:4},
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}
},{filename:'instance-main-without-dom.js'});
const main=window.laozuLocal;
for(const name of ['effects','level','pieceLevel','candidateBuilder','snapshot','restoreAwaken','validatePieces','restorePieces','bookmark','validateLayout'])
  assert.equal(typeof main[name],'function','Missing test interface: '+name);
const workerSelf={postMessage:()=>{}};
const workerCode=main.workerSource.replace('q({type:"ready"})',
  'self.testEngine={compile:mt,Layout:St,tableBuilder:st,candidates:yt,snapshot:F};q({type:"ready"})');
vm.runInNewContext(workerCode,{self:workerSelf,setTimeout:()=>0,performance:{now:()=>0}},{filename:'instance-worker.js'});
const worker=workerSelf.testEngine,catalog=main.catalog;
const plain=value=>JSON.parse(JSON.stringify(value));
const close=(actual,expected,label)=>assert(Math.abs(actual-expected)<1e-8*Math.max(1,Math.abs(expected)),`${label}: ${actual} != ${expected}`);
const eq=id=>catalog.equips.find(piece=>piece.id===id);
const shape={id:987655,cells:[[0,0]],width:1,height:1};
const board={rows:6,cols:7,blocked:[]};
const testCatalog={...catalog,shapes:[shape],equips:catalog.equips.map(piece=>({...piece,shapeId:shape.id}))};
let cases=0;

function runPair(id,levels,expectedAttacks,extraId=150109){
  const options={kind:'power',awaken:{[id]:levels}};
  const holdings=[{equipId:id,count:2},{equipId:extraId,count:1}];
  const compiled=main.compile(testCatalog,options),workerCompiled=worker.compile(testCatalog,options);
  const candidates=main.candidateBuilder(testCatalog,holdings,42,compiled.equipIndexById);
  const workerCandidates=worker.candidates(testCatalog,holdings,42,workerCompiled.equipIndexById);
  assert.deepEqual(plain(candidates),plain(workerCandidates),'candidate parity');
  const copies=candidates.candidates.filter(piece=>piece.equipId===id);
  assert.equal(copies.length,2);
  if(levels[0]!==levels[1])assert.notEqual(copies[0].equipIndex,copies[1].equipIndex,'Different levels must use different profiles');
  const mainTable=main.tableBuilder([shape],board),workerTable=worker.tableBuilder([shape],board);
  const a=new main.Layout(compiled,mainTable,candidates.candidates),b=new worker.Layout(workerCompiled,workerTable,workerCandidates.candidates);
  const cellOf=piece=>piece.equipId===id?piece.copyIndex:41;
  for(const piece of candidates.candidates){assert(a.place(piece.index,cellOf(piece)));assert(b.place(piece.index,cellOf(piece)));}
  const pieces=candidates.candidates.map(piece=>main.snapshot(piece.index,a.placementOf(piece.index),mainTable,candidates.candidates));
  const workerPieces=workerCandidates.candidates.map(piece=>worker.snapshot(piece.index,b.placementOf(piece.index),workerTable,workerCandidates.candidates));
  assert.deepEqual(plain(pieces),plain(workerPieces),'snapshot parity');
  for(const piece of pieces.filter(piece=>piece.equipId===id)){
    assert.equal(piece.awakenLevel,levels[piece.copyIndex]);
    assert.equal(piece.cells[0],piece.copyIndex);
  }
  const detail=main.score(testCatalog,pieces,options);
  close(a.total,detail.powerTotal,'main/detail');close(b.total,detail.powerTotal,'worker/detail');
  for(const result of detail.pieces){
    const expected=result.piece.equipId===id?expectedAttacks[result.piece.copyIndex]:expectedAttacks[2];
    close(result.finalAtk,expected,'independent attack expectation');
  }
  // Nonadjacent third piece changes when a global aura source is removed.
  const high=copies.find(piece=>piece.awakenLevel===3);
  a.remove(high.index);b.remove(high.index);
  const remaining=pieces.filter(piece=>piece.candidateIndex!==high.index);
  const after=main.score(testCatalog,remaining,options);
  close(a.total,after.powerTotal,'main remove/detail');close(b.total,after.powerTotal,'worker remove/detail');
  cases++;
  return {pieces,options,holdings};
}

// Yang Jian: 135 attack; Awakening 1 gives 40% per adjacent metal piece;
// Awakening 2 adds 20% base; Awakening 3 adds 15% base to every other spear.
// Jin Ling has 79 base attack, so the distant third piece gets floor(79*1.15)=90.
const mixed13=runPair(150104,[1,3],[217,226.8,90]);
runPair(150104,[0,3],[155,226.8,90]);
// Two level-3 sources each exclude themselves, but buff the other source;
// the distant spear receives both 15% auras, so floor(79*1.30)=102.
runPair(150104,[3,3],[254.8,254.8,102]);
// Deng Chan Yu: 109 attack, Awakening 1 gives 30%; level 2 base becomes 130;
// level 3 adds 8% to neighbors. The unawakened distant spear remains 79.
runPair(150107,[1,3],[150.42,169,79]);
runPair(150107,[0,3],[117.72,169,79]);

const yang3=main.effects(eq(150104),3),deng3=main.effects(eq(150107),3),jin3=main.effects(eq(150109),3);
assert.deepEqual(plain(yang3.skillIds),[1045,10101],'Level 3 retains level 1 self skill');
assert.deepEqual(plain(yang3.baseBonus),{2001:2000,2002:2000,2003:2000},'Level 3 retains level 2 base bonuses');
assert.deepEqual(plain(yang3.globalBuffs),[
  {form:6,attr:2004,value:1500,excludeSource:true},{form:6,attr:2005,value:1500,excludeSource:true},{form:6,attr:2006,value:1500,excludeSource:true}
]);
assert.deepEqual(plain(deng3.skillIds),[10801,10802],'Level 3 has both self and adjacent effects');
assert.deepEqual(plain(deng3.baseBonus),{2001:2000,2002:2000,2003:2000});
assert.deepEqual(plain(jin3.baseBonus),{2001:5000,2002:5000,2003:5000},'Jin Ling 20% plus 30% equals 50%');

// A one-cell board can keep only one copy; the Aw3 copy must survive pruning.
const pruneOptions={kind:'power',awaken:{150104:[0,3]}};
for(const [name,engine,builder]of [['main',main,main.candidateBuilder],['worker',worker,worker.candidates]]){
  const c=engine.compile(testCatalog,pruneOptions);
  const result=builder(testCatalog,[{equipId:150104,count:2}],1,c.equipIndexById);
  assert.equal(result.prunedCount,1,name+' prune count');
  assert.equal(result.candidates[0].copyIndex,1,name+' retain high-level instance identity');
  assert.equal(result.candidates[0].awakenLevel,3,name+' retain high-level awakening');
  assert.equal(c.profiles[result.candidates[0].equipIndex].awakenLevel,3);
  assert.equal(engine.compile(testCatalog,{kind:'power',awaken:{150104:[0,1]}}).hasGlobal,false,
    name+' unused level 3 profile must not force full rescoring');
}

// A legacy scalar applies to the existing copies; subsequent copies start at 0.
const migrated=main.restoreAwaken({150104:3},{150104:2});
assert.deepEqual(plain(migrated[150104]),[3,3]);
assert.equal(main.level({awaken:migrated},150104,2),0,'New copies do not inherit a legacy level');
assert.deepEqual(plain(main.restoreAwaken(migrated,{150104:3})[150104]),[3,3,0],'Inventory growth creates an unawakened third copy');
assert.equal(main.level({awaken:{150104:[0,3]}},150104,0),0);
assert.equal(main.level({awaken:{150104:[0,3]}},150104,1),3);
assert.equal(main.pieceLevel({equipId:150104,copyIndex:0,awakenLevel:1},{awaken:{150104:[3,0]}}),1,
  'Frozen result metadata takes precedence');

main.holdings.value={150104:2,150109:1};main.awaken.value={150104:[1,3]};
const saved=main.validatePieces(mixed13.pieces);
assert(saved);
const restored=main.restorePieces(saved);
for(const original of mixed13.pieces){
  const a=saved.find(piece=>piece.equipId===original.equipId&&piece.cells[0]===original.cells[0]);
  const b=restored.find(piece=>piece.equipId===original.equipId&&piece.cells[0]===original.cells[0]);
  assert.equal(a.copyIndex,original.copyIndex,'validated save preserves copy');
  assert.equal(a.awakenLevel,original.awakenLevel,'validated save preserves level');
  assert.equal(b.copyIndex,original.copyIndex,'restored save preserves copy');
  assert.equal(b.awakenLevel,original.awakenLevel,'restored save preserves level');
}
main.bookmark('instance regression',mixed13.pieces,0,'power');
const bookmark=main.bookmarks.value.find(item=>item.name==='instance regression');
assert(bookmark);
assert.deepEqual(plain(bookmark.pieces),plain(saved),'Bookmark must retain instance identity');
assert.equal(main.validateLayout(mixed13.pieces,board,mixed13.holdings).length,0,'Valid instances accepted');
const duplicate=plain(mixed13.pieces);
const copies=duplicate.filter(piece=>piece.equipId===150104);
copies[1].copyIndex=copies[0].copyIndex;copies[1].awakenLevel=copies[0].awakenLevel;
assert(main.validateLayout(duplicate,board,mixed13.holdings).length>0,'One instance cannot be used twice');

console.log(JSON.stringify({passed:true,mixedCases:cases,engines:['detailed','main incremental','embedded worker'],checks:[
  'different levels on identical equipment','literal cumulative official effects','distant aura add/remove',
  'high-level copy pruning','save restore bookmark metadata','legacy migration and new-copy level 0','duplicate instance rejection'
]},null,2));

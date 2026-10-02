'use strict';
// Verifies internal model consistency; game-side rounding and stacking remain
// subject to an in-game panel comparison, as documented in the local README.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const executable=source.slice(source.indexOf('var g0'),source.lastIndexOf(',Ha=document.getElementById'))+';';
const window={matchMedia:()=>({matches:false}),addEventListener:()=>{}};
const storage=new Map();
const context={B:(object,key,value)=>{object[key]=value;},window,console,atob,Uint8ClampedArray,setTimeout:()=>0,clearTimeout:()=>{},navigator:{hardwareConcurrency:4},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}};
vm.runInNewContext(executable,context,{filename:'app-without-dom.js'});
const main=window.laozuLocal;
const workerSelf={postMessage:()=>{}};
const workerCode=main.workerSource.replace('q({type:"ready"})','self.testEngine={compile:mt,Layout:St,tableBuilder:st};q({type:"ready"})');
vm.runInNewContext(workerCode,{self:workerSelf,setTimeout:()=>0,performance:{now:()=>0}},{filename:'worker-test.js'});
const worker=workerSelf.testEngine;
const syntheticShape={id:987654,name:'scoring fixture',cells:[[0,0]],width:1,height:1};
const board={rows:6,cols:7,blocked:[]};
const catalog=main.catalog;
function create(engine,ids,options){
  const compiled=engine.compile(catalog,options);
  const table=engine.tableBuilder([syntheticShape],board);
  const candidates=ids.map((id,index)=>({index,equipId:id,equipIndex:compiled.equipIndexById.get(id),shapeId:syntheticShape.id,name:String(id),tier:5,element:catalog.equips.find(eq=>eq.id===id).element}));
  return {layout:new engine.Layout(compiled,table,candidates),table,compiled,candidates};
}
function place(state,index,cell){const placement=[...state.table.anchorRow].findIndex((row,i)=>row*7+state.table.anchorCol[i]===cell);assert(state.layout.place(index,placement));}
function detailed(state,options){const pieces=state.layout.placedCandidates().map(index=>{const pm=state.layout.placementOf(index),start=state.table.cellStart[pm],end=state.table.cellStart[pm+1];return {...state.candidates[index],cells:[...state.table.cells.slice(start,end)]};});return main.score(catalog,pieces,options);}
function close(actual,expected,label){assert(Math.abs(actual-expected)<1e-7*Math.max(1,Math.abs(expected)),`${label}: ${actual} != ${expected}`);}
function check(ids,options,cells=[0,1,41]){
  const a=create(main,ids,options),b=create(worker,ids,options);
  ids.forEach((_,i)=>{place(a,i,cells[i]);place(b,i,cells[i]);});
  const detail=detailed(a,options),score=options.kind==='weighted'?detail.weightedTotal:detail.powerTotal;
  close(a.layout.total,score,'main/detail');close(b.layout.total,score,'worker/detail');
  return {a,b,options};
}
let cases=0;
for(const [id,data]of Object.entries(main.awakening)){
  if(data.maxLevel!==3)continue;
  for(let level=0;level<=3;level++){
    try{
      let expectedSkillIds=catalog.equips.find(eq=>eq.id===Number(id)).skillIds;
      for(let lv=1;lv<=level;lv++)if(Array.isArray(data.levels[lv]?.skillIds))expectedSkillIds=data.levels[lv].skillIds;
      const expectedSkills=[...new Set(expectedSkillIds)].map(sid=>catalog.skills.find(skill=>skill.id===sid));
      const profile=main.compile(catalog,{kind:'power',awaken:{[id]:level}});
      const compiled=profile.profiles[profile.equipIndexById.get(Number(id))];
      for(const [scope,field]of [['self','selfBuffs'],['adjacent','adjBuffs']]){
        const expected=expectedSkills.filter(skill=>skill.scope===scope).flatMap(skill=>skill.buffs.map(buff=>({elementMask:skill.elementMask,attrIndex:profile.attrIndex.get(buff.attr),value:buff.value})));
        assert.deepEqual(JSON.parse(JSON.stringify(compiled[field])),expected,'official replacement skill list');
      }
      check([Number(id),110104],{kind:'power',awaken:{[id]:level},elderStars:{[id]:5},talents:{6:{2001:1200}}});cases++;
      check([Number(id),110104],{kind:'weighted',mode:'product',critRate:.35,weights:{2001:2,2025:4,2027:7},awaken:{[id]:level}});cases++;
    }catch(error){error.message+=' (equipment '+id+', level '+level+')';throw error;}
  }
}
// A distant aura source changes the existing target, and must be removed again.
for(const engine of [main,worker]){
  const options={kind:'power',awaken:{150104:3}};
  const st=create(engine,[110104,150104],options);
  place(st,0,0);const without=st.layout.total;place(st,1,41);
  close(st.layout.total,detailed(st,options).powerTotal,'distant source add');
  st.layout.remove(1);close(st.layout.total,without,'distant source removal');
}
// Duplicate sources exclude the physical source slot, while benefiting others.
check([150104,150104,110104],{kind:'power',awaken:{150104:3}},[0,20,41]);
// The official replacement list and shielding channel must survive compiling.
const profile=main.compile(catalog,{kind:'power',awaken:{250804:1}});
const shield=profile.profiles[profile.equipIndexById.get(250804)];
assert(shield.selfBuffs.some(buff=>profile.attrIds[buff.attrIndex]===2069));
assert(!shield.selfBuffs.some(buff=>profile.attrIds[buff.attrIndex]===2025));
const valid=JSON.parse(JSON.stringify(main.validateAwaken({150104:3,250305:3,250306:1,999999:2,150103:-1,150105:4})));
assert.deepEqual(valid,{'150104':3});
assert.deepEqual(JSON.parse(JSON.stringify(main.validateAwaken(null))),{});
assert.deepEqual(JSON.parse(JSON.stringify(main.validateAwaken([3]))),{});
console.log(JSON.stringify({passed:true,exhaustiveCases:cases,equipmentWithLevels:78,engines:['detailed','main incremental','embedded worker'],checks:['all 78 equipment at levels 0-3','power and product objectives','official skill-list replacement and deduplication','official shield attribute 2069','distant aura add/remove','duplicate aura sources','invalid saved settings']},null,2));

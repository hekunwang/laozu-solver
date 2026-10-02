#!/usr/bin/env node
'use strict';
// Reproducible, fail-closed patches against the archived upstream build.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = __dirname;
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const awakening = JSON.parse(read('data/awakening.json'));
const catalog = JSON.parse(read('data/game-catalog.json'));
let app = read('upstream-bundle.js');
function change(source, old, replacement, expected = 1) {
  const count = source.split(old).length - 1;
  if (count !== expected) throw new Error(`Patch anchor occurs ${count}, expected ${expected}: ${old.slice(0, 100)}`);
  return source.split(old).join(replacement);
}
const workerStart = app.indexOf(',ra=') + 4;
const workerEnd = app.indexOf(',Kt=', workerStart);
if (workerStart < 4 || workerEnd < 0) throw new Error('Embedded worker boundaries missing');
let worker = vm.runInNewContext(app.slice(workerStart, workerEnd));
app = app.slice(0, workerStart) + '__LOCAL_WORKER__' + app.slice(workerEnd);
const catalogStart = app.indexOf('const z=JSON.parse(');
const catalogEnd = app.indexOf("'),", catalogStart) + 2;
if (catalogStart < 0 || catalogEnd < 2) throw new Error('Catalog anchor missing');
app = app.slice(0, catalogStart) + `const z=${JSON.stringify(catalog)}` + app.slice(catalogEnd);
const shared = `
const AWDB=${JSON.stringify(awakening)};
function awEffects(eq,level){
  if(Number.isInteger(eq.awakenLevel))level=eq.awakenLevel;
  const data=AWDB[eq.id],out={baseBonus:{},skillIds:null,globalBuffs:[]};
  if(!data)return out;
  const limit=Math.min(data.maxLevel??3,Math.max(0,Number(level)||0));
  for(let lv=1;lv<=limit;lv++){
    const row=data.levels[lv];if(!row)continue;
    for(const [attr,value]of Object.entries(row.baseBonus||{}))out.baseBonus[attr]=(out.baseBonus[attr]||0)+value;
    if(Array.isArray(row.skillIds))out.skillIds=[...row.skillIds];out.globalBuffs.push(...(row.globalBuffs||[]));
  }
  return out;
}
function awSkills(eq,level){return [...new Set(awEffects(eq,level).skillIds??eq.skillIds)];}
function awLevel(options,id,copyIndex=0){const input=options?.awaken?.[id],lv=Array.isArray(input)?input[copyIndex]:input,max=AWDB[id]?.maxLevel??0;return Number.isInteger(lv)&&lv>=0&&lv<=max?lv:0;}
function awPieceLevel(piece,options){return Number.isInteger(piece.awakenLevel)?awLevel({awaken:{[piece.equipId]:piece.awakenLevel}},piece.equipId):awLevel(options,piece.equipId,piece.copyIndex??0);}
function awValidate(input){const out={};if(input&&typeof input==='object'&&!Array.isArray(input))for(const [id,lv]of Object.entries(input)){const max=AWDB[id]?.maxLevel??0;if(!AWDB[id])continue;if(Array.isArray(lv))out[id]=lv.slice(0,99).map(n=>Number.isInteger(n)&&n>=0&&n<=max?n:0);else if(Number.isInteger(lv)&&lv>=0&&lv<=max)out[id]=lv;}return out;}
function awRestore(input,holdings){const valid=awValidate(input),out={};for(const [id,count]of Object.entries(holdings||{})){if(!AWDB[id]||!Number.isInteger(count)||count<=0)continue;out[id]=Array.from({length:Math.min(99,count)},(_,copy)=>awLevel({awaken:valid},id,copy));}return out;}
`;
app = change(app, 'const z=', shared + '\nconst z=');
worker = change(worker, '(function(){"use strict";', '(function(){"use strict";' + shared);

app = change(app, 'Ne=C({}),De=C(', 'Ne=C({}),Aw=C({}),De=C(');
app = change(app, 'elderStars:e,talents:s}', 'elderStars:e,talents:s,awaken:Aw.value}', 2);
app = change(app, 'elderStars:Ne.value,talentPicks:De.value', 'elderStars:Ne.value,awaken:Aw.value,talentPicks:De.value');
app = change(app, 'Ne.value=nr(t.elderStars),De.value=', 'Ne.value=nr(t.elderStars),Aw.value=awValidate(t.awaken),De.value=');
app = change(app, 'Ne.value={},De.value=', 'Ne.value={},Aw.value={},De.value=');
app = change(app, 'l1=(t,e,s,a,n)=>{const l=_t(t,e),i=(s?.[t.weaponForm]?.[a]??0)/de,o=l+i;', 'l1=(t,e,s,a,n,level=awLevel({awaken:Aw.value},t.id),extraGlobal=0)=>{const l=_t(t,e),i=(s?.[t.weaponForm]?.[a]??0)/de,o=l+i+(awEffects(t,level).baseBonus[a]||0)/de+extraGlobal;');
worker = change(worker, 'ft=(n,t,e,s,o)=>{const i=pt(n,t),r=(e?.[n.weaponForm]?.[s]??0)/E,l=i+r;', 'ft=(n,t,e,s,o,level=0,extraGlobal=0)=>{const i=pt(n,t),r=(e?.[n.weaponForm]?.[s]??0)/E,l=i+r+(awEffects(n,level).baseBonus[s]||0)/E+extraGlobal;');

// Detailed scorer (including product weighting) and the fast profile compiler
// share the same cumulative skill IDs and additive percentage semantics.
app = change(app, 'for(const k of I.skillIds)', 'for(const k of awSkills(I,s.awaken?.[I.id]||0))');
app = change(app, 'for(const T of M.skillIds)', 'for(const T of awSkills(M,s.awaken?.[M.id]||0))');
app = change(app, 'const N=k=>l1(I,E,s.talents,k,I.base.find(M=>M.attr===k)?.value??0)', `
const globalBase={};
for(let source=0;source<e.length;source++){
  const sourceEq=a.get(e[source].equipId);
  for(const buff of awEffects(sourceEq,s.awaken?.[sourceEq.id]||0).globalBuffs){
    if(buff.form!==I.weaponForm||(buff.excludeSource&&source===h))continue;
    const basic={2004:2001,2005:2002,2006:2003}[buff.attr]??buff.attr;globalBase[basic]=(globalBase[basic]||0)+buff.value;S.push({attr:buff.attr,attrName:i(buff.attr),value:buff.value,kind:'neighbor',skillId:0,skillName:'觉醒光环',skillDesc:'背包内指定形态法宝基础属性提升',fromName:e[source].name});
  }
}
const N=k=>l1(I,E,s.talents,k,I.base.find(M=>M.attr===k)?.value??0,s.awaken?.[I.id]||0,(globalBase[k]||0)/de)`);
app = change(app, 'value:l1(I,E,s.talents,k.attr,k.value)', 'value:l1(I,E,s.talents,k.attr,k.value,s.awaken?.[I.id]||0,(globalBase[k.attr]||0)/de)');
app = change(app, 'l1(v,m,e.talents,b.attr,b.value)', 'l1(v,m,e.talents,b.attr,b.value,e.awaken?.[v.id]||0)');
app = change(app, 'for(const b of v.skillIds)', 'for(const b of awSkills(v,e.awaken?.[v.id]||0))');
app = change(app, 'c.push({equipId:v.id,element:v.element', 'c.push({equipId:v.id,rawBase:Float64Array.from(s,attr=>v.base.find(b=>b.attr===attr)?.value||0),baseBonusMultiplier:Float64Array.from(s,attr=>_t(v,m)+(e.talents?.[v.weaponForm]?.[attr]||0)/de+(awEffects(v,e.awaken?.[v.id]||0).baseBonus[attr]||0)/de),weaponForm:v.weaponForm,globalBuffs:awEffects(v,e.awaken?.[v.id]||0).globalBuffs,element:v.element');
app = change(app, 'profiles:c,equipIndexById:u', 'profiles:c,hasGlobal:c.some(profile=>profile.globalBuffs.length>0),equipIndexById:u');
worker = change(worker, 'ft(c,f,t.talents,y.attr,y.value)', 'ft(c,f,t.talents,y.attr,y.value,t.awaken?.[c.id]||0)');
worker = change(worker, 'for(const y of c.skillIds)', 'for(const y of awSkills(c,t.awaken?.[c.id]||0))');
worker = change(worker, 'p.push({equipId:c.id,element:c.element', 'p.push({equipId:c.id,rawBase:Float64Array.from(e,attr=>c.base.find(b=>b.attr===attr)?.value||0),baseBonusMultiplier:Float64Array.from(e,attr=>pt(c,f)+(t.talents?.[c.weaponForm]?.[attr]||0)/E+(awEffects(c,t.awaken?.[c.id]||0).baseBonus[attr]||0)/E),weaponForm:c.weaponForm,globalBuffs:awEffects(c,t.awaken?.[c.id]||0).globalBuffs,element:c.element');
worker = change(worker, 'profiles:p,equipIndexById:u', 'profiles:p,hasGlobal:p.some(profile=>profile.globalBuffs.length>0),equipIndexById:u');
app = change(app, 'recomputeSlots(e,s=e.length){for', 'recomputeSlots(e,s=e.length){if(this.ctx.hasGlobal){this.recomputeAll();return;}for');
worker = change(worker, 'recomputeSlots(t,e=t.length){for', 'recomputeSlots(t,e=t.length){if(this.ctx.hasGlobal){this.recomputeAll();return;}for');
app = change(app, 'const u=s.profiles[c];n.fill(0);', `const u=s.profiles[c];n.fill(0);const globalBase=new Float64Array(i);
if(s.hasGlobal)for(let source=0;source<a.length;source++){const profile=a[source];if(profile===W)continue;for(const buff of s.profiles[profile].globalBuffs){if(buff.form===u.weaponForm&&!(buff.excludeSource&&source===e)){const index=s.attrIndex.get({2004:2001,2005:2002,2006:2003}[buff.attr]??buff.attr);if(index!==undefined)globalBase[index]+=buff.value;}}}`);
worker = change(worker, 'const u=e.profiles[p];o.fill(0);', `const u=e.profiles[p];o.fill(0);const globalBase=new Float64Array(r);
if(e.hasGlobal)for(let source=0;source<s.length;source++){const profile=s[source];if(profile===-1)continue;for(const buff of e.profiles[profile].globalBuffs){if(buff.form===u.weaponForm&&!(buff.excludeSource&&source===t)){const index=e.attrIndex.get({2004:2001,2005:2002,2006:2003}[buff.attr]??buff.attr);if(index!==undefined)globalBase[index]+=buff.value;}}}`);
for(const attr of ['Atk','Def','Hp']){
  app=change(app,`u.base[s.i${attr}]*(1+n[s.i${attr}Pct]/de)`,`Math.floor(u.rawBase[s.i${attr}]*(1+(u.baseBonusMultiplier[s.i${attr}]+globalBase[s.i${attr}]/de)))*(1+n[s.i${attr}Pct]/de)`);
  worker=change(worker,`u.base[e.i${attr}]*(1+o[e.i${attr}Pct]/E)`,`Math.floor(u.rawBase[e.i${attr}]*(1+(u.baseBonusMultiplier[e.i${attr}]+globalBase[e.i${attr}]/E)))*(1+o[e.i${attr}Pct]/E)`);
}

// Keep the upstream stars panel intact, and append a reactive awakening panel.
app = change(app, 'function bl(){', 'function blOriginal(){');
const extension = `
function bl(){
  const levels=Aw.value,items=wl().filter(eq=>AWDB[eq.id]);
  return r(R,{children:[r(blOriginal,{}),r('h3',{children:'法宝觉醒'}),
    items.length?r('div',{class:'elder-rows',children:items.map(eq=>{
      const level=levels[eq.id]||0,data=AWDB[eq.id];
      return r('div',{class:'elder-row',children:[r('span',{class:'name',children:eq.name}),
        r('select',{'aria-label':eq.name+'觉醒等级',class:level?'elder-select on':'elder-select',value:String(level),disabled:data.maxLevel===0,onChange:event=>{Aw.value=awValidate({...Aw.value,[eq.id]:Number(event.target.value)});K();},children:Array.from({length:data.maxLevel+1},(_,lv)=>r('option',{value:String(lv),children:lv?'觉醒 '+lv:'未觉醒'},lv))}),
        r('span',{class:data.maxLevel===0?'warn small':'muted small',children:data.maxLevel===0?'官方快照暂无觉醒配置':level?data.levels[level]?.description:'同款法宝共享觉醒等级'})]},eq.id);
    })}):r('p',{class:'muted small',children:'添加长老红宝后，可选择觉醒等级。'}),
    r(v0,{children:'觉醒 1–3 按资源表累计。计入相邻技能、自身三围和指定形态光环；光环排除来源那一件。形态光环按基础加成叠加；同款多件的叠加顺序待游戏面板核对。四、五级尚未开放。'})]});
}
window.laozuLocal={catalog:z,awakening:AWDB,awaken:Aw,score:Q1,compile:_n,Scoring:Mn,Layout:Fn,tableBuilder:kn,workerSource:ra,objective:We,save:K,load:Ia,validateAwaken:awValidate};
`;
app = change(app, 'const Dl=(t,e)=>', extension + '\nconst Dl=(t,e)=>');
({app,worker}=require('./patch-instance-engine.cjs')({app,worker,change}));
app=require('./patch-instance-ui.cjs')({app,change});
app=require('./patch-awakening-import.cjs')({app,change,recognizerSource:read('awakening-recognizer.js')});
app = change(app, '__LOCAL_WORKER__', JSON.stringify(worker));
new vm.Script(worker, { filename: 'embedded-solver-worker.js' });
new vm.Script(app, { filename: 'app.js' });
fs.writeFileSync(path.join(root, 'app.js'), app);
console.log(JSON.stringify({output:path.join(root,'app.js'),equipment:catalog.equips.length,awakeningEquipment:Object.keys(awakening).length,workerBytes:Buffer.byteLength(worker)},null,2));

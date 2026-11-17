'use strict';

// Local experimental model; static config is not proof of live settlement.
module.exports = function patchAcquired({app,worker,change,catalog,attributes}) {
  const rows=catalog.acquiredTalents;
  if(!Array.isArray(rows)||!rows.length) throw Error('Missing acquired talent catalog');
  const shared=`
const ACDB=${JSON.stringify(rows)};
const AC_ATTR_NAMES=${JSON.stringify(Object.fromEntries(attributes.filter(x=>x.iAtrributeID>0).map(x=>[x.iAtrributeID,x.szAttrName])))};
const AC_BY_ID=new Map(ACDB.map(row=>[row.id,row]));
function acKey(row){
  const fields=['effects','equipBaseEffects','equipAdvancedEffects'];
  return JSON.stringify([row.quality,[...(row.forms||[])].sort((a,b)=>a-b),...fields.map(k=>(row[k]||[]).map(x=>[x.attr,x.value]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]))]);
}
function acValidate(input){
  const out=[],seen=new Set;
  if(!Array.isArray(input))return [0,0,0,0];
  for(const id of input.slice(0,193)){
    const row=AC_BY_ID.get(id),key=row&&acKey(row);
    if(!row||seen.has(key)){out.push(0);continue;}
    seen.add(key);out.push(id);
  }
  while(out.length<4)out.push(0);
  while(out.length>4&&out[out.length-1]===0)out.pop();
  return out;
}
// Existing surplus entries remain in storage for review, never in the model.
function acRows(ids){return acValidate(ids).slice(0,4).map(id=>AC_BY_ID.get(id)).filter(Boolean);}
function acMergeBase(talents,ids){
  const out={};for(const [form,attrs] of Object.entries(talents||{}))out[form]={...attrs};
  for(const row of acRows(ids))for(const form of row.forms||[])for(const effect of row.equipBaseEffects||[]){
    const attr=({2004:2001,2005:2002,2006:2003})[effect.attr];
    if(attr===undefined)throw Error('Unsupported acquired base attribute '+effect.attr);
    const entry=out[form]||(out[form]={});entry[attr]=(entry[attr]||0)+effect.value;
  }
  return out;
}
function acAdvanced(ids,form,index){
  const out=[];
  for(const row of acRows(ids))if((row.forms||[]).includes(form))for(const effect of row.equipAdvancedEffects||[]){
    const attrIndex=index.get(effect.attr);if(attrIndex===undefined)throw Error('Missing acquired attribute '+effect.attr);
    out.push({attrIndex,value:effect.value});
  }
  return out;
}
function acOptions(options){return {...options,productBaseCritMultiplier:laozuCalcProductBaseCritMultiplier(options),talents:acMergeBase(options.talents,options.acquiredTalentPicks)};}
`;
  app=change(app,'const z=',shared+'\nconst z=');
  worker=change(worker,'(function(){"use strict";','(function(){"use strict";'+shared);
  // Previews use the same base pool; solver receives original innate picks and
  // separately receives acquired IDs so the base pool is merged only once.
  app=change(app,'Aw=C({}),De=C(', 'Aw=C({}),Ac=C([0,0,0,0]),De=C(');
  app=change(app,'ar=t=>{const e=Array(x1).fill(0);', 'ar=t=>{const e=Array(Math.max(x1,Math.min(z.talents.length,Array.isArray(t)?t.length:0))).fill(0);');
  app=change(app,'for(let a=0;a<x1;a++){const n=t[a];', 'for(let a=0;a<e.length;a++){const n=t[a];');
  app=change(app,'ga.has(n)&&!s.has(n)&&(e[a]=n,s.add(n))}return e}', 'ga.has(n)&&!s.has(n)&&(e[a]=n,s.add(n))}while(e.length>x1&&e[e.length-1]===0)e.pop();return e}');
  app=change(app,'t<0||t>=x1)return;const s=ga.has(e);', 't<0||t>=De.value.length)return;const s=ga.has(e);');
  app=change(app,'ma=te(()=>pn(z.talents,De.value))','ma=te(()=>acMergeBase(pn(z.talents,De.value.slice(0,4)),Ac.value))');
  app=change(app,'e=Ne.value,s=ma.value;return ie.value', 'e=Ne.value,s=pn(z.talents,De.value.slice(0,4));return ie.value');
  app=change(app,'talents:s,awaken:Aw.value}', 'talents:s,awaken:Aw.value,acquiredTalentPicks:Ac.value}',2);
  app=change(app,'at=te(()=>Te.value.length===0?', "at=te(()=>De.value.slice(4).some(Boolean)||Ac.value.slice(4).some(Boolean)?'天赋超过四格，请先清理第 5 格及之后的词条':Te.value.length===0?");
  app=change(app,'awaken:Aw.value,talentPicks:De.value','awaken:Aw.value,acquiredTalentPicks:Ac.value,talentPicks:De.value');
  app=change(app,'Aw.value=awRestore(t.awaken,ae.value),De.value=', 'Aw.value=awRestore(t.awaken,ae.value),Ac.value=acValidate(t.acquiredTalentPicks),De.value=');
  app=change(app,'Aw.value={},De.value=', 'Aw.value={},Ac.value=[0,0,0,0],De.value=');
  app=change(app,'Q1=(t,e,s={kind:"power"})=>{const a=', 'Q1=(t,e,s={kind:"power"})=>{s=acOptions(s);const a=');
  app=change(app,'_n=(t,e={kind:"power"})=>{const s=', '_n=(t,e={kind:"power"})=>{e=acOptions(e);const s=');
  worker=change(worker,'mt=(n,t={kind:"power"})=>{const e=', 'mt=(n,t={kind:"power"})=>{t=acOptions(t);const e=');
  app=change(app,'equipId:v.id,awakenLevel:v.awakenLevel,rawBase:', 'equipId:v.id,awakenLevel:v.awakenLevel,acAdvanced:acAdvanced(e.acquiredTalentPicks,v.weaponForm,a),rawBase:');
  worker=change(worker,'equipId:c.id,awakenLevel:c.awakenLevel,rawBase:', 'equipId:c.id,awakenLevel:c.awakenLevel,acAdvanced:acAdvanced(t.acquiredTalentPicks,c.weaponForm,s),rawBase:');
  app=change(app,'const u=s.profiles[c];n.fill(0);', 'const u=s.profiles[c];n.fill(0);for(const x of u.acAdvanced)n[x.attrIndex]+=x.value;');
  worker=change(worker,'const u=e.profiles[p];o.fill(0);', 'const u=e.profiles[p];o.fill(0);for(const x of u.acAdvanced)o[x.attrIndex]+=x.value;');
  for(let src of ['app','worker']){
    let text=src==='app'?app:worker;
    text=change(text,'const values=new Float64Array(ctx.attrIds.length);', 'const values=new Float64Array(ctx.attrIds.length);for(const x of a.acAdvanced)values[x.attrIndex]+=x.value;');
    if(src==='app')app=text;else worker=text;
  }
  app=change(app,'E=s.elderStars?.[b.equipId];for(const k of awSkills',`E=s.elderStars?.[b.equipId];for(const row of acRows(s.acquiredTalentPicks))if((row.forms||[]).includes(I.weaponForm))for(const effect of row.equipAdvancedEffects||[]){O(effect.attr,effect.value);S.push({attr:effect.attr,attrName:i(effect.attr),value:effect.value,kind:'acquired',skillName:row.name,skillDesc:row.desc,fromName:'后天天赋'});}for(const k of awSkills`);
  // Crit is included in the attack product. Base 1 preserves the historical
  // preference model; base 2 is an approximate expectation under a default
  // double-damage critical hit, not a live-game damage or DPS simulation.
  // The crit-rate input precedes the form-specific acquired bonus.
  app=change(app,'iCritDmg:Ie(a,et)', 'iCritDmg:Ie(a,et),iCritRate:a.get(2009)??-1');
  worker=change(worker,'iCritDmg:k(s,dt)', 'iCritDmg:k(s,dt),iCritRate:s.get(2009)??-1');
  app=change(app,'(1+f*(g(et)/de))','(1+Math.min(1,Math.max(0,f+g(2009)/de))*(s.productBaseCritMultiplier-1+g(et)/de))');
  app=change(app,'M.id===a1||M.id===Z0||M.id===et||', 'M.id===a1||M.id===Z0||M.id===et||M.id===2009||');
  app=change(app,'(1+c*(d/de))','(1+Math.min(1,Math.max(0,c+(a.iCritRate<0?0:e[s+a.iCritRate]/de)))*(a.objective.productBaseCritMultiplier-1+d/de))');
  app=change(app,'h===a.iAtk||h===a.iDmgUp||h===a.iCritDmg||','h===a.iAtk||h===a.iDmgUp||h===a.iCritDmg||h===a.iCritRate||');
  worker=change(worker,'(1+p*(h/E))','(1+Math.min(1,Math.max(0,p+(s.iCritRate<0?0:t[e+s.iCritRate]/E)))*(s.objective.productBaseCritMultiplier-1+h/E))');
  worker=change(worker,'m===s.iAtk||m===s.iDmgUp||m===s.iCritDmg||','m===s.iAtk||m===s.iDmgUp||m===s.iCritDmg||m===s.iCritRate||');
  app=change(app,'A0=[2001,2002,2003,2025,2027,2045,2069,2049]', 'A0=[2001,2002,2003,2009,2025,2027,2045,2047,2049,2069,2070,2072,2082]');
  app=change(app,'e===2025||e===2027','e===2009||e===2025||e===2027');
  // Keep both kinds of talent on the same searchable, accessible picker.
  // The old component remains in the generated bundle for anchor stability.
  app=change(app,'function kl(){','function klOriginal(){');
  app=change(app,'function Al(){','function Al(){'); // anchor check
  app=change(app,'r(bl,{}),r(kl,{}),r("h3",{children:"求解参数"})','r(bl,{}),r(kl,{}),r(acPanel,{}),r("h3",{children:"求解参数"})');
  app=change(app,'function Al(){',`
const innateTalentSearch=C(''),acquiredTalentSearch=C('');
const innateTalentSearchOpen=C(false),acquiredTalentSearchOpen=C(false);
const innateTalentSearchTarget=C(-1),acquiredTalentSearchTarget=C(-1);
function talentSearchText(row,acquired){
 const forms=acquired?(row.forms||[]):[row.form];
 const quality=({1:'白',2:'凡',3:'良',4:'优'})[row.quality]||'';
 return [row.name,row.desc,row.id,quality,...forms.filter(Boolean).map(form=>na(form)+'形态')].join(' ').toLowerCase();
}
function talentPicker({title,picks,search,open,target,rows,acquired,onPick}){
 const terms=search.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);
 const matches=row=>terms.every(term=>talentSearchText(row,acquired).includes(term));
 const firstEmpty=picks.slice(0,4).findIndex(id=>!id);
 const targetIndex=firstEmpty>=0?firstEmpty:(target.value>=0&&target.value<4?target.value:-1);
 const occupiedForTarget=new Set(picks.filter((id,index)=>id&&index!==targetIndex).map(id=>{const row=rows.find(x=>x.id===id);return acquired&&row?acKey(row):id;}));
 const results=rows.filter(row=>matches(row)&&(!occupiedForTarget.has(acquired?acKey(row):row.id)));
 const choose=row=>{if(targetIndex<0)return;onPick(targetIndex,row.id);search.value='';target.value=-1;open.value=false;};
 const searchId=(acquired?'acquired':'innate')+'-talent-results';
 return r('div',{class:'talent-picker',children:[
  r('div',{class:'talent-search-box',onFocusOut:event=>{if(!event.currentTarget.contains(event.relatedTarget))open.value=false;},children:[
   r('label',{class:'talent-search',children:[r('span',{class:'small',children:'筛选'+title}),r('input',{type:'search',value:search.value,'aria-label':'筛选'+title,'aria-expanded':!!(open.value&&terms.length),'aria-controls':searchId,autoComplete:'off',placeholder:'名称、形态、效果或 ID',onFocus:()=>{open.value=true;},onInput:event=>{search.value=event.currentTarget.value;target.value=-1;open.value=true;},onKeyDown:event=>{if(event.key==='Escape'){open.value=false;return;}if(event.key==='Enter'&&!event.isComposing&&event.keyCode!==229&&open.value&&terms.length&&targetIndex>=0&&results.length){event.preventDefault();choose(results[0]);}}})]}),
   open.value&&terms.length?r('div',{class:'talent-results',id:searchId,children:[
    firstEmpty<0?r('div',{class:'talent-result-target',children:[r('span',{class:'small',children:'选择要替换的天赋：'}),...picks.slice(0,4).map((id,index)=>r('button',{type:'button',class:targetIndex===index?'talent-target active':'talent-target','aria-pressed':targetIndex===index,onClick:()=>{target.value=index;},children:(index+1)+' · '+(rows.find(row=>row.id===id)?.name||'未设')},index))]}):r('div',{class:'talent-results-hint',children:'选择后填入天赋 '+(firstEmpty+1)}),
    targetIndex<0?r('div',{class:'talent-results-hint',children:'请选择一个天赋格'}):results.length?r('div',{class:'talent-result-list',children:results.map(row=>r('button',{type:'button',class:'talent-result',onClick:()=>choose(row),children:[r('span',{class:'talent-result-name',children:row.name}),r('span',{class:'muted small',children:row.desc})]},row.id))}):r('div',{class:'talent-results-hint',children:'没有可选的匹配天赋'})
   ]}):null
  ]}),
  r('div',{class:'elder-rows',children:picks.map((id,index)=>{
   const chosen=rows.find(row=>row.id===id);
   const occupied=new Set(picks.filter((value,i)=>i!==index&&value>0).map(value=>{const row=rows.find(x=>x.id===value);return acquired&&row?acKey(row):value;}));
   const surplus=index>=4;
   const available=rows.filter(row=>(!surplus||row.id===id)&&(row.id===id||matches(row))&&(row.id===id||!occupied.has(acquired?acKey(row):row.id)));
   return r('div',{class:'elder-row talent-row',children:[
    r('label',{class:'name',htmlFor:(acquired?'acquired-talent-':'innate-talent-')+index,children:(surplus?'待清理 ':'天赋 ')+(index+1)}),
    r('select',{id:(acquired?'acquired-talent-':'innate-talent-')+index,'aria-label':title+' '+(index+1),class:id?'elder-select on':'elder-select',value:String(id),onChange:event=>onPick(index,Number(event.currentTarget.value)),children:[
     r('option',{value:'0',children:'未设'}),...available.map(row=>r('option',{value:String(row.id),title:row.desc,children:row.name+(row.id===id?'':' · '+row.desc)},row.id))]}),
    chosen?r('span',{class:'muted small talent-description',children:chosen.desc}):null
   ]},index);
  })})
 ]});
}
function kl(){
 return r(R,{children:[talentGroupHeading('先天天赋',De,ar,innateTalentSearch,innateTalentSearchOpen,innateTalentSearchTarget),De.value.slice(4).some(Boolean)?r('p',{class:'warn small',children:'旧方案超过四格：第 5 格及之后的词条暂不参与计算。可把多余词条改为「未设」，或清空本组。'}):null,r(talentPicker,{title:'先天天赋',picks:De.value,search:innateTalentSearch,open:innateTalentSearchOpen,target:innateTalentSearchTarget,rows:z.talents,acquired:false,onPick:(index,id)=>cr(index,id)})]});
}
function acPanel(){
 const picks=Ac.value;
 return r(R,{children:[talentGroupHeading('后天天赋',Ac,acValidate,acquiredTalentSearch,acquiredTalentSearchOpen,acquiredTalentSearchTarget),
 picks.slice(4).some(Boolean)?r('p',{class:'warn small',children:'旧方案超过四格：第 5 格及之后的词条暂不参与计算。可把多余词条改为「未设」，或清空本组。'}):null,
 r(talentPicker,{title:'后天天赋',picks,search:acquiredTalentSearch,open:acquiredTalentSearchOpen,target:acquiredTalentSearchTarget,rows:ACDB,acquired:true,onPick:(index,id)=>{const next=[...picks];next[index]=id;Ac.value=acValidate(next);K();}})]});
}
function talentGroupHeading(title,picks,normalize,search,open,target){
 return r('div',{class:'talent-group-heading',children:[r('h3',{children:title}),
  r('button',{type:'button','aria-label':'清空'+title,disabled:!picks.value.some(Boolean),children:'清空',
   onClick:()=>{picks.value=normalize([]);search.value='';open.value=false;target.value=-1;K();}})]});
}
function Al(){`);
  app=change(app,'window.laozuLocal={catalog:z,', `window.laozuLocal={talentReview:{read:()=>({innate:[...De.value],acquired:[...Ac.value]}),apply:({innate,acquired})=>{const validate=(value,normal,label)=>{if(value===undefined)return null;if(!Array.isArray(value)||value.slice(4).some(Boolean))throw Error(label+'最多四格');const result=normal(value);for(let i=0;i<value.length;i++)if((value[i]||0)!==(result[i]||0))throw Error(label+'包含未知或重复词条');return result;};const a=validate(innate,ar,'先天天赋'),b=validate(acquired,acValidate,'后天天赋');if(a)De.value=a;if(b)Ac.value=b;K();}},solverBlock:at,acquired:Ac,acquiredValidate:acValidate,acquiredMergeBase:acMergeBase,serialize:fa,savePlan:rs,loadPlan:vr,plans:f1,catalog:z,`);
  return {app,worker};
};

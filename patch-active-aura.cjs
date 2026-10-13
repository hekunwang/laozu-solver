'use strict';

// Applied after patch-instance-engine. The detailed scorer stays unchanged.
module.exports = function patchActiveAura({app, worker, change}) {
  const shared = `
class AwActiveAura {
  constructor(scoring){
    this.scoring=scoring;this.byScope=new Map;this.deltas=new Map;this.changed=new Set;
    this.zero=new Float64Array(scoring.nAttrs);this.scratch=new Float64Array(scoring.nAttrs);
    this.marked=new Uint8Array(scoring.slotEquip.length);this.dirty=new Int32Array(scoring.slotEquip.length);
    this.count=0;this.batch=0;this.activeSources=0;
    this.profiles=scoring.ctx.profiles.map(profile=>{
      const buffs=[],exclude=[];
      for(const buff of profile.globalBuffs){
        const attr=scoring.ctx.attrIndex.get(({2004:2001,2005:2002,2006:2003})[buff.attr]??buff.attr);
        if(attr===undefined)continue;
        const scope=buff.element==null?'form:'+buff.form:'element:'+buff.element;
        buffs.push({scope,attr,value:buff.value});
        if(!this.byScope.has(scope)){
          this.byScope.set(scope,new Float64Array(scoring.nAttrs));
          this.deltas.set(scope,new Float64Array(scoring.nAttrs));
        }
        if(buff.excludeSource&&awGlobalMatches(buff,profile))exclude.push({attr,value:buff.value});
      }
      return {scopes:['form:'+profile.weaponForm,'element:'+profile.element],buffs,exclude};
    });
    for(const profile of scoring.slotEquip)if(profile>=0)this.update(profile,1);
  }
  update(profile,direction){
    const buffs=this.profiles[profile].buffs;
    if(buffs.length)this.activeSources+=direction;
    for(const buff of buffs){
      this.byScope.get(buff.scope)[buff.attr]+=direction*buff.value;
      this.deltas.get(buff.scope)[buff.attr]+=direction*buff.value;
      this.changed.add(buff.scope);
    }
  }
  baseFor(profile){
    const data=this.profiles[profile],form=this.byScope.get(data.scopes[0]),element=this.byScope.get(data.scopes[1]);
    if(!data.exclude.length&&(!form||!element))return form||element||this.zero;
    this.scratch.set(form||this.zero);
    if(element)for(let i=0;i<element.length;i++)this.scratch[i]+=element[i];
    for(const buff of data.exclude)this.scratch[buff.attr]-=buff.value;
    return this.scratch;
  }
  mark(slot){if(!this.marked[slot]){this.marked[slot]=1;this.dirty[this.count++]=slot;}}
  reset(){
    for(let i=0;i<this.count;i++)this.marked[this.dirty[i]]=0;
    this.count=0;
    for(const scope of this.changed)this.deltas.get(scope).fill(0);
    this.changed.clear();
  }
  recompute(slots,count){
    for(let i=0;i<count;i++)this.mark(slots[i]);
    if(this.batch)return;
    const scoring=this.scoring;
    // A remove/place move has no net aura change. Removing the last source does.
    for(const scope of this.changed){
      if(!this.deltas.get(scope).some(value=>value!==0))continue;
      for(let slot=0;slot<scoring.slotEquip.length;slot++){
        const profile=scoring.slotEquip[slot];
        if(profile>=0&&this.profiles[profile].scopes.includes(scope))this.mark(slot);
      }
    }
    for(let i=0;i<this.count;i++){
      const slot=this.dirty[i],old=scoring.pieceScore[slot];
      scoring.total+=scoring.recomputeSlot(slot)-old;
    }
    this.reset();
  }
}
function awAuraMove(layout,candidate,placement){
  const aura=layout.scoring.activeAura;aura.batch++;
  try{
    const previous=layout.remove(candidate);
    return previous<0?false:layout.place(candidate,placement)?true:(layout.place(candidate,previous),false);
  }finally{
    aura.batch--;
    if(!aura.batch)aura.recompute([],0);
  }
}
`;
  app=change(app,'class Mn{',shared+'\nclass Mn{');
  worker=change(worker,'class bt{',shared+'\nclass bt{');
  for(const [name,main] of [['app',true],['worker',false]]){
    let source=main?app:worker;
    source=change(source,'this.acc=new Float64Array(this.nAttrs)}recomputeAll(){',
      'this.acc=new Float64Array(this.nAttrs);this.activeAura=new AwActiveAura(this)}recomputeAll(){');
    source=change(source,main?'this.total=e}recomputeSlots(e,s=e.length){if(this.ctx.hasGlobal){this.recomputeAll();return;}for(let a=0;a<s;a++){const n=e[a],l=this.pieceScore[n],i=this.recomputeSlot(n);this.total+=i-l}}':
      'this.total=t}recomputeSlots(t,e=t.length){if(this.ctx.hasGlobal){this.recomputeAll();return;}for(let s=0;s<e;s++){const o=t[s],i=this.pieceScore[o],r=this.recomputeSlot(o);this.total+=r-i}}',
      main?'this.total=e;this.activeAura.reset()}recomputeSlots(e,s=e.length){this.activeAura.recompute(e,s)}':
        'this.total=t;this.activeAura.reset()}recomputeSlots(t,e=t.length){this.activeAura.recompute(t,e)}');
    const start=main?'const globalBase=new Float64Array(i);':'const globalBase=new Float64Array(r);';
    const end=main?'const f=this.board.neighborSlots(e,l);':'const d=this.board.neighborSlots(t,i);';
    const first=source.indexOf(start),last=source.indexOf(end,first);
    if(first<0||last<0)throw new Error('Active aura scoring anchor missing: '+name);
    source=change(source,source.slice(first,last),main?'const globalBase=this.activeAura.baseFor(c);':'const globalBase=this.activeAura.baseFor(p);');
    source=change(source,main?'this.slotEquip[a]=this.candidates[e].equipIndex;':'this.slotEquip[s]=this.candidates[t].equipIndex;',
      main?'this.slotEquip[a]=this.candidates[e].equipIndex;this.scoring.activeAura.update(this.slotEquip[a],1);':
        'this.slotEquip[s]=this.candidates[t].equipIndex;this.scoring.activeAura.update(this.slotEquip[s],1);');
    source=change(source,main?'this.slotEquip[s]=W,this.freeSlots.push(s)':'this.slotEquip[e]=-1,this.freeSlots.push(e)',
      main?'this.scoring.activeAura.update(this.slotEquip[s],-1),this.slotEquip[s]=W,this.freeSlots.push(s)':
        'this.scoring.activeAura.update(this.slotEquip[e],-1),this.slotEquip[e]=-1,this.freeSlots.push(e)');
    source=change(source,main?'move(e,s){const a=this.remove(e);return a===se?!1:this.place(e,s)?!0:(this.place(e,a),!1)}':
      'move(t,e){const s=this.remove(t);return s===g?!1:this.place(t,e)?!0:(this.place(t,s),!1)}',
      main?'move(e,s){return awAuraMove(this,e,s)}':'move(t,e){return awAuraMove(this,t,e)}');
    if(main)app=source;else worker=source;
  }
  return {app,worker};
};

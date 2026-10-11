'use strict';

// Guide a bounded share of search towards valuable adjacency relationships.
// All proposals still use the existing full scorer and acceptance rule.
module.exports=function patchSolverCore({app,worker,change}) {
  const shared=`
function laozuCoreGuide(solver){
  if(solver.coreGuide!==undefined)return solver.coreGuide;
  solver.coreGuide=null;
  const candidates=solver.candidates,table=solver.table,layout=solver.layout;
  if(!layout||!table||candidates.length<2||candidates.length>64)return null;
  const ctx=layout.scoring.ctx,n=candidates.length,weights=new Float64Array(n*n),cache=new Map();
  // Isolated pair gains are only a ranking heuristic. Global auras and
  // multiplicative objectives can change them in a complete layout.
  function received(a,b){
    const values=new Float64Array(ctx.attrIds.length);
    if(b){
      for(const buff of a.selfBuffs)if(buff.elementMask&b.elementBit)values[buff.attrIndex]+=buff.value;
      for(const buff of b.adjBuffs)if(buff.elementMask&a.elementBit)values[buff.attrIndex]+=buff.value;
    }
    for(const [attr,pct]of [[ctx.iAtk,ctx.iAtkPct],[ctx.iDef,ctx.iDefPct],[ctx.iHp,ctx.iHpPct]]){
      values[attr]=Math.floor(a.rawBase[attr]*(1+a.baseBonusMultiplier[attr]))*(1+values[pct]/10000);
    }
    return layout.scoring.scoreValues(values,0);
  }
  const profiles=candidates.map(c=>ctx.profiles[c.equipIndex]),solo=profiles.map(p=>received(p,null)),potential=new Float64Array(n);
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
    const key=candidates[i].equipIndex+':'+candidates[j].equipIndex;
    let gain=cache.get(key);
    if(gain===undefined){gain=Math.max(0,received(profiles[i],profiles[j])+received(profiles[j],profiles[i])-solo[i]-solo[j]);cache.set(key,gain);}
    weights[i*n+j]=weights[j*n+i]=gain;potential[i]+=gain;potential[j]+=gain;
  }
  const cores=Array.from({length:n},(_,i)=>i).filter(i=>potential[i]>1e-6&&(profiles[i].selfBuffs.length||candidates[i].cells>1&&profiles[i].adjBuffs.length)).sort((a,b)=>potential[b]-potential[a]||a-b).slice(0,4);
  if(!potential.some(value=>value>1e-6))return null;
  const byCell=Array.from({length:42},()=>[]),positions=candidates.map(c=>{
    const range=table.byShape.get(c.shapeId),out=[];
    if(range)for(let p=range.start;p<range.end;p++)out.push(p);
    return out;
  });
  let targetLo=0,targetHi=0;
  for(let i=0;i<n;i++)for(const p of positions[i]){
    targetLo|=table.occLo[p];targetHi|=table.occHi[p];
    for(let k=table.cellStart[p];k<table.cellStart[p+1];k++)byCell[table.cells[k]].push([i,p]);
  }
  return solver.coreGuide={n,weights,potential,cores,positions,byCell,targetLo,targetHi};
}
function laozuCoreTouch(table,a,b){return (table.occLo[a]&table.nbrLo[b]|table.occHi[a]&table.nbrHi[b])!==0;}
function laozuCoreSeed(solver,initialize){
  // Keep the ordinary greedy construction as a concrete fallback. New seeds
  // may only replace it after full scoring; partial searches are never used.
  initialize();
  const guide=laozuCoreGuide(solver);
  if(!guide||!guide.cores.length||solver.stopRequested)return;
  const table=solver.table,layout=solver.layout,rng=solver.eng.rng,now=()=>typeof performance!=='undefined'?performance.now():Date.now();
  const start=now(),allowance=solver.byIterations?12:Math.max(0,Math.min(12,solver.budgetMs-solver.elapsedMs()-8));
  if(allowance<=0)return;
  const initial=layout.snapshot();let best=initial,bestScore=layout.total,nodes=0,complete=0;
  const expired=()=>solver.stopRequested||nodes>=2400||(!solver.byIterations&&now()-start>=allowance);
  const {n,weights,cores,positions,byCell,targetLo,targetHi}=guide;
  if(laozuSearchPopcount(targetLo)+laozuSearchPopcount(targetHi)!==solver.usableCells)return;
  const fits=(p,lo,hi)=>(table.occLo[p]&lo|table.occHi[p]&hi)===0;
  function rank(entries,lo,hi){
    let score=0;const used=new Set(entries.map(e=>e[0]));
    for(let i=0;i<entries.length;i++){
      const [c,p]=entries[i];
      for(let j=0;j<i;j++)if(laozuCoreTouch(table,p,entries[j][1]))score+=weights[c*n+entries[j][0]];
      const possible=[];
      for(let j=0;j<n;j++)if(!used.has(j)&&weights[c*n+j]>0){
        for(const q of positions[j])if(fits(q,lo,hi)&&laozuCoreTouch(table,p,q)){possible.push(weights[c*n+j]);break;}
      }
      // A neighboring item needs at least one distinct free boundary cell.
      // The remaining inventory/shape conflicts are checked by full packing.
      const boundary=laozuSearchPopcount(table.nbrLo[p]&targetLo&~lo)+laozuSearchPopcount(table.nbrHi[p]&targetHi&~hi);
      possible.sort((a,b)=>b-a);for(let j=0;j<Math.min(boundary,possible.length);j++)score+=possible[j];
    }
    return score;
  }
  try{
    let beam=[{entries:[],lo:0,hi:0,rank:0}];
    // Keep several different core skeletons, rather than locking a single
    // red-item maximum. Jitter diversifies different cold starts.
    // Alternate a joint multi-element skeleton with the strongest pair. Other
    // cores stay movable during completion, including gold adjacency anchors.
    const first=cores[0],different=cores.find(c=>layout.scoring.ctx.profiles[solver.candidates[c].equipIndex].element!==layout.scoring.ctx.profiles[solver.candidates[first].equipIndex].element);
    const anchors=[first,solver.chunkIndex%3===0&&different!==undefined?different:cores[1]].filter(c=>c!==undefined);
    for(const c of anchors){
      const next=[],seen=new Set();
      for(const state of beam)for(const p of positions[c]){
        if(expired())break;
        if(!fits(p,state.lo,state.hi))continue;
        const entries=state.entries.concat([[c,p]]),lo=state.lo|table.occLo[p],hi=state.hi|table.occHi[p];
        const key=entries.map(([i,q])=>solver.candidates[i].equipIndex+':'+q).sort().join(',');
        if(seen.has(key))continue;seen.add(key);
        const value=rank(entries,lo,hi);nodes++;
        next.push({entries,lo,hi,rank:value*(.94+.12*rng())});
      }
      if(expired()||!next.length)break;
      next.sort((a,b)=>b.rank-a.rank);beam=next.slice(0,6);
    }
    const used=new Uint8Array(n),chosen=[];
    function fill(lo,hi){
      if(expired())return false;nodes++;
      if(lo===targetLo&&hi===targetHi)return true;
      let options=null;
      for(let cell=0;cell<42;cell++){
        const occupied=cell<32?(lo&(1<<cell)):(hi&(1<<(cell-32))),target=cell<32?(targetLo&(1<<cell)):(targetHi&(1<<(cell-32)));
        if(occupied||!target)continue;
        const available=[],seen=new Set();
        for(const [c,p]of byCell[cell])if(!used[c]&&fits(p,lo,hi)){
          const key=solver.candidates[c].equipIndex+':'+p;if(seen.has(key))continue;seen.add(key);available.push([c,p]);
        }
        if(!available.length)return false;
        if(options===null||available.length<options.length)options=available;
        if(options.length===1)break;
      }
      if(!options)return false;
      const ranked=options.map(([c,p])=>{
        let gain=0;for(const [d,q]of chosen)if(laozuCoreTouch(table,p,q))gain+=weights[c*n+d];
        return {c,p,rank:gain*(.9+.2*rng())+rng()};
      }).sort((a,b)=>b.rank-a.rank);
      for(const {c,p}of ranked){
        used[c]=1;chosen.push([c,p]);
        if(fill(lo|table.occLo[p],hi|table.occHi[p]))return true;
        chosen.pop();used[c]=0;if(expired())break;
      }
      return false;
    }
    for(const state of beam){
      if(expired())break;
      used.fill(0);chosen.length=0;for(const pair of state.entries){used[pair[0]]=1;chosen.push(pair);}
      if(!fill(state.lo,state.hi))continue;
      layout.clear();let valid=true;
      for(const [c,p]of chosen)if(!layout.place(c,p)){valid=false;break;}
      if(!valid)continue;
      layout.recomputeAll();complete++;
      if(layout.total>bestScore+1e-6){bestScore=layout.total;best=layout.snapshot();}
    }
  }finally{
    layout.restore(best);layout.recomputeAll();
    solver.coreSeedStats={calls:(solver.coreSeedStats?.calls||0)+1,complete:(solver.coreSeedStats?.complete||0)+complete,nodes:(solver.coreSeedStats?.nodes||0)+nodes};
  }
}
function laozuCoreInitialize(solver,initialize){
  const now=()=>typeof performance!=='undefined'?performance.now():Date.now(),start=now();
  laozuCoreSeed(solver,initialize);
  // Constructor work otherwise lies outside the solver's timed budget.
  if(!solver.byIterations)solver.consumedMs+=Math.max(0,now()-start);
}
function laozuCoreRestart(solver,chunk,initialize){
  if(chunk%4===3&&solver.bestSnap&&solver.bestSnap.length){solver.layout.restore(solver.bestSnap);solver.layout.recomputeAll();}
  else{solver.layout.clear();if(chunk%4===2)initialize();else laozuCoreSeed(solver,initialize);}
}
function laozuCoreRegion(solver,placed,count){
  const guide=laozuCoreGuide(solver),rng=solver.eng.rng,table=solver.table,layout=solver.layout;
  solver.coreGuidedRepack=false;
  if(!guide||rng()>=.65)return null;
  // The second net-gain trial can start from supports or recipients too.
  // The first trial and ordinary exploration retain the core preference.
  const all=solver.netGroupRound===1;
  const cores=all?placed.filter(c=>guide.potential[c]>1e-6):guide.cores.filter(c=>layout.isPlaced(c));if(!cores.length)return null;
  solver.coreGuidedRepack=true;
  function weighted(list,value){
    const ws=list.map(c=>Math.max(1,value(c))),sum=ws.reduce((a,b)=>a+b,0);let pick=rng()*sum;
    for(let i=0;i<list.length;i++){pick-=ws[i];if(pick<=0)return list[i];}return list[list.length-1];
  }
  const core=weighted(cores,c=>{
    let actual=0;for(const d of placed)if(d!==c&&laozuCoreTouch(table,layout.placementOf(c),layout.placementOf(d)))actual+=guide.weights[c*guide.n+d];
    return Math.max(1,guide.potential[c]-actual);
  }),selected=[core];
  // Include one valuable missing neighbor even when it is in another region.
  const missing=placed.filter(d=>d!==core&&guide.weights[core*guide.n+d]>0&&!laozuCoreTouch(table,layout.placementOf(core),layout.placementOf(d)));
  if(missing.length)selected.push(weighted(missing,d=>guide.weights[core*guide.n+d]));
  while(selected.length<count){
    const next=placed.filter(c=>!selected.includes(c)&&selected.some(d=>laozuCoreTouch(table,layout.placementOf(c),layout.placementOf(d))));
    if(!next.length)break;
    selected.push(weighted(next,c=>1+(all?selected.reduce((sum,d)=>sum+guide.weights[d*guide.n+c],0):guide.weights[core*guide.n+c])));
  }
  return selected;
}
function laozuCoreOptions(solver,c,legal,chosen,selected){
  if(!solver.coreGuidedRepack||!solver.coreGuide)return legal;
  const guide=solver.coreGuide,table=solver.table,rng=solver.eng.rng;
  const fixed=solver.layout.placedCandidates().filter(d=>!selected.includes(d)).map(d=>[d,solver.layout.placementOf(d)]);
  const neighbors=fixed.concat(Array.from(chosen));
  return legal.map(p=>{
    let gain=0;for(const [d,q]of neighbors)if(d!==c&&laozuCoreTouch(table,p,q))gain+=guide.weights[c*guide.n+d];
    return {p,rank:gain*(.9+.2*rng())+rng()};
  }).sort((a,b)=>b.rank-a.rank).map(entry=>entry.p);
}
`;
  app=change(app,'class Wn{',shared+'\nclass Wn{');
  worker=change(worker,'class Rt{',shared+'\nclass Rt{');
  app=change(app,'tt(u,this.soloOrder),this.bestScore','laozuCoreInitialize(this,()=>tt(u,this.soloOrder)),this.bestScore');
  worker=change(worker,'x(u,this.soloOrder),this.bestScore','laozuCoreInitialize(this,()=>x(u,this.soloOrder)),this.bestScore');
  app=change(app,'laozuSearchRestart(this,e,()=>tt(s,this.soloOrder))','laozuCoreRestart(this,e,()=>tt(s,this.soloOrder))');
  worker=change(worker,'laozuSearchRestart(this,t,()=>x(e,this.soloOrder))','laozuCoreRestart(this,t,()=>x(e,this.soloOrder))');
  const region='const selected=[placed[Math.floor(rng()*placed.length)]],count=Math.min(placed.length,6+Math.floor(rng()*3));';
  const guided='const count=Math.min(placed.length,6+Math.floor(rng()*3)),selected=laozuCoreRegion(solver,placed,count)||[placed[Math.floor(rng()*placed.length)]];';
  app=change(app,region,guided);worker=change(worker,region,guided);
  const traversal='for(const p of legal){\n      chosen.set(pick,p);';
  const ranked='for(const p of laozuCoreOptions(solver,pick,legal,chosen,selected)){\n      chosen.set(pick,p);';
  app=change(app,traversal,ranked);worker=change(worker,traversal,ranked);
  return {app,worker};
};

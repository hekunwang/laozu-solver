'use strict';

// Keep full-board proposals useful and spend a small part of the existing
// budget on real two-piece rearrangements. Shared by both solver engines.
module.exports=function patchSolverSearch({app,worker,change}) {
  const shared=`
function laozuSearchPopcount(value){
  value-=value>>>1&0x55555555;
  value=(value&0x33333333)+(value>>>2&0x33333333);
  return ((value+(value>>>4)&0x0f0f0f0f)*0x01010101)>>>24;
}
function laozuSearchNoop(){return null;}
function laozuSearchRestart(solver,chunk,initialize){
  if(chunk%2&&solver.bestSnap&&solver.bestSnap.length){
    solver.layout.restore(solver.bestSnap);
    solver.layout.recomputeAll();
  }else{
    solver.layout.clear();initialize();
  }
}
function laozuSearchRepack(solver,net=false){
  const layout=solver.layout,table=solver.table,rng=solver.eng.rng;
  const now=()=>typeof performance!=='undefined'?performance.now():Date.now();
  const deadline=now()+2;
  let nodes=0;
  const stopped=()=>solver.stopRequested||!solver.running||(!solver.byIterations&&solver.elapsedMs()>=solver.budgetMs-8);
  const cancelled=()=>stopped()||(!solver.byIterations&&now()>=deadline);
  if(cancelled())return null;
  const placed=layout.placedCandidates();
  if(placed.length<2)return null;
  const snapshot=layout.snapshot(),originalTotal=layout.total;
  const restore=()=>{layout.restore(snapshot);layout.recomputeAll();};
  let best=null,bestGain=-Infinity,applied=false,mutated=false;
  const seen=new Set();
  try{
  // Compare a bounded set of complete repairs from the same original board.
  // Half the calls still take the original first proposal for exploration.
  for(let round=0;round<(net?2:1)&&!cancelled();round++){
  solver.netGroupRound=net?round:-1;
  const nodeLimit=net?Math.min(2048,nodes+1024):2048;
  const groupDeadline=net&&round===0?Math.min(deadline,now()+.8):deadline;
  const groupExpired=()=>cancelled()||(net&&!solver.byIterations&&now()>=groupDeadline);
  let complete=0;
  const selected=[placed[Math.floor(rng()*placed.length)]],count=Math.min(placed.length,6+Math.floor(rng()*3));
  // Grow a connected region. Work only with masks until a complete packing
  // is found: an incomplete repair would lose the full-board fill bonus.
  while(selected.length<count){
    const next=placed.filter(c=>!selected.includes(c)&&selected.some(d=>{
      const a=layout.placementOf(c),b=layout.placementOf(d);
      return (table.occLo[a]&table.nbrLo[b]|table.occHi[a]&table.nbrHi[b])!==0;
    }));
    if(!next.length)break;
    selected.push(next[Math.floor(rng()*next.length)]);
  }
  let regionLo=0,regionHi=0;
  for(const c of selected){const p=layout.placementOf(c);regionLo|=table.occLo[p];regionHi|=table.occHi[p];}
  const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
  const options=new Map(selected.map(c=>{
    const range=table.byShape.get(solver.candidates[c].shapeId),positions=[];
    if(range)for(let p=range.start;p<range.end;p++)if((table.occLo[p]&~regionLo|table.occHi[p]&~regionHi)===0)positions.push(p);
    return [c,shuffle(positions)];
  }));
  const signature=entries=>entries.map(([c,p])=>[solver.candidates[c].equipIndex,p]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]).map(x=>x.join(':')).join(',');
  const original=signature(selected.map(c=>[c,layout.placementOf(c)])),chosen=new Map();
  const originalEntries=selected.map(c=>[c,layout.placementOf(c)]);
  function evaluate(){
    const key=signature(Array.from(chosen));
    if(key===original||seen.has(key))return;
    seen.add(key);complete++;
    try{
      mutated=true;
      for(const c of selected)layout.remove(c);
      for(const [c,p]of chosen)if(!layout.place(c,p))return;
      layout.recomputeAll();
      // Full-board delta includes recipients outside this group, active
      // global auras and the objective's nonlinear terms.
      const gain=layout.total-originalTotal;
      if(gain>bestGain+1e-6){bestGain=gain;best=layout.snapshot();}
    }finally{
      for(const c of selected)layout.remove(c);
      for(const [c,p]of originalEntries)layout.place(c,p);
      layout.recomputeAll();
      mutated=false;
    }
  }
  function search(todo,lo,hi){
    if(++nodes>nodeLimit||complete>=(net?2:1)||groupExpired())return false;
    if(!todo.length){
      if(signature(Array.from(chosen))===original)return false;
      if(!net)return true;
      evaluate();return false;
    }
    let pick=-1,legal=null;
    for(const c of todo){
      const available=options.get(c).filter(p=>(table.occLo[p]&lo|table.occHi[p]&hi)===0);
      if(!available.length)return false;
      if(legal===null||available.length<legal.length){pick=c;legal=available;}
    }
    const rest=todo.filter(c=>c!==pick);
    for(const p of legal){
      chosen.set(pick,p);
      if(search(rest,lo|table.occLo[p],hi|table.occHi[p]))return true;
      chosen.delete(pick);
      if(nodes>=nodeLimit||complete>=(net?2:1)||groupExpired())break;
    }
    return false;
  }
  const found=search(shuffle(selected.slice()),0,0);
  if(net)continue;
  if(!found||cancelled())return null;
    mutated=true;
    for(const c of selected){layout.remove(c);if(cancelled())return null;}
    for(const [c,p]of chosen)if(cancelled()||!layout.place(c,p))return null;
    if(cancelled())return null;
    layout.recomputeAll();applied=true;
    return restore;
  }
  if(!best||stopped())return null;
  mutated=true;layout.restore(best);layout.recomputeAll();applied=true;
  return restore;
  }finally{solver.netGroupRound=-1;if(!applied&&mutated)restore();}
}
function laozuSearchPick(rng,layout,usableCells,moves,original,solver){
  // Keep the original 100-part draw and cooling step. Reweighting the useful
  // moves would change how many effective proposals run at each temperature.
  const move=original(rng);
  const board=layout.board;
  const full=laozuSearchPopcount(board.occLo)+laozuSearchPopcount(board.occHi)===usableCells;
  // Periodically propose a complete six-to-eight-piece repacking. The same
  // annealing acceptance rule can cross equal-score and downhill layouts;
  // the global best snapshot remains the result floor.
  if(full&&solver&&(solver.iterations&1023)===0)return ()=>laozuSearchRepack(solver,(solver.iterations&2048)===0);
  if(move!==moves[0].apply&&move!==moves[3].apply)return move;
  // A completely occupied fixed-orientation board cannot accept either a
  // translated single piece or an extra piece. Skip the failed mutation only.
  return full?laozuSearchNoop:move;
}
function laozuSearchPolish(solver){
  if(!solver.running||solver.stopRequested||!solver.layout||!solver.table)return;
  const now=()=>typeof performance!=='undefined'?performance.now():Date.now();
  const remaining=solver.byIterations?8:Math.max(0,solver.budgetMs-solver.elapsedMs());
  if(remaining<=0)return;
  const deadline=now()+Math.min(8,remaining),layout=solver.layout,table=solver.table;
  let attempts=0,evaluations=0;
  const expired=()=>solver.stopRequested||attempts>=4096||evaluations>=128||now()>=deadline;
  // Preserve the old positive-gain insertion cleanup, but bound its work.
  for(const candidate of layout.unplacedCandidates()){
    if(expired())break;
    const range=table.byShape.get(solver.candidates[candidate].shapeId);
    if(!range)continue;
    let best=-1,bestScore=layout.total;
    for(let place=range.start;place<range.end&&!expired();place++){
      attempts++;
      if(!layout.place(candidate,place))continue;
      evaluations++;
      if(layout.total>bestScore+1e-6){best=place;bestScore=layout.total;}
      layout.remove(candidate);
    }
    if(best>=0)layout.place(candidate,best);
  }
  const placed=layout.placedCandidates(),pairs=[];
  for(let i=0;i<placed.length;i++)for(let j=i+1;j<placed.length;j++)pairs.push([placed[i],placed[j]]);
  if(!pairs.length)return;
  // Rotate the starting pair so repeated chunks do not always inspect the
  // same prefix. Candidate IDs, and thus each copy's awakening, stay intact.
  const start=(solver.localPairCursor||0)%pairs.length;
  for(let offset=0;offset<pairs.length&&!expired();offset++){
    const pairIndex=(start+offset)%pairs.length,[first,second]=pairs[pairIndex];
    solver.localPairCursor=(pairIndex+1)%pairs.length;
    const rangeA=table.byShape.get(solver.candidates[first].shapeId),rangeB=table.byShape.get(solver.candidates[second].shapeId);
    if(!rangeA||!rangeB)continue;
    let bestA=layout.placementOf(first),bestB=layout.placementOf(second),bestScore=layout.total;
    layout.remove(first);layout.remove(second);
    try{
      for(let placeA=rangeA.start;placeA<rangeA.end&&!expired();placeA++){
        attempts++;
        if(!layout.place(first,placeA))continue;
        for(let placeB=rangeB.start;placeB<rangeB.end&&!expired();placeB++){
          attempts++;
          if(!layout.place(second,placeB))continue;
          evaluations++;
          if(layout.total>bestScore+1e-6){bestA=placeA;bestB=placeB;bestScore=layout.total;}
          layout.remove(second);
        }
        layout.remove(first);
      }
    }finally{
      // Even a cancelled or time-limited partial enumeration restores both
      // physical copies, retaining only an actually evaluated improvement.
      layout.remove(first);layout.remove(second);
      layout.place(first,bestA);layout.place(second,bestB);
    }
  }
}
`;
  app=change(app,'class Wn{',shared+'\nclass Wn{');
  worker=change(worker,'class Rt{',shared+'\nclass Rt{');
  app=change(app,'f=zn(s.rng)(s);','f=laozuSearchPick(s.rng,a,this.usableCells,st,zn,this)(s);');
  worker=change(worker,'d=Et(e.rng)(e);','d=laozuSearchPick(e.rng,s,this.usableCells,L,Et,this)(e);');
  app=change(app,'a.clear(),tt(s,this.soloOrder),this.chunkBestScore','laozuSearchRestart(this,e,()=>tt(s,this.soloOrder)),this.chunkBestScore');
  worker=change(worker,'s.clear(),x(e,this.soloOrder),this.chunkBestScore','laozuSearchRestart(this,t,()=>x(e,this.soloOrder)),this.chunkBestScore');
  // A dry streak is not a proof of optimality. Timed runs must keep searching
  // until their budget or an explicit cancellation, including after ten chunks.
  app=change(app,'if(this.endChunk(),!this.byIterations&&this.dryChunks>=Dn)return l(!0);','this.endChunk();');
  worker=change(worker,'if(this.endChunk(),!this.byIterations&&this.dryChunks>=kt)return i(!0);','this.endChunk();');
  const endCheck='if(this.stopRequested||this.workDone()>=this.totalWork)return this.endChunk(),';
  const reservedCheck='if(this.stopRequested||this.workDone()>=Math.max(0,this.totalWork-(this.byIterations?0:8)))return this.endChunk(),';
  // Check inside the existing 192-proposal batch as well, so a slow batch
  // cannot consume the small reservation before endChunk gets to polish.
  const budgetCheck='if(!this.byIterations&&(this.iterations&7)===0&&this.elapsedMs()>=Math.max(0,this.budgetMs-8))break;';
  app=change(app,'c++){this.iterations++;','c++){'+budgetCheck+'this.iterations++;');
  worker=change(worker,'p++){this.iterations++;','p++){'+budgetCheck+'this.iterations++;');
  app=change(app,endCheck,reservedCheck);
  worker=change(worker,endCheck,reservedCheck);
  function replacePolish(source){
    const start=source.indexOf('polish(){'),end=source.indexOf('countUnplacedThatFit(){',start);
    if(start<0||end<start)throw new Error('Solver polish boundaries missing');
    return change(source,source.slice(start,end),'polish(){laozuSearchPolish(this)}');
  }
  return {app:replacePolish(app),worker:replacePolish(worker)};
};

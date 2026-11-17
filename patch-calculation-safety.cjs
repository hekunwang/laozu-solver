'use strict';

// Apply after the instance, search/core, incumbent and scoring patches, before UI.
// This changes search ordering and equivalent-copy pruning, not equipment rules.
module.exports = function patchCalculationSafety({app, worker, change}) {
  const shared = `
function laozuCalcProductBaseCritMultiplier(objective){
  const value=objective?.productBaseCritMultiplier;
  // Missing API fields keep the historical preference model. UI state owns
  // the explicit migration and chooses two for newly created configurations.
  if(value===undefined)return 1;
  if(value!==1&&value!==2)throw new Error('基础暴击倍率口径只能为 1 或 2');
  return value;
}
function laozuCalcHoldings(catalog,holdings){
  if(!Array.isArray(holdings))throw new Error('持有清单必须是数组');
  const equips=new Map(catalog.equips.map(eq=>[eq.id,eq])),counts=new Map();
  for(const holding of holdings){
    if(!holding||!Number.isInteger(holding.equipId)||!equips.has(holding.equipId))throw new Error('持有清单引用了不存在的法宝');
    if(!Number.isSafeInteger(holding.count)||holding.count<0||holding.count>99)throw new Error('每种法宝的持有数量必须是 0–99 的整数');
    const count=(counts.get(holding.equipId)||0)+holding.count;
    if(count>99)throw new Error('每种法宝的合计持有数量不能超过 99');
    counts.set(holding.equipId,count);
  }
  return counts;
}
function laozuCalcObjective(objective){
  // The fill flag is retained on the solver, but never added to real scores.
  // The best-result tuple below gives occupancy an exact, unbounded priority.
  return {...(objective||{kind:'power'}),fillBonus:0};
}
function laozuCalcFilled(layout){
  return laozuSearchPopcount(layout.board.occLo)+laozuSearchPopcount(layout.board.occHi);
}
function laozuCalcSnapshotFilled(solver,snapshot){
  let filled=0;
  for(let i=1;i<snapshot.length;i+=2)filled+=solver.table.cellStart[snapshot[i]+1]-solver.table.cellStart[snapshot[i]];
  return filled;
}
function laozuCalcBetter(solver,score,filled,previousScore,previousFilled){
  if(!Number.isFinite(score))return false;
  if(!Number.isFinite(previousScore))return true;
  return solver.fillBonus>0&&filled!==previousFilled?filled>previousFilled:score>previousScore;
}
function laozuCalcRecord(solver){
  const layout=solver.layout,score=layout.total,filled=laozuCalcFilled(layout);
  const chunkFilled=solver.chunkBestFilled??laozuCalcSnapshotFilled(solver,solver.chunkBestSnap);
  const chunkBetter=laozuCalcBetter(solver,score,filled,solver.chunkBestScore,chunkFilled);
  const bestBetter=laozuCalcBetter(solver,score,filled,solver.bestScore,solver.bestStats.filledCells);
  if(!chunkBetter&&!bestBetter)return;
  const snapshot=layout.snapshot();
  if(chunkBetter){solver.chunkBestScore=score;solver.chunkBestFilled=filled;solver.chunkBestSnap=snapshot;}
  if(bestBetter){
    solver.bestScore=score;solver.bestSnap=snapshot;solver.captureBestStats();
    const ms=solver.elapsedMs();solver.recordMilestone(ms);
    solver.history.push({ms,score,filledCells:filled});solver.chunkImproved=true;
  }
}
function laozuCalcAnnealDelta(solver,beforeScore,beforeFilled,afterScore,afterFilled){
  const delta=afterScore-beforeScore;
  if(!(solver.fillBonus>0)||beforeFilled===afterFilled)return delta;
  // Search is allowed to pass through holes. This bounded temperature-scaled
  // bias affects only the walk, never the exact ordering of retained results.
  const scale=Math.max(Number.MIN_VALUE,solver.T0);
  return Math.max(-scale,Math.min(scale,delta))+(afterFilled-beforeFilled)*scale*.25;
}
`;
  const candidates = `function awInstanceCandidates(catalog,holdings,usableCells,profileMap){
  const counts=laozuCalcHoldings(catalog,holdings);
  if(!Number.isSafeInteger(usableCells)||usableCells<0||usableCells>42)throw new Error('背包可用格数必须是 0–42 的整数');
  const equips=new Map(catalog.equips.map(eq=>[eq.id,eq]));
  const sizes=new Map(catalog.shapes.map(shape=>[shape.id,shape.cells.length]));
  const candidates=[];let prunedCount=0;
  for(const [equipId,count]of [...counts].sort((a,b)=>a[0]-b[0])){
    if(count===0)continue;
    const eq=equips.get(equipId),size=sizes.get(eq.shapeId);
    if(!Number.isSafeInteger(size)||size<1||size>42)throw new Error('法宝形状无效：'+equipId);
    const capacity=Math.floor(usableCells/size),keptByLevel=new Map();
    // Read the bounded inventory to choose identities, without first expanding
    // count objects. Only identical equipment/awakening profiles are equivalent.
    // Different levels can carry different auras, so neither dominates safely.
    for(let copyIndex=0;copyIndex<count;copyIndex++){
      const awakenLevel=awLevel({awaken:profileMap.awaken},equipId,copyIndex);
      const kept=keptByLevel.get(awakenLevel)||0;
      if(kept>=capacity){prunedCount++;continue;}
      const equipIndex=profileMap.get(awProfileKey(equipId,awakenLevel));
      if(equipIndex===undefined)throw new Error('法宝 '+equipId+' 的觉醒 '+awakenLevel+' 不在结算上下文中');
      keptByLevel.set(awakenLevel,kept+1);
      candidates.push({index:candidates.length,equipId,copyIndex,awakenLevel,equipIndex,
        shapeId:eq.shapeId,name:eq.name,tier:eq.tier,element:eq.element,cells:size});
    }
  }
  return {candidates,prunedCount};
}
`;
  function between(source,start,end,replacement){
    const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
    if(a<0||b<0)throw new Error('Calculation safety boundary missing: '+start);
    return change(source,source.slice(a,b),replacement);
  }
  function patchShared(source,className){
    source=change(source,'class '+className+'{',shared+'\nclass '+className+'{');
    const candidateStart=source.indexOf('function awInstanceCandidates('),candidateEnd=source.indexOf('\n}\n',candidateStart)+3;
    if(candidateStart<0||candidateEnd<3)throw new Error('Instance candidate function boundary missing');
    source=change(source,source.slice(candidateStart,candidateEnd),candidates);
    // A short awakening list still implies level zero for later physical copies.
    source=change(source,'?[...new Set(selected.map((_,copyIndex)=>awLevel(options,eq.id,copyIndex)))]',
      '?[...new Set([0,...selected.map((_,copyIndex)=>awLevel(options,eq.id,copyIndex))])]');
    source=change(source,'let best=initial,bestScore=layout.total,nodes=0,complete=0;',
      'let best=initial,bestScore=layout.total,bestFilled=laozuCalcFilled(layout),nodes=0,complete=0;');
    source=change(source,'if(layout.total>bestScore+1e-6){bestScore=layout.total;best=layout.snapshot();}',
      'if(laozuCalcBetter(solver,layout.total,laozuCalcFilled(layout),bestScore,bestFilled)){bestScore=layout.total;bestFilled=laozuCalcFilled(layout);best=layout.snapshot();}');
    source=change(source,'let best=-1,bestScore=layout.total;',
      'let best=-1,bestScore=layout.total,bestFilled=laozuCalcFilled(layout);');
    source=change(source,'if(layout.total>bestScore+1e-6){best=place;bestScore=layout.total;}',
      'if(laozuCalcBetter(solver,layout.total,laozuCalcFilled(layout),bestScore,bestFilled)){best=place;bestScore=layout.total;bestFilled=laozuCalcFilled(layout);}');
    source=change(source,'solver.chunkBestScore=layout.total;solver.chunkBestSnap=layout.snapshot();solver.chunkImproved=true;',
      'solver.chunkBestScore=layout.total;solver.chunkBestFilled=laozuCalcFilled(layout);solver.chunkBestSnap=layout.snapshot();solver.chunkImproved=true;');
    source=change(source,'this.chunkBestScore=this.bestScore,this.chunkBestSnap=this.bestSnap,',
      'this.chunkBestScore=this.bestScore,this.chunkBestFilled=this.bestStats.filledCells,this.chunkBestSnap=this.bestSnap,');
    return source;
  }
  app=patchShared(app,'Wn');worker=patchShared(worker,'Rt');
  app=change(app,'critRate:e.critRate??0,fillBonus:e.fillBonus??0',
    'critRate:e.critRate??0,productBaseCritMultiplier:laozuCalcProductBaseCritMultiplier(e),fillBonus:e.fillBonus??0');
  worker=change(worker,'critRate:t.critRate??0,fillBonus:t.fillBonus??0',
    'critRate:t.critRate??0,productBaseCritMultiplier:laozuCalcProductBaseCritMultiplier(t),fillBonus:t.fillBonus??0');
  app=change(app,'const a=_n(e,s.objective??{kind:"power"});',
    'laozuCalcHoldings(e,s.holdings);const a=_n(e,laozuCalcObjective(s.objective));');
  worker=change(worker,'const s=mt(t,e.objective??{kind:"power"});',
    'laozuCalcHoldings(t,e.holdings);const s=mt(t,laozuCalcObjective(e.objective));');
  app=change(app,'Sn(e,s.holdings,Math.max(1,this.usableCells),a.equipIndexById)',
    'Sn(e,s.holdings,this.usableCells,a.equipIndexById)');
  worker=change(worker,'yt(t,e.holdings,Math.max(1,this.usableCells),s.equipIndexById)',
    'yt(t,e.holdings,this.usableCells,s.equipIndexById)');
  app=change(app,'trueScore(e,s){return this.fillBonus===0?e:e-this.fillBonus*s}',
    'trueScore(e,s){return e}');
  worker=change(worker,'trueScore(t,e){return this.fillBonus===0?t:t-this.fillBonus*e}',
    'trueScore(t,e){return t}');
  app=change(app,'ca=t=>t===0?Zn:t??1','ca=(t,policy)=>t===0&&policy!=="zero"?Zn:t??1');

  function patchMethods(source,{now,rng,step,initialize,moves,pick,batch}){
    source=between(source,'startChunk(', 'endChunk(){', `startChunk(chunk){
      const eng=this.eng,layout=this.layout;
      this.chunkIndex=chunk;this.chunkStartIter=this.iterations;
      this.chunkIters=this.byIterations?Math.max(1,Math.min(this.chunkSize,this.totalWork-this.iterations)):this.chunkSize;
      eng.rng=${rng}(this.seed+chunk*${step});
      laozuCoreRestart(this,chunk,()=>${initialize}(eng,this.soloOrder));
      this.chunkBestScore=layout.total;this.chunkBestFilled=laozuCalcFilled(layout);this.chunkBestSnap=layout.snapshot();this.chunkImproved=false;
      laozuCalcRecord(this);
    }`);
    source=between(source,'endChunk(){','runSlice(',`endChunk(){
      if(!this.layout)return;
      this.layout.restore(this.chunkBestSnap);this.polish();laozuCalcRecord(this);
      this.dryChunks=this.chunkImproved?0:this.dryChunks+1;
    }`);
    source=between(source,'runSlice(','materializeMilestones(){',`runSlice(milliseconds){
      if(this.finished)return true;
      const eng=this.eng,layout=this.layout,started=${now}();this.runningSince=started;this.running=true;
      const finishSlice=done=>{this.consumedMs+=${now}()-started;this.running=false;this.finished=this.finished||done;return done;};
      for(;;){
        if(this.stopRequested||this.workDone()>=Math.max(0,this.totalWork-(this.byIterations?0:8))){this.endChunk();return finishSlice(true);}
        if(${now}()-started>=milliseconds)return finishSlice(false);
        if(this.iterations-this.chunkStartIter>=this.chunkIters){this.endChunk();this.startChunk(this.chunkIndex+1);continue;}
        const phase=Math.min(1,(this.iterations-this.chunkStartIter)/this.chunkIters),temperature=this.T0*Math.pow(this.T1/this.T0,phase);
        for(let attempt=0;attempt<${batch};attempt++){
          if(this.stopRequested||this.byIterations&&this.iterations>=this.totalWork||!this.byIterations&&(this.iterations&7)===0&&this.elapsedMs()>=Math.max(0,this.budgetMs-8))break;
          this.iterations++;
          const beforeScore=layout.total,beforeFilled=laozuCalcFilled(layout);
          const undo=laozuSearchPick(eng.rng,layout,this.usableCells,${moves},${pick},this)(eng);
          if(!undo)continue;
          // A valid proposal is a result candidate even if the walk rejects it.
          laozuCalcRecord(this);
          const delta=laozuCalcAnnealDelta(this,beforeScore,beforeFilled,layout.total,laozuCalcFilled(layout));
          if(!(delta>=0||eng.rng()<Math.exp(delta/temperature)))undo();
        }
      }
    }`);
    // Only evaluated, tuple-improving polish changes may replace the floor.
    // Final recomputation also removes accumulated arithmetic drift.
    source=change(source,'finish(){const ',
      'finish(){if(this.layout){this.layout.restore(this.bestSnap);this.layout.recomputeAll();this.polish();laozuCalcRecord(this);}const ');
    return source;
  }
  app=patchMethods(app,{now:'U1',rng:'Vt',step:'Pn',initialize:'tt',moves:'st',pick:'zn',batch:'Gn'});
  worker=patchMethods(worker,{now:'R',rng:'D',step:'wt',initialize:'x',moves:'L',pick:'Et',batch:'vt'});
  return {app,worker};
};

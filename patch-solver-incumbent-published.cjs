'use strict';

// Session-only incumbents. Both engines validate geometry and instance identity,
// then recompute scores with this request's compiled profiles; saved scores are ignored.
module.exports = function patchSolverIncumbent({app, worker, change}) {
  const shared = `
function awIncumbentBetter(a,b,fillFirst){
  if(!a||!Number.isFinite(a.score))return false;
  if(!b||!Number.isFinite(b.score))return true;
  return fillFirst&&a.filledCells!==b.filledCells?a.filledCells>b.filledCells:a.score>b.score;
}
function awValidIncumbent(catalog,request,packet){
  const pieces=packet?.pieces,board=request?.board;
  if(!Array.isArray(pieces)||pieces.length===0||pieces.length>42||!board||
    !Number.isInteger(board.rows)||board.rows<1||board.rows>6||!Number.isInteger(board.cols)||board.cols<1||board.cols>7||
    !Array.isArray(board.blocked)||board.blocked.some(cell=>!Number.isInteger(cell)||cell<0||cell>=42)||!Array.isArray(request.holdings))return null;
  const equips=new Map(catalog.equips.map(eq=>[eq.id,eq])),shapes=new Map(catalog.shapes.map(shape=>[shape.id,shape]));
  const counts=new Map,blocked=new Set(board.blocked),occupied=new Set,used=new Set;
  for(const h of request.holdings){
    if(!h||!Number.isInteger(h.equipId)||!equips.has(h.equipId)||!Number.isSafeInteger(h.count)||h.count<0)return null;
    counts.set(h.equipId,(counts.get(h.equipId)||0)+h.count);
  }
  const current=packet.recalculateAwakening===true,prepared=[];
  // Reserve explicit identities before assigning old records without copyIndex.
  for(const piece of pieces){
    if(!piece||!Number.isInteger(piece.equipId)||!equips.has(piece.equipId)||!Array.isArray(piece.cells)||piece.cells.length===0)return null;
    const eq=equips.get(piece.equipId),shape=shapes.get(eq.shapeId),count=counts.get(eq.id)||0;
    if(!shape||piece.cells.length!==shape.cells.length||count===0)return null;
    if(piece.awakenLevel!==undefined&&(!Number.isInteger(piece.awakenLevel)||piece.awakenLevel<0||piece.awakenLevel>(AWDB[eq.id]?.maxLevel??0)))return null;
    const cells=[...piece.cells].sort((a,b)=>a-b);
    for(const cell of cells){
      if(!Number.isInteger(cell)||cell<0||cell>=42||Math.floor(cell/7)>=board.rows||cell%7>=board.cols||blocked.has(cell)||occupied.has(cell))return null;
      occupied.add(cell);
    }
    const row=Math.min(...cells.map(cell=>Math.floor(cell/7))),col=Math.min(...cells.map(cell=>cell%7));
    const shapeRow=Math.min(...shape.cells.map(cell=>cell[0])),shapeCol=Math.min(...shape.cells.map(cell=>cell[1]));
    const expected=shape.cells.map(([r,c])=>(row+r-shapeRow)*7+col+c-shapeCol).sort((a,b)=>a-b);
    if(expected.some((cell,i)=>cell!==cells[i]))return null;
    let copyIndex=piece.copyIndex;
    if(copyIndex!==undefined){
      if(!Number.isInteger(copyIndex)||copyIndex<0||copyIndex>=count||used.has(eq.id+':'+copyIndex))return null;
      used.add(eq.id+':'+copyIndex);
      if(!current&&piece.awakenLevel!==undefined&&piece.awakenLevel!==awLevel(request.objective,eq.id,copyIndex))return null;
    }
    prepared.push({equipId:eq.id,copyIndex,cells,previousLevel:piece.awakenLevel});
  }
  for(const piece of prepared){
    if(piece.copyIndex===undefined){
      const count=counts.get(piece.equipId);let copy=-1;
      for(let i=0;i<count;i++)if(!used.has(piece.equipId+':'+i)&&(current||piece.previousLevel===undefined||piece.previousLevel===awLevel(request.objective,piece.equipId,i))){copy=i;break;}
      if(copy<0)return null;piece.copyIndex=copy;used.add(piece.equipId+':'+copy);
    }
    piece.awakenLevel=awLevel(request.objective,piece.equipId,piece.copyIndex);delete piece.previousLevel;
  }
  return prepared;
}
function awValidIncumbents(catalog,request){
  if(!Array.isArray(request.incumbents))return [];
  return request.incumbents.slice(0,3).map(packet=>awValidIncumbent(catalog,request,packet)).filter(Boolean);
}
function awIncumbentCandidates(catalog,request,built,profileMap){
  const seeds=awValidIncumbents(catalog,request);
  if(!seeds.length)return built;
  const candidates=built.candidates.slice(),known=new Set(candidates.map(piece=>piece.equipId+':'+piece.copyIndex));
  const equips=new Map(catalog.equips.map(eq=>[eq.id,eq])),sizes=new Map(catalog.shapes.map(shape=>[shape.id,shape.cells.length]));
  for(const seed of seeds)for(const piece of seed){
    const key=piece.equipId+':'+piece.copyIndex;if(known.has(key))continue;
    const eq=equips.get(piece.equipId),equipIndex=profileMap.get(awProfileKey(eq.id,piece.awakenLevel));
    if(equipIndex===undefined)continue;
    candidates.push({index:candidates.length,equipId:eq.id,copyIndex:piece.copyIndex,awakenLevel:piece.awakenLevel,equipIndex,shapeId:eq.shapeId,name:eq.name,tier:eq.tier,element:eq.element,cells:sizes.get(eq.shapeId)});known.add(key);
  }
  return {candidates,prunedCount:Math.max(0,built.prunedCount-(candidates.length-built.candidates.length))};
}
function awIncumbentSnapshot(solver,pieces){
  const result=[],used=new Set,table=solver.table;
  for(const piece of pieces){
    const candidate=solver.candidates.find(c=>c.equipId===piece.equipId&&c.copyIndex===piece.copyIndex&&c.awakenLevel===piece.awakenLevel);
    if(!candidate||used.has(candidate.index))return null;
    const profile=solver.layout.scoring.ctx.profiles[candidate.equipIndex];
    if(!profile||profile.equipId!==piece.equipId||profile.awakenLevel!==piece.awakenLevel)return null;
    const range=table.byShape.get(candidate.shapeId);if(!range)return null;let placement=-1;
    for(let p=range.start;p<range.end;p++){
      const begin=table.cellStart[p],end=table.cellStart[p+1];
      if(end-begin===piece.cells.length&&piece.cells.every((cell,i)=>table.cells[begin+i]===cell)){placement=p;break;}
    }
    if(placement<0)return null;used.add(candidate.index);result.push(candidate.index,placement);
  }
  return Int32Array.from(result);
}
function awSeedSolver(solver,catalog,request){
  solver.awIncumbent=null;
  if(!solver.layout||!solver.table||solver.finished)return;
  const seeds=awValidIncumbents(catalog,request);if(!seeds.length)return;
  const layout=solver.layout,original=layout.snapshot(),originalStats={...solver.bestStats},fillFirst=solver.fillBonus>0;
  let best=null;
  for(const pieces of seeds){
    const snap=awIncumbentSnapshot(solver,pieces);if(!snap)continue;
    layout.clear();let valid=true;
    for(let i=0;i<snap.length;i+=2)if(!layout.place(snap[i],snap[i+1])){valid=false;break;}
    if(!valid)continue;
    layout.recomputeAll();solver.captureBestStats();
    const value={score:solver.trueScore(layout.total,solver.bestStats.filledCells),...solver.bestStats,snap:layout.snapshot(),augmentedScore:layout.total};
    if(awIncumbentBetter(value,best,fillFirst))best=value;
  }
  layout.restore(original);layout.recomputeAll();solver.bestStats=originalStats;
  if(!best)return;
  solver.awIncumbent=best;
  const greedy={score:solver.trueScore(solver.bestScore,originalStats.filledCells),filledCells:originalStats.filledCells};
  if(!awIncumbentBetter(best,greedy,fillFirst))return;
  solver.bestScore=best.augmentedScore;solver.bestSnap=best.snap;solver.bestStats={atk:best.atk,def:best.def,hp:best.hp,filledCells:best.filledCells};
  solver.milestones=[];solver.history=[{ms:0,score:solver.bestScore}];solver.recordMilestone(0);
  // All threads retain the incumbent; only thread zero starts searching from it.
  if(solver.thread===0){
    layout.restore(best.snap);layout.recomputeAll();solver.chunkBestScore=layout.total;solver.chunkBestSnap=layout.snapshot();solver.chunkImproved=true;
    const scale=Math.max(1,Math.abs(best.score));solver.T0=scale*.03;solver.T1=scale*1e-5;
  }
}
function awIncumbentView(solver,view,materialize){
  const best=solver.awIncumbent;
  return awIncumbentBetter(best,view,solver.fillBonus>0)?{score:best.score,atk:best.atk,def:best.def,hp:best.hp,filledCells:best.filledCells,pieces:materialize(best.snap,solver.table,solver.candidates)}:view;
}
function awIncumbentFinish(solver,result,materialize,unused){
  const best=solver.awIncumbent;
  if(!awIncumbentBetter(best,result,solver.fillBonus>0))return result;
  solver.layout.restore(best.snap);solver.layout.recomputeAll();
  const pieces=materialize(best.snap,solver.table,solver.candidates);
  return {...result,pieces,score:solver.trueScore(solver.layout.total,best.filledCells),filledCells:best.filledCells,drift:0,unusedByEquip:unused(solver.candidates,pieces.map(piece=>piece.candidateIndex)),unplacedThatFit:solver.countUnplacedThatFit()};
}
`;
  app=change(app,'function awProfileKey(',shared+'\nfunction awProfileKey(');
  worker=change(worker,'function awProfileKey(',shared+'\nfunction awProfileKey(');
  app=change(app,'Sn(e,s.holdings,Math.max(1,this.usableCells),a.equipIndexById)',
    'awIncumbentCandidates(e,s,Sn(e,s.holdings,Math.max(1,this.usableCells),a.equipIndexById),a.equipIndexById)');
  worker=change(worker,'yt(t,e.holdings,Math.max(1,this.usableCells),s.equipIndexById)',
    'awIncumbentCandidates(t,e,yt(t,e.holdings,Math.max(1,this.usableCells),s.equipIndexById),s.equipIndexById)');
  const wrapper=(name,materialize,unused)=>`
${name}=class extends ${name}{
  constructor(catalog,request){super(catalog,request);awSeedSolver(this,catalog,request);}
  bestSnapshot(){return awIncumbentView(this,super.bestSnapshot(),${materialize});}
  progress(){const value=super.progress();return value.best?{...value,bestScore:value.best.score}:value;}
  finish(){return awIncumbentFinish(this,super.finish(),${materialize},${unused});}
};
`;
  app=change(app,'const ia=(t,e,s,a)=>',wrapper('Wn','Zt','es')+'const ia=(t,e,s,a)=>');
  worker=change(worker,'const F=(n,t,e,s)=>',wrapper('Rt','U','$')+'const F=(n,t,e,s)=>');

  const ui=`
let awSessionIncumbent=null;
function awIncumbentKey(request){
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
  return JSON.stringify(stable({board:request.board,holdings:request.holdings,objective:request.objective}));
}
function awPrepareIncumbentRequest(request,current,previous,previousMatches){
  const snapshot=JSON.parse(JSON.stringify(request)),key=awIncumbentKey(snapshot),incumbents=[];
  if(current?.pieces)incumbents.push({pieces:current.pieces,recalculateAwakening:true});
  if(awSessionIncumbent?.key===key)incumbents.push({pieces:awSessionIncumbent.pieces});
  if(previousMatches&&previous?.pieces)incumbents.push({pieces:previous.pieces});
  snapshot.incumbents=incumbents.map(packet=>({pieces:awValidIncumbent(z,snapshot,packet)})).filter(packet=>packet.pieces);
  return snapshot;
}
function awRememberIncumbent(request,result){
  if(!result||!Number.isFinite(result.score))return;
  const pieces=awValidIncumbent(z,request,{pieces:result.pieces});
  if(pieces)awSessionIncumbent={key:awIncumbentKey(request),pieces};
}
`;
  app=change(app,'const pe=C(null)',ui+'\nconst pe=C(null)');
  app=change(app,'Ts=()=>{if(be.value||at.value)return;',
    'Ts=()=>{if(be.value||at.value)return;const awRunRequest=awPrepareIncumbentRequest({holdings:Te.value,board:c0.value,objective:We.value,budgetMs:He.value,seed:Xe.value},Ae.value,pe.value,Na===Ea.value);');
  app=change(app,'r1=Vn(z,{holdings:Te.value,board:c0.value,objective:We.value,budgetMs:He.value,seed:Xe.value},',
    'r1=Vn(z,awRunRequest,');
  app=change(app,'r1.promise.then(n=>{pe.value=n,',
    'r1.promise.then(n=>{awRememberIncumbent(awRunRequest,n);pe.value=n,');
  return {app,worker};
};

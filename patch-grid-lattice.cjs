'use strict';
// A portrait game can occupy only the middle of a wider phone capture. Use
// the content width for the seam pitch only when both black bars have a stable
// vertical boundary. All identities and final layout coordinates still use the
// untouched screenshot. An ordinary full-bleed picture exits at its first edge.
function screenshotPillarbox(bitmap) {
  const {w,h}=bitmap, minimum=Math.max(4,Math.ceil(w*.015)),limit=Math.floor(w*.27);
  const dark=(x,y)=>{
    const rgb=bitmap.px(x,y);
    const high=Math.max(rgb[0],rgb[1],rgb[2]);
    return high<=14&&high-Math.min(rgb[0],rgb[1],rgb[2])<=6;
  };
  const left=[],right=[];
  for(let row=1;row<=9;row++){
    const y=Math.floor(row*h/10);
    if(!dark(0,y)||!dark(w-1,y))return null;
    let lo=0,hi=0;
    while(lo<=limit&&dark(lo,y))lo++;
    while(hi<=limit&&dark(w-1-hi,y))hi++;
    left.push(lo);right.push(hi);
  }
  const stable=widths=>{
    widths.sort((a,b)=>a-b);
    const median=widths[4];
    return median>=minimum&&median<=limit&&widths.filter(value=>Math.abs(value-median)<=2).length>=7?median:0;
  };
  const l=stable(left),r=stable(right);
  return l&&r&&Math.abs(l-r)<=Math.max(3,Math.min(l,r)*.2)?{x:l,width:w-l-r}:null;
}

function seamCandidates(bitmap){
  const {round,min,max}=Math;
  const bounds=screenshotPillarbox(bitmap),offset=bounds?.x??0,contentWidth=bounds?.width??bitmap.w;
  const w=288,h=round(bitmap.h*w/contentWidth),sx=contentWidth/w,sy=bitmap.h/h;
  const l=new Float32Array(w*h),v=new Float32Array(w*(h+1)),b=new Float32Array((w+1)*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let sum=0;
    for(const dy of [-.25,.25])for(const dx of [-.25,.25]){
      const p=bitmap.px(offset+min(contentWidth-1,max(0,round((x+.5+dx)*sx-.5))),min(bitmap.h-1,max(0,round((y+.5+dy)*sy-.5))));
      sum+=(p[0]+p[1]+p[2])/12;
    }
    l[y*w+x]=sum;
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const mid=l[y*w+x];
    v[(y+1)*w+x]=v[y*w+x]+(x>=2&&x<w-2?max(0,min(l[y*w+x-2],l[y*w+x+2])-mid):0);
    b[y*(w+1)+x+1]=b[y*(w+1)+x]+(y>=2&&y<h-2?max(0,min(l[(y-2)*w+x],l[(y+2)*w+x])-mid):0);
  }
  const top=[];
  for(let p=w/7.6*.82;p<=w/7.6*1.12;p+=.25){
    const dx=round(7*p),dy=round(6*p);
    for(let y=2;y+dy<h-2;y++)for(let x=2;x+dx<w-2;x++){
      let score=0;
      for(let c=0;c<=7;c++){
        const xx=round(x+c*p);
        let z=0;for(let d=-1;d<=1;d++)z=max(z,(v[(y+dy)*w+xx+d]-v[y*w+xx+d])/dy);
        score+=min(z,20);
      }
      for(let r=0;r<=6;r++){
        const yy=round(y+r*p);
        let z=0;for(let d=-1;d<=1;d++)z=max(z,(b[(yy+d)*(w+1)+x+dx]-b[(yy+d)*(w+1)+x])/dx);
        score+=min(z,20);
      }
      if(top.length<15||score>top[top.length-1].score){
        top.push({score,grid:{ox:offset+x*sx,oy:y*sy,pw:p*sx,ph:p*sy}});top.sort((a,b)=>b.score-a.score);top.length=min(15,top.length);
      }
    }
  }
  return top;
}

// Strong board seams constrain the pitch and row phase even with only two
// pieces. Search a bounded local origin neighbourhood before the global fitter.
// Two different nearby origins must independently identify the same two pieces
// with the unchanged appearance, element and number thresholds. Otherwise keep
// the existing global fallback. The grid-only legacy worker has no identity
// library and therefore cannot take this shortcut.
function fitSparseScreenshotLattice(bitmap, seed, countAnchors, scoreGrid) {
  if(typeof recognitionGridEvidence!=='function'||countAnchors(bitmap,seed.grid)>=3)return null;
  const rows=[];
  for(let x=-4;x<=4;x++)for(let y=-4;y<=4;y++){
    const grid={...seed.grid,ox:seed.grid.ox+x*seed.grid.pw*.02,oy:seed.grid.oy+y*seed.grid.ph*.02};
    if(grid.ox<0||grid.oy<0||grid.ox+7*grid.pw>bitmap.w||grid.oy+6*grid.ph>bitmap.h)continue;
    rows.push({grid,score:scoreGrid(bitmap,grid)});
  }
  rows.sort((a,b)=>b.score-a.score);
  let best=null,identity=null,support=0;
  for(const row of rows.slice(0,4)){
    if(row.score<33)continue;
    row.anchors=countAnchors(bitmap,row.grid);if(row.anchors!==2)continue;
    const evidence=recognitionGridEvidence(bitmap,row.grid);if(evidence.count!==2)continue;
    const key=evidence.matches.map(item=>item.row+','+item.col+':'+item.equipId).join('|');
    if(identity!==null&&key!==identity)return null;
    support++;identity=key;if(!best)best=row;
  }
  return support>=2?{...best,converged:true}:null;
}

// JPEG color blending can push a real board below the palette cutoff. Only
// after the normal lattice checks fail, corroborate the existing row phases
// with the unchanged icon, element, shape and number checks. Six independent
// pieces across at least three rows and columns must uniquely favor one phase;
// that phase must also dominate both color and badge evidence. A shifted board
// or repeated artwork cannot win merely by adding glyph-like patches.
function fitVerifiedScreenshotLattice(bitmap, rows, countAnchors) {
  if(typeof recognitionGridEvidence!=='function')return null;
  const ranked=rows.map(row=>({...row,anchors:row.anchors??countAnchors(bitmap,row.grid),
    evidence:recognitionGridEvidence(bitmap,row.grid)})).sort((a,b)=>b.evidence.count-a.evidence.count);
  const best=ranked[0];
  if(!best||best.evidence.count<6||best.anchors<6
      ||ranked[1]?.evidence.count===best.evidence.count
      ||ranked.some(row=>row.score>best.score||row.anchors>best.anchors))return null;
  const matched=best.evidence.matches;
  if(new Set(matched.map(item=>item.row)).size<3||new Set(matched.map(item=>item.col)).size<3)return null;
  return {grid:best.grid,score:best.score,anchors:best.anchors,converged:true};
}

// A weak seam can have the correct row and pitch but a one-pixel origin error.
// Do not accept that shortcut when an adjacent origin preserves every verified
// identity while exposing more badges and no less board-color evidence. The
// extra badges have not established their identities, so keep the original
// global fitter rather than select a nearby phase by color alone.
function hasStrongerScreenshotPhase(bitmap, fit, countAnchors, scoreGrid) {
  const key=item=>item.row+','+item.col+':'+item.equipId;
  const required=recognitionGridEvidence(bitmap,fit.grid).matches.map(key);
  for(const dx of [-1,0,1])for(const dy of [-1,0,1]){
    if(!dx&&!dy)continue;
    const grid={...fit.grid,ox:fit.grid.ox+dx,oy:fit.grid.oy+dy};
    if(grid.ox<0||grid.oy<0||grid.ox+7*grid.pw>bitmap.w||grid.oy+6*grid.ph>bitmap.h
        ||scoreGrid(bitmap,grid)<fit.score||countAnchors(bitmap,grid)<=fit.anchors)continue;
    const evidence=recognitionGridEvidence(bitmap,grid),identities=new Set(evidence.matches.map(key));
    if(required.every(identity=>identities.has(identity)))return true;
  }
  return false;
}

// Weak seams cannot use the ordinary three-badge route. They may still locate a
// compressed full board when six real badges already support the seed. Examine
// at most two pitches and their five row phases, then require the stronger
// distributed-identity verification above. Do not lower the seam cutoff or run
// another whole-picture search merely because JPEG decoders differ by one level.
function fitWeakScreenshotLattice(bitmap, seams, refine, countAnchors, scoreGrid) {
  const first=seams[0];
  if(typeof recognitionGridEvidence!=='function'||!first||countAnchors(bitmap,first.grid)<6)return null;
  const second=seams.find(row=>row.grid.pw!==first.grid.pw&&row.score>=first.score*.95);
  const rows=[];
  for(const seed of second?[first,second]:[first]){
    const initial=refine(bitmap,seed.grid),center=initial===seed.grid?initial:refine(bitmap,initial);
    for(let shift=-2;shift<=2;shift++){
      const grid={...center,oy:center.oy+shift*center.ph};
      if(grid.ox<0||grid.oy<0||grid.ox+7*grid.pw>bitmap.w||grid.oy+6*grid.ph>bitmap.h)continue;
      rows.push({grid,score:scoreGrid(bitmap,grid)});
    }
  }
  const best=fitVerifiedScreenshotLattice(bitmap,rows,countAnchors);
  return best&&!hasStrongerScreenshotPhase(bitmap,best,countAnchors,scoreGrid)?best:null;
}

// A lattice needs whole-board evidence. Check row phase after glyph refinement;
// background score alone and the number of dark glyph-like patches are not enough.
function fitScreenshotLattice(bitmap, fallback, refine, countAnchors, scoreGrid) {
  const seams=seamCandidates(bitmap), first=seams[0];
  if(!first)return fallback(bitmap);
  if(first.score<200)return fitWeakScreenshotLattice(bitmap,seams,refine,countAnchors,scoreGrid)||fallback(bitmap);
  const sparse=fitSparseScreenshotLattice(bitmap,first,countAnchors,scoreGrid);
  if(sparse)return sparse;
  const rejectedPhases=[];
  for(let attempt=0;attempt<2;attempt++){
    // JPEG sampling can leave the leading lattice just below the background
    // threshold. Keep the successful path unchanged; only on failure try one
    // similarly strong lattice with a different pitch, using the same checks.
    const candidate=attempt===0?first:seams.find(row=>
      row.grid.pw!==first.grid.pw && row.score>=200 && row.score>=first.score*.95);
    if(!candidate)break;
    // A pitch retry needs evidence in the original seam as well as the refined
    // one. If only glyph refinement creates anchors, keep the original fitter
    // instead of paying for another unsupported refinement.
    if(attempt===1 && countAnchors(bitmap,first.grid)<3)break;
    const center=refine(bitmap,refine(bitmap,candidate.grid)), rows=[];
    for(let shift=-2;shift<=2;shift++){
      const grid={...center,oy:center.oy+shift*center.ph};
      if(grid.oy<0||grid.oy+6*grid.ph>bitmap.h)continue;
      rows.push({grid,score:scoreGrid(bitmap,grid)});
    }
    const bestColor=Math.max(...rows.map(row=>row.score));
    let best=null;
    for(const row of rows){
      if(row.score<28||row.score<bestColor-3)continue;
      row.anchors=countAnchors(bitmap,row.grid);
      if(row.anchors<3)continue;
      if(!best||row.anchors>best.anchors||row.anchors===best.anchors&&row.score>best.score)best=row;
    }
    if(best)return {...best,converged:true};
    rejectedPhases.push(...rows);
  }
  // Keep every existing successful pitch retry ahead of the evidence fallback.
  // Compare both failed pitches together. Even near-duplicate winners tie and
  // retain the original global fallback rather than silently prefer one pitch.
  const verified=fitVerifiedScreenshotLattice(bitmap,rejectedPhases,countAnchors);
  if(verified)return verified;
  return fallback(bitmap);
}
module.exports=function patchGridLattice({app,change}){
  const start=app.indexOf('function gs(t,e){'),end=app.indexOf('function Jr(t,e){',start);
  if(start<0||end<start)throw Error('Grid glyph refinement anchor missing');
  const map={gs:'refineLatticeGlyphs',i1:'G',o1:'P',$1:'E',p0:'$',Le:'b',Y:'H',Ma:'K',Sa:'V'};
  const workerRefine=app.slice(start,end).replace(/[A-Za-z_$][\w$]*/g,name=>map[name]||name);
  const helpers=screenshotPillarbox.toString()+'\n'+seamCandidates.toString()+'\n'+fitSparseScreenshotLattice.toString()+'\n'+fitVerifiedScreenshotLattice.toString()+'\n'+hasStrongerScreenshotPhase.toString()+'\n'+fitWeakScreenshotLattice.toString()+'\n'+fitScreenshotLattice.toString()+'\n';
  app=change(app,'function zr(t){return recoverScreenshotGrid(t,gridFitOriginal,vs,e1)}',helpers+
    'function zr(t){return fitScreenshotLattice(t,b=>recoverScreenshotGrid(b,gridFitOriginal,vs,e1),gs,vs,e1)}');
  app=change(app,'function nA(t){return recoverScreenshotGrid(t,gridFitOriginal,_,z)}',helpers+workerRefine+
    'function nA(t){return fitScreenshotLattice(t,b=>recoverScreenshotGrid(b,gridFitOriginal,_,z),refineLatticeGlyphs,_,z)}');
  return app;
};
module.exports.fitScreenshotLattice=fitScreenshotLattice;
module.exports.seamCandidates=seamCandidates;
module.exports.screenshotPillarbox=screenshotPillarbox;
module.exports.fitSparseScreenshotLattice=fitSparseScreenshotLattice;
module.exports.fitVerifiedScreenshotLattice=fitVerifiedScreenshotLattice;
module.exports.fitWeakScreenshotLattice=fitWeakScreenshotLattice;
module.exports.hasStrongerScreenshotPhase=hasStrongerScreenshotPhase;

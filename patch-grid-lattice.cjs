'use strict';
function seamCandidates(bitmap){
  const {round,min,max}=Math;
  const w=288,h=round(bitmap.h*w/bitmap.w),sx=bitmap.w/w,sy=bitmap.h/h;
  const l=new Float32Array(w*h),v=new Float32Array(w*(h+1)),b=new Float32Array((w+1)*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let sum=0;
    for(const dy of [-.25,.25])for(const dx of [-.25,.25]){
      const p=bitmap.px(min(bitmap.w-1,max(0,round((x+.5+dx)*sx-.5))),min(bitmap.h-1,max(0,round((y+.5+dy)*sy-.5))));
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
        top.push({score,grid:{ox:x*sx,oy:y*sy,pw:p*sx,ph:p*sy}});top.sort((a,b)=>b.score-a.score);top.length=min(15,top.length);
      }
    }
  }
  return top;
}


// A lattice needs whole-board evidence. Check row phase after glyph refinement;
// background score alone and the number of dark glyph-like patches are not enough.
function fitScreenshotLattice(bitmap, fallback, refine, countAnchors, scoreGrid) {
  const seams=seamCandidates(bitmap),candidate=seams[0];
  if(!candidate || candidate.score<200) return fallback(bitmap);
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
  return best?{...best,converged:true}:fallback(bitmap);
}
module.exports=function patchGridLattice({app,change}){
  const start=app.indexOf('function gs(t,e){'),end=app.indexOf('function Jr(t,e){',start);
  if(start<0||end<start)throw Error('Grid glyph refinement anchor missing');
  const map={gs:'refineLatticeGlyphs',i1:'G',o1:'P',$1:'E',p0:'$',Le:'b',Y:'H',Ma:'K',Sa:'V'};
  const workerRefine=app.slice(start,end).replace(/[A-Za-z_$][\w$]*/g,name=>map[name]||name);
  const helpers=seamCandidates.toString()+'\n'+fitScreenshotLattice.toString()+'\n';
  app=change(app,'function zr(t){return recoverScreenshotGrid(t,gridFitOriginal,vs,e1)}',helpers+
    'function zr(t){return fitScreenshotLattice(t,b=>recoverScreenshotGrid(b,gridFitOriginal,vs,e1),gs,vs,e1)}');
  app=change(app,'function nA(t){return recoverScreenshotGrid(t,gridFitOriginal,_,z)}',helpers+workerRefine+
    'function nA(t){return fitScreenshotLattice(t,b=>recoverScreenshotGrid(b,gridFitOriginal,_,z),refineLatticeGlyphs,_,z)}');
  return app;
};
module.exports.fitScreenshotLattice=fitScreenshotLattice;
module.exports.seamCandidates=seamCandidates;

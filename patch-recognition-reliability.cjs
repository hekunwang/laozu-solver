'use strict';

// This inexpensive check corroborates an existing grid with independent icon,
// element, shape and terminal-number evidence. It does not run full recognition
// or learn new templates. The bounded cache belongs to the immutable bitmap.
function recognitionGridEvidence(bitmap, grid) {
  const key=[grid.ox,grid.oy,grid.pw,grid.ph].join(',');
  let cache=recognitionEvidenceCache.get(bitmap);
  if(!cache){cache=new Map();recognitionEvidenceCache.set(bitmap,cache);}
  if(cache.has(key))return cache.get(key);
  const matches=[], occupied=new Set();
  for(let row=0;row<6;row++)for(let col=0;col<7;col++){
    if(p0(bitmap,grid,row,col,Le.badgeBox)<=Y.anchorCandidate)continue;
    const signature=us(bitmap,grid,row,col), distances=new Map();
    for(const sample of ot){const d=n1(signature,sample.sig);if(d<(distances.get(sample.equipId)??Infinity))distances.set(sample.equipId,d);}
    const ranked=[...distances].sort((a,b)=>a[1]-b[1]);
    if(!ranked.length||ranked[0][1]>Y.signatureMaxDistance||ranked[1]&&ranked[1][1]-ranked[0][1]<Y.signatureMinMargin)continue;
    const eq=S0.find(item=>item.id===ranked[0][0]);
    if(!eq)continue;
    const cells=Kr(eq.shapeId,row,col),last=Xr(eq.shapeId,row,col),number=Or.get(String(eq.reson));
    if(!cells||!last||!number||cells.some(cell=>occupied.has(cell)))continue;
    const glyph=classifyElementGlyph(bitmap,grid,row,col,i1);
    if(glyph.key!==Fe[eq.element]||glyph.score<Y.glyphCorr||glyph.margin<Y.glyphMargin||glyph.score+2*glyph.margin<Y.glyphCombined)continue;
    if(M1(bitmap,grid,last.row,last.col,Le.numberBox,number,[-.024,-.016,-.008,0,.008,.016,.024])<Y.numberAccept)continue;
    matches.push({equipId:eq.id,row,col,cells});for(const cell of cells)occupied.add(cell);
  }
  const evidence={matches,count:matches.length};
  if(cache.size>=8)cache.delete(cache.keys().next().value);
  cache.set(key,evidence);return evidence;
}

// Tiny compressed element badges can be confidently wrong even at adjacent
// pixel phases. If the proposed item's own appearance template is outside the
// ordinary acceptance radius and clearly worse than another appearance, retain
// a manual review item. The nearest template is not accepted as a replacement.
function compressedIdentityContradicts(signature, equipId, grid) {
  if(grid.pw*(Le.elementBox[2]-Le.elementBox[0])>=Le.patchSize/2)return false;
  let own=Infinity,other=Infinity;
  for(const sample of ot){
    const value=n1(signature,sample.sig);
    if(sample.equipId===equipId)own=Math.min(own,value);else other=Math.min(other,value);
  }
  return Number.isFinite(own)&&own>Y.signatureMaxDistance&&own-other>=Y.signatureMinMargin;
}

function selectRecognitionGrid(bitmap, original, refined) {
  let selected=refined;
  // Keep the ordinary one-pass route. Only a colour-regressing refinement needs
  // an independent check; fake glyph anchors must not outweigh real equipment.
  if(refined!==original&&e1(bitmap,refined)<e1(bitmap,original)){
    const before=recognitionGridEvidence(bitmap,original);
    if(before.count&&recognitionGridEvidence(bitmap,refined).count<before.count)selected=original;
  }
  return alignCompressedRecognitionGrid(bitmap,selected);
}

// When a badge is sampled from fewer than half as many source pixels as its
// template, a one-pixel lattice phase can change the apparent element. Examine
// only the eight adjacent phases, never rerun the complete recognizer. A move
// must preserve every verified identity, gain two independent pieces, and not
// sacrifice background or badge evidence. Artwork alone cannot authorize it.
function alignCompressedRecognitionGrid(bitmap, grid) {
  if(grid.pw*(Le.elementBox[2]-Le.elementBox[0])>=Le.patchSize/2)return grid;
  const original=recognitionGridEvidence(bitmap,grid);
  if(original.count<3)return grid;
  const color=e1(bitmap,grid),anchors=vs(bitmap,grid);
  let best=null;
  for(const dx of [-1,0,1])for(const dy of [-1,0,1]){
    if(!dx&&!dy)continue;
    const shifted={...grid,ox:grid.ox+dx,oy:grid.oy+dy};
    if(shifted.ox<0||shifted.oy<0||shifted.ox+7*shifted.pw>bitmap.w||shifted.oy+6*shifted.ph>bitmap.h)continue;
    const score=e1(bitmap,shifted);if(score<color)continue;
    const evidence=recognitionGridEvidence(bitmap,shifted);
    if(evidence.count<original.count+2||original.matches.some(item=>!evidence.matches.some(
      next=>next.row===item.row&&next.col===item.col&&next.equipId===item.equipId)))continue;
    const count=vs(bitmap,shifted);if(count<anchors)continue;
    if(!best||evidence.count>best.count||evidence.count===best.count&&score>best.score){
      best={grid:shifted,count:evidence.count,score};
    }
  }
  return best?.grid||grid;
}

// A seam found at the 288-pixel search resolution can land between the
// source-pixel boundaries of narrow badges. Search only around an established
// board with unexplained equipment-colored cells, at the original pitch and
// its nearest whole source-pixel pitch. Geometry alone never adds an item.
function recoverIncompleteRecognitionGrid(bitmap, original, readGrid) {
  const grid=original.grid;
  if(original.unexplainedCells.length<2||original.pieces.length<6||original.redViolation
      ||original.pieces.some(piece=>piece.status!=='ok')
      ||grid.pw*(Le.elementBox[2]-Le.elementBox[0])<Le.patchSize/2)return original;
  const prior=recognitionGridEvidence(bitmap,grid);
  if(prior.count<6||new Set(prior.matches.map(p=>p.row)).size<3
      ||new Set(prior.matches.map(p=>p.col)).size<3)return original;
  const minimum=vs(bitmap,grid)+2,color=e1(bitmap,grid);
  const radius=Math.max(1,Math.min(3,Math.ceil(Math.max(grid.pw,grid.ph)/(288/7.6))));
  const pitches=[[grid.pw,grid.ph]];
  const pw=Math.round(grid.pw),ph=Math.round(grid.ph);
  if(pw!==grid.pw||ph!==grid.ph)pitches.push([pw,ph]);
  const options=[];
  for(const [width,height] of pitches)for(let dx=-radius;dx<=radius;dx++)for(let dy=-radius;dy<=radius;dy++){
    const g={ox:grid.ox+dx,oy:grid.oy+dy,pw:width,ph:height};
    if(g.ox<0||g.oy<0||g.ox+7*width>bitmap.w||g.oy+6*height>bitmap.h)continue;
    const score=e1(bitmap,g);
    if(score<color)continue;
    const anchors=vs(bitmap,g);
    if(anchors>=minimum)options.push({grid:g,anchors,score});
  }
  options.sort((a,b)=>b.anchors-a.anchors||b.score-a.score);
  const [best,witness]=options;
  if(!witness||best.anchors===witness.anchors)return original;
  const key=(row,col,id,cells)=>[row,col,id,...cells].join(',');
  const matchKey=p=>key(p.row,p.col,p.equipId,p.cells);
  const pieceKey=p=>key(p.row,p.col,p.equip.id,p.cells);
  const verified=new Set(recognitionGridEvidence(bitmap,best.grid).matches.map(matchKey));
  if(verified.size<prior.count+2||prior.matches.some(p=>!verified.has(matchKey(p))))return original;
  const trial=readGrid(bitmap,best.grid);
  if(trial.redViolation||trial.unexplainedCells.length||trial.pieces.some(p=>p.status!=='ok')
      ||trial.lockedCells.join(',')!==original.lockedCells.join(','))return original;
  const byPlacement=new Map(trial.pieces.map(p=>[pieceKey(p),p]));
  const oldKeys=new Set(original.pieces.map(pieceKey));
  if(original.pieces.some(p=>!byPlacement.has(pieceKey(p))))return original;
  const added=trial.pieces.filter(p=>!oldKeys.has(pieceKey(p)));
  const warnings=new Set(original.unexplainedCells);
  if(added.length<2||added.some(p=>!verified.has(pieceKey(p))||!p.cells.some(cell=>warnings.has(cell))))return original;
  const covered=new Set(added.flatMap(p=>p.cells));
  if(original.unexplainedCells.some(cell=>!covered.has(cell)))return original;
  const supported=new Set(recognitionGridEvidence(bitmap,witness.grid).matches.map(matchKey));
  if(added.some(p=>!supported.has(pieceKey(p))))return original;
  // Retain previously read per-copy awakening values, including an uncertain
  // result. Repositioning a board cannot silently change a held red item.
  const level=(g,p)=>{
    const reading=awRecognizeBitmap(bitmap,g,p);
    return reading?.awakenStatus!=='uncertain'&&awScreenshotLevelValid(reading?.awakenLevel)?reading.awakenLevel:null;
  };
  try{
    if(original.pieces.some(p=>awScreenshotIsRed(p)&&level(grid,p)!==level(trial.grid,byPlacement.get(pieceKey(p)))))return original;
  }catch{return original;}
  return trial;
}

function resolveScreenshotWorkerUrl(reference){
  const page=new URL(location.href),base=typeof document!=='undefined'?document.baseURI:page.href;
  const url=new URL(reference,base);
  if(url.origin!==page.origin||url.protocol!==page.protocol||!['https:','http:','file:'].includes(url.protocol))throw Error('截图识别文件须与网页同源');
  return url.href;
}

function createScreenshotRecognitionJob(imageData,options={}){
  let worker=null,blobUrl=null,timer=null,started=false,settled=false,resolveJob,rejectJob;
  const promise=new Promise((resolve,reject)=>{resolveJob=resolve;rejectJob=reject;});
  const failure=(code,message)=>Object.assign(new Error(message),{code});
  const releaseBlob=()=>{
    if(blobUrl){URL.revokeObjectURL(blobUrl);blobUrl=null;}
  };
  const discardWorker=()=>{
    if(worker){worker.onmessage=worker.onerror=worker.onmessageerror=null;worker.terminate();worker=null;}
    releaseBlob();
  };
  const finish=(result,error)=>{
    if(settled)return;settled=true;if(timer!==null)clearTimeout(timer);
    discardWorker();
    error?rejectJob(error):resolveJob(result);
  };
  const unavailable=()=>finish(null,failure('RECOGNITION_WORKER_UNAVAILABLE','截图识别不可用，请手工录入法宝'));
  timer=setTimeout(()=>finish(null,failure('RECOGNITION_TIMEOUT','截图识别超时，请校正网格后重试，或手工录入法宝')),20000);
  const launch=()=>{
    const packed=blobUrl!==null;
    // Sites with a worker-src policy that excludes blob: use the byte-identical
    // static Worker. Only retry before any pixels have been sent for recognition.
    const startupFailure=()=>{
      if(!packed){unavailable();return;}
      discardWorker();launch();
    };
    try{
      worker=packed?new Worker(blobUrl,{name:'laozu-screenshot-recognition'}):
        new Worker(resolveScreenshotWorkerUrl(SCREENSHOT_RECOGNITION_WORKER_URL),{name:'laozu-screenshot-recognition'});
    }catch{startupFailure();return;}
    const instance=worker;
    worker.onmessage=event=>{
      if(settled||worker!==instance)return;const message=event.data;
      if(message?.type==='ready'){
        if(started)return;started=true;releaseBlob();
        try{worker.postMessage({type:'recognize',width:imageData.width,height:imageData.height,pixels:imageData.data,grid:options.grid||null,signatures:Ba()});}
        catch{finish(null,failure('RECOGNITION_WORKER_ERROR','截图识别失败，请重试或手工录入法宝'));}return;
      }
      if(message?.type==='phase'){options.onPhase?.(message.phase);return;}
      if(message?.type==='done'&&started){finish(message);return;}
      if(message?.type==='error')finish(null,failure('RECOGNITION_ERROR',message.message||'截图识别失败，请校正网格后重试'));
    };
    worker.onerror=worker.onmessageerror=()=>{
      if(settled||worker!==instance)return;
      if(started)finish(null,failure('RECOGNITION_WORKER_ERROR','后台识别中断，请重试或手工录入法宝'));
      else startupFailure();
    };
  };
  if(typeof Worker==='undefined')unavailable();
  else{
    if(SCREENSHOT_RECOGNITION_WORKER_URL!=='inline:gear'&&typeof packedGearWorkerUrl==='function'){
      try{blobUrl=packedGearWorkerUrl();}catch{blobUrl=null;}
    }
    launch();
  }
  return {promise,cancel:()=>finish(null,failure('RECOGNITION_CANCELLED','截图识别已取消'))};
}

function recognizeScreenshotInWorker(){
  if(!V||!re.value)return;
  h0++;cancelImportRecognition();Pe?.cancel();Pe=null;E1.value=false;
  const image=V,sourceGrid=re.value,grid={...sourceGrid},generation=h0,run=importRecognitionRun;
  const current=()=>generation===h0&&run===importRecognitionRun&&V===image&&re.value===sourceGrid&&['ox','oy','pw','ph'].every(key=>sourceGrid[key]===grid[key]);
  N1.value=null;me.value='识别中…';
  const job=createScreenshotRecognitionJob(image.data,{grid});importRecognitionJob=job;
  job.promise.then(output=>{
    if(!current())return;importRecognitionJob=null;
    re.value=output.result.grid;d1.value=output.choices;v1.value=output.result;me.value=null;F0.value++;
  }).catch(error=>{
    if(!current())return;importRecognitionJob=null;d1.value={};v1.value=null;me.value=null;N1.value=error.message;F0.value++;
  });
}

async function importScreenshotInWorker(file){
  const generation=++h0;screenshotTalentReview.start(file);cancelImportRecognition();Pe?.cancel();Pe=null;
  E1.value=false;V=null;re.value=null;v1.value=null;d1.value={};N1.value=null;importPreviewExpanded.value=false;me.value='读取图片…';
  let image;try{image=await sl(file);}catch{if(generation===h0){me.value=null;N1.value='无法读取该图片，请换一张 PNG / JPG 截图';}return;}
  if(generation!==h0)return;V=image;me.value='自动定位网格…';E1.value=true;
  const current=()=>generation===h0&&V===image;
  const job=createScreenshotRecognitionJob(image.data,{onPhase:phase=>{if(current())me.value=phase==='fit'?'自动定位网格…':'识别法宝与觉醒…';}});Pe=job;
  job.promise.then(output=>{
    if(!current())return;Pe=null;E1.value=false;re.value=output.result.grid;B0.value=output.fit?.converged??false;d1.value=output.choices;v1.value=output.result;me.value=null;F0.value++;
  }).catch(error=>{
    if(!current())return;Pe=null;E1.value=false;me.value=null;re.value=J1(image.bitmap);B0.value=false;v1.value=null;d1.value={};N1.value=error.message;F0.value++;
  });
}

function recognitionWorkerHandler(event){
  const message=event.data;if(message?.type!=='recognize')return;
  try{
    localStorage.setItem(Fa,JSON.stringify(Array.isArray(message.signatures)?message.signatures:[]));
    const bitmap=qa({width:message.width,height:message.height,data:message.pixels});
    bitmap.stableGlyphRefinements=new Set();
    self.postMessage({type:'phase',phase:'fit'});
    const fit=message.grid?null:zr(bitmap),grid=message.grid||fit.grid;
    self.postMessage({type:'phase',phase:'recognize'});
    const result=awAttachScreenshot(bitmap,Jr(bitmap,grid,fit?.converged===true)),choices={};
    for(const group of result.groups)if(!group.impossible)group.clusters.forEach((cluster,index)=>{const known=Er(cluster.signature,group.candidates);if(known)choices[group.key+'#'+index]={equipId:known.equip.id,source:known.source};});
    V={bitmap};re.value=result.grid;d1.value=choices;v1.value=result;me.value=null;screenshotAutoOpenSuggestions();
    self.postMessage({type:'done',fit,result:v1.value,choices:d1.value});
  }catch(error){self.postMessage({type:'error',message:error?.message||'截图识别失败'});}
}

module.exports=function patchRecognitionReliability({app,change,emitWorker}){
  if(typeof emitWorker!=='function')throw Error('Recognition build requires emitWorker({source}) -> relative URL');
  // Corrupt learned signatures must never turn a NaN distance into a match.
  app=change(app,'Array.isArray(s.sig)&&s.sig.length===48','Array.isArray(s.sig)&&s.sig.length===48&&s.sig.every(Number.isFinite)');
  app=change(app,'filter(c=>c.d!==null);if(!i.length)return null;','filter(c=>c.d!==null&&Number.isFinite(c.d));if(!i.length)return null;');
  const old='function Jr(t,e){const s=refineGridPair(t,e,gs),';
  app=change(app,old,'const recognitionEvidenceCache=new WeakMap();\n'+recognitionGridEvidence.toString()+'\n'+alignCompressedRecognitionGrid.toString()+'\n'+compressedIdentityContradicts.toString()+'\n'+selectRecognitionGrid.toString()+'\n'+recoverIncompleteRecognitionGrid.toString()+'\nfunction Jr(t,e,auto=false){const grid=selectRecognitionGrid(t,e,refineGridPair(t,e,gs)),result=recognizeScreenshotAtGrid(t,grid);return auto?recoverIncompleteRecognitionGrid(t,result,recognizeScreenshotAtGrid):result;}\nfunction recognizeScreenshotAtGrid(t,s){const ');
  app=change(app,'T=$=>({...k,status:"ok",equip:$.eq,',
    'T=$=>compressedIdentityContradicts(p.sig,$.eq.id,s)?M("低清图标与候选身份矛盾，请换清晰截图或手工确认"):({...k,status:"ok",equip:$.eq,');
  app=change(app,'importRecognitionTimer=null,importRecognitionRun=0;','importRecognitionTimer=null,importRecognitionRun=0,importRecognitionJob=null;');
  app=change(app,'  importRecognitionRun++;','  importRecognitionRun++;\n  importRecognitionJob?.cancel();importRecognitionJob=null;');
  const replaceRange=(first,last,replacement)=>{const a=app.indexOf(first),b=app.indexOf(last,a);if(a<0||b<a)throw Error('Recognition job anchor changed: '+first);app=change(app,app.slice(a,b),replacement);};
  replaceRange('Dt=function recognizeCurrentScreenshot()',',ht=async function importScreenshot','Dt='+recognizeScreenshotInWorker.toString());
  replaceRange('ht=async function importScreenshot',',al=function skipScreenshotGridFit','ht='+importScreenshotInWorker.toString());
  // Both import paths now use createScreenshotRecognitionJob. The upstream
  // fit-only worker used to build another Blob as soon as the page opened.
  replaceRange('const xa=`(function()', 'const hs=ce.geometry;', '');
  replaceRange('const Ur=1500,Gr=function recognitionGridJob', ',Le=ce.geometry', '');
  app=change(app,',Le=ce.geometry,Y=ce.thresholds','const Le=ce.geometry,Y=ce.thresholds');
  if(/\b(?:Gr|Nr|xa|ps|Ur)\b/.test(app))throw Error('A caller still references the removed fit-only Worker');
  app=change(app,'let V=null;',resolveScreenshotWorkerUrl.toString()+'\n'+createScreenshotRecognitionJob.toString()+'\nlet V=null;');
  app=change(app,'const Dl=(t,e)=>',"if(typeof SCREENSHOT_RECOGNITION_WORKER_URL!=='undefined'){window.laozuLocal.recognitionWorkerUrl=SCREENSHOT_RECOGNITION_WORKER_URL;window.laozuLocal.createRecognitionJob=createScreenshotRecognitionJob;}\nconst Dl=(t,e)=>");
  // Capture the completed recognition implementation. The Worker has isolated,
  // memory-only state and receives only the picture and learned signatures.
  const start=app.indexOf('var g0'),end=app.lastIndexOf(',Ha=document.getElementById');
  if(start<0||end<start)throw Error('Recognition Worker bundle boundary changed');
  const workerSource="'use strict';const B=(object,key,value)=>(object[key]=value);const workerStorage=new Map();const localStorage={getItem:key=>workerStorage.get(key)??null,setItem:(key,value)=>workerStorage.set(key,String(value)),removeItem:key=>workerStorage.delete(key)};const window={matchMedia:()=>({matches:false}),addEventListener:()=>{}};\n"+app.slice(start,end)+';\nself.onmessage='+recognitionWorkerHandler.toString()+";self.postMessage({type:'ready'});";
  // Only the build emits this isolated source. It does not import the page app,
  // execute its DOM mount, or contain another inline copy of itself. The public
  // page requests the same-origin static asset only when recognition starts.
  const workerUrl=emitWorker({source:workerSource});
  if(typeof workerUrl!=='string'||!workerUrl.trim())throw Error('emitWorker must return the recognition Worker URL');
  app=change(app,'let V=null;','const SCREENSHOT_RECOGNITION_WORKER_URL='+JSON.stringify(workerUrl)+';\nlet V=null;');
  return app;
};
module.exports.recognitionGridEvidence=recognitionGridEvidence;
module.exports.selectRecognitionGrid=selectRecognitionGrid;
module.exports.compressedIdentityContradicts=compressedIdentityContradicts;
module.exports.alignCompressedRecognitionGrid=alignCompressedRecognitionGrid;
module.exports.recoverIncompleteRecognitionGrid=recoverIncompleteRecognitionGrid;
module.exports.createScreenshotRecognitionJob=createScreenshotRecognitionJob;
module.exports.resolveScreenshotWorkerUrl=resolveScreenshotWorkerUrl;
module.exports.recognizeScreenshotInWorker=recognizeScreenshotInWorker;
module.exports.importScreenshotInWorker=importScreenshotInWorker;

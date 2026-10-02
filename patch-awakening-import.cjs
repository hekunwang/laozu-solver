'use strict';

// Runs after patch-instance-ui.cjs. Recognition concerns the new awakening
// sticker only; the original resonance-number and equipment recognizers remain
// unchanged. The recognizer is supplied by the build, with no network or OCR
// runtime dependency.
module.exports=function patchAwakeningImport({app,change,recognizerSource}){
  if(typeof recognizerSource!=='string'||!recognizerSource.includes('awRecognizeBitmap')){
    throw new Error('Awakening screenshot recognizer source is missing');
  }
  const helpers=`
${recognizerSource}
function awScreenshotIsRed(piece){return piece.status!=='suspect'&&(piece.equip?.quality===5||piece.candidates?.some(eq=>eq.quality===5));}
function awScreenshotLevelValid(level){return Number.isInteger(level)&&level>=0&&level<=3;}
function awAttachScreenshot(bitmap,result){
  for(const piece of result.pieces){
    if(!awScreenshotIsRed(piece))continue;
    let reading;try{reading=awRecognizeBitmap(bitmap,result.grid,piece);}catch{reading=null;}
    const valid=reading&&awScreenshotLevelValid(reading.awakenLevel)&&reading.awakenStatus!=='uncertain';
    piece.awakenLevel=valid?reading.awakenLevel:null;
    piece.awakenConfidence=Number.isFinite(reading?.awakenConfidence)?Math.max(0,Math.min(1,reading.awakenConfidence)):0;
    piece.awakenStatus=valid?(reading.awakenStatus==='none'?'none':'recognized'):'uncertain';
    piece.awakenBox=reading?.awakenBox??null;
  }
  return result;
}
function awScreenshotEquip(result,index){
  const piece=result.pieces[index];if(piece.status==='ok')return piece.equip;
  for(const group of result.groups){if(group.impossible)continue;for(let cluster=0;cluster<group.clusters.length;cluster++){
    if(!group.clusters[cluster].pieceIndexes.includes(index))continue;
    const picked=d1.value[group.key+'#'+cluster];return picked?group.candidates.find(eq=>eq.id===picked.equipId):null;
  }}return null;
}
function awScreenshotSupported(eq,level){return awScreenshotLevelValid(level)&&level<=(AWDB[eq.id]?.maxLevel??0);}
function awImportMetadata(eq,piece,index,copies){
  const copyIndex=copies.get(eq.id)||0;copies.set(eq.id,copyIndex+1);
  const out={equipId:eq.id,copyIndex,cells:[...piece.cells]};
  if(eq.quality!==5)return out;
  const valid=awScreenshotSupported(eq,piece.awakenLevel)&&piece.awakenStatus!=='uncertain';
  return {...out,awakenLevel:valid?piece.awakenLevel:null,awakenPending:!valid,awakenConfidence:piece.awakenConfidence??0,importPieceIndex:index};
}
function awImportAwaken(layout){
  const levels={};for(const piece of layout.pieces){
    if(!AWDB[piece.equipId])continue;
    if(!awScreenshotLevelValid(piece.awakenLevel))throw new Error('截图觉醒等级尚未确认');
    (levels[piece.equipId]??=[])[piece.copyIndex]=piece.awakenLevel;
  }return awValidate(levels);
}
function awSetScreenshotLevel(index,level){
  const result=v1.value;if(!result||!awScreenshotLevelValid(level))return;
  v1.value={...result,pieces:result.pieces.map((piece,i)=>i===index?{...piece,awakenLevel:level,awakenConfidence:1,awakenStatus:'recognized',awakenManual:true}:piece)};
}
function awScreenshotBox(box){
  const values=Array.isArray(box)?box:[box?.x,box?.y,box?.width??box?.w,box?.height??box?.h];
  return values.length===4&&values.every(Number.isFinite)&&values[2]>0&&values[3]>0?values:null;
}
function awScreenshotCrop({piece}){
  const box=awScreenshotBox(piece.awakenBox);if(!V||!box)return null;
  return r('canvas',{width:64,height:64,style:{width:'48px',height:'48px',imageRendering:'pixelated',border:'1px solid var(--line)',borderRadius:'3px'},'aria-label':'原图觉醒角标',ref:canvas=>{
    if(!canvas||!V)return;const context=canvas.getContext('2d');context.clearRect(0,0,64,64);context.imageSmoothingEnabled=false;context.drawImage(V.canvas,...box,0,0,64,64);
  }});
}
function awImportControls({result}){
  const items=result.pieces.map((piece,index)=>({piece,index})).filter(({piece})=>awScreenshotIsRed(piece));
  if(!items.length)return null;
  return r(R,{children:[r('h3',{children:'逐件觉醒 · 可手动校正'}),r('p',{class:'muted small',children:'同名两件分别识别。看不清的角标必须选定等级后才能导入；不自动按未觉醒计算。'}),r('div',{class:'elder-rows',children:items.map(({piece,index})=>{
    const eq=awScreenshotEquip(result,index),valid=eq?awScreenshotSupported(eq,piece.awakenLevel)&&piece.awakenStatus!=='uncertain':awScreenshotLevelValid(piece.awakenLevel)&&piece.awakenStatus!=='uncertain';
    const name=eq?.name??piece.candidates.map(candidate=>candidate.name).join(' / '),missing=eq&&!AWDB[eq.id]?.maxLevel;
    return r('div',{class:'elder-row',children:[r(awScreenshotCrop,{piece}),r('span',{class:'name',children:name+' · 位置 ('+(piece.row+1)+','+(piece.col+1)+')'}),
      r('select',{'aria-label':'截图第'+(index+1)+'件觉醒等级',class:valid?'elder-select on':'elder-select',value:valid?String(piece.awakenLevel):'',onChange:event=>{if(event.target.value!=='')awSetScreenshotLevel(index,Number(event.target.value));},children:[r('option',{value:'',disabled:true,children:'待确认'}),...Array.from({length:4},(_,level)=>r('option',{value:String(level),children:level?'觉醒 '+level:'未觉醒'},level))]}),
      r('span',{class:valid?'muted small':'warn small',children:valid?(piece.awakenManual?'已手动确认':piece.awakenLevel===0?'未觉醒 · 已识别':'识别为觉醒 '+piece.awakenLevel+' · '+Math.round(piece.awakenConfidence*100)+'%'):(missing?'此法宝暂无官方觉醒数据；非零等级目前不能导入':'觉醒角标不确定，请先选择等级')})]},index);
  })})]});
}
`;
  // Keep declarations adjacent to the image-import UI, after bitmap helpers
  // and before the first importer component. No identifiers depend on order
  // beyond runtime access to the existing signals and canvas.
  app=change(app,'function ol(){',helpers+'\nfunction ol(){');
  app=change(app,'const e=Jr(V.bitmap,t);re.value=e.grid;',
    'const e=awAttachScreenshot(V.bitmap,Jr(V.bitmap,t));re.value=e.grid;');
  app=change(app,'const e={},s=new Map,a=[],n=[];let l=0;const i=new Map;',
    'const e={},s=new Map,a=[],n=[],awCopies=new Map;let l=0;const i=new Map;');
  app=change(app,'o.cells&&a.push({equipId:u.id,cells:o.cells})',
    'o.cells&&a.push(awImportMetadata(u,o,c,awCopies))');
  app=change(app,'layout:{pieces:a,missing:n.length+l,savedAt:',
    'awakenPending:a.filter(piece=>piece.awakenPending).length,layout:{pieces:a,missing:n.length+l,savedAt:');
  app=change(app,'const e=Tt(t);pr(e.counts,e.layout),',
    'const e=Tt(t);if(e.awakenPending)return;Aw.value=awImportAwaken(e.layout);pr(e.counts,e.layout),');
  app=change(app,'return r("div",{class:"import-side",children:[t.redViolation',
    'return r("div",{class:"import-side",children:[r(awImportControls,{result:t}),t.redViolation');
  app=change(app,'disabled:!e||e.countList.length===0||!!me.value,onClick:nl',
    'disabled:!e||e.countList.length===0||e.awakenPending>0||!!me.value,onClick:nl');
  app=change(app,'e.layout.missing>0&&r("span",{class:"muted",children:',
    'e.awakenPending>0&&r("span",{class:"warn",children:" · "+e.awakenPending+" 件觉醒待确认"}),e.layout.missing>0&&r("span",{class:"muted",children:');
  app=change(app,'validateLayout:Jn,holdings:ae};',
    'validateLayout:Jn,holdings:ae,recognizeAwakening:awRecognizeBitmap,attachScreenshotAwakening:awAttachScreenshot,screenshotMetadata:awImportMetadata,screenshotAwaken:awImportAwaken,importSummary:Tt,importResult:v1,setScreenshotLevel:awSetScreenshotLevel};');
  return app;
};

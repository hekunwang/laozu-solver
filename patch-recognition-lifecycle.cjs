'use strict';

// This patch changes ownership and completion of import work, not image data,
// fitting, refinement, recognition thresholds or the embedded Worker source.
function recognitionGridJob(imageData) {
  let worker = null, startTimer = null, fitTimer = null;
  let phase = 'starting', settled = false, resolveJob, rejectJob;
  const promise = new Promise((resolve, reject) => { resolveJob = resolve; rejectJob = reject; });
  const error = (code, message) => Object.assign(new Error(message), {code});
  const cleanup = () => {
    if (startTimer !== null) clearTimeout(startTimer);
    if (fitTimer !== null) clearTimeout(fitTimer);
    startTimer = fitTimer = null;
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      try { worker.terminate(); } catch {}
      worker = null;
    }
  };
  const finish = (fit, failure) => {
    if (settled) return;
    settled = true;
    cleanup();
    failure ? rejectJob(failure) : resolveJob(fit);
  };
  // Preserve the existing one-shot compatibility path before Worker startup.
  // Once fit has started, failures must not start another expensive fit.
  const fallback = () => {
    if (settled || phase !== 'starting') return;
    phase = 'fallback';
    cleanup();
    try { finish(zr(qa(imageData))); }
    catch { finish(null, error('GRID_FIT_ERROR', '无法自动定位网格，请手动校正')); }
  };
  const failed = () => {
    if (settled) return;
    if (phase === 'starting') fallback();
    else finish(null, error('GRID_WORKER_ERROR', '自动定位失败，请手动校正'));
  };
  if (typeof Worker === 'undefined') fallback();
  else {
    try { worker = new Nr(); } catch { fallback(); }
    if (worker && !settled) {
      startTimer = setTimeout(fallback, Ur);
      worker.onmessage = event => {
        if (settled) return;
        const message = event.data;
        if (message?.type === 'ready') {
          if (phase !== 'starting') return;
          clearTimeout(startTimer); startTimer = null;
          phase = 'fitting';
          fitTimer = setTimeout(() => finish(null,
            error('GRID_FIT_TIMEOUT', '自动定位超时，请手动校正网格')), 20000);
          try { worker.postMessage({type:'fit', w:imageData.width, h:imageData.height, pixels:imageData.data}); }
          catch { failed(); }
          return;
        }
        if (message?.type === 'done' && phase === 'fitting') {
          const fit = message.fit, grid = fit?.grid;
          if (grid && [grid.ox,grid.oy,grid.pw,grid.ph].every(Number.isFinite) && grid.pw > 0 && grid.ph > 0) finish(fit);
          else failed();
          return;
        }
        failed();
      };
      worker.onerror = worker.onmessageerror = failed;
    }
  }
  return {promise, cancel:() => finish(null, error('GRID_CANCELLED', '自动定位已取消'))};
}

// OCR results are a draft only. The existing gear confirmation is the sole
// commit point; changing images or closing the dialog invalidates the draft.
const {createUnifiedTalentReview}=require('./talent-review-state.cjs');
const reviewPanelSource=require('./talent-review-panel.cjs');
const importAliases=require('./data/acquired-talent-aliases.json').filter(alias=>
  require('./data/game-catalog.json').acquiredTalents.some(row=>row.id===alias.id&&row.name!==alias.name));

function resolveTalentImportRow(kind,item,innate,acquired,aliases){
  const rows=kind==='innate'?innate:kind==='acquired'?acquired:[];
  const row=rows.find(row=>row.id===item.id);
  if(!row)return null;
  if(row.name===item.name)return row;
  return kind==='acquired'&&aliases.some(alias=>alias.id===item.id&&alias.name===item.name)?row:null;
}

async function recognizeUnifiedTalents(file,abortSignal){
  if(!/^image\/(png|jpeg|webp)$/i.test(file?.type||''))throw Error('请选择 PNG、JPEG 或 WebP 截图');
  if(file.size>12*1024*1024)throw Error('截图超过 12 MB');
  if(abortSignal?.aborted)throw Object.assign(Error('识别已取消'),{name:'AbortError'});
  const controller=new AbortController(),signal=controller.signal;
  let timedOut=false,onAbort;
  const cancel=()=>controller.abort();
  const cancelled=new Promise((resolve,reject)=>{
    onAbort=()=>reject(timedOut?Error('天赋识别超时，请重试或手动选择'):Object.assign(Error('识别已取消'),{name:'AbortError'}));
    signal.addEventListener('abort',onAbort,{once:true});
  });
  abortSignal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>{timedOut=true;cancel();},45000);
  if(abortSignal?.aborted)cancel();
  const work=async()=>{
    let module;
    try { module=await import(new URL('./assets/browser-talent-ocr.js',document.baseURI).href); }
    catch { throw Error('天赋识别资源未就绪，请手动选择天赋'); }
    if(signal.aborted)throw Object.assign(Error('识别已取消'),{name:'AbortError'});
    const result=await module.recognizeText(file,{signal});
    const canonical=(kind,item)=>{
      return resolveTalentImportRow(kind,item,z.talents,ACDB,TALENT_IMPORT_ALIASES);
    };
    const matches=result.matches.map(item=>{
      const row=canonical(item.kind,item);
      if(!row)throw Error('天赋字库与当前版本不一致，请刷新页面');
      return {kind:item.kind,id:row.id,name:row.name,quality:row.quality,order:item.order};
    });
    const unresolved=result.unresolved.map(entry=>({...entry,candidates:entry.candidates.flatMap(item=>{
      const row=canonical(entry.kind,item);
      return row?[{id:row.id,name:row.name,quality:row.quality}]:[];
    })}));
    return {...result,matches,unresolved};
  };
  try { return await Promise.race([work(),cancelled]); }
  finally { clearTimeout(timer);abortSignal?.removeEventListener('abort',cancel);signal.removeEventListener('abort',onAbort); }
}

function screenshotImportBlockedCells(summary) {
  return summary.lockedCells.length===0?[]:F1.value?summary.lockedCells:qe.value;
}

function screenshotGearImportError(result,summary) {
  if(me.value)return me.value;
  if(!result||!summary?.countList.length)return '没有可导入的法宝';
  if(summary.awakenPending)return '请先确认全部法宝的觉醒等级';
  const holdings=summary.countList.map(({equip,count})=>({equipId:equip.id,count}));
  if(summary.layout.pieces.length!==holdings.reduce((sum,row)=>sum+row.count,0))return '可导入法宝的占格信息不完整';
  const layoutErrors=window.laozuLocal.validateLayout(summary.layout.pieces,
    {rows:le,cols:J,blocked:screenshotImportBlockedCells(summary)},holdings);
  return layoutErrors[0]||'';
}

function screenshotImportButton(result,summary) {
  const review=screenshotTalentReview.state.value;
  const gearOnly=review.status!=='ready'||pendingTalentDecisions()>0||!review.groups.some(group=>group.include);
  const gearError=screenshotGearImportError(result,summary)||
    (!screenshotManualLayoutValid(result)?'请先校正法宝的格位或候选确认结果':'');
  const error=gearError||(!gearOnly?screenshotTalentReview.plan().errors[0]:'');
  // Capture the displayed action and replace the button when it changes, so
  // an OCR completion between pointer-down and pointer-up cannot widen a tap.
  return r('button',{type:'button',class:'primary',disabled:!!error,
    title:error||(gearOnly?'保留当前先天、后天天赋，本图已选天赋也不会写入。':undefined),
    onClick:()=>{if(result===v1.value)nl(gearOnly?'gear-only':'combined');},
    children:gearOnly?'仅导入法宝':'确认导入法宝和天赋'},gearOnly?'gear-only':'combined');
}

function commitScreenshotImport(result,mode) {
  const summary=Tt(result),error=screenshotGearImportError(result,summary);
  if(error){N1.value=error;return;}
  try{
    const next={...window.laozuLocal.serialize(),holdings:summary.counts,awaken:awImportAwaken(summary.layout),
      currentLayout:summary.layout,boardRows:le,boardCols:J,blockedCells:screenshotImportBlockedCells(summary)};
    if(mode!=='gear-only'){
      const review=screenshotTalentReview.state.value;
      if(review.status!=='ready'||!review.groups.some(group=>group.include)){
        N1.value=review.status==='pending'?'天赋仍在识别，请等待或选择仅导入法宝':'本次没有参与导入的天赋，请选择仅导入法宝';return;
      }
      const talentPlan=screenshotTalentReview.plan();
      if(talentPlan.errors.length){N1.value=talentPlan.errors.join('；');return;}
      if(talentPlan.updates.innate!==undefined)next.talentPicks=talentPlan.updates.innate;
      if(talentPlan.updates.acquired!==undefined)next.acquiredTalentPicks=talentPlan.updates.acquired;
    }
    window.laozuLocal.importState(next);
  }catch(failure){N1.value='未导入，当前配置保持不变：'+failure.message;return;}
  Z1();
}

function cancelImportRecognition() {
  importRecognitionRun++;
  if (importRecognitionTimer !== null) clearTimeout(importRecognitionTimer);
  importRecognitionTimer = null;
}

function resetScreenshotImport() {
  h0++;
  screenshotTalentReview.reset();
  cancelImportRecognition();
  Pe?.cancel(); Pe = null;
  E1.value = false;
  V = null; re.value = null; v1.value = null; d1.value = {};
  N1.value = null; me.value = null; F1.value = true; F0.value++;
}

function recognizeCurrentScreenshot() {
  if (!V || !re.value) return;
  cancelImportRecognition();
  const image = V, sourceGrid = re.value, grid = {...sourceGrid}, generation = h0, run = importRecognitionRun;
  const current = () => generation === h0 && run === importRecognitionRun && V === image && re.value === sourceGrid
    && sourceGrid.ox === grid.ox && sourceGrid.oy === grid.oy && sourceGrid.pw === grid.pw && sourceGrid.ph === grid.ph;
  N1.value = null; me.value = '识别中…';
  importRecognitionTimer = setTimeout(() => {
    if (!current()) return;
    importRecognitionTimer = null;
    try {
      const result = awAttachScreenshot(image.bitmap, Jr(image.bitmap, grid));
      const choices = {};
      result.groups.forEach(group => {
        if (!group.impossible) group.clusters.forEach((cluster, index) => {
          const known = Er(cluster.signature, group.candidates);
          if (known) choices[`${group.key}#${index}`] = {equipId:known.equip.id, source:known.source};
        });
      });
      if (!current()) return;
      re.value = result.grid; d1.value = choices; v1.value = result;
      me.value = null; F0.value++;
    } catch {
      if (!current()) return;
      d1.value = {}; v1.value = null; me.value = null;
      N1.value = '截图识别失败，请调整网格后重试，或重新选择图片';
      F0.value++;
    }
  }, 30);
}

async function importScreenshot(file) {
  // The generation belongs to the selection, not the completion of decoding.
  const generation = ++h0;
  screenshotTalentReview.start(file);
  cancelImportRecognition();
  Pe?.cancel(); Pe = null;
  E1.value = false;
  V = null; re.value = null; v1.value = null; d1.value = {};
  N1.value = null; importPreviewExpanded.value = false; me.value = '读取图片…';
  let image;
  try { image = await sl(file); }
  catch {
    if (generation !== h0) return;
    me.value = null; N1.value = '无法读取该图片，请换一张 PNG / JPG 截图';
    return;
  }
  if (generation !== h0) return;
  V = image; me.value = '自动定位网格…'; E1.value = true;
  const current = () => generation === h0 && V === image;
  const failed = failure => {
    if (!current()) return;
    Pe = null; E1.value = false; me.value = null;
    re.value = J1(image.bitmap); B0.value = false;
    v1.value = null; d1.value = {};
    N1.value = failure?.code === 'GRID_FIT_TIMEOUT'
      ? '自动定位超时，请拖动四角校正网格；对齐后会重新识别'
      : '自动定位失败，请拖动四角校正网格；对齐后会重新识别';
    F0.value++;
  };
  try {
    const job = Gr(image.data);
    Pe = job;
    job.promise.then(fit => {
      if (!current()) return;
      Pe = null; E1.value = false;
      re.value = fit.grid; B0.value = fit.converged; Dt();
    }).catch(failed);
  } catch (failure) { failed(failure); }
}

function skipScreenshotGridFit() {
  if (!V) return;
  h0++; cancelImportRecognition(); Pe?.cancel(); Pe = null;
  E1.value = false; N1.value = null;
  re.value = J1(V.bitmap); B0.value = false; Dt();
}

module.exports = function patchRecognitionLifecycle({app, change}) {
  const marker = '/* recognition-lifecycle-v1 */';
  if (app.includes(marker)) return app;
  const replaceRange = (start, end, replacement) => {
    const first = app.indexOf(start), last = app.indexOf(end, first);
    if (first < 0 || last < first) throw Error('Recognition lifecycle anchor missing: ' + start);
    app = change(app, app.slice(first, last), replacement);
  };
  replaceRange('const Ur=1500,Gr=', ',Le=ce.geometry',
    marker + '\nconst Ur=1500,Gr=' + recognitionGridJob.toString());
  app = change(app, 'let Pe=null,h0=0;',
    'let Pe=null,h0=0,importRecognitionTimer=null,importRecognitionRun=0;\n'+createUnifiedTalentReview.toString()+'\n'+reviewPanelSource+'\n'+resolveTalentImportRow.toString()+'\nconst TALENT_IMPORT_ALIASES='+JSON.stringify(importAliases)+';\n'+recognizeUnifiedTalents.toString()+`
window.laozuTalentReviewFactory=createUnifiedTalentReview;window.laozuRecognizeTalents=recognizeUnifiedTalents;window.laozuTalentReviewValidate=(kind,ids)=>{const normalized=kind==='innate'?ar(ids):acValidate(ids);return ids.every((id,index)=>normalized[index]===id);};\nconst screenshotTalentReview=createUnifiedTalentReview({
  signal:value=>C(value),read:()=>window.laozuLocal.talentReview.read(),recognize:recognizeUnifiedTalents,
  validate:(kind,ids)=>window.laozuTalentReviewValidate(kind,ids),
  makeController:()=>typeof AbortController==='function'?new AbortController():null
});\n` + [screenshotImportBlockedCells,screenshotGearImportError,screenshotImportButton,commitScreenshotImport,cancelImportRecognition].map(fn=>fn.toString()).join('\n')+'\n');
  replaceRange('Ta=()=>', ',tl=', 'Ta=' + resetScreenshotImport.toString());
  replaceRange('Dt=()=>', ',ht=', 'Dt=' + recognizeCurrentScreenshot.toString());
  replaceRange('ht=async t=>', ',al=', 'ht=' + importScreenshot.toString());
  replaceRange(',al=()=>', ';typeof window', ',al=' + skipScreenshotGridFit.toString());
  app = change(app, 'nl=()=>{const t=v1.value;if(!t)return;', 'nl=(mode="combined")=>{const t=v1.value;if(!t)return;');
  app = change(app, 'r("button",{type:"button",class:"primary",disabled:!e||e.countList.length===0||e.awakenPending>0||!!me.value,onClick:nl,children:"确认导入"})',
    'screenshotImportButton(t,e)');
  app = change(app, 'e.awakenPending>0&&r("span",{class:"warn",children:" · "+e.awakenPending+" 件觉醒待确认"})',
    'pendingTalentDecisions()>0&&r("span",{class:"warn",children:" · "+pendingTalentDecisions()+" 项天赋待裁决"}),e.awakenPending>0&&r("span",{class:"warn",children:" · "+e.awakenPending+" 件觉醒待确认"})');
  app = change(app, '图片只在本机处理，不会上传。',
    '法宝和天赋将一起显示以供核对。图片只在本机处理，不会上传。');
  // N1 used to appear only before an image was loaded, hiding fit/recognition errors.
  app = change(app, 'children:[!B0.value&&r("p",{class:"warn small",children:',
    'children:[N1.value&&r("p",{class:"warn",role:"alert",children:N1.value}),!B0.value&&r("p",{class:"warn small",children:');
  return app;
};
module.exports.fitTimeoutMs = 20000;
module.exports.createUnifiedTalentReview = createUnifiedTalentReview;
module.exports.resolveTalentImportRow = resolveTalentImportRow;

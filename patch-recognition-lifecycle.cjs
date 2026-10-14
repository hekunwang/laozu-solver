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

function cancelImportRecognition() {
  importRecognitionRun++;
  if (importRecognitionTimer !== null) clearTimeout(importRecognitionTimer);
  importRecognitionTimer = null;
}

function resetScreenshotImport() {
  h0++;
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
    'let Pe=null,h0=0,importRecognitionTimer=null,importRecognitionRun=0;\n' + cancelImportRecognition.toString() + '\n');
  replaceRange('Ta=()=>', ',tl=', 'Ta=' + resetScreenshotImport.toString());
  replaceRange('Dt=()=>', ',ht=', 'Dt=' + recognizeCurrentScreenshot.toString());
  replaceRange('ht=async t=>', ',al=', 'ht=' + importScreenshot.toString());
  replaceRange(',al=()=>', ';typeof window', ',al=' + skipScreenshotGridFit.toString());
  // N1 used to appear only before an image was loaded, hiding fit/recognition errors.
  app = change(app, 'children:[!B0.value&&r("p",{class:"warn small",children:',
    'children:[N1.value&&r("p",{class:"warn",role:"alert",children:N1.value}),!B0.value&&r("p",{class:"warn small",children:');
  return app;
};
module.exports.fitTimeoutMs = 20000;

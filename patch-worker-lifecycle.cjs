'use strict';
// These functions are serialized into the archived bundle, where Wn/In/Kn/Xn
// refer to the same solver implementation used by the page and its workers.
function mainRunner(catalog, request, options = {}) {
  let solver, closed = false, stopped = false, resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  const schedule = bn();
  const step = () => {
    if (closed) return;
    try {
      if (!solver) solver = new Wn(catalog, request);
      if (stopped) solver.requestStop();
      if (solver.runSlice(gn)) {
        const result = solver.finish();
        if (!Number.isFinite(result?.score) || !Array.isArray(result?.pieces)) throw Error('计算未返回有效结果');
        closed = true; resolve(result); return;
      }
      options.onProgress?.(solver.progress());
      schedule(step);
    } catch (error) { closed = true; reject(error); }
  };
  schedule(step);
  return {
    promise, info: Promise.resolve({mode: 'main-thread', threads: 1}),
    stop() { stopped = true; solver?.requestStop(); },
    cancel() {
      if (closed) return;
      closed = true; solver?.requestStop();
      const error = Error('计算已取消'); error.name = 'AbortError'; reject(error);
    }
  };
}
function workerRunner(catalog, request, options = {}) {
  if (options.forceMainThread || typeof Worker === 'undefined') return ts(catalog, request, options);
  const count = Math.max(1, Math.min(K1, Math.floor(Number(options.threads) || St())));
  const fillFirst = (request.objective?.fillBonus ?? 0) > 0;
  const records = [], results = [], progress = new Map(), timers = new Set();
  const started = Date.now(), budget = Math.max(1, Number(request.budgetMs) || 20000);
  let closed = false, stopped = false, fallback = null, infoSent = false, launching = true;
  let resolve, reject, resolveInfo, stopTimer = null;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  const info = new Promise(a => { resolveInfo = a; });
  const timer = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id;
  };
  const clear = id => { clearTimeout(id); timers.delete(id); };
  const tell = value => { if (!infoSent) { infoSent = true; resolveInfo(value); } };
  const terminate = record => { clear(record.readyTimer); try { record.worker.terminate(); } catch {} };
  const cleanup = () => { for (const id of timers) clearTimeout(id); timers.clear(); records.forEach(terminate); };
  const valid = value => Number.isFinite(value?.score) && Array.isArray(value?.pieces) && Number.isFinite(value?.filledCells);
  const complete = () => {
    if (closed) return;
    if (!results.length) return useFallback();
    closed = true; cleanup();
    const best = Kn(results, fillFirst);
    resolve({...best, iterations: results.reduce((sum, item) => sum + Math.max(0, item.iterations || 0), 0),
      stopped: stopped || results.some(item => item.stopped),
      partial: records.some(record => record.failed),
      warning: records.some(record => record.failed) ? '部分计算线程提前结束，已保留其余线程及已收到的有效解' : undefined});
  };
  const fail = error => { if (closed) return; closed = true; cleanup(); tell({mode:'main-thread',threads:1}); reject(error); };
  const useFallback = () => {
    if (closed || fallback) return;
    cleanup(); tell({mode:'main-thread',threads:1});
    try {
      const remaining = Math.max(1, budget - (Date.now() - started));
      fallback = ts(catalog, {...request, budgetMs: remaining}, options);
      if (stopped) fallback.stop();
      fallback.promise.then(result => {
        if (closed) return;
        if (!valid(result)) return fail(Error('计算线程异常，重试也未返回有效结果'));
        closed = true; resolve({...result, recovered: true, warning: '计算线程不可用，已通过主线程分片完成'});
      }, fail);
    } catch (error) { fail(error); }
  };
  const check = () => { if (!launching && !closed && !fallback && records.every(record => record.done)) complete(); };
  const salvage = record => {
    const item = progress.get(record.id), best = item?.best;
    if (!valid(best)) return;
    results.push({...best, iterations: item.iterations || 0, elapsedMs: item.elapsedMs || 0,
      stopped: true, seed: (request.seed ?? 1) + record.id * 7919,
      usableCells: la(request.board), history: [], milestones: [], drift: 0,
      unusedByEquip: [], unplacedThatFit: 0, candidateCount: 0, prunedCount: 0, partial: true});
  };
  const failed = record => {
    if (closed || fallback || record.done) return;
    record.done = true; record.failed = true; salvage(record); terminate(record); check();
  };
  timer(() => { for (const record of records) failed(record); check(); }, budget + Math.max(1500, Math.min(5000, budget * 0.2)));
  for (let id = 0; id < count; id++) {
    let worker;
    try { worker = new In(); } catch { break; }
    const record = {id, worker, ready: false, done: false, failed: false, readyTimer: null};
    records.push(record);
    record.readyTimer = timer(() => failed(record), wn);
    worker.onmessage = event => {
      if (closed || fallback || record.done) return;
      const message = event.data || {};
      try {
        if (message.type === 'ready') {
          if (record.ready) return;
          record.ready = true; clear(record.readyTimer); tell({mode:'worker',threads:records.length});
          worker.postMessage({type:'solve',catalog,request:{...request,seed:(request.seed ?? 1)+id*7919,thread:id}});
          if (stopped) worker.postMessage({type:'stop'});
        } else if (message.type === 'progress') {
          const value = message.progress;
          if (!value || !Number.isFinite(value.bestScore)) return;
          progress.set(id, {...value, thread:id});
          const best = Xn(progress.values(), fillFirst);
          if (best) options.onProgress?.({...best,iterations:[...progress.values()].reduce((sum,item)=>sum+(item.iterations||0),0)});
        } else if (message.type === 'done') {
          if (!valid(message.result)) return failed(record);
          results.push(message.result); record.done = true; terminate(record); check();
        } else if (message.type === 'error') failed(record);
      } catch { failed(record); }
    };
    worker.onerror = () => failed(record);
    worker.onmessageerror = () => failed(record);
  }
  launching = false; check();
  return {
    promise, info,
    stop() {
      if (closed || stopped) return;
      stopped = true;
      if (fallback) { fallback.stop(); return; }
      for (const record of records) if (!record.done) {
        try { record.worker.postMessage({type:'stop'}); } catch { failed(record); }
      }
      if (!closed && !fallback && !stopTimer) stopTimer = timer(() => {
        for (const record of records) failed(record); check();
      }, 800);
    },
    cancel() {
      if (closed) return;
      closed = true; cleanup(); fallback?.cancel?.(); tell({mode:'worker',threads:records.length});
      const error = Error('计算已取消'); error.name = 'AbortError'; reject(error);
    }
  };
}
module.exports = function patch({app, change}) {
  const start = app.indexOf('ts=(t,e,s)=>{'), end = app.indexOf(',u0=', start);
  if (start < 0 || end < 0) throw Error('Main runner patch boundary missing');
  app = change(app, app.slice(start, end), 'ts=' + mainRunner.toString());
  const wstart = app.indexOf('Vn=(t,e,s={})=>{'), wend = app.indexOf(',Jn=', wstart);
  if (wstart < 0 || wend < 0) throw Error('Worker runner patch boundary missing');
  return change(app, app.slice(wstart, wend), 'Vn=' + workerRunner.toString());
};
module.exports.mainRunner = mainRunner;
module.exports.workerRunner = workerRunner;

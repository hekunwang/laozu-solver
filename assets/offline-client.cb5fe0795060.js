(function () {
  'use strict';
  const base = new URL('../', document.currentScript.src);
  const status = document.getElementById('offline-status');
  const text = document.getElementById('offline-status-text');
  if (!status || !text) return;
  let registration, watchedRegistration, ready = false, starting = false, updateReady = false;
  function render(message, canRetry = false) {
    text.textContent = message;
    status.dataset.ready = String(ready);
    status.dataset.retry = String(canRetry);
    status.title = message + (canRetry ? '（点击重试）' : '');
    status.setAttribute('aria-label', status.title);
  }
  function renderReady() {
    render(updateReady
      ? '已可离线使用 · 新版已准备好，关闭本工具的所有页面后重新打开即可更新'
      : navigator.onLine ? '已可离线使用' : '离线使用中');
  }
  function report(action = 'FABAO_OFFLINE_STATUS') {
    const worker = navigator.serviceWorker.controller;
    if (!worker) return;
    const channel = new MessageChannel();
    if (action === 'FABAO_OFFLINE_REPAIR') render('正在后台准备离线使用…');
    const timer = setTimeout(() => {
      channel.port1.close();
      if (!ready) render('离线准备未完成，联网后可重试', true);
    }, action === 'FABAO_OFFLINE_REPAIR' ? 60000 : 5000);
    channel.port1.onmessage = event => {
      clearTimeout(timer);
      channel.port1.close();
      ready = event.data?.type === 'FABAO_OFFLINE_STATUS' && event.data.ready === true;
      if (ready) renderReady();
      else render('离线资源未缓存完整，联网后可重试', true);
    };
    worker.postMessage({type: action}, [channel.port2]);
  }
  function watch(worker) {
    if (!worker) return;
    const changed = () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        updateReady = Boolean(registration.waiting);
        if (ready) renderReady();
      } else if (worker.state === 'activated') report();
      else if (worker.state === 'redundant' && !ready) render('离线准备未完成，联网后可重试', true);
    };
    worker.addEventListener('statechange', changed);
    changed();
  }
  async function start() {
    if (starting) return;
    starting = true;
    if (!ready) render('正在后台准备离线使用…');
    try {
      registration = await navigator.serviceWorker.register(new URL('sw.js', base).href, {
        scope: base.href, updateViaCache: 'none'
      });
      updateReady = Boolean(registration.waiting);
      if (registration !== watchedRegistration) {
        registration.addEventListener('updatefound', () => watch(registration.installing));
        watchedRegistration = registration;
      }
      watch(registration.installing);
      report();
      if (ready) renderReady();
    } catch {
      if (!ready) render('离线准备未完成，联网后可重试', true);
    } finally { starting = false; }
  }
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('caches' in window)) {
    render('当前浏览环境仅支持在线使用');
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => report());
  window.addEventListener('offline', () => { if (ready) renderReady(); });
  window.addEventListener('online', () => {
    if (ready) renderReady();
    else if (navigator.serviceWorker.controller) report('FABAO_OFFLINE_REPAIR');
    start();
  });
  status.addEventListener('click', () => {
    if (status.dataset.retry !== 'true') return;
    if (navigator.serviceWorker.controller) report('FABAO_OFFLINE_REPAIR');
    else start();
  });
  report();
  function schedule() {
    // Keep first render and application loading ahead of precaching.
    setTimeout(() => {
      if ('requestIdleCallback' in window) window.requestIdleCallback(start, {timeout: 3000});
      else start();
    }, 1500);
  }
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, {once: true});
})();

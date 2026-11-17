'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

// Serialized as the browser service worker. Cache names include the full scope.
function offlineWorker(config) {
  'use strict';
  const base = self.registration.scope;
  const prefix = 'fabao-offline:' + encodeURIComponent(base) + ':';
  const cacheName = prefix + config.version;
  const indexUrl = new URL('index.html', base).href;
  const predecessorsUrl = new URL('__fabao-cache-predecessors__', base).href;
  const resources = config.resources.map(row => ({...row, url: new URL(row.name, base).href,
    // Static hosts canonicalize /index.html to /. Fetch the canonical root
    // directly, retaining the fixed cache key and HTML integrity digest.
    fetchUrl: row.name === 'index.html' ? base : new URL(row.name, base).href}));
  const allowed = new Set(resources.map(row => row.url));
  const clientPages = new Map();
  async function complete() {
    if (!(await caches.has(cacheName))) return false;
    const cache = await caches.open(cacheName);
    return (await Promise.all(resources.map(row => cache.match(row.url)))).every(Boolean);
  }
  async function download(cache, rows) {
    return Promise.allSettled(rows.map(async row => {
      const response = await fetch(new Request(row.fetchUrl, {
        cache: 'reload', credentials: 'same-origin', integrity: row.integrity
      }));
      if (!response.ok || response.redirected) throw Error('Offline resource unavailable');
      await cache.put(row.url, response);
    }));
  }
  self.addEventListener('install', event => {
    event.waitUntil((async () => {
      const predecessors=(await caches.keys()).filter(name=>name.startsWith(prefix)&&name!==cacheName);
      const cache = await caches.open(cacheName);
      // Settle all writes before discarding an incomplete cache.
      const results = await download(cache, resources);
      if (results.some(result => result.status === 'rejected') || !(await complete())) {
        await caches.delete(cacheName);
        throw Error('Offline preparation incomplete');
      }
      // Remember only caches that predate this install. A status request from
      // an older worker must never delete a newer worker's staging cache.
      try { await cache.put(predecessorsUrl,new Response(JSON.stringify(predecessors))); }
      catch(error){await caches.delete(cacheName);throw error;}
      // Keep old pages running, but never let them block a newer navigation.
      // Their fingerprinted assets remain available in their original caches.
      await self.skipWaiting();
    })());
  });
  self.addEventListener('activate', event => {
    event.waitUntil((async () => {
      if (!(await complete())) throw Error('Offline cache incomplete');
      await self.clients.claim();
    })());
  });
  self.addEventListener('message', event => {
    if (!['FABAO_OFFLINE_STATUS', 'FABAO_OFFLINE_REPAIR'].includes(event.data?.type) || !event.ports?.[0]) return;
    event.waitUntil((async () => {
      let ready = false;
      try {
        if (event.source?.id && event.data.pageVersion) clientPages.set(event.source.id, event.data.pageVersion);
        if (event.data.type === 'FABAO_OFFLINE_REPAIR') {
          const cache = await caches.open(cacheName), missing = [];
          for (const row of resources) if (!(await cache.match(row.url))) missing.push(row);
          await download(cache, missing);
        }
        ready = (!event.data.pageVersion || event.data.pageVersion === config.pageVersion) && await complete();
        // Clean old releases only when every remaining page has identified
        // itself as this release. Unknown/legacy tabs retain their lazy assets.
        if (ready && event.data.pageVersion === config.pageVersion) {
          const pages = await self.clients.matchAll({type:'window',includeUncontrolled:true});
          if (pages.every(page => clientPages.get(page.id) === config.pageVersion)) {
            const record=await (await caches.open(cacheName)).match(predecessorsUrl);
            const predecessors=record?await record.json():[];
            if(Array.isArray(predecessors))for(const name of predecessors)
              if(typeof name==='string'&&name.startsWith(prefix)&&name!==cacheName)await caches.delete(name);
          }
        }
      } catch { /* Storage unavailable: keep online use and existing data intact. */ }
      event.ports[0].postMessage({type: 'FABAO_OFFLINE_STATUS', ready, version: config.version, pageVersion:config.pageVersion});
    })());
  });
  async function loadNavigation(request) {
    const cache = await caches.open(cacheName), cached = await cache.match(indexUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.navigationTimeoutMs || 4000);
    try {
      // A tiny revalidated manifest decides whether the cached document is
      // current. Cache-Control on HTTP alone cannot update Cache Storage.
      const response = await fetch(new Request(new URL('manifest.json',base), {
        cache:'no-store',credentials:'same-origin',signal:controller.signal
      }));
      if (!response.ok) throw Error('Version check unavailable');
      const manifest = await response.json(), release = manifest.offline?.pageVersion || manifest.offline?.version;
      const document = manifest.files?.find(row=>row.name==='index.html');
      if (!/^[a-f0-9]{20}$/.test(release||'') || !/^[a-f0-9]{64}$/.test(document?.sha256||'')) throw Error('Invalid release manifest');
      if (release === config.pageVersion && cached) return cached;
      const digest = btoa(String.fromCharCode(...document.sha256.match(/../g).map(byte=>parseInt(byte,16))));
      const latest = await fetch(new Request(base, {
        cache:'no-store',credentials:'same-origin',signal:controller.signal,integrity:'sha256-'+digest
      }));
      if (!latest.ok || latest.redirected) throw Error('New page unavailable');
      // Never overwrite the old complete release with only a newer HTML file.
      // The page can render now; the new worker caches its whole release later.
      return latest;
    } catch (error) {
      if (cached) return cached;
      throw error;
    } finally { clearTimeout(timer); }
  }
  self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url), scope = new URL(base);
    if (url.origin !== scope.origin) return;
    const navigation = event.request.mode === 'navigate' &&
      (url.pathname === scope.pathname || url.pathname === new URL(indexUrl).pathname);
    // Cache only release assets: no APIs, uploads or unrelated pages.
    if (navigation) { event.respondWith(loadNavigation(event.request)); return; }
    const key = url.origin + url.pathname;
    const immutable = url.pathname.startsWith(scope.pathname+'assets/') && /\.[a-f0-9]{12}\.(?:js|css)$/.test(url.pathname);
    if (!allowed.has(key) && !immutable) return;
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      const current = await cache.match(key);
      if (current) return current;
      if (immutable) for (const name of await caches.keys()) {
        if (!name.startsWith(prefix) || name===cacheName) continue;
        const previous = await (await caches.open(name)).match(key);
        if (previous) return previous;
      }
      return fetch(event.request);
    })());
  });
}

function updatePage() {
  // One-time migration for browsers still controlled by the earlier cache-first
  // worker. That worker does not intercept /update.html. No site data is erased.
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>更新 · 老祖法宝模拟器</title><style>body{font:16px system-ui;line-height:1.7;max-width:32em;margin:15vh auto;padding:24px;color:#604833;background:#fff7e8}button,a{font:inherit}button{padding:8px 18px}</style>'+
    '<h1>正在检查更新</h1><p id="state" role="status">更新完成后会自动进入工具，背包和收藏会保留。</p><button id="retry" hidden>重试</button> <a href="./">返回工具</a><script>('+function () {
      const base=new URL('./',location.href),text=document.getElementById('state'),retry=document.getElementById('retry');
      async function status(worker,pageVersion){
        if(!worker)return null;
        return new Promise(resolve=>{
          const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(null);},1000);
          channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};
          worker.postMessage({type:'FABAO_OFFLINE_STATUS',pageVersion},[channel.port2]);
        });
      }
      async function run(){
        retry.hidden=true;text.textContent='正在准备最新版，完成后自动进入工具…';
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
        try{
          const response=await fetch(new URL('manifest.json',base),{cache:'no-store',signal:controller.signal});
          if(!response.ok)throw Error();
          const manifest=await response.json(),target=manifest.offline;
          if(!target?.version||!target.pageVersion)throw Error();
          const registration=await navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.href,updateViaCache:'none'});
          await registration.update();
          while(!controller.signal.aborted){
            const current=await status(navigator.serviceWorker.controller,target.pageVersion);
            if(current?.version===target.version&&current.ready){location.replace(base.href);return;}
            await new Promise(resolve=>setTimeout(resolve,200));
          }
          throw Error();
        }catch{text.textContent='更新暂未完成，请联网后重试；已有背包、收藏和离线缓存均保留。';retry.hidden=false;}
        finally{clearTimeout(timer);}
      }
      retry.onclick=run;run();
    }.toString()+')();</script></html>';
}

function addOfflineSupport(files) {
  const client = fs.readFileSync(path.join(__dirname, 'offline-client.js'));
  const clientName = 'assets/offline-client.' + hash(client).slice(0, 12) + '.js';
  files[clientName] = client;
  files['app.webmanifest'] = Buffer.from(JSON.stringify({
    id: './', name: '老祖法宝模拟器', short_name: '法宝摆盘', lang: 'zh-CN',
    start_url: './', scope: './', display: 'standalone', background_color: '#fff7e8',
    theme_color: '#604833', icons: [
      {src: './assets/offline-icon-192.png', sizes: '192x192', type: 'image/png'},
      {src: './assets/offline-icon-512.png', sizes: '512x512', type: 'image/png'}
    ]
  }, null, 2) + '\n');
  for (const size of [192, 512]) files['assets/offline-icon-' + size + '.png'] =
    fs.readFileSync(path.join(__dirname, 'assets/offline-icon-' + size + '.png'));
  let html = files['index.html'].toString();
  html = html.replace('</head>', '<link rel="manifest" href="./app.webmanifest">\n' +
    '<link rel="apple-touch-icon" href="./assets/offline-icon-192.png">\n' +
    '<meta name="theme-color" content="#604833">\n' +
    '<script defer src="./' + clientName + '"></script>\n' +
    '<style>#offline-status{display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;width:14px;height:14px;margin:0 0 0 4px;padding:0;border:0;border-radius:50%;background:transparent;box-shadow:none;cursor:help}' +
    '#offline-status::before{content:"";display:block;width:7px;height:7px;border-radius:50%;background:#a3a6a8}' +
    '#offline-status[data-ready="true"]::before{background:#4d965b}#offline-status[data-retry="true"]{cursor:pointer}' +
    '#offline-status:focus-visible{outline:2px solid #a08036;outline-offset:2px}' +
    '#offline-status-text{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}</style>\n</head>');
  html = html.replace('<details><summary>来源与版本</summary>',
    '<button type="button" id="offline-status" data-ready="false" aria-live="polite" aria-label="离线资源尚未就绪" title="离线资源尚未就绪">' +
    '<span id="offline-status-text">离线资源尚未就绪</span></button><details><summary>来源与版本</summary>');
  // A page marker is distinct from the worker version so worker-only fixes
  // can activate without invalidating otherwise identical application HTML.
  const pageVersion = hash(html + JSON.stringify(Object.entries(files).filter(([name])=>name!=='index.html').map(([name,value])=>[name,hash(value)]))).slice(0,20);
  html = html.replace('</head>','<meta name="fabao-page-release" content="'+pageVersion+'">\n</head>');
  files['index.html'] = Buffer.from(html);
  const names = ['index.html', ...Object.keys(files).filter(name => name.startsWith('assets/')), 'app.webmanifest'];
  const resources = names.map(name => ({name, integrity: 'sha256-' + crypto.createHash('sha256').update(files[name]).digest('base64')}));
  // Worker-only fixes also need a new bucket; failed installs must never
  // discard the active bucket just because asset bytes stayed unchanged.
  const version = hash(JSON.stringify(resources) + '\n' + offlineWorker.toString()).slice(0, 20);
  files['sw.js'] = Buffer.from('/* fabao offline release ' + version + ' */\n(' + offlineWorker.toString() + ')(' + JSON.stringify({version,pageVersion,resources,navigationTimeoutMs:4000}) + ');\n');
  files['update.html']=Buffer.from(updatePage());
  files['_headers'] = Buffer.from('/sw.js\n  Cache-Control: no-cache\n  X-Content-Type-Options: nosniff\n/app.webmanifest\n  Cache-Control: no-cache\n/manifest.json\n  Cache-Control: no-cache\n/update\n  Cache-Control: no-cache\n/update.html\n  Cache-Control: no-cache\n');
  return {version,pageVersion,serviceWorker:'./sw.js',manifest:'./app.webmanifest',resources:names.length,
    strategy:'manifest-validated navigation; immutable asset cache; offline fallback; nonblocking release activation'};
}
module.exports = {addOfflineSupport, offlineWorker};

/* fabao offline release d722a9dc6711b7acd589 */
(function offlineWorker(config) {
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
})({"version":"d722a9dc6711b7acd589","pageVersion":"be6aefb901d1dd1f0e37","resources":[{"name":"index.html","integrity":"sha256-hlrhuNS4A8nHtX8CTHguYczdaslpKUjPu4CVYDEbgJQ="},{"name":"assets/app.40ecec47916c.js","integrity":"sha256-QOzsR5Fs9xz9Sj4nJ6ZTjTrLKNDb/DLcoy5Xglhyfuk="},{"name":"assets/app.88f342cd19b7.css","integrity":"sha256-iPNCzRm3UF7KUZ7rQ1FoairBMl9/Dskvdbr5tp5KMA8="},{"name":"assets/recognition-worker.8e710434434e.js","integrity":"sha256-jnEENENO/WptkSE8DEXR2z8FDOSLA73XMElBgMPBXk4="},{"name":"assets/talent-worker.e86d004e5555.js","integrity":"sha256-6G0ATlVVgqD8buwh0s6btoKdWm+6q89c3msaK9lj2Ow="},{"name":"assets/offline-client.acaa86f23880.js","integrity":"sha256-rKqG8jiAcUC0TnJ4XPmEDlduM1RNRIKZHGzpDOk1rgc="},{"name":"assets/offline-icon-192.png","integrity":"sha256-K99Y6PE2pUm/5fj4Q1hYHVRYz+OXGMOZj/xu7GEY0f0="},{"name":"assets/offline-icon-512.png","integrity":"sha256-Dous3FuTbG3+bb7LVH+zcKAUEIXftmjvT0Rtx59DmZY="},{"name":"app.webmanifest","integrity":"sha256-YKziquBnRkFFendyOtNN8CSV+YozUoTEi4GeS+1JnnA="}],"navigationTimeoutMs":4000});

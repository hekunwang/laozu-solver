'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web'),{offlineWorker}=require('../offline-support.cjs');
const sw=fs.readFileSync(path.join(web,'sw.js'),'utf8'),config=JSON.parse(sw.slice(sw.lastIndexOf(')(')+2,sw.lastIndexOf(');')));
const files=new Map(config.resources.map(row=>[row.name,fs.readFileSync(path.join(web,row.name))]));
const manifest=JSON.parse(fs.readFileSync(path.join(web,'manifest.json'))),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
let checks=0;function check(fn){fn();checks++;}
function storage(){const buckets=new Map();return {buckets,has:async n=>buckets.has(n),keys:async()=>[...buckets.keys()],delete:async n=>buckets.delete(n),open:async n=>{if(!buckets.has(n))buckets.set(n,new Map());const b=buckets.get(n);return {match:async k=>b.get(k)?.clone(),put:async(k,r)=>b.set(k,r.clone())};}};}
function boot({scope='https://example.test/tool/',version=config.version,store=storage(),fail,corrupt,timeout=30}={}){
 const handlers=new Map(),requests=[];let offline=false,claims=0,skips=0,remote={manifest,files},clients=[{id:'legacy'}],hangVersion=false;
 const ctx={URL,Request,Response,Set,Map,Promise,Error,AbortController,setTimeout,clearTimeout,btoa,caches:store,
 self:{registration:{scope},addEventListener:(t,f)=>handlers.set(t,f),skipWaiting:async()=>skips++,clients:{claim:async()=>claims++,matchAll:async()=>clients}},
 fetch:async request=>{requests.push(request);if(offline)throw Error('Network disabled');const relative=new URL(request.url).pathname.slice(new URL(scope).pathname.length);
   if(relative==='manifest.json'){
     if(hangVersion)return new Promise((_,reject)=>{if(request.signal.aborted)reject(Error('timeout'));else request.signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true});});
     if(fail==='manifest.json')return new Response('',{status:503});
     return new Response(JSON.stringify(remote.manifest));
   }
   if(relative==='index.html')return new Response(null,{status:307,headers:{Location:scope}});
   const name=relative||'index.html';if(fail===name)return new Response('unavailable',{status:503});
   const body=corrupt===name?Buffer.from('wrong release'):remote.files.get(name);assert(body,'Unexpected request '+request.url);
   assert.equal(request.integrity,'sha256-'+crypto.createHash('sha256').update(body).digest('base64'),'release integrity must be enforced');return new Response(body);
 }};
 vm.runInNewContext('('+offlineWorker.toString()+')('+JSON.stringify({...config,version,navigationTimeoutMs:timeout})+')',ctx);
 async function event(type,extra={}){let waiting,response;handlers.get(type)({...extra,waitUntil:v=>waiting=v,respondWith:v=>response=v});await waiting;return response?await response:undefined;}
 async function status({repair=false,pageVersion,clientId='current'}={}){let reply;await event('message',{source:{id:clientId},data:{type:repair?'FABAO_OFFLINE_REPAIR':'FABAO_OFFLINE_STATUS',pageVersion},ports:[{postMessage:v=>reply=v}]});return reply;}
 const navigation=suffix=>event('fetch',{request:{url:scope+(suffix||''),method:'GET',mode:'navigate'}});
 return {event,status,navigation,requests,store,scope,key:'fabao-offline:'+encodeURIComponent(scope)+':'+version,
 setOffline:v=>offline=v,setRemote:v=>remote=v,setClients:v=>clients=v,setHangVersion:v=>hangVersion=v,claims:()=>claims,skips:()=>skips};
}
(async()=>{
 for(const row of config.resources)check(()=>assert.equal(row.integrity,'sha256-'+crypto.createHash('sha256').update(files.get(row.name)).digest('base64')));
 check(()=>assert(config.resources.some(x=>x.name===manifest.talentOcr.worker.slice(2))));
 check(()=>assert(config.resources.some(x=>x.name===manifest.recognitionWorker.slice(2))));
 const a=boot();await a.event('install');check(()=>assert.equal(a.skips(),1,'new release activates even with an old page running'));
 check(()=>assert.equal(a.claims(),0));check(()=>assert.equal(a.requests[0].url,a.scope,'canonical homepage avoids Cloudflare redirect'));
 check(()=>assert.equal(a.requests.length,config.resources.length));await a.event('activate');check(()=>assert.equal(a.claims(),1));
 assert.equal((await a.status({pageVersion:config.pageVersion})).ready,true);checks++;
 assert.equal((await a.status({pageVersion:'f'.repeat(20)})).ready,false,'do not mark a newer page offline-ready under an older worker');checks++;
 const before=a.requests.length;let response=await a.navigation();assert.equal(await response.text(),files.get('index.html').toString());checks++;
 check(()=>assert.equal(a.requests.length-before,1,'unchanged release makes just one small version request'));
 check(()=>assert(a.requests.at(-1).url.endsWith('/manifest.json')&&a.requests.at(-1).cache==='no-store'));
 const ownBefore=await(await a.store.open(a.key)).match(new URL('index.html',a.scope).href);
 const newPage=Buffer.from('<!doctype html><title>Newest version</title>'),newFiles=new Map(files);newFiles.set('index.html',newPage);
 const newManifest={...manifest,offline:{...manifest.offline,pageVersion:'b'.repeat(20),version:'c'.repeat(20)},files:manifest.files.map(x=>x.name==='index.html'?{...x,sha256:sha(newPage)}:x)};
 a.setRemote({manifest:newManifest,files:newFiles});const changedBefore=a.requests.length;response=await a.navigation('?refresh=1');assert.equal(await response.text(),newPage.toString());checks++;
 check(()=>assert.equal(a.requests.length-changedBefore,2,'changed version fetches the new document during this navigation'));
 assert.equal(await(await(await a.store.open(a.key)).match(new URL('index.html',a.scope).href)).text(),await ownBefore.text(),'new HTML does not overwrite an old complete release');checks++;
 a.setRemote({manifest,files});a.setHangVersion(true);response=await a.navigation();assert.equal(await response.text(),files.get('index.html').toString(),'version-check timeout falls back to cached working document');checks++;a.setHangVersion(false);
 a.setOffline(true);for(const suffix of ['','?from=homescreen','index.html?x=1']){response=await a.navigation(suffix);assert.equal(await response.text(),files.get('index.html').toString());checks++;}
 const assetsBefore=a.requests.length;for(const row of config.resources){response=await a.event('fetch',{request:{url:new URL(row.name,a.scope).href,method:'GET',mode:'same-origin'}});assert(Buffer.from(await response.arrayBuffer()).equals(files.get(row.name)));checks++;}
 check(()=>assert.equal(a.requests.length,assetsBefore,'fingerprinted assets retain zero-network reads'));
 for(const request of [{url:a.scope+'api/talent-ocr',method:'GET'},{url:a.scope+'update.html',method:'GET',mode:'navigate'},{url:a.scope,method:'POST'},{url:'https://other.test/',method:'GET',mode:'navigate'}]){assert.equal(await a.event('fetch',{request}),undefined);checks++;}
 const bad=boot({version:'failed-new-release',store:a.store,fail:manifest.talentOcr.worker.slice(2)});await assert.rejects(bad.event('install'),/incomplete/);checks++;
 check(()=>assert(!a.store.buckets.has(bad.key)&&a.store.buckets.has(a.key)));check(()=>assert.equal(bad.skips(),0,'incomplete release never takes over'));
 const mixed=boot({version:'mixed-deployment',store:a.store,corrupt:'index.html'});await assert.rejects(mixed.event('install'),/incomplete/);checks++;
 check(()=>assert(!a.store.buckets.has(mixed.key)));
 const missingUrl=new URL(manifest.talentOcr.worker.slice(2),a.scope).href;a.store.buckets.get(a.key).delete(missingUrl);
 assert.equal((await a.status({pageVersion:config.pageVersion})).ready,false);checks++;
 assert.equal((await a.status({repair:true,pageVersion:config.pageVersion})).ready,false);checks++;a.setOffline(false);
 const repairBefore=a.requests.length;assert.equal((await a.status({repair:true,pageVersion:config.pageVersion})).ready,true);checks++;
 check(()=>assert.equal(a.requests.length-repairBefore,1,'repair downloads only the missing file'));
 const newer=boot({version:'new-worker-version',store:a.store});await newer.event('install');await newer.event('activate');
 check(()=>assert(a.store.buckets.has(a.key)&&a.store.buckets.has(newer.key),'old tabs retain their old complete cache after immediate activation'));
 const oldAsset=new URL('assets/app.aaaaaaaaaaaa.js',a.scope).href;a.store.buckets.get(a.key).set(oldAsset,new Response('old page lazy code'));
 newer.setOffline(true);response=await newer.event('fetch',{request:{url:oldAsset,method:'GET'}});assert.equal(await response.text(),'old page lazy code');checks++;
 const nested=boot({scope:'https://example.test/tool/:another/',store:a.store});await nested.event('install');await nested.event('activate');
 newer.setClients([{id:'current'},{id:'legacy'}]);await newer.status({pageVersion:config.pageVersion});
 check(()=>assert(a.store.buckets.has(a.key),'unknown/legacy tab prevents unsafe old-cache deletion'));
 const futureKey='fabao-offline:'+encodeURIComponent(a.scope)+':future-install';await a.store.open(futureKey);
 newer.setClients([{id:'current'}]);await newer.status({pageVersion:config.pageVersion});
 check(()=>assert(!a.store.buckets.has(a.key)&&a.store.buckets.has(newer.key)&&a.store.buckets.has(nested.key),'cleanup waits for current pages and preserves other scopes'));
 check(()=>assert(a.store.buckets.has(futureKey),'cleanup by an older active worker cannot delete a later staging cache'));
 console.log(JSON.stringify({suite:'offline-cache',passed:checks,manifestValidatedNavigation:true,changedVersionLoadsOnRefresh:true,offlineAndTimeoutFallback:true,legacyTabsDoNotBlockActivation:true,oldPageAssetsPreserved:true,integrityChecked:true,scopeIsolation:true},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});

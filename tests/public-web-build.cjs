'use strict';
// Only small synthetic package fixtures are written below the system temp dir.
// No recognition asset is downloaded, and no source app/index/web artifact is rebuilt here.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http'),zlib=require('node:zlib'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const {createPublicWebArtifacts,readPublicWebInputs,writePublicWeb,extractReviewCss,prepareTalentLitePackage,validateTalentGlyphs,TALENT_LITE_REQUIRED}=require('../web-build.cjs');
const {createStaticServer,resolvePort,acceptsGzip}=require('../serve-web.cjs');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const workerUrl='./assets/recognition-worker.0123456789ab.js';
const app='const SCREENSHOT_RECOGNITION_WORKER_URL='+JSON.stringify(workerUrl)+';\n'+"window.loadTalentOcr=()=>import(new URL('./assets/browser-talent-ocr.js',document.baseURI).href);\n"+'/* fixture application */\n'.repeat(100);
const glyphs={version:1,engine:'talent-lite',size:4,bits:2,chars:'甲乙',data:Buffer.alloc(8).toString('base64'),words:[{name:'甲乙',kind:'innate',id:1,quality:1},{name:'乙',kind:'exclude',id:-1,quality:0}]};
const input={upstreamHtml:'<!doctype html><html><head><title>Old</title><style>.base{color:black}</style><script type="module" crossorigin>oldApp()</script></head><body><div id="app"></div></body></html>',
 app,resourceManifest:{channel:'formal',resourceVersion:'fixture',builtForDate:'2026-11-06'},releaseTitle:'测试版',extraCss:['.talent-picker{display:block}'],
 reviewCss:extractReviewCss(fs.readFileSync(path.join(__dirname,'../talent-ocr-ui.js'),'utf8')),workerUrl,workerSource:'self.postMessage({type:"ready"});',
 browserOcrSource:fs.readFileSync(path.join(__dirname,'../browser-talent-ocr.js'),'utf8'),
 talentLiteWorkerSource:fs.readFileSync(path.join(__dirname,'../talent-lite-worker.js'),'utf8'),
 talentLiteSegmentationSource:'self.LaozuTalentLiteSegmentation={segment:()=>({fixture:true})};',
 talentLiteCoreSource:'self.LaozuTalentLiteCore={compile:g=>g.words.length,recognize:(i,s,count)=>({engine:"talent-lite",matches:[],unresolved:[],safeToReplace:{innate:false,acquired:false},completeKinds:{innate:false,acquired:false},count})};',talentGlyphsSource:JSON.stringify(glyphs)};
const artifacts=createPublicWebArtifacts(input),html=artifacts.files['index.html'].toString(),manifest=artifacts.manifest;
const outputApp=artifacts.files[manifest.app.slice(2)].toString(),bundleVersion=manifest.talentOcr.bundleVersion;
let checks=0;const check=fn=>{fn();checks++;};
check(()=>assert.match(manifest.app,/^\.\/assets\/app\.[a-f0-9]{12}\.js$/));
check(()=>assert.match(html,/<script type="module" src="\.\/assets\/app\.[a-f0-9]{12}\.js"><\/script>/));
check(()=>assert(!html.includes('oldApp()')&&!html.includes(app),'application is external'));
check(()=>assert(!html.includes(workerUrl)&&!html.includes('browser-talent-ocr.js')&&!html.includes('talent-glyphs.json'),'Workers/OCR module and glyph data are not preloaded'));
check(()=>assert(artifacts.debugFiles['index.html'].toString().includes('src="./app.js"'),'debug output keeps plain app.js'));
check(()=>assert(artifacts.files[manifest.stylesheet.slice(2)].toString().includes('.talent-picker')&&artifacts.files[manifest.stylesheet.slice(2)].toString().includes('.talent-ocr-row')&&artifacts.files[manifest.stylesheet.slice(2)].toString().includes('.config-export-dialog')));
check(()=>assert.match(bundleVersion,/^[a-f0-9]{20}$/));
const talentName='assets/talent-worker.'+bundleVersion.slice(0,12)+'.js',packed=artifacts.files[talentName].toString(),talentUrl='./'+talentName;
check(()=>assert.deepEqual(manifest.talentOcr,{engine:'talent-lite',ready:true,status:'ready',scope:'fixed-vocabulary',delivery:'bundled-worker-v1',bundleVersion,worker:talentUrl,glyphSchemaVersion:1,glyphCount:2,wordCount:2,glyphSize:4,glyphBits:2}));
check(()=>assert(outputApp.includes(JSON.stringify(talentUrl))&&!outputApp.includes('browser-talent-ocr.js'),'adapter constructs the single content-fingerprinted Worker'));
check(()=>assert.equal(artifacts.debugFiles['app.js'].toString(),outputApp,'debug and public apps use the same OCR version'));
check(()=>assert.equal(createPublicWebArtifacts({...input,app:outputApp}).manifest.app,manifest.app,'building an already-versioned debug app is stable'));
for(const field of ['browserOcrSource','talentLiteWorkerSource','talentLiteSegmentationSource','talentLiteCoreSource','talentGlyphsSource'])check(()=>{
 const source=field==='talentGlyphsSource'?JSON.stringify({...glyphs,words:glyphs.words.slice(0,1)}):'/* Changed runtime */\n'+input[field];
 const changed=createPublicWebArtifacts({...input,[field]:source}).manifest;
 if(field==='browserOcrSource')assert.equal(changed.talentOcr.worker,talentUrl,'adapter-only edit keeps the same valid cached Worker');
 else assert.notEqual(changed.talentOcr.worker,talentUrl,field+' changes the emitted Worker URL');
 assert.notEqual(changed.app,manifest.app,'changed OCR content also invalidates the app URL');
});
check(()=>assert(!Object.hasOwn(manifest.talentOcr,'manifest')&&!Object.hasOwn(manifest.talentOcr,'model')));
check(()=>assert(!Object.keys(artifacts.files).some(name=>/\.cjs$|\.swift$|\.command$|^data\/|^\.local-bin\//.test(name))));
check(()=>assert(!Object.keys(artifacts.files).some(name=>/ocr\/|tesseract|traineddata|\.wasm|\.(?:ttf|otf)$/.test(name)),'no general OCR package or original font is published'));
check(()=>{for(const name of TALENT_LITE_REQUIRED)assert(!artifacts.files[name],'No separately fetched OCR file: '+name);
 const record=manifest.files.find(row=>row.name===talentName);assert.equal(record.sha256,sha(packed));assert.equal(record.sha256.slice(0,20),bundleVersion);
 assert.equal(record.bytes,Buffer.byteLength(packed));assert.equal(artifacts.debugFiles[talentName].toString(),packed);});
check(()=>assert(packed.includes(input.talentGlyphsSource)&&!(/\b(?:fetch|importScripts)\s*\(/.test(packed)),'Worker includes all glyphs and both algorithms'));
check(()=>{for(const source of [html,outputApp,input.workerSource])assert(!source.includes(glyphs.data)&&!source.includes(glyphs.chars),'glyphs only load in the Worker');});
check(()=>assert.notEqual(createPublicWebArtifacts({...input,app:app+'\n'}).manifest.app,manifest.app,'content determines app URL'));
check(()=>assert.throws(()=>createPublicWebArtifacts({...input,app:app+'fetch("/api/talent-ocr")'}),/local-service/));
check(()=>assert.throws(()=>createPublicWebArtifacts({...input,workerUrl:'../secret.js'}),/does not match/));
check(()=>assert.throws(()=>createPublicWebArtifacts({...input,app:app.replace('browser-talent-ocr.js','missing.js')}),/module URL missing/));
// Validate a tiny fixed-vocabulary fixture, with no downloaded assets.
check(()=>assert.equal(prepareTalentLitePackage(input).manifest.engine,'talent-lite'));
for(const field of ['browserOcrSource','talentLiteWorkerSource','talentLiteSegmentationSource','talentLiteCoreSource','talentGlyphsSource'])check(()=>assert.throws(()=>createPublicWebArtifacts({...input,[field]:''}),/Missing talent-lite publish input/));
check(()=>assert.throws(()=>createPublicWebArtifacts({...input,talentGlyphsSource:'{broken'}),/glyph JSON/));
for(const malformed of [null,[],{...glyphs,version:2},{...glyphs,engine:'other'},{...glyphs,bits:1},{...glyphs,size:3},{...glyphs,size:0},{...glyphs,chars:'甲甲'},{...glyphs,data:glyphs.data+'!'}, {...glyphs,data:Buffer.alloc(7).toString('base64')},{...glyphs,words:[]},{...glyphs,words:[{name:'丙',kind:'innate',id:1,quality:1}]},{...glyphs,words:[{name:'甲',kind:'other',id:1,quality:1}]},{...glyphs,words:[{name:'甲',kind:'innate',id:'1',quality:1}]}])check(()=>assert.throws(()=>validateTalentGlyphs(JSON.stringify(malformed)),/talent-lite/));
check(()=>assert.equal(validateTalentGlyphs(JSON.stringify({...glyphs,chars:'甲𠀀',words:[{name:'甲𠀀',kind:'acquired',id:2,quality:2}]})).glyphCount,2,'glyph count uses Unicode code points'));
check(()=>assert.equal(resolvePort(),process.env.LAOZU_PORT?Number(process.env.LAOZU_PORT):18768));
check(()=>assert(acceptsGzip('br, gzip;q=0.8')&&!acceptsGzip('gzip;q=0, *;q=1')));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'laozu-static-web-test-'));
let server;
function request(port,url,options={}){return new Promise((resolve,reject)=>{
 const req=http.request({hostname:'127.0.0.1',port,path:url,method:options.method||'GET',headers:options.headers||{}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);req.end();
});}
(async()=>{
 const {talentResourceUrl}=await import('../browser-talent-ocr.js');
 const pageBase='https://example.test/demo/index.html';
 check(()=>assert.equal(talentResourceUrl('./talent-lite-worker.js','https://example.test/demo/assets/browser-talent-ocr.js').href,'https://example.test/demo/assets/talent-lite-worker.js','unpackaged developer source remains usable'));
 const requests=[];
 const denied=()=>{throw Error('Unexpected additional OCR network request');};
 class FixtureWorker{
  constructor(url){
   requests.push(String(url));
   this.context={performance,Uint8ClampedArray,fetch:denied,importScripts:denied,postMessage:data=>this.onmessage?.({data})};
   this.context.self=this.context;vm.runInNewContext(packed,this.context);
  }
  postMessage(data){this.context.onmessage({data});}
  terminate(){}
 }
 const page={window:{},document:{baseURI:pageBase,createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(4)})})})},
  Worker:FixtureWorker,URL,performance,setTimeout,clearTimeout,fetch:denied,createImageBitmap:async()=>({width:1,height:1,close(){}})};
 vm.runInNewContext(outputApp,page);
 check(()=>assert.equal(requests.length,0,'landing does not download the talent Worker'));
 const client=await page.window.loadTalentOcr();
 check(()=>assert.equal(requests.length,0,'initializing the small client does not load glyphs'));
 const result=await client.recognizeText({type:'image/png',size:1});
 check(()=>assert.deepEqual(requests,[new URL(talentUrl,pageBase).href],'one relative Worker request under a subpath and no dependent requests'));
 check(()=>assert.equal(result.count,glyphs.words.length,'Worker executed the bundled glyphs and matcher'));
 const sourceRoot=path.join(temporary,'fixture-source');
 const fixtureFiles={'app.js':input.app,'upstream.html':input.upstreamHtml,'data/manifest.json':JSON.stringify(input.resourceManifest),'data/release-notes.json':JSON.stringify({title:input.releaseTitle}),
  'mobile-ui.css':'.mobile{}','state-ui-safety.css':'.safety{}','talent-picker.css':'.picker{}',
  'talent-ocr-ui.js':"const style=el('style',{text:`.talent-ocr-row{display:flex}`});",[workerUrl.slice(2)]:input.workerSource,
  'browser-talent-ocr.js':input.browserOcrSource,'talent-lite-worker.js':input.talentLiteWorkerSource,'talent-lite-segmentation.js':input.talentLiteSegmentationSource,'talent-lite-core.js':input.talentLiteCoreSource,'data/talent-glyphs.json':input.talentGlyphsSource,
  'assets/ocr/manifest.json':'{"ready":true}', 'assets/ocr/chi_sim.traineddata.gz':'obsolete test fixture'};
 for(const [name,value] of Object.entries(fixtureFiles)){const file=path.join(sourceRoot,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);}
 const readInputs=readPublicWebInputs(sourceRoot);
 check(()=>{for(const key of ['browserOcrSource','talentLiteWorkerSource','talentLiteSegmentationSource','talentLiteCoreSource','talentGlyphsSource'])assert.equal(readInputs[key],input[key]);});
 check(()=>assert(!Object.hasOwn(readInputs,'ocrFiles'),'old general OCR assets are not even read'));
 check(()=>assert.equal(createPublicWebArtifacts(readInputs).manifest.talentOcr.engine,'talent-lite'));
 for(const name of ['browser-talent-ocr.js','talent-lite-worker.js','talent-lite-segmentation.js','talent-lite-core.js','data/talent-glyphs.json']){
  const file=path.join(sourceRoot,name),held=file+'.held';fs.renameSync(file,held);
  try{check(()=>assert.throws(()=>readPublicWebInputs(sourceRoot),/ENOENT/));}finally{fs.renameSync(held,file);}
 }
 const first=writePublicWeb(temporary,artifacts);
 fs.writeFileSync(path.join(first.directory,'native.swift'),'private fixture');
 const second=writePublicWeb(temporary,artifacts);
 check(()=>assert(second.previous&&fs.existsSync(path.join(second.previous,'native.swift'))&&!fs.existsSync(path.join(second.directory,'native.swift')),'old publish output is preserved outside the clean web directory'));
 fs.writeFileSync(path.join(temporary,'private.txt'),'private fixture');fs.symlinkSync(path.join(temporary,'private.txt'),path.join(second.directory,'assets/private.txt'));
 fs.writeFileSync(path.join(second.directory,'serve.cjs'),'private fixture');
 fs.writeFileSync(path.join(second.directory,'assets/fixture.gz'),zlib.gzipSync('test fixture'));
 server=createStaticServer({root:second.directory,base:'/demo/'});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 let res=await request(port,'/demo/');check(()=>assert.equal(res.status,200));check(()=>assert.equal(res.headers['cache-control'],'no-cache'));check(()=>assert(res.body.toString().includes(manifest.app)));
 res=await request(port,'/demo');check(()=>assert.equal(res.status,308));check(()=>assert.equal(res.headers.location,'/demo/'));
 const asset='/demo/'+manifest.app.slice(2),get=await request(port,asset,{headers:{'Accept-Encoding':'gzip'}});
 check(()=>assert.equal(get.headers['content-encoding'],'gzip'));check(()=>assert.equal(zlib.gunzipSync(get.body).toString(),outputApp));check(()=>assert.match(get.headers['cache-control'],/immutable/));
 const head=await request(port,asset,{method:'HEAD',headers:{'Accept-Encoding':'gzip'}});check(()=>assert.equal(head.body.length,0));check(()=>assert.equal(head.headers['content-length'],get.headers['content-length']));check(()=>assert.equal(head.headers.etag,get.headers.etag));
 res=await request(port,asset,{headers:{'Accept-Encoding':'gzip','If-None-Match':get.headers.etag}});check(()=>assert.equal(res.status,304));check(()=>assert.equal(res.body.length,0));
 res=await request(port,asset,{headers:{'Accept-Encoding':'gzip;q=0'}});check(()=>assert.equal(res.headers['content-encoding'],undefined));check(()=>assert.equal(res.body.toString(),outputApp));
 for(const url of ['/demo/api/talent-ocr','/demo/api/screenshot-recognition','/demo/serve.cjs','/demo/assets/private.txt','/demo/..%2Fprivate.txt','/assets/'+path.basename(manifest.app),'/demo/assets/ocr/manifest.json','/demo/assets/ocr/chi_sim.traineddata.gz']){res=await request(port,url);check(()=>assert.equal(res.status,404,url));}
 res=await request(port,'/demo/api/talent-ocr',{method:'POST'});check(()=>assert.equal(res.status,404));
 res=await request(port,'/demo/',{method:'POST'});check(()=>assert.equal(res.status,405));
 const workerLocation=new URL(talentUrl,'http://localhost/demo/index.html');
 res=await request(port,workerLocation.pathname,{headers:{'Accept-Encoding':'gzip'}});
 check(()=>assert.equal(res.status,200));check(()=>assert.equal(res.headers['content-encoding'],'gzip'));check(()=>assert.match(res.headers['content-type'],/javascript/));
 check(()=>assert.equal(zlib.gunzipSync(res.body).toString(),packed));check(()=>assert.match(res.headers['cache-control'],/immutable/));
 res=await request(port,'/demo/assets/fixture.gz',{headers:{'Accept-Encoding':'gzip'}});check(()=>assert.equal(res.headers['content-encoding'],undefined,'do not double-decode precompressed static files'));
 console.log(JSON.stringify({suite:'public-web-build',passed:checks,engine:'talent-lite',staticOnly:true,subdirectory:'/demo/',syntheticGlyphFixture:true,downloads:false,actualSourceBuild:false},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 if(server)await new Promise(resolve=>server.close(resolve));
 execFileSync('/usr/bin/trash',[temporary]);
});

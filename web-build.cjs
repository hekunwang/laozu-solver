'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {packageGearWorker}=require('./gear-worker-package.cjs');
const {addOfflineSupport}=require('./offline-support.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const bytes=value=>Buffer.isBuffer(value)?value:Buffer.from(String(value),'utf8');
const TALENT_LITE_REQUIRED=['assets/browser-talent-ocr.js','assets/talent-lite-worker.js','assets/talent-lite-segmentation.js','assets/talent-lite-core.js','assets/talent-glyphs.json'];
const AWAKENING_CSS='.cell-awaken{position:absolute;bottom:2px;right:2px;min-width:11px;padding:1px 2px;border-radius:3px;background:#5b2c83;color:#fff;border:1px solid #ead4ff;font-size:10px;font-weight:700;line-height:1;text-align:center;pointer-events:none;text-shadow:none;z-index:2}.cell-awaken.aw1{background:#537533;border-color:#d8edb6}.cell-awaken.aw2{background:#267ba0;border-color:#b9ebff}.cell-awaken.aw4{background:#985309;border-color:#ffe0a6}.cell-awaken.aw5{background:#a63131;border-color:#ffd1cf}';
const CONFIG_EXPORT_CSS='.config-export-dialog{width:min(760px,calc(100% - 28px));max-height:85vh;overflow:auto}.config-export-dialog textarea{width:100%;box-sizing:border-box}.config-export-dialog button{margin:8px 8px 0 0}';
function relativeName(value){
  if(typeof value!=='string'||!value||value.startsWith('/')||value.includes('\\')||value.includes('\0')||value.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid public asset path: '+value);
  return value;
}
function extractReviewCss(source){
  const match=/const style=el\('style',\{text:`([\s\S]*?)`\}\);/.exec(source);
  if(!match||match[1].includes('${'))throw Error('Static talent review CSS was not found');
  return match[1];
}
function recognitionWorkerReference(app){
  const match=/const SCREENSHOT_RECOGNITION_WORKER_URL=("(?:\\.|[^"\\])*");/.exec(app);
  if(!match)throw Error('Static recognition Worker URL missing from app');
  const url=JSON.parse(match[1]);
  if(!url.startsWith('./assets/'))throw Error('Recognition Worker must use a relative assets URL');
  relativeName(url.slice(2));return url;
}
function validateTalentGlyphs(source){
  let glyphs;
  try{glyphs=JSON.parse(bytes(source).toString('utf8'));}catch{throw Error('Invalid talent-lite glyph JSON');}
  if(!glyphs||typeof glyphs!=='object'||Array.isArray(glyphs)||glyphs.version!==1||glyphs.engine!=='talent-lite'||glyphs.bits!==2)throw Error('Invalid talent-lite glyph schema');
  if(!Number.isSafeInteger(glyphs.size)||glyphs.size<=0||glyphs.size*glyphs.size%4!==0)throw Error('Invalid talent-lite glyph size');
  if(typeof glyphs.chars!=='string'||!glyphs.chars.length)throw Error('Missing talent-lite glyph characters');
  const chars=Array.from(glyphs.chars),knownChars=new Set(chars),expectedBytes=chars.length*glyphs.size*glyphs.size/4;
  if(knownChars.size!==chars.length)throw Error('Duplicate talent-lite glyph characters');
  if(!Number.isSafeInteger(expectedBytes)||typeof glyphs.data!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(glyphs.data))throw Error('Invalid talent-lite glyph base64');
  const packed=Buffer.from(glyphs.data,'base64');
  if(packed.length!==expectedBytes||packed.toString('base64')!==glyphs.data)throw Error('Invalid talent-lite glyph data length or encoding');
  if(!Array.isArray(glyphs.words)||!glyphs.words.length)throw Error('Missing talent-lite word list');
  for(const word of glyphs.words){
    if(!word||typeof word.name!=='string'||!word.name.trim()||!['innate','acquired','exclude'].includes(word.kind)||!Number.isSafeInteger(word.id)||!Number.isSafeInteger(word.quality))throw Error('Invalid talent-lite word record');
    if(Array.from(word.name).some(char=>!knownChars.has(char)))throw Error('Missing talent-lite glyph for word: '+word.name);
  }
  return {version:glyphs.version,glyphCount:chars.length,wordCount:glyphs.words.length,size:glyphs.size,bits:glyphs.bits};
}
function prepareTalentLitePackage({browserOcrSource,talentLiteWorkerSource,talentLiteSegmentationSource,talentLiteCoreSource,talentGlyphsSource}={}){
  const sources=[browserOcrSource,talentLiteWorkerSource,talentLiteSegmentationSource,talentLiteCoreSource,talentGlyphsSource];
  for(let index=0;index<TALENT_LITE_REQUIRED.length;index++){
    const name=TALENT_LITE_REQUIRED[index],source=sources[index];
    if(typeof source!=='string'||!source.trim())throw Error('Missing talent-lite publish input: '+name);
  }
  const glyphs=validateTalentGlyphs(talentGlyphsSource);
  function runtime(source,boundary){
    const index=source.indexOf(boundary);
    if(index<1||index!==source.lastIndexOf(boundary))throw Error('Missing or duplicate talent-lite build boundary: '+boundary);
    return source.slice(0,index).trim();
  }
  // Keep the independent developer entry points out of the published bytes.
  const handler=runtime(talentLiteWorkerSource,'// Unbundled Worker entry.');
  const adapter=runtime(browserOcrSource,'// Unbundled ES module entry.');
  const workerSource=[talentLiteSegmentationSource,talentLiteCoreSource,handler,
    'installTalentLiteWorker(self,LaozuTalentLiteSegmentation,LaozuTalentLiteCore,()=>('+talentGlyphsSource.trim()+'));'].join(';\n');
  const digest=hash(workerSource),name='assets/talent-worker.'+digest.slice(0,12)+'.js',worker='./'+name;
  const client='('+adapter+')(WorkerClass=>new WorkerClass(new URL('+JSON.stringify(worker)+",document.baseURI),{name:'laozu-talent-lite'}))";
  return {files:{[name]:bytes(workerSource)},client,manifest:{engine:'talent-lite',ready:true,status:'ready',scope:'fixed-vocabulary',
    delivery:'bundled-worker-v1',bundleVersion:digest.slice(0,20),worker,
    glyphSchemaVersion:glyphs.version,glyphCount:glyphs.glyphCount,wordCount:glyphs.wordCount,glyphSize:glyphs.size,glyphBits:glyphs.bits}};
}
function inlineTalentClient(app,client){
  const begin='/* fabao-talent-client:begin */',end='/* fabao-talent-client:end */';
  const loader=/import\(new URL\((['"])\.\/assets\/browser-talent-ocr\.js(?:\?v=[a-f0-9]{20})?\1,document\.baseURI\)\.href\)/g;
  if(app.includes(begin)){
    const start=app.indexOf(begin),finish=app.indexOf(end);
    if(start!==app.lastIndexOf(begin)||finish<=start||finish!==app.lastIndexOf(end))throw Error('Invalid inline talent client');
    return app.slice(0,start+begin.length)+client+app.slice(finish);
  }
  if([...app.matchAll(loader)].length!==1)throw Error('Lazy talent OCR module URL missing or duplicated in app');
  return app.replace(loader,()=> 'Promise.resolve('+begin+client+end+')');
}
function createPublicWebArtifacts({upstreamHtml,app,resourceManifest,releaseTitle,extraCss=[],reviewCss='',workerUrl,workerSource,browserOcrSource,talentLiteWorkerSource,talentLiteSegmentationSource,talentLiteCoreSource,talentGlyphsSource,notices={}}){
  if(!app||app.includes('SCREENSHOT_RECOGNITION_WORKER_BASE64')||app.includes('/api/screenshot-recognition')||app.includes('/api/talent-ocr'))throw Error('Public app still contains an inline Worker or a local-service dependency');
  if(recognitionWorkerReference(app)!==workerUrl)throw Error('Recognition Worker asset does not match app');
  if(typeof workerSource!=='string'||!workerSource.length)throw Error('Recognition Worker asset is missing');
  const talentLite=prepareTalentLitePackage({browserOcrSource,talentLiteWorkerSource,talentLiteSegmentationSource,talentLiteCoreSource,talentGlyphsSource});
  app=inlineTalentClient(app,talentLite.client);
  let html=upstreamHtml;
  const scripts=[...html.matchAll(/<script\b[^>]*type="module"[^>]*>[\s\S]*?<\/script>/g)];
  if(scripts.length!==1)throw Error('Expected exactly one upstream app module');
  const styles=[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(match=>match[1]);
  html=html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g,'');
  const css=[...styles,AWAKENING_CSS,...extraCss,reviewCss,CONFIG_EXPORT_CSS].join('\n');
  app=packageGearWorker(app,workerSource);
  const appName='assets/app.'+hash(app).slice(0,12)+'.js',cssName='assets/app.'+hash(css).slice(0,12)+'.css';
  const appTag=url=>'<script type="module" src="'+url+'"></script>';
  html=html.replace(scripts[0][0],appTag('./'+appName));
  if(!html.includes('</head>')||!html.includes('</body>'))throw Error('Upstream document boundaries missing');
  html=html.replace('</head>','<link rel="stylesheet" href="./'+cssName+'">\n</head>');
  const preview=resourceManifest.channel==='prerelease',title=preview?'先遣验证版':releaseTitle;
  if(typeof title!=='string'||!title.trim())throw Error('Missing release title');
  const edition=title.trim().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  html=html.replace(/<title>[\s\S]*?<\/title>/,()=>'<title>老祖法宝模拟器 · '+edition+'</title>');
  html=html.replace('机制与公式见 docs/GAME_DATA.md。本工具不修改游戏、不与服务端交互。','战力目标为法宝模型分，非游戏面板总战力。本工具不修改游戏、不与服务端交互。');
  const talentVersion=resourceManifest.acquiredTalentNameSource?.resourceVersion;
  const talentSource=/^\d+$/.test(talentVersion||'')?'；后天特性名称来自先遣服 '+talentVersion:'';
  html=html.replace('<div id="app"></div>',()=>`<div style="padding:10px 16px;text-align:center;border-bottom:1px solid #dec9ab;background:#fff7e8;color:#604833;font-size:13px">${edition}<details><summary>来源与版本</summary>${preview?'先遣':'正式服'}资源 ${String(resourceManifest.resourceVersion).replace(/[<>&"]/g,'')}${talentSource}。原作者 <a href="https://github.com/fradwow/laozu-solver" target="_blank" rel="noopener">fradwow/laozu-solver</a>；更新 ${String(resourceManifest.builtForDate).replace(/[<>&"]/g,'')}。<a href="https://github.com/hekunwang/laozu-solver" target="_blank" rel="noopener">项目源码</a>。</details></div><div id="app"></div>`);
  const files={'index.html':bytes(html),[appName]:bytes(app),[cssName]:bytes(css),[workerUrl.slice(2)]:bytes(workerSource),...talentLite.files};
  files['SOURCE_NOTICES.txt']=bytes('原版代码及界面来源：https://github.com/fradwow/laozu-solver\n本版本源码：https://github.com/hekunwang/laozu-solver\n游戏配置、名称及字形素材归原权利人所有。上游基线未附带 LICENSE 文件；本包保留来源与署名，不为上游代码或游戏数据另行声明许可证。\n天赋识别使用固定词表与字形数据，在浏览器内运行；字库按需加载，不包含通用 OCR 模型或原始字体文件。\n');
  for(const [name,value] of Object.entries(notices))files[relativeName(name)]=bytes(value);
  const offline=addOfflineSupport(files);
  html=files['index.html'].toString();
  const manifest={format:'laozu-public-web-v1',resourceVersion:resourceManifest.resourceVersion,builtForDate:resourceManifest.builtForDate,offline,
    app:'./'+appName,stylesheet:'./'+cssName,recognitionWorker:workerUrl,
    ...(talentVersion ? {acquiredTalentNameSource:resourceManifest.acquiredTalentNameSource} : {}),
    talentOcr:talentLite.manifest,
    files:Object.entries(files).map(([name,value])=>({name,bytes:value.length,sha256:hash(value)}))};
  files['manifest.json']=bytes(JSON.stringify(manifest,null,2)+'\n');
  // Debug app.js is outside the fingerprinted web/ offline release.
  const debugHtml=html.replace(/<script defer src="\.\/assets\/offline-client\.[a-f0-9]{12}\.js"><\/script>\n/,'').replace(/<button type="button" id="offline-status"[\s\S]*?<\/button>/,'').replace('<link rel="manifest" href="./app.webmanifest">\n','');
  const debugFiles={'index.html':bytes(debugHtml.replace(appTag('./'+appName),appTag('./app.js'))),'app.js':bytes(app),[cssName]:files[cssName],...talentLite.files};
  return {files,debugFiles,manifest};
}
function readPublicWebInputs(root){
  const read=name=>fs.readFileSync(path.join(root,name),'utf8'),app=read('app.js'),workerUrl=recognitionWorkerReference(app);
  const notices={};
  for(const name of ['LICENSE','LICENSE.txt','LICENSE.md','NOTICE','NOTICE.txt','THIRD_PARTY_NOTICES.txt','THIRD_PARTY_NOTICES.md'])if(fs.existsSync(path.join(root,name)))notices[name]=fs.readFileSync(path.join(root,name));
  return {upstreamHtml:read('upstream.html'),app,resourceManifest:JSON.parse(read('data/manifest.json')),releaseTitle:JSON.parse(read('data/release-notes.json')).title,
    extraCss:['mobile-ui.css','state-ui-safety.css','talent-picker.css'].map(read),reviewCss:extractReviewCss(read('talent-ocr-ui.js')),
    workerUrl,workerSource:read(workerUrl.slice(2)),browserOcrSource:read('browser-talent-ocr.js'),
    talentLiteWorkerSource:read('talent-lite-worker.js'),talentLiteSegmentationSource:read('talent-lite-segmentation.js'),talentLiteCoreSource:read('talent-lite-core.js'),talentGlyphsSource:read('data/talent-glyphs.json'),notices};
}
function writePublicWeb(root,artifacts){
  const suffix=process.pid+'-'+crypto.randomBytes(4).toString('hex'),staging=path.join(root,'.web-build-'+suffix),target=path.join(root,'web');
  fs.mkdirSync(staging);
  for(const [name,value] of Object.entries(artifacts.files)){const file=path.join(staging,relativeName(name));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);}
  let previous=null;
  if(fs.existsSync(target)){previous=path.join(root,'.web-previous-'+suffix);fs.renameSync(target,previous);}
  try{fs.renameSync(staging,target);}catch(error){if(previous)fs.renameSync(previous,target);throw error;}
  for(const [name,value] of Object.entries(artifacts.debugFiles)){const file=path.join(root,relativeName(name));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);}
  return {directory:target,previous};
}
module.exports={createPublicWebArtifacts,readPublicWebInputs,writePublicWeb,extractReviewCss,recognitionWorkerReference,prepareTalentLitePackage,validateTalentGlyphs,TALENT_LITE_REQUIRED};

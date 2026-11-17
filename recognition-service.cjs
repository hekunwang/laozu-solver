'use strict';
// Optional loopback-only fallback for browsers which cannot create Workers.
// It runs the exact recognizer embedded in the page, on a Node worker thread.
// Pixels, learned signatures and recognition results are never written to disk.
const fs=require('node:fs'),path=require('node:path');
const {Worker}=require('node:worker_threads');
const MAX_PIXELS=16*1024*1024,MAX_METADATA=512*1024;
function createRecognitionService({root,json,timeoutMs=20000,createWorker=source=>new Worker(source,{eval:true})}){
  let active=null,source=null;
  // Snapshot at service creation, just like index.html and the advertised hash.
  const filename=path.join(root,'app.js');
  const match=fs.existsSync(filename)?/const SCREENSHOT_RECOGNITION_WORKER_BASE64="([A-Za-z0-9+/=]+)";/.exec(fs.readFileSync(filename,'utf8')):null;
  function workerSource(){
    if(source)return source;
    if(!match)throw Error('当前构建缺少截图识别程序，请重新构建本地工具');
    source="const {parentPort}=require('node:worker_threads');const self={postMessage:value=>parentPort.postMessage(value)};parentPort.on('message',data=>self.onmessage({data}));\n"+Buffer.from(match[1],'base64').toString('utf8');
    return source;
  }
  function handle(req,res,pathname){
    if(pathname!=='/api/screenshot-recognition')return false;
    if(req.method!=='POST'){json(res,405,{error:'此接口只接受截图识别请求'});return true;}
    if(req.headers['content-type']!=='application/octet-stream'){json(res,415,{error:'截图像素格式无效'});return true;}
    if(active){json(res,429,{error:'法宝识别正在进行，请稍候'},{'Retry-After':'1'});return true;}
    const limit=4+MAX_METADATA+MAX_PIXELS*4;
    if(Number(req.headers['content-length']||0)>limit){json(res,413,{error:'截图尺寸过大，请缩小后重试'});return true;}
    const task={finished:false,worker:null,timer:null,chunks:[],length:0};active=task;
    const finish=(status,value)=>{
      if(task.finished)return;task.finished=true;clearTimeout(task.timer);task.chunks=[];
      if(task.worker){task.worker.removeAllListeners();task.worker.terminate().catch(()=>{});task.worker=null;}
      if(active===task)active=null;
      if(status)json(res,status,value);
    };
    task.cancel=()=>finish(0);
    res.on('close',()=>{if(!res.writableEnded)task.cancel();});
    req.on('aborted',task.cancel);req.on('error',()=>finish(400,{error:'截图读取失败'}));
    task.timer=setTimeout(()=>finish(504,{error:'截图识别超时，请校正网格后重试'}),timeoutMs);
    req.on('data',chunk=>{
      if(task.finished)return;
      task.length+=chunk.length;
      if(task.length>limit){finish(413,{error:'截图尺寸过大，请缩小后重试'});req.resume();return;}
      task.chunks.push(chunk);
    });
    req.on('end',()=>{
      if(task.finished)return;
      let payload;
      try{
        const bytes=Buffer.concat(task.chunks);task.chunks=[];
        if(bytes.length<4)throw Error();
        const length=bytes.readUInt32BE(0);
        if(length<2||length>MAX_METADATA||length+4>bytes.length)throw Error();
        const metadata=JSON.parse(bytes.subarray(4,4+length).toString('utf8'));
        const {width,height,grid}=metadata;
        if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>8192||height>8192||width*height>MAX_PIXELS)throw Error();
        const pixels=bytes.subarray(4+length);
        if(pixels.length!==width*height*4)throw Error();
        if(grid!==null&&grid!==undefined&&(!['ox','oy','pw','ph'].every(key=>Number.isFinite(grid[key]))||grid.pw<=0||grid.ph<=0))throw Error();
        if(!Array.isArray(metadata.signatures)||metadata.signatures.length>2048||metadata.signatures.some(item=>!item||!Number.isInteger(item.equipId)||!Array.isArray(item.sig)||item.sig.length!==48||!item.sig.every(Number.isFinite)))throw Error();
        payload={type:'recognize',width,height,pixels,grid:grid||null,signatures:metadata.signatures};
      }catch{return finish(400,{error:'截图尺寸、网格或像素数据无效'});}
      let worker;try{worker=createWorker(workerSource());task.worker=worker;}catch{return finish(503,{error:'本机法宝识别不可用，请重新打开本地工具'});}
      let started=false;
      worker.on('error',()=>finish(503,{error:'本机法宝识别异常，请重试'}));
      worker.on('exit',()=>{if(!task.finished)finish(503,{error:'本机法宝识别进程提前结束'});});
      worker.on('message',message=>{
        if(task.finished)return;
        if(message?.type==='ready'&&!started){started=true;try{worker.postMessage(payload);payload=null;}catch{finish(500,{error:'截图无法传递给本机识别进程'});}return;}
        if(message?.type==='phase')return;
        if(message?.type==='done'&&started&&message.result&&message.choices)return finish(200,message);
        if(message?.type==='error')return finish(422,{error:message.message||'截图识别失败'});
        finish(500,{error:'截图识别响应无效'});
      });
    });
    return true;
  }
  return {handle,cancel:()=>active?.cancel(),close:()=>active?.cancel()};
}
module.exports={createRecognitionService,MAX_PIXELS,MAX_METADATA};

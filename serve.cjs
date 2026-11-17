'use strict';
// Screenshot bytes stay in memory; only the local Vision helper receives them.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {matchTalents}=require('./talent-ocr-match.cjs');
const {SERVICE,buildInfo,resolvePort}=require('./local-build.cjs');
const {createRecognitionService}=require('./recognition-service.cjs');
function createResidentHelper({helper,launch,timeoutMs=30000}) {
  let current=null,pending=null,lastFailure=null,lastWarmupMs=null,starts=0,closed=false;
  const failure=(message,status=503,name='OCRServiceError')=>Object.assign(Error(message),{status,name});
  function terminate(record,error) {
    if(!record||record.closed)return;
    record.closed=true;record.failure=error;clearTimeout(record.timer);
    if(current===record)current=null;
    if(error.name!=='AbortError')lastFailure=error.message;
    record.reject(error);
    if(pending?.record===record){const task=pending;pending=null;task.reject(error);}
    try{record.child?.kill('SIGKILL');}catch{}
  }
  function start() {
    if(closed)throw failure('文字识别服务已关闭',503,'AbortError');
    if(current)return current;
    const record={child:null,closed:false,ready:false,sequence:0,output:'',stderr:'',startedAt:performance.now(),timer:null};
    record.promise=new Promise((resolve,reject)=>{record.resolve=resolve;record.reject=reject;});
    // Startup is intentionally eager; failures remain visible in status and are
    // returned to a waiting request, without an unhandled warmup rejection.
    record.promise.catch(()=>{});current=record;starts++;
    let child;
    try{child=launch(helper,['--server'],{stdio:['pipe','pipe','pipe']});record.child=child;}
    catch{terminate(record,failure('无法启动本机文字识别'));return record;}
    record.timer=setTimeout(()=>terminate(record,failure('本机文字识别预热超时，请重试',504)),timeoutMs);
    child.stdout.setEncoding('utf8');child.stdout.on('data',data=>{
      if(record.closed)return;
      record.output+=data;
      if(record.output.length>2*1024*1024)return terminate(record,failure('文字识别输出异常',422));
      for(;;){
        const end=record.output.indexOf('\n');if(end<0)break;
        const line=record.output.slice(0,end);record.output=record.output.slice(end+1);
        let message;try{message=JSON.parse(line);}catch{return terminate(record,failure('识别结果无法读取',500));}
        if(message.type==='ready'&&!record.ready&&message.protocol===1){
          record.ready=true;clearTimeout(record.timer);record.readyAt=performance.now();
          record.startupMs=record.readyAt-record.startedAt;record.warmupMs=Number(message.warmupMs)||0;lastWarmupMs=record.warmupMs;record.resolve(record);continue;
        }
        if(message.type==='fatal')return terminate(record,failure(message.error||'本机文字识别初始化失败'));
        const task=pending;
        if(!record.ready||!task||task.record!==record||message.id!==task.id)return terminate(record,failure('文字识别响应与当前图片不匹配',500));
        if(message.type==='error'){
          pending=null;task.reject(failure(message.error||'本机文字识别失败',422));continue;
        }
        if(message.type!=='result'||!Array.isArray(message.lines))return terminate(record,failure('文字识别响应格式异常',500));
        pending=null;
        task.resolve({lines:message.lines,timing:{...message.timing,helperStartupMs:record.startupMs,warmupMs:record.warmupMs,waitForWarmupMs:task.waitForWarmupMs,resident:true}});
      }
    });
    child.stderr.setEncoding('utf8');child.stderr.on('data',data=>{if(!record.closed)record.stderr=(record.stderr+data).slice(0,4096);});
    child.on('error',()=>terminate(record,failure('无法启动本机文字识别')));
    // exit precedes stream close. Invalidate immediately so a request arriving
    // between these events cannot reuse a dead process; the old close is inert.
    child.on('exit',(code,signal)=>{if(!record.closed)terminate(record,failure(record.stderr.trim()||'文字识别进程意外退出（'+(signal||code)+'）'));});
    child.on('close',code=>{if(!record.closed)terminate(record,failure(record.stderr.trim()||'文字识别进程意外退出（'+code+'）'));});
    child.stdin.on('error',()=>terminate(record,failure('图片无法传递给本机文字识别',422)));
    return record;
  }
  return {
    warmup(){try{return start().promise;}catch(error){return Promise.reject(error);}},
    async recognize(data) {
      const startedAt=performance.now(),record=start();await record.promise;
      if(record.closed||current!==record)throw record.failure||failure('文字识别已取消',503,'AbortError');
      if(pending)throw failure('识别正在进行，请稍候',429);
      return new Promise((resolve,reject)=>{
        const id=++record.sequence;
        pending={record,id,resolve,reject,waitForWarmupMs:Math.max(0,record.readyAt-startedAt)};
        const header=Buffer.allocUnsafe(4);header.writeUInt32BE(data.length);
        try{record.child.stdin.write(header);record.child.stdin.write(data);}
        catch{terminate(record,failure('图片无法传递给本机文字识别',422));}
      });
    },
    cancel(error){terminate(current,error||failure('文字识别已取消',503,'AbortError'));},
    close(){closed=true;terminate(current,failure('文字识别服务已关闭',503,'AbortError'));},
    state(){return {mode:'resident',state:closed?'closed':current?(current.ready?(pending?'recognizing':'ready'):'warming'):'cold',starts,lastWarmupMs,lastFailure};}
  };
}
function createServer(options={}) {
  const root=options.root||__dirname, port=options.port??resolvePort();
  const helper=options.helper||path.join(root,'.local-bin','talent-ocr'), launch=options.spawn||spawn;
  const maxBytes=12*1024*1024, timeoutMs=options.timeoutMs??30000, info=buildInfo(root);
  const page=fs.readFileSync(path.join(root,'index.html'));
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/game-catalog.json')));
  const ability=JSON.parse(fs.readFileSync(path.join(root,'data/Ability.json')));
  // Existing injected one-shot fakes keep their old contract; production uses
  // one supervised resident helper, restarted only on a later request if lost.
  const persistent=options.persistent??!options.spawn;
  const resident=persistent?createResidentHelper({helper,launch,timeoutMs}):null;
  const recognition=createRecognitionService({root,json,timeoutMs:options.recognitionTimeoutMs??20000,createWorker:options.recognitionWorker});
  let active=null;
  function json(res,status,value,headers={}) {
    if(res.destroyed||res.writableEnded)return;
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Laozu-Local':SERVICE,...headers});
    res.end(JSON.stringify(value));
  }
  function sameOrigin(req) {
    const actualPort=server.address()?.port||port, host=req.headers.host;
    return [`127.0.0.1:${actualPort}`,`localhost:${actualPort}`].includes(host)&&(!req.headers.origin||req.headers.origin===`http://${host}`);
  }
  const server=http.createServer((req,res)=>{
    if(!sameOrigin(req))return json(res,403,{error:'仅允许从本机计算器访问'});
    let pathname;try{pathname=new URL(req.url,`http://127.0.0.1:${port}`).pathname;}catch{return json(res,400,{error:'请求地址无效'});}
    if(recognition.handle(req,res,pathname))return;
    if(req.method==='GET'&&pathname==='/api/talent-ocr/status')return json(res,200,{...info,ocr:resident?resident.state():{mode:'one-shot'}});
    if(req.method==='GET'&&(pathname==='/'||pathname==='/index.html')){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Laozu-Local':SERVICE});
      return res.end(page);
    }
    if(req.method!=='POST'||pathname!=='/api/talent-ocr')return json(res,404,{error:'未找到'});
    if(!/^image\/(png|jpeg|webp)$/i.test(req.headers['content-type']||''))return json(res,415,{error:'请选择 PNG、JPEG 或 WebP 截图'});
    if(!info.available&&!options.spawn)return json(res,503,{error:'本机 OCR 程序不可用'});
    if(active)return json(res,429,{error:'识别正在进行，请稍候'},{'Retry-After':'1'});
    if(Number(req.headers['content-length']||0)>maxBytes)return json(res,413,{error:'截图超过 12 MB'});
    const task={child:null,finished:false,timer:null,chunks:[],length:0}; active=task;
    const finish=(status,value,kill=false)=>{
      if(task.finished)return;
      task.finished=true;clearTimeout(task.timer);task.chunks=[];
      if(kill&&resident)resident.cancel(status>=400?Object.assign(Error(value?.error||'本机文字识别失败'),{status}):undefined);
      if(kill&&task.child){try{task.child.kill('SIGKILL');}catch{}}
      if(active===task)active=null;
      if(status)json(res,status,value);
    };
    task.cancel=()=>finish(0,null,true);
    // A completed upload can still be cancelled while Vision is processing it.
    res.on('close',()=>{if(!res.writableEnded)task.cancel();});
    req.on('error',()=>finish(400,{error:'图片读取失败'},true));
    req.on('aborted',task.cancel);
    task.timer=setTimeout(()=>finish(408,{error:'截图上传超时'},true),timeoutMs);
    req.on('data',chunk=>{
      if(task.finished)return;
      task.length+=chunk.length;
      if(task.length>maxBytes){finish(413,{error:'截图超过 12 MB'},true);req.resume();return;}
      task.chunks.push(chunk);
    });
    req.on('end',()=>{
      if(task.finished)return;
      if(!task.length)return finish(400,{error:'图片为空'});
      clearTimeout(task.timer);
      if(resident){
        const startedAt=performance.now(),data=Buffer.concat(task.chunks);task.chunks=[];
        task.timer=setTimeout(()=>finish(504,{error:'本机文字识别超时，请重试或裁剪图片'},true),timeoutMs);
        resident.recognize(data).then(result=>{
          if(task.finished)return;
          try{
            const mode=req.headers['x-laozu-ocr-mode']==='acquisition'?'acquisition':'detail';
            finish(200,{...matchTalents(result.lines,catalog,ability,{mode}),timing:{...result.timing,requestProcessingMs:performance.now()-startedAt}});
          }catch{finish(500,{error:'识别结果无法读取'});}
        }).catch(error=>{if(!task.finished)finish(error.status||503,{error:error.message||'本机文字识别失败'});});
        return;
      }
      let child;try{child=launch(helper,[],{stdio:['pipe','pipe','pipe']});task.child=child;}catch{return finish(503,{error:'无法启动本机文字识别'});}
      let output='',stderr='';
      task.timer=setTimeout(()=>finish(504,{error:'本机文字识别超时，请重试或裁剪图片'},true),timeoutMs);
      child.stdout.setEncoding('utf8');child.stdout.on('data',data=>{
        if(task.finished)return;output+=data;
        if(output.length>2*1024*1024)finish(422,{error:'文字识别输出异常，请重试或裁剪图片'},true);
      });
      child.stderr.setEncoding('utf8');child.stderr.on('data',data=>{if(!task.finished)stderr=(stderr+data).slice(0,4096);});
      child.on('error',()=>finish(503,{error:'无法启动本机文字识别'},true));
      child.on('close',code=>{
        if(task.finished)return;
        if(code!==0)return finish(422,{error:stderr.trim()||'本机文字识别失败'});
        try{
          const mode=req.headers['x-laozu-ocr-mode']==='acquisition'?'acquisition':'detail';
          finish(200,matchTalents(JSON.parse(output),catalog,ability,{mode}));
        }catch{finish(500,{error:'识别结果无法读取'});}
      });
      child.stdin.on('error',()=>finish(422,{error:'图片无法传递给本机文字识别'},true));
      child.stdin.end(Buffer.concat(task.chunks));task.chunks=[];
    });
  });
  // Lightweight/temporary HTTP servers do not start Vision just to serve the
  // page. The desktop launcher opts into eager warmup; the first real request
  // always starts it when needed and includes any remaining wait in its timing.
  server.on('listening',()=>{if(options.prewarm&&resident&&info.available)resident.warmup().catch(()=>{});});
  server.on('close',()=>{active?.cancel();resident?.close();recognition.close();});
  server.cancelActive=()=>{active?.cancel();resident?.cancel();recognition.cancel();};
  server.ocrState=()=>resident?resident.state():{mode:'one-shot'};
  return server;
}
function startServer(options={}) {
  const port=options.port??resolvePort(),server=createServer({prewarm:true,...options,port});
  server.on('error',err=>{console.error('本地服务启动失败：'+err.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>{
    const url=`http://127.0.0.1:${port}/`;console.log('本地计算器：'+url+'；关闭此窗口可停止本机服务。');
    if(options.open)spawn('/usr/bin/open',[url],{stdio:'ignore'}).unref();
  });
  const shutdown=()=>{server.cancelActive();server.close(()=>process.exit(0));server.closeAllConnections();};
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);process.once('SIGHUP',shutdown);
  server.once('close',()=>{for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.removeListener(signal,shutdown);});
  return server;
}
if(require.main===module){
  startServer({open:process.argv.includes('--open')});
}
module.exports={createServer,startServer,createResidentHelper};

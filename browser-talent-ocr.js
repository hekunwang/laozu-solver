function createTalentLiteAdapter(createWorker){
  // Lazy, same-origin adapter for the fixed-vocabulary glyph matcher.
  // The font and a general Chinese OCR model are never sent to the browser.
  const abortError=()=>Object.assign(Error('识别已取消'),{name:'AbortError'});
  const checkAbort=signal=>{if(signal?.aborted)throw abortError();};
  const clock=()=>performance.now();

  function createOcrChannel(url,{signal,WorkerClass=globalThis.Worker,timeoutMs=20000}={}){
    checkAbort(signal);
    if(typeof WorkerClass!=='function')throw Error('当前浏览器不支持天赋识别，请手动选择');
    const worker=url==null?createWorker(WorkerClass):new WorkerClass(url),pending=new Map();
    let announceStop;
    const stopped=new Promise(resolve=>{announceStop=resolve;});
    let sequence=0,closed=false,failure;
    const stop=(error=abortError())=>{
      if(closed)return;
      closed=true;failure=error;announceStop(error);
      clearTimeout(timer);signal?.removeEventListener('abort',onAbort);
      worker.onmessage=worker.onerror=worker.onmessageerror=null;
      try{worker.terminate();}catch{}
      for(const job of pending.values())job.reject(error);
      pending.clear();
    };
    const onAbort=()=>stop(abortError());
    const timer=setTimeout(()=>stop(Error('天赋识别超时，请重试或手动选择')),timeoutMs);
    signal?.addEventListener('abort',onAbort,{once:true});
    worker.onerror=worker.onmessageerror=()=>stop(Error('天赋识别加载失败，请重试或手动选择'));
    worker.onmessage=({data})=>{
      if(closed||data?.workerId!=='laozu-talent-ocr')return;
      const job=pending.get(data.jobId);
      if(!job)return;
      pending.delete(data.jobId);
      if(data.status==='resolve')job.resolve(data.data);
      else job.reject(Error(data.message||'天赋识别失败，请手动选择'));
    };
    if(signal?.aborted)onAbort();
    return {
      checkOpen(){if(closed)throw failure;},
      duringDecode(promise){return Promise.race([promise,stopped.then(error=>{throw error;})]);},
      call(action,payload,transfer=[]){
        if(closed)return Promise.reject(failure);
        return new Promise((resolve,reject)=>{
          const jobId=String(++sequence);pending.set(jobId,{resolve,reject});
          try{worker.postMessage({workerId:'laozu-talent-ocr',jobId,action,payload},transfer);}
          catch{stop(Error('天赋识别启动失败，请手动选择'));}
        });
      },
      close:()=>stop(abortError())
    };
  }

  async function decodeImage(file,signal,checkOpen){
    checkAbort(signal);
    let image,release;
    if(typeof createImageBitmap==='function'){
      image=await createImageBitmap(file);release=()=>image.close();
    }else{
      const url=URL.createObjectURL(file);image=new Image();
      release=()=>URL.revokeObjectURL(url);
      try{await new Promise((resolve,reject)=>{
        const cleanup=()=>{image.onload=image.onerror=null;signal?.removeEventListener('abort',abort);};
        const abort=()=>{cleanup();image.src='';reject(abortError());};
        image.onload=()=>{cleanup();resolve();};
        image.onerror=()=>{cleanup();reject(Error('无法读取截图'));};
        signal?.addEventListener('abort',abort,{once:true});image.src=url;
        if(signal?.aborted)abort();
      });}catch(error){release();throw error;}
    }
    let canvas;
    try{
      checkOpen();
      const iw=image.naturalWidth||image.width,ih=image.naturalHeight||image.height;
      if(!iw||!ih||iw*ih>20000000)throw Error('截图尺寸过大，请选择原始手机截图');
      // Browser decoding handles JPEG/WebP orientation and color profiles once.
      const scale=Math.min(1,1080/iw),width=Math.round(iw*scale),height=Math.round(ih*scale);
      canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const context=canvas.getContext('2d',{willReadFrequently:true});
      context.drawImage(image,0,0,width,height);
      const pixels=context.getImageData(0,0,width,height).data;
      checkAbort(signal);
      return {width,height,pixels};
    }finally{if(canvas)canvas.width=canvas.height=1;release();}
  }

  async function recognizeText(file,{signal}={}){
    checkAbort(signal);
    if(!/^image\/(png|jpeg|webp)$/i.test(file?.type||''))throw Error('请选择 PNG、JPEG 或 WebP 截图');
    if(file.size>12*1024*1024)throw Error('截图超过 12 MB');
    const start=clock(),channel=createOcrChannel(null,{signal});
    try{
      // A classic Worker queues messages while its single immutable asset loads.
      const decoded=await channel.duringDecode(decodeImage(file,signal,channel.checkOpen)),decodedAt=clock();
      const result=await channel.call('recognize',decoded,[decoded.pixels.buffer]);
      checkAbort(signal);
      if(result?.engine!=='talent-lite'||!Array.isArray(result.matches)||!Array.isArray(result.unresolved)
        ||['innate','acquired'].some(kind=>typeof result.safeToReplace?.[kind]!=='boolean'||typeof result.completeKinds?.[kind]!=='boolean'))
        throw Error('天赋识别结果不完整，请手动选择');
      const timing={...result.timing,decodeMs:decodedAt-start,totalMs:clock()-start};
      // Standard DevTools measurement, without screenshot contents or names.
      try{performance.measure('laozu-talent-lite',{start,end:clock(),detail:timing});}catch{}
      return {...result,timing};
    }finally{channel.close();}
  }
  return Object.freeze({createOcrChannel,recognizeText});
}

// Unbundled ES module entry.
// Relative URLs discard the parent's query string; carry the package version
// explicitly so a cached adapter cannot silently load a different OCR bundle.
export function talentResourceUrl(name,base=import.meta.url){
  const url=new URL(name,base),version=new URL(base).searchParams.get('v');
  if(version)url.searchParams.set('v',version);
  return url;
}

const adapter=createTalentLiteAdapter(WorkerClass=>new WorkerClass(talentResourceUrl('./talent-lite-worker.js'),{name:'laozu-talent-lite'}));
export const {createOcrChannel,recognizeText}=adapter;

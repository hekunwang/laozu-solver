'use strict';

function installTalentLiteWorker(scope,segmenter,matcher,loadGlyphs){
  scope.onmessage=async({data})=>{
    if(data?.workerId!=='laozu-talent-ocr'||data.action!=='recognize')return;
    const base={workerId:data.workerId,jobId:data.jobId},start=performance.now();
    try{
      const {width,height,pixels}=data.payload||{};
      if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>20000000
         ||!(pixels instanceof Uint8ClampedArray)||pixels.length!==width*height*4)throw Error('截图像素不完整');
      const compiled=matcher.compile(await loadGlyphs()),loaded=performance.now();
      const image={width,height,data:pixels},segmentation=segmenter.segment(image),segmented=performance.now();
      const result=matcher.recognize(image,segmentation,compiled),done=performance.now();
      result.timing={loadMs:loaded-start,segmentMs:segmented-loaded,matchMs:done-segmented,workerMs:done-start};
      scope.postMessage({...base,status:'resolve',data:result});
    }catch(error){scope.postMessage({...base,status:'reject',message:error?.message||'天赋识别失败，请手动选择'});}
  };
}

// Unbundled Worker entry.
function talentResourceUrl(name){
  const url=new URL(name,self.location.href),version=new URL(self.location.href).searchParams.get('v');
  if(version)url.searchParams.set('v',version);
  return url.href;
}
importScripts(talentResourceUrl('./talent-lite-segmentation.js'),talentResourceUrl('./talent-lite-core.js'));
installTalentLiteWorker(self,LaozuTalentLiteSegmentation,LaozuTalentLiteCore,async()=>{
  const response=await fetch(talentResourceUrl('./talent-glyphs.json'));
  if(!response.ok)throw Error('天赋字库加载失败，请重试');
  return response.json();
});

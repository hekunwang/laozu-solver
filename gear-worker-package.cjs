'use strict';

// The standalone HTML and the public page both ship the recognition engine
// in their app code. Record long exact matches instead of sending it twice.
function sharedSlices(app,worker){
  const span=80,map=new Map(),parts=[];
  for(let i=0;i+span<=app.length;i+=span)map.set(app.slice(i,i+span),i);
  let cursor=0,i=0;
  while(i+span<=worker.length){
    const pos=map.get(worker.slice(i,i+span));
    if(pos===undefined){i++;continue;}
    let a=pos,b=i,end=i+span,ae=pos+span;
    while(b>cursor&&a>0&&worker.charCodeAt(b-1)===app.charCodeAt(a-1)){b--;a--;}
    while(end<worker.length&&ae<app.length&&worker.charCodeAt(end)===app.charCodeAt(ae)){end++;ae++;}
    if(cursor<b)parts.push(worker.slice(cursor,b));
    parts.push([a,ae]);cursor=i=end;
  }
  if(cursor<worker.length)parts.push(worker.slice(cursor));
  if(parts.map(p=>typeof p==='string'?p:app.slice(p[0],p[1])).join('')!==worker)throw Error('Worker reconstruction mismatch');
  return parts;
}

// Emitted into the public page's module scope and called only on image import.
// Never evaluate generated code on the UI thread. The caller owns the Blob URL.
function packedGearWorkerUrl(){
  if(typeof URL.createObjectURL!=='function'||typeof URL.revokeObjectURL!=='function'||typeof atob!=='function')return null;
  const source=Function.prototype.toString.call(startFabaoPage);
  if(source.length!==gearWorkerSourceLength)return null;
  const parts=gearWorkerParts.map(part=>Array.isArray(part)
    ?source.slice(part[0],part[1])
    :Uint8Array.from(atob(part),char=>char.charCodeAt(0)));
  return URL.createObjectURL(new Blob(parts,{type:'text/javascript'}));
}

function packageGearWorker(app,worker){
  const header='function startFabaoPage(){\n';
  const end='\n}\nconst gearWorkerSourceLength=';
  // The debug app is itself a public artifact. It can be supplied to tooling
  // again, so take its original page body instead of nesting another wrapper.
  if(app.startsWith(header)){
    const endIndex=app.lastIndexOf(end);
    if(endIndex<0)throw Error('Incomplete public page wrapper');
    app=app.slice(header.length,endIndex);
  }
  const page=header+app+'\n}';
  const parts=sharedSlices(page,worker).map(part=>typeof part==='string'
    ?Buffer.from(part,'utf8').toString('base64'):part);
  const blobParts=parts.map(part=>Array.isArray(part)
    ?Buffer.from(page.slice(part[0],part[1]),'utf8'):Buffer.from(part,'base64'));
  if(!Buffer.concat(blobParts).equals(Buffer.from(worker,'utf8')))throw Error('Packed Worker bytes differ');
  return page+'\nconst gearWorkerSourceLength='+page.length+';\nconst gearWorkerParts='
    +JSON.stringify(parts)+';\n'+packedGearWorkerUrl.toString()+'\nstartFabaoPage();\n';
}

module.exports={packageGearWorker,sharedSlices};

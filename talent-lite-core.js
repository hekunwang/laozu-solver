/* Fixed-vocabulary image matching. Scores are similarities, not OCR probabilities.
 * No text engine, fonts, WASM, network access or platform API is used here. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.LaozuTalentLiteCore=api;
})(typeof self!=='undefined'?self:globalThis,function(){
  'use strict';
  const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
  const minWordMargin=.035;
  function cropTight(image,threshold=80){
    const {data,width,height}=image;
    let x0=width,y0=height,x1=-1,y1=-1;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[y*width+x]>threshold){
      x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
    }
    if(x1<x0)return null;
    const w=x1-x0+1,h=y1-y0+1,out=new Float32Array(w*h);
    for(let y=0;y<h;y++)out.set(data.subarray((y+y0)*width+x0,(y+y0)*width+x0+w),y*w);
    return {data:out,width:w,height:h};
  }
  function resize(image,width,height){
    const out=new Float32Array(width*height),src=image.data;
    for(let y=0;y<height;y++){
      const sy=clamp((y+.5)*image.height/height-.5,0,image.height-1),y0=Math.floor(sy),y1=Math.min(y0+1,image.height-1),dy=sy-y0;
      for(let x=0;x<width;x++){
        const sx=clamp((x+.5)*image.width/width-.5,0,image.width-1),x0=Math.floor(sx),x1=Math.min(x0+1,image.width-1),dx=sx-x0;
        out[y*width+x]=(src[y0*image.width+x0]*(1-dx)+src[y0*image.width+x1]*dx)*(1-dy)
          +(src[y1*image.width+x0]*(1-dx)+src[y1*image.width+x1]*dx)*dy;
      }
    }
    return {data:out,width,height};
  }
  function vector(image,size=24){
    const tight=image&&cropTight(image,90);
    if(!tight)return null;
    let data;
    if(tight.width/tight.height>2.5){
      // Stretching a horizontal stroke such as 一 into a square destroys it.
      const scale=(size-2)/Math.max(tight.width,tight.height);
      const w=Math.max(1,Math.round(tight.width*scale)),h=Math.max(1,Math.round(tight.height*scale));
      const resized=resize(tight,w,h),x0=Math.floor((size-w)/2),y0=Math.floor((size-h)/2);
      data=new Float32Array(size*size);
      for(let y=0;y<h;y++)data.set(resized.data.subarray(y*w,(y+1)*w),(y+y0)*size+x0);
    }else data=resize(tight,size,size).data;
    const mean=data.reduce((a,b)=>a+b,0)/data.length;
    let sum=0;for(let i=0;i<data.length;i++){data[i]-=mean;sum+=data[i]*data[i];}
    if(sum<1)return null;
    const norm=Math.sqrt(sum);for(let i=0;i<data.length;i++)data[i]/=norm;
    return data;
  }
  function dot(a,b){if(!a||!b)return -1;let sum=0;for(let i=0;i<a.length;i++)sum+=a[i]*b[i];return sum;}
  function compile(pack){
    if(pack?.version!==1||pack.engine!=='talent-lite'||pack.bits!==2)throw Error('字库版本不兼容');
    const chars=Array.from(pack.chars),size=pack.size;
    const bytes=typeof atob==='function'?Uint8Array.from(atob(pack.data),c=>c.charCodeAt(0)):Uint8Array.from(Buffer.from(pack.data,'base64'));
    if(bytes.length*4!==chars.length*size*size)throw Error('字库不完整');
    const glyphs=new Map();
    for(let c=0;c<chars.length;c++){
      const data=new Float32Array(size*size),offset=c*size*size;
      for(let i=0;i<data.length;i++)data[i]=((bytes[(offset+i)>>2]>>((3-((offset+i)&3))*2))&3)*85;
      glyphs.set(chars[c],vector({data,width:size,height:size}));
    }
    return {glyphs,words:pack.words.map(row=>({...row,chars:Array.from(row.name)}))};
  }
  function wordImage(image,bbox,localContrast=false){
    const x0=clamp(Math.floor(bbox[0])-2,0,image.width),y0=clamp(Math.floor(bbox[1])-2,0,image.height);
    const x1=clamp(Math.ceil(bbox[2])+2,0,image.width),y1=clamp(Math.ceil(bbox[3])+2,0,image.height);
    const width=x1-x0,height=y1-y0,data=new Float32Array(width*height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=((y+y0)*image.width+x+x0)*4;
      data[y*width+x]=Math.min(image.data[i],image.data[i+1],image.data[i+2]);
    }
    // Downscaled white strokes blend into the badge color. Recover their edges
    // from the crop's background level without changing the glyph templates.
    const background=localContrast?data.slice().sort()[Math.floor(data.length*.2)]:155;
    if(!data.length||255-background<40)return null;
    const scale=255/(255-background);
    for(let i=0;i<data.length;i++)data[i]=clamp((data[i]-background)*scale,0,255);
    return cropTight({data,width,height},115);
  }
  function splitWord(image,count){
    const chars=[],cuts=[0],pitch=image.width/count,projection=new Float32Array(image.width);
    for(let x=0;x<image.width;x++)for(let y=0;y<image.height;y++)projection[x]+=image.data[y*image.width+x]/(255*image.height);
    for(let i=1;i<count;i++){
      const target=image.width*i/count,radius=Math.max(1,Math.round(pitch*.16));
      const low=Math.max(cuts.at(-1)+2,Math.round(target)-radius),high=Math.min(image.width-2,Math.round(target)+radius);
      let cut=Math.round(target),best=Infinity;
      for(let x=low;x<=high;x++){
        const cost=(projection[x-1]+projection[x])/2+.025*Math.abs(x-target)/pitch;
        if(cost<best){best=cost;cut=x;}
      }
      cuts.push(cut);
    }
    cuts.push(image.width);
    for(let i=0;i<count;i++){
      const x0=cuts[i],x1=cuts[i+1],width=x1-x0;
      const data=new Float32Array(width*image.height);
      for(let y=0;y<image.height;y++)data.set(image.data.subarray(y*image.width+x0,y*image.width+x1),y*width);
      chars.push(vector({data,width,height:image.height}));
    }
    return chars;
  }
  function matchBadge(image,badge,compiled){
    const mask=badge.inkMode==='muted'?badge.inkMask:null;
    const word=mask?cropTight({width:mask.width,height:mask.height,data:Float32Array.from(mask.data,v=>v?255:0)},115):wordImage(image,badge.bbox);
    const first=matchWord(word,badge,compiled);
    // An uncertain exclusion could hide a selectable slot. Only rescue a
    // selectable name when both readings independently rank that name first.
    if(first.accepted||!first.word||first.word.kind==='exclude'||first.margin<minWordMargin
      ||badge.inkMode!=='white'||!(badge.inkHeight>=9&&badge.inkHeight<=16))return first;
    const second=matchWord(wordImage(image,badge.bbox,true),badge,compiled);
    return second.accepted&&second.word.id===first.word.id&&second.word.kind===first.word.kind?second:first;
  }
  function matchWord(word,badge,compiled){
    if(!word||word.height<9)return {accepted:false,reasonCode:'unreadable',reason:'文字过小或不清晰',candidates:[]};
    const qualities=badge.qualityCandidates||[],kinds=badge.kindCandidates||[];
    const splits=new Map(),caches=new Map(),ranked=[];
    for(const row of compiled.words){
      if(row.quality&&qualities.length&&!qualities.includes(row.quality))continue;
      if(row.kind!=='exclude'&&kinds.length&&!kinds.includes(row.kind))continue;
      if(/[()（）]/.test(row.name))continue; // deprecated labels need manual selection
      const count=row.chars.length;
      if(Math.abs(Math.log(count/(word.width/word.height)))>.4)continue;
      if(!splits.has(count)){splits.set(count,splitWord(word,count));caches.set(count,new Map());}
      const observed=splits.get(count),cache=caches.get(count),scores=[];
      for(let i=0;i<count;i++){
        const key=i+':'+row.chars[i];
        if(!cache.has(key))cache.set(key,dot(observed[i],compiled.glyphs.get(row.chars[i])));
        scores.push(cache.get(key));
      }
      const min=Math.min(...scores),mean=scores.reduce((a,b)=>a+b,0)/count;
      ranked.push({row,score:.75*mean+.25*min,min,mean,scores});
    }
    ranked.sort((a,b)=>b.score-a.score);
    const first=ranked[0];
    if(!first)return {accepted:false,reasonCode:'no_candidates',reason:'没有匹配词条',candidates:[]};
    const next=ranked.find(({row})=>row.id!==first.row.id||row.kind!==first.row.kind);
    const margin=first.score-(next?.score||0);
    const observed=splits.get(first.row.chars.length);
    let charMargin=Infinity;
    first.row.chars.forEach((char,i)=>{
      let alternative=-1;
      for(const [other,glyph] of compiled.glyphs)if(other!==char)alternative=Math.max(alternative,dot(observed[i],glyph));
      charMargin=Math.min(charMargin,first.scores[i]-alternative);
    });
    const accepted=first.mean>=.7&&first.min>=.52&&margin>=minWordMargin&&charMargin>=.02;
    // Exclusions (personality, physique, placeholders) still compete in the
    // identity test above, but can never be suggested as one of the four
    // selectable talents. Filtering precedes the cap, so exclusions cannot
    // crowd all selectable suggestions out of a close result.
    const candidates=[],seen=new Set();
    for(const {row} of ranked){
      if((row.kind!=='innate'&&row.kind!=='acquired')||!Number.isSafeInteger(row.id)||row.id<=0||seen.has(row.id))continue;
      candidates.push({id:row.id,name:row.name,kind:row.kind,quality:row.quality});seen.add(row.id);
      if(candidates.length===5)break;
    }
    return {accepted,word:first.row,score:first.score,margin,charMargin,min:first.min,mean:first.mean,
      reasonCode:accepted?'':margin<minWordMargin||charMargin<.02?'ambiguous':'weak_glyphs',
      reason:accepted?'':'字形或相似词差距不足',candidates,ranked:ranked.slice(0,3).map(r=>({name:r.row.name,score:r.score,min:r.min}))};
  }

  const kinds=['innate','acquired'];
  const sectionName=kind=>kind==='innate'?'先天':'后天';
  function topLeftBox(raw,image){
    if(!Array.isArray(raw)||raw.length!==4||!raw.every(Number.isFinite))return null;
    const [x0,y0,x1,y1]=raw;
    if(x0<0||y0<0||x1<=x0||y1<=y0||x1>image.width||y1>image.height)return null;
    return {x:x0/image.width,y:y0/image.height,width:(x1-x0)/image.width,height:(y1-y0)/image.height};
  }

  function recognize(image,segmentation,compiled){
    if(segmentation?.contextReliable!==true||segmentation.context==='unknown')throw Error('未确认完整弟子详情截图，请手动选择天赋');
    const layout=segmentation.layout;
    const expected=layout==='legacy_2x3_innate'?{innate:6,acquired:0}:layout==='modern_3x2_innate'?{innate:6,acquired:4}:null;
    const observed={innate:0,acquired:0},unlocated={innate:0,acquired:0},ambiguousSection={innate:false,acquired:false};
    const completeKinds={},safeToReplace={},matches=[],diagnostics=[],unresolved=[],records=[];
    const acceptedIds={innate:new Map(),acquired:new Map()};
    for(const badge of Array.isArray(segmentation.badges)?segmentation.badges:[]){
      const possible=kinds.filter(kind=>badge?.kindCandidates?.includes(kind));
      if(possible.length!==1){
        for(const kind of possible.length?possible:kinds)ambiguousSection[kind]=true;
        continue;
      }
      const kind=possible[0],box=topLeftBox(badge.bbox,image);
      if(!box){unlocated[kind]++;continue;}
      const order=++observed[kind];
      const key='badge:'+kind+':'+order;
      const result=matchBadge(image,badge,compiled);
      records.push({key,kind,order,box,result,placeholderBadge:badge.qualityCandidates?.includes(0)===true});
      diagnostics.push({key,bbox:badge.bbox,...result,word:result.word?{name:result.word.name,kind:result.word.kind}:undefined});
      if(result.accepted&&result.word.kind===kind){const id=result.word.id;acceptedIds[kind].set(id,(acceptedIds[kind].get(id)||0)+1);}
    }

    for(const kind of kinds){
      // Structural evidence is separate from word confidence. An inconsistent
      // completeness flag, e.g. four claimed acquired slots but only three
      // locatable badges, must never authorize a silent deletion.
      completeKinds[kind]=!!expected&&segmentation.completeKinds?.[kind]===true&&observed[kind]===expected[kind]&&!unlocated[kind]&&!ambiguousSection[kind];
      safeToReplace[kind]=completeKinds[kind];
    }
    for(const {key,kind,order,box,result,placeholderBadge} of records){
      const row=result.word;
      if(result.accepted&&row.kind==='exclude')continue;
      const duplicate=result.accepted&&acceptedIds[kind].get(row.id)>1;
      const overflow=result.accepted&&acceptedIds[kind].size>4;
      if(!result.accepted||duplicate||overflow){
        safeToReplace[kind]=false;
        unresolved.push({key,kind,order,scope:'badge',reason:duplicate?'duplicate':overflow?'over_capacity':result.reasonCode,
          reasonText:duplicate?'多张牌匹配为同一天赋，请分别核对。':overflow?'匹配的不同天赋超过四项，请核对这一类。':row?.kind==='exclude'?'字形更接近非天赋词“'+row.name+'”，请对照截图。':result.reason,
          // Unlike historical matches[].bbox (bottom-left), this box is ready
          // for an image/canvas crop with the conventional top-left origin.
          bbox:box,bboxOrigin:'top-left',candidates:(result.candidates||[]).filter(candidate=>candidate.kind===kind),
          allowFullCatalog:true,allowNonTalent:true,defaultSelected:false,mayBeNonTalent:placeholderBadge||row?.kind==='exclude'});
        continue;
      }
      matches.push({key,id:row.id,name:row.name,kind,order,confidence:result.score,scoreType:'glyph',sourceText:row.name,
        defaultSelected:true,bbox:{...box,y:1-box.y-box.height}});
    }
    for(const kind of kinds){
      if(completeKinds[kind]||(!expected&&!observed[kind]&&!unlocated[kind]))continue;
      unresolved.push({key:'region:'+kind,kind,scope:'region',reason:unlocated[kind]?'unlocated_badge':'incomplete_region',
        reasonText:sectionName(kind)+'区域未完整定位，请核对该类全部天赋。',bbox:null,bboxOrigin:'top-left',candidates:[],allowFullCatalog:true,defaultSelected:false,
        expectedSlots:expected?.[kind]??null,locatedSlots:observed[kind],missingSlots:expected?Math.max(0,expected[kind]-observed[kind]):null});
    }
    return {engine:'talent-lite',context:'disciple_detail',contextReliable:true,layout,matches,lines:[],completeKinds,safeToReplace,unresolved,diagnostics,
      warnings:kinds.filter(kind=>!safeToReplace[kind]).map(kind=>sectionName(kind)+'区域需要核对后才能覆盖。')};
  }
  return {compile,matchBadge,recognize};
});

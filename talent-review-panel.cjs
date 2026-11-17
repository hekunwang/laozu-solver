'use strict';

// Injected alongside the existing screenshot importer. on() is Preact's
// component-scoped signal hook in the upstream bundle.
function talentReviewPanelRuntime(){
  function reviewName(row){
    return r('span',{class:talentQualityClass(row),children:row.name});
  }
  function talentReviewCrop({box}){
    const source=V?.canvas;
    if(!source)return null;
    const left=box?Math.max(0,Math.floor(box.x*source.width)-2):0;
    const top=box?Math.max(0,Math.floor(box.y*source.height)-2):0;
    const right=box?Math.min(source.width,Math.ceil((box.x+box.width)*source.width)+2):source.width;
    const bottom=box?Math.min(source.height,Math.ceil((box.y+box.height)*source.height)+2):source.height;
    const width=right-left,height=bottom-top;
    if(width<=0||height<=0)return null;
    const scale=Math.min(1,(box?480:768)/width);
    return r('canvas',{class:box?'talent-decision-crop':'talent-decision-original',
      width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale)),
      role:'img','aria-label':box?'待裁决天赋原图':'导入的完整截图',ref:canvas=>{
        if(canvas)canvas.getContext('2d').drawImage(source,left,top,width,height,0,0,canvas.width,canvas.height);
      }});
  }
  function talentReviewDecision({group,entry,index,rows,byId}){
    const browse=on(false),query=on(''),showOriginal=on(false);
    const region=entry.scope==='region';
    const staged=region&&Array.isArray(entry.choice)?entry.choice:[];
    const kind=group.kind,key=entry.key;
    function closeCatalog(){browse.value=false;query.value='';}
    function finish(value){closeCatalog();screenshotTalentReview.resolve(kind,key,value);}
    function setPicked(id){
      if(!region){finish(id);return;}
      const next=staged.includes(id)?staged.filter(value=>value!==id):[...staged,id];
      screenshotTalentReview.stageRegion(kind,key,next);
    }
    const button=(caption,action,props={})=>r('button',{type:'button',class:'ghost',onClick:action,children:caption,...props});
    const title=region?'未定位的天赋':'天赋 '+(index+1);
    if(entry.resolved){
      const ids=region?staged:[entry.choice];
      const names=ids.map(id=>byId.get(id)).filter(Boolean);
      return r('div',{class:'talent-review-resolved',children:[
        r('span',{class:'small muted',children:title}),
        ...(names.length?names.map(reviewName):[r('span',{children:region?'没有其他天赋':'已跳过'})]),
        button('重选',()=>{
          if(region)screenshotTalentReview.stageRegion(kind,key,staged);
          else screenshotTalentReview.resolve(kind,key,null);
        },{'aria-label':'重新裁决'+title})
      ]});
    }
    const occupied=new Set(group.items.filter(item=>item.checked).map(item=>item.id));
    for(const other of group.unresolved){
      if(other.key===key)continue;
      const choices=Array.isArray(other.choice)?other.choice:[other.choice];
      for(const id of choices)if(Number.isInteger(id))occupied.add(id);
    }
    const atLimit=occupied.size+staged.length>=4;
    const option=row=>{
      const picked=staged.includes(row.id);
      return r('button',{type:'button',class:'talent-decision-option',disabled:!picked&&atLimit,
        'aria-pressed':region?picked:undefined,onClick:()=>setPicked(row.id),children:reviewName(row)},row.id);
    };
    const candidates=entry.candidates.map(candidate=>byId.get(candidate.id)).filter(row=>row&&!occupied.has(row.id));
    const term=query.value.trim().toLowerCase();
    const results=browse.value?rows.filter(row=>!occupied.has(row.id)&&
      (!term||row.name.includes(term)||String(row.id).includes(term))):[];
    return r('div',{class:'talent-review-decision',children:[
      r('div',{class:'talent-decision-heading',children:[
        r('strong',{children:region?'待裁决 · 未定位的天赋':'待裁决 · '+title}),
        entry.bbox?r(talentReviewCrop,{box:entry.bbox}):
          button(showOriginal.value?'收起原图':'查看原图',()=>{showOriginal.value=!showOriginal.value;},{'aria-expanded':showOriginal.value})
      ]}),
      !entry.bbox&&showOriginal.value?r(talentReviewCrop,{box:null}):null,
      candidates.length?r('div',{class:'talent-review-options','aria-label':'候选天赋',children:candidates.map(option)}):null,
      staged.length?r('div',{class:'talent-review-options','aria-label':'已补选天赋',children:staged.map(id=>{
        const row=byId.get(id);return row&&button([reviewName(row),' ×'],()=>setPicked(id),{'aria-label':'移除'+row.name});
      })}):null,
      r('div',{class:'talent-review-options',children:[
        button(browse.value?'收起天赋列表':(region?'补选天赋':'从全部天赋选择'),()=>{
          if(browse.value)closeCatalog();else browse.value=true;
        },{'aria-expanded':browse.value}),
        region?button(staged.length?'完成裁决':'没有其他天赋',()=>finish(staged.length?staged:'skip')):
          button('跳过此项',()=>finish('skip'))
      ]}),
      browse.value?r('div',{class:'talent-decision-catalog',children:[
        r('input',{type:'search',placeholder:'搜索天赋名称或 ID','aria-label':'搜索'+group.title,
          value:query.value,onInput:event=>{query.value=event.currentTarget.value;},
          onKeyDown:event=>{if(event.key==='Escape'){event.stopPropagation();closeCatalog();}}}),
        atLimit?r('p',{class:'small muted',children:'已选四项，可先取消一项再补选。'}):null,
        r('div',{class:'talent-decision-list','aria-label':group.title+'词表',children:results.length?
          results.map(option):r('span',{class:'small muted',children:'没有匹配的天赋'})})
      ]}):null
    ]});
  }
  function pendingTalentDecisions(){
    return screenshotTalentReview.state.value.groups.reduce((count,group)=>
      count+(group.include?group.unresolved.filter(entry=>!entry.resolved).length:0),0);
  }
  function unifiedTalentReviewPanel(){
    const state=screenshotTalentReview.state.value;
    if(state.status==='idle')return null;
    const heading=r('h3',{children:'天赋识别'});
    if(state.status==='pending')return r('section',{class:'talent-review',children:[heading,
      r('span',{class:'small muted',children:'正在识别…'}),
      r('button',{type:'button',class:'ghost',onClick:()=>screenshotTalentReview.skip(),children:'跳过天赋识别'})]});
    if(state.status==='error'||state.status==='skipped')return r('section',{class:'talent-review',children:[heading,
      r('span',{class:'small muted',children:state.status==='skipped'?'已跳过':'无法识别此图的天赋'}),
      state.status==='error'?r('button',{type:'button',class:'ghost',onClick:()=>screenshotTalentReview.manual(),children:'手动裁决'}):null]});
    if(state.status!=='ready')return null;
    const plan=screenshotTalentReview.plan();
    return r('section',{class:'talent-review',children:[heading,...state.groups.map(group=>{
      const rows=group.kind==='innate'?z.talents:ACDB,byId=new Map(rows.map(row=>[row.id,row]));
      return r('div',{class:'talent-review-group',children:[
        r('label',{class:'talent-review-toggle',children:[
          r('input',{type:'checkbox',checked:group.include,onChange:event=>screenshotTalentReview.include(group.kind,event.currentTarget.checked)}),
          '导入'+group.title]}),
        group.include?r(R,{children:[
          group.items.length?r('div',{class:'talent-review-names',children:group.items.map(item=>
            r('label',{children:[r('input',{type:'checkbox',checked:item.checked,
              onChange:event=>screenshotTalentReview.item(group.kind,item.id,event.currentTarget.checked)}),reviewName(byId.get(item.id)||item)]},item.id))}):null,
          ...group.unresolved.map((entry,index)=>r(talentReviewDecision,{group,entry,index,rows,byId},entry.key)),
          !group.items.some(item=>item.checked)&&group.unresolved.every(entry=>entry.resolved&&
            (entry.choice==='skip'||(Array.isArray(entry.choice)&&!entry.choice.length)))?
            r('small',{class:'muted',children:'无选中天赋，确认后清空此类。'}):null
        ]}):null
      ]},group.kind);
    }),...plan.errors.filter(error=>!error.includes('待裁决')).map(error=>r('p',{class:'small warn',role:'alert',children:error},error))]});
  }
}

const source=talentReviewPanelRuntime.toString();
module.exports=source.slice(source.indexOf('{')+1,source.lastIndexOf('}'));

'use strict';
// Standalone review UI. Screenshot pixels remain in the local browser and
// the localhost Vision helper; detected strings are always reviewed by user.
(()=>{
  let dialog=null;
  const el=(tag,props={},children=[])=>{
    const node=document.createElement(tag);
    for(const [key,value] of Object.entries(props)){
      if(key==='text')node.textContent=value;
      else if(key==='className')node.className=value;
      else if(key.startsWith('on'))node.addEventListener(key.slice(2).toLowerCase(),value);
      else if(key==='checked'||key==='disabled')node[key]=value;
      else node.setAttribute(key,value);
    }
    for(const child of children)node.append(child);
    return node;
  };
  const style=el('style',{text:`
    .talent-ocr-dialog{border:1px solid #b69a78;border-radius:12px;padding:0;max-width:760px;width:calc(100% - 28px);max-height:90vh;color:#332718;background:#fffaf1;box-shadow:0 12px 45px #0006}
    .talent-ocr-dialog::backdrop{background:#0008}.talent-ocr-inner{padding:18px;overflow:auto;max-height:85vh}.talent-ocr-head{display:flex;justify-content:space-between;align-items:center;gap:12px}.talent-ocr-head h2{margin:0}.talent-ocr-box{margin:12px 0;padding:12px;border:1px solid #d9c3a4;border-radius:8px;background:#fff}.talent-ocr-row{display:flex;align-items:flex-start;gap:8px;margin:8px 0}.talent-ocr-name{font-weight:700}.talent-ocr-muted{color:#6c5d49;font-size:13px}.talent-ocr-warning{color:#944411}.talent-ocr-preview{max-height:220px;max-width:100%;object-fit:contain}.talent-ocr-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}.talent-ocr-status{white-space:pre-wrap}.talent-ocr-dialog button{cursor:pointer;padding:7px 12px}.talent-ocr-dialog button:disabled{cursor:not-allowed}.talent-ocr-dialog input[type=file]{max-width:100%}
  `});
  document.head.append(style);
  window.openTalentTransfer=()=>{
    const api=window.laozuLocal;
    if(!api?.serialize||!api?.importState){alert('配置尚未加载完成，请稍后再试。');return;}
    const textarea=el('textarea',{'aria-label':'配置迁移内容',rows:'10',style:'width:100%;box-sizing:border-box;font-family:monospace'});
    const status=el('p',{className:'talent-ocr-muted',text:'复制当前配置，或将配置内容粘贴到这里。'});
    let transfer;
    const show=el('button',{type:'button',text:'显示当前配置',onclick:()=>{
      textarea.value=JSON.stringify({format:'laozu-current-config-v1',state:api.serialize()});
      textarea.focus();textarea.select();status.textContent='已选中当前配置，请复制后到目标地址粘贴。';
    }});
    const restore=el('button',{type:'button',text:'导入并替换当前配置',onclick:()=>{
      try{
        if(textarea.value.length>2*1024*1024)throw Error('配置内容过大');
        const backup=JSON.parse(textarea.value),state=backup?.state;
        if(backup?.format!=='laozu-current-config-v1'||!state||state.version!==1||!state.holdings||typeof state.holdings!=='object'||Array.isArray(state.holdings))throw Error('配置格式不正确');
        const result=api.importState(state);if(result?.saved===false){status.textContent='已载入当前页面，但浏览器保存失败，请保留此备份。';}else transfer.close();
      }catch(error){status.textContent='未导入：'+error.message;}
    }});
    transfer=el('dialog',{className:'talent-ocr-dialog','aria-label':'迁移当前配置'},[
      el('div',{className:'talent-ocr-inner'},[
        el('div',{className:'talent-ocr-head'},[el('h2',{text:'迁移当前配置'}),el('button',{type:'button',text:'关闭',onclick:()=>transfer.close()})]),
        el('p',{text:'不同地址的浏览器存档相互隔离。先在原地址显示并复制当前配置，再到新地址粘贴导入。'}),
        el('p',{className:'talent-ocr-warning',text:'导入会替换目标地址的当前配置；不会迁移已命名方案和收藏。需要迁移命名方案时，请先逐个载入后分别复制。'}),
        textarea,status,el('div',{className:'talent-ocr-actions'},[show,restore])
      ])
    ]);
    transfer.addEventListener('close',()=>transfer.remove());document.body.append(transfer);transfer.showModal();
  };
  window.openTalentOCR=initialFile=>{
    if(dialog&&!dialog.open)dialog.dispose?.();
    if(dialog){dialog.showModal();if(initialFile)dialog.selectImage?.(initialFile);return;}
    const root=window.laozuLocal,api=root?.talentReview,factory=window.laozuTalentReviewFactory;
    if(!api||!factory){alert('天赋界面尚未加载完成，请稍后再试。');return;}
    let ownDialog,closed=false,lastFile=null,review,ownImageUrl=null;
    const status=el('p',{className:'talent-ocr-status talent-ocr-muted',text:'选择弟子详情截图，识别后请核对。'});
    const preview=el('img',{className:'talent-ocr-preview',alt:'待识别的截图预览'});preview.hidden=true;
    const list=el('div'),apply=el('button',{type:'button',disabled:true,text:'确认并导入所选天赋'});
    const file=el('input',{type:'file',accept:'image/png,image/jpeg,image/webp','aria-label':'选择弟子天赋截图'});
    const mode=el('select',{'aria-label':'天赋截图类型'},[el('option',{value:'detail',text:'弟子详情：当前持有天赋'}),el('option',{value:'acquisition',text:'获得或替换界面：逐项核对'})]);
    const names=(kind,ids)=>ids.map(id=>(kind==='innate'?root.catalog.talents:root.catalog.acquiredTalents).find(row=>row.id===id)?.name||String(id)).join('、')||'无';
    function render(){
      if(closed||!review)return;
      const state=review.state.value,plan=review.plan(),current=api.read();list.replaceChildren();
      apply.disabled=state.status!=='ready'||!!plan.errors.length||!Object.keys(plan.updates).length;
      if(state.status==='pending'){status.textContent='正在本机识别文字…可以选择其他图片或关闭以取消。';return;}
      if(state.status==='error'){status.textContent='识别失败：'+state.message;return;}
      if(state.status!=='ready')return;
      status.textContent='请对照原图核对。默认覆盖原有天赋；未识别到或全部取消勾选的类别，确认后清空。';
      for(const group of state.groups){
        const section=el('section',{className:'talent-ocr-box'}),old=(current[group.kind]||[]).filter(Boolean),diff=plan.changes[group.kind];
        const include=el('input',{type:'checkbox',checked:group.include,onchange:event=>review.include(group.kind,event.target.checked)});
        section.append(el('label',{className:'talent-ocr-row'},[include,el('strong',{text:'导入'+group.title})]),el('p',{className:'talent-ocr-muted',text:'当前：'+names(group.kind,old)}));
        if(!group.items.length)section.append(el('p',{className:'talent-ocr-muted',text:group.include?'未识别到此类，确认后清空原有天赋。':'已取消此类导入，保留原有天赋。'}));
        for(const item of group.items){
          const checkbox=el('input',{type:'checkbox',checked:item.checked,disabled:group.clear,onchange:event=>review.item(group.kind,item.id,event.target.checked)});
          section.append(el('label',{className:'talent-ocr-row'},[checkbox,el('span',{},[el('strong',{text:item.name}),el('span',{className:'talent-ocr-muted',text:'　'+(item.desc||'')}),el('small',{style:'display:block',text:window.laozuTalentEvidenceLabel(item)}),...(item.reviewReason?[el('small',{className:'talent-ocr-warning',style:'display:block',text:item.reviewReason})]:[])])]));
        }
        if(group.items.length){
          const choice=el('select',{'aria-label':group.title+'导入方式',onchange:event=>review.mode(group.kind,event.target.value==='replace')},[el('option',{value:'replace',text:'覆盖原有（所选为空则清空）'}),el('option',{value:'merge',text:'合并保留已有项'})]);choice.value=group.replace?'replace':'merge';section.append(choice);
        }
        if(old.length)section.append(el('button',{type:'button',text:group.clear?'取消清空':'清空此类当前天赋',onclick:()=>review.clear(group.kind,!group.clear)}));
        section.append(el('p',{className:diff?.removed.length?'talent-ocr-warning':'talent-ocr-muted',text:diff?'确认后：'+names(group.kind,diff.after)+'；新增：'+names(group.kind,diff.added)+'；移除：'+names(group.kind,diff.removed):'确认后保持不变'}));
        list.append(section);
      }
      for(const error of plan.errors)list.append(el('p',{className:'talent-ocr-warning',role:'alert',text:error}));
      if(state.lines.length)list.append(el('details',{},[el('summary',{text:'查看全部识别原文'}),...state.lines.map(line=>el('div',{className:'talent-ocr-muted',text:line.text}))]));
    }
    review=factory({signal:value=>({value}),read:()=>api.read(),recognize:window.laozuRecognizeTalents,
      validate:(kind,ids)=>window.laozuTalentReviewValidate(kind,ids),
      makeController:()=>new AbortController(),onChange:render});
    function recognize(chosen){
      if(!chosen||closed)return;lastFile=chosen;
      if(ownImageUrl)URL.revokeObjectURL(ownImageUrl);ownImageUrl=URL.createObjectURL(chosen);preview.src=ownImageUrl;preview.hidden=false;
      review.start(chosen,{mode:mode.value});
    }
    file.addEventListener('change',()=>recognize(file.files?.[0]));mode.addEventListener('change',()=>lastFile&&recognize(lastFile));
    apply.addEventListener('click',()=>{
      const plan=review.plan();if(plan.errors.length||!Object.keys(plan.updates).length)return;
      try{
        const state=root.serialize();if(plan.updates.innate!==undefined)state.talentPicks=plan.updates.innate;if(plan.updates.acquired!==undefined)state.acquiredTalentPicks=plan.updates.acquired;
        const result=root.importState(state);
        if(result?.saved===false){status.textContent='已应用到当前页面，但浏览器保存失败。请导出备份后再关闭。';return;}
        ownDialog.close();dispose();
      }catch(error){status.textContent='未导入：'+error.message;}
    });
    ownDialog=el('dialog',{className:'talent-ocr-dialog','aria-label':'从截图识别天赋'},[
      el('div',{className:'talent-ocr-inner'},[
        el('div',{className:'talent-ocr-head'},[el('h2',{text:'从截图识别天赋'}),el('button',{type:'button',text:'关闭',onclick:()=>{ownDialog.close();dispose();}})]),
        el('p',{text:'图片仅在本机处理。确认后默认用截图天赋覆盖原有，未识别类别清空；取消该类导入可保留原值。'}),
        mode,el('button',{type:'button',text:'从旧地址迁移当前配置',onclick:()=>{ownDialog.close();dispose();window.openTalentTransfer();}}),
        file,status,preview,list,el('div',{className:'talent-ocr-actions'},[apply])
      ])
    ]);
    ownDialog.selectImage=recognize;
    ownDialog.addEventListener('paste',event=>{const image=[...(event.clipboardData?.items||[])].find(item=>item.type.startsWith('image/'))?.getAsFile();if(image){event.preventDefault();recognize(image);}});
    function dispose(){if(closed)return;closed=true;review.reset();if(ownImageUrl){URL.revokeObjectURL(ownImageUrl);ownImageUrl=null;}ownDialog.remove();if(dialog===ownDialog)dialog=null;}
    ownDialog.dispose=dispose;ownDialog.addEventListener('close',dispose);
    dialog=ownDialog;document.body.append(ownDialog);ownDialog.showModal();if(initialFile)recognize(initialFile);
  };
})();

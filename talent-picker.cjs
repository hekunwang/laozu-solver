'use strict';

// Applied after patch-acquired-talents.cjs. The picker only changes presentation
// and input navigation; cr/acValidate still own persistence and validation.
function talentPickerRuntime() {
  /* talent-picker-v1 */
  const talentSlotState=C({key:null,active:0});
  const talentSearchActive=C({innate:0,acquired:0});
  function talentQualityText(row){
    return ({1:'尘品 绿',2:'凡品 蓝',3:'良品 紫',4:'优品 橙',5:'卓品 红'})[row?.quality]||'';
  }
  function talentQualityClass(row){
    return row&&[1,2,3,4,5].includes(row.quality)?'talent-quality talent-quality-'+row.quality:'';
  }
  function talentSearchText(row,acquired){
    const forms=acquired?(row.forms||[]):[row.form];
    return [row.name,row.desc,row.id,talentQualityText(row),...forms.filter(Boolean).map(form=>na(form)+'形态')].join(' ').toLowerCase();
  }
  function talentCloseSlot(){
    if(talentSlotState.value.key!==null)talentSlotState.value={key:null,active:0};
  }
  function talentFocus(id){
    if(typeof document!=='undefined')document.getElementById?.(id)?.focus();
  }
  function talentReveal(id){
    if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>{
      if(typeof document!=='undefined')document.getElementById?.(id)?.scrollIntoView?.({block:'nearest'});
    });
  }
  // One listener for the application lifetime also closes touch-opened menus
  // when the next tap is on a non-focusable part of the page.
  if(typeof document!=='undefined'&&typeof document.addEventListener==='function'){
    document.addEventListener('pointerdown',event=>{
      const key=talentSlotState.value.key;
      if(key&&event.target?.closest?.('.talent-select-wrap')?.getAttribute('data-talent-picker-id')!==key)talentCloseSlot();
    },true);
  }
  function talentPicker({title,picks,search,open,target,rows,acquired,onPick}){
    const group=acquired?'acquired':'innate',byId=new Map(rows.map(row=>[row.id,row]));
    const rowKey=row=>acquired?acKey(row):row.id;
    const terms=search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches=row=>terms.every(term=>talentSearchText(row,acquired).includes(term));
    let visibleCount=picks.length;
    while(visibleCount>4&&!picks[visibleCount-1])visibleCount--;
    const firstEmpty=picks.slice(0,4).findIndex(id=>!id);
    const targetIndex=firstEmpty>=0?firstEmpty:(target.value>=0&&target.value<4?target.value:-1);
    const occupiedExcept=index=>new Set(picks.filter((id,i)=>id&&i!==index).map(id=>{
      const row=byId.get(id);return row?rowKey(row):id;
    }));
    const occupiedForTarget=occupiedExcept(targetIndex);
    const results=rows.filter(row=>matches(row)&&!occupiedForTarget.has(rowKey(row)));
    const searchId=group+'-talent-results',inputId=group+'-talent-search';
    const activeSearch=Math.min(Math.max(0,talentSearchActive.value[group]),Math.max(0,results.length-1));
    const showSearch=!!(open.value&&terms.length),canChoose=targetIndex>=0&&results.length>0;
    const setSearchActive=index=>{
      talentSearchActive.value={...talentSearchActive.value,[group]:index};
      if(results[index])talentReveal(searchId+'-'+results[index].id);
    };
    const chooseSearch=row=>{
      if(targetIndex<0)return;
      onPick(targetIndex,row.id);search.value='';target.value=-1;open.value=false;
      setSearchActive(0);talentCloseSlot();talentFocus(inputId);
    };
    const nameNode=(row,extra='')=>r('span',{class:(extra+' '+talentQualityClass(row)).trim(),children:row.name});
    const qualityLabel=row=>row.name+'，'+talentQualityText(row)+(row.desc?'，'+row.desc:'');
    const searchKeyDown=event=>{
      if(event.isComposing||event.keyCode===229)return;
      if(event.key==='Escape'){if(showSearch)event.preventDefault();open.value=false;return;}
      if(event.key==='Tab'){open.value=false;return;}
      if(!terms.length||!canChoose)return;
      let next=activeSearch;
      if(event.key==='ArrowDown')next=showSearch?Math.min(results.length-1,next+1):0;
      else if(event.key==='ArrowUp')next=showSearch?Math.max(0,next-1):results.length-1;
      else if(event.key==='Home')next=0;
      else if(event.key==='End')next=results.length-1;
      else if(event.key==='Enter'&&showSearch){event.preventDefault();chooseSearch(results[activeSearch]);return;}
      else return;
      event.preventDefault();open.value=true;setSearchActive(next);
    };
    const pickerExpanded=showSearch||talentSlotState.value.key?.startsWith(group+'-talent-');
    return r('div',{class:'talent-picker'+(pickerExpanded?' talent-picker-open':''),children:[
      r('div',{class:'talent-search-box',onFocusOut:event=>{
        if(!event.currentTarget.contains(event.relatedTarget))open.value=false;
      },children:[
        r('label',{class:'talent-search',children:[
          r('span',{class:'small',children:'筛选'+title}),
          r('input',{id:inputId,type:'search',role:'combobox',value:search.value,'aria-label':'筛选'+title,
            'aria-autocomplete':'list','aria-haspopup':'listbox','aria-expanded':showSearch,'aria-controls':searchId,
            'aria-activedescendant':showSearch&&canChoose?searchId+'-'+results[activeSearch].id:undefined,
            autoComplete:'off',placeholder:'名称、形态、效果或 ID',
            onFocus:()=>{open.value=true;talentCloseSlot();},
            onInput:event=>{search.value=event.currentTarget.value;target.value=-1;open.value=true;setSearchActive(0);talentCloseSlot();},
            onKeyDown:searchKeyDown})
        ]}),
        showSearch?r('div',{class:'talent-results',children:[
          firstEmpty<0?r('div',{class:'talent-result-target',children:[
            r('span',{class:'small',children:'选择要替换的天赋：'}),
            ...picks.slice(0,4).map((id,index)=>{
              const row=byId.get(id);
              return r('button',{type:'button',class:targetIndex===index?'talent-target active':'talent-target',
                'aria-pressed':targetIndex===index,onClick:()=>{target.value=index;setSearchActive(0);talentFocus(inputId);},
                children:[(index+1)+' · ',row?nameNode(row):'未设']},index);
            })
          ]}):r('div',{class:'talent-results-hint',children:'选择后填入天赋 '+(firstEmpty+1)}),
          targetIndex<0?r('div',{class:'talent-results-hint',children:'请选择一个天赋格'}):null,
          targetIndex>=0&&!results.length?r('div',{class:'talent-results-hint',children:'没有可选的匹配天赋'}):null,
          r('div',{class:'talent-result-list',role:'listbox',id:searchId,'aria-label':title+'筛选结果',children:
            targetIndex>=0?results.map((row,index)=>r('button',{type:'button',role:'option',tabIndex:-1,
              id:searchId+'-'+row.id,class:'talent-result'+(index===activeSearch?' talent-option-active':''),
              'aria-selected':picks[targetIndex]===row.id,'aria-label':qualityLabel(row),
              onMouseDown:event=>event.preventDefault(),onClick:()=>chooseSearch(row),
              children:[nameNode(row,'talent-result-name'),r('span',{class:'muted small',children:row.desc})]},row.id)):[]})
        ]}):null
      ]}),
      r('div',{class:'elder-rows',children:picks.slice(0,visibleCount).map((id,index)=>{
        const chosen=byId.get(id),occupied=occupiedExcept(index),surplus=index>=4;
        const available=rows.filter(row=>(!surplus||row.id===id)&&(row.id===id||matches(row))&&(row.id===id||!occupied.has(rowKey(row))));
        const options=[null,...available],key=group+'-talent-'+index,listId=key+'-options';
        const expanded=talentSlotState.value.key===key;
        const activeIndex=Math.max(0,options.findIndex(row=>(row?.id||0)===talentSlotState.value.active));
        const activeId=options[activeIndex]?.id||0;
        const setActive=next=>{
          talentSlotState.value={key,active:options[next]?.id||0};open.value=false;
          talentReveal(listId+'-'+(options[next]?.id||0));
        };
        const openSlot=()=>setActive(Math.max(0,options.findIndex(row=>(row?.id||0)===id)));
        const chooseSlot=next=>{onPick(index,next);talentCloseSlot();open.value=false;talentFocus(key);};
        const keyDown=event=>{
          if(event.isComposing||event.keyCode===229)return;
          if(event.key==='Escape'){if(expanded)event.preventDefault();talentCloseSlot();return;}
          if(event.key==='Tab'){talentCloseSlot();return;}
          if(event.key==='Enter'||event.key===' '){
            event.preventDefault();if(expanded)chooseSlot(activeId);else openSlot();return;
          }
          let next=activeIndex;
          if(event.key==='Home')next=0;
          else if(event.key==='End')next=options.length-1;
          else if(event.key==='ArrowDown'||event.key==='ArrowUp'){
            if(!expanded){event.preventDefault();openSlot();return;}
            next=Math.min(options.length-1,Math.max(0,next+(event.key==='ArrowDown'?1:-1)));
          }else return;
          event.preventDefault();setActive(next);
        };
        return r('div',{class:'elder-row talent-row',children:[
          r('label',{class:'name',htmlFor:key,children:(surplus?'待清理 ':'天赋 ')+(index+1)}),
          r('div',{class:'talent-select-wrap','data-talent-picker-id':key,onFocusOut:event=>{
            if(!event.currentTarget.contains(event.relatedTarget)&&talentSlotState.value.key===key)talentCloseSlot();
          },children:[
            r('button',{type:'button',id:key,role:'combobox',class:'elder-select talent-select-trigger'+(id?' on':''),
              'aria-label':title+' '+(index+1)+'，'+(chosen?qualityLabel(chosen):'未设'),
              'aria-haspopup':'listbox','aria-expanded':expanded,'aria-controls':listId,
              'aria-activedescendant':expanded?listId+'-'+activeId:undefined,
              onClick:()=>{if(expanded)talentCloseSlot();else openSlot();},onKeyDown:keyDown,
              children:[chosen?nameNode(chosen,'talent-selected-name'):r('span',{class:'talent-selected-name',children:'未设'}),
                r('span',{class:'talent-select-arrow','aria-hidden':true,children:'▾'})]}),
            expanded?r('div',{class:'talent-slot-options',id:listId,role:'listbox','aria-label':title+' '+(index+1)+'可选天赋',
              children:options.map((row,optionIndex)=>{
                const value=row?.id||0;
                return r('button',{type:'button',role:'option',tabIndex:-1,id:listId+'-'+value,
                  class:'talent-result talent-slot-option'+(optionIndex===activeIndex?' talent-option-active':''),
                  'aria-selected':value===id,'aria-label':row?qualityLabel(row):'未设',
                  onMouseDown:event=>event.preventDefault(),onClick:()=>chooseSlot(value),
                  children:row?[nameNode(row,'talent-result-name'),r('span',{class:'muted small',children:row.desc})]:['未设']},value);
              })}):null
          ]}),
          chosen?r('span',{class:'muted small talent-description',children:chosen.desc}):null
        ]},index);
      })})
    ]});
  }
}

function runtimeSource(){
  const text=talentPickerRuntime.toString();
  return text.slice(text.indexOf('{')+1,text.lastIndexOf('}'));
}

function patchTalentPicker({app,change}){
  if(app.includes('/* talent-picker-v1 */'))throw Error('Talent picker already patched');
  const start=app.indexOf('function talentSearchText('),end=app.indexOf('function kl(){',start);
  if(start<0||end<=start)throw Error('Talent picker requires the acquired-talents UI patch');
  return change(app,app.slice(start,end),runtimeSource()+'\n');
}
module.exports=patchTalentPicker;
module.exports.runtimeSource=runtimeSource;

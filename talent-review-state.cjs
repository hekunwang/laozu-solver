'use strict';

// This factory is also injected into the public app with .toString(). All its
// helpers live inside the factory. It never writes settings; the dialog commits
// the complete gear/talent plan once, after explicit confirmation.
function createUnifiedTalentReview({signal,read,recognize,validate,makeController,onChange}) {
  const kinds=[['innate','普通先天天赋'],['acquired','后天天赋']];
  const state=signal({status:'idle',groups:[],lines:[]});
  let generation=0,controller=null;
  function publish(next){state.value=next;onChange?.(next);}
  function reset(status='idle'){
    generation++;controller?.abort();controller=null;
    publish({status,groups:[],lines:[]});
  }
  function changeGroup(kind,update){
    if(state.value.status!=='ready'||!state.value.groups.some(group=>group.kind===kind))return;
    publish({...state.value,groups:state.value.groups.map(group=>group.kind===kind?update(group):group)});
  }
  function validId(kind,id){return Number.isSafeInteger(id)&&id>0&&validate(kind,[id]);}
  function validBox(box){
    return box&&[box.x,box.y,box.width,box.height].every(Number.isFinite)&&box.x>=0&&box.y>=0&&box.width>0&&box.height>0&&box.x+box.width<=1.000001&&box.y+box.height<=1.000001;
  }
  function emptyRegion(kind,existing=[]){
    const base='region:'+kind;let key=base,n=1;while(existing.some(entry=>entry.key===key))key=base+':'+(++n);
    return {key,kind,scope:'region',reason:'incomplete_region',reasonText:'无法定位全部天赋，请补选遗漏项，或确认没有其他天赋。',bbox:null,bboxOrigin:'top-left',candidates:[],allowFullCatalog:true,choice:null,resolved:false};
  }
  function groupsFrom(result){
    if(result?.contextReliable===false||(result?.context!=null&&!['disciple_detail','detail'].includes(result.context)))throw Error('未确认完整弟子详情截图');
    if(!result||!Array.isArray(result.matches)||!Array.isArray(result.unresolved)||kinds.some(([kind])=>typeof result.completeKinds?.[kind]!=='boolean'||typeof result.safeToReplace?.[kind]!=='boolean'))throw Error('天赋识别结果不完整');
    const known=kind=>kinds.some(([value])=>value===kind);
    if(result.matches.some(row=>!row||!known(row.kind)||!Number.isSafeInteger(row.id)||row.id<=0)||result.unresolved.some(row=>!row||!known(row.kind)||typeof row.key!=='string'||!row.key||!['badge','region'].includes(row.scope)))throw Error('天赋识别结果格式异常');
    if(result.contextReliable!==true&&!result.matches.length&&!result.unresolved.length&&kinds.every(([kind])=>!result.completeKinds[kind]))throw Error('未确认完整弟子详情截图');
    return kinds.map(([kind,title])=>{
      const items=result.matches.filter(row=>row.kind===kind).map(row=>({...row,checked:row.defaultSelected!==false}));
      const unresolved=result.unresolved.filter(row=>row.kind===kind).map(row=>{
        const bbox=row.bboxOrigin==='top-left'&&validBox(row.bbox)?{...row.bbox}:null;
        // Without a usable crop we cannot assume that exactly one slot is left.
        const scope=row.scope==='badge'&&!bbox?'region':row.scope;
        return {...row,scope,bbox,bboxOrigin:'top-left',candidates:Array.isArray(row.candidates)?row.candidates.map(entry=>({...entry})):[],allowFullCatalog:true,choice:null,resolved:false};
      });
      if(new Set(unresolved.map(entry=>entry.key)).size!==unresolved.length)throw Error('天赋识别结果含有重复裁决项');
      if((!result.completeKinds[kind]&&!unresolved.some(row=>row.scope==='region'))||(!result.safeToReplace[kind]&&!unresolved.length))unresolved.push(emptyRegion(kind,unresolved));
      return {kind,title,items,include:true,unresolved};
    });
  }
  function plan(){
    const updates={},errors=[],changes={};
    if(state.value.status!=='ready')return {updates,errors,changes};
    const current=read();
    for(const group of state.value.groups){
      if(!group.include)continue;
      const old=[...(current[group.kind]||[])].filter(Boolean);
      const invalid=group.unresolved.find(row=>row.error),pending=group.unresolved.filter(row=>!row.resolved).length;
      if(invalid){errors.push(group.title+'：'+invalid.error);continue;}
      if(pending){errors.push(group.title+'还有'+pending+'项待裁决，请选择天赋、跳过该项或取消此类导入');continue;}
      const badges=group.items.filter(item=>item.checked).map(item=>({id:item.id,order:item.order}));
      const extra=[];
      for(const row of group.unresolved)if(row.choice!=='skip'){
        if(row.scope==='region')extra.push(...row.choice);
        else badges.push({id:row.choice,order:row.order});
      }
      const rank=entry=>Number.isSafeInteger(entry.order)?entry.order:Number.MAX_SAFE_INTEGER;
      const ids=badges.sort((a,b)=>rank(a)-rank(b)).map(entry=>entry.id).concat(extra);
      if(ids.length>4){errors.push(group.title+'超过四项，请调整选择');continue;}
      if(new Set(ids).size!==ids.length){errors.push(group.title+'有重复天赋，请调整选择');continue;}
      if(!ids.every(id=>validId(group.kind,id))||!validate(group.kind,ids)){errors.push(group.title+'含有无效天赋，请调整选择');continue;}
      updates[group.kind]=ids;
      changes[group.kind]={before:old,after:ids,added:ids.filter(id=>!old.includes(id)),removed:old.filter(id=>!ids.includes(id)),clear:!ids.length};
    }
    return {updates:errors.length?{}:updates,errors,changes};
  }
  function choose(kind,key,choice,finish){
    changeGroup(kind,group=>({...group,unresolved:group.unresolved.map(row=>{
      if(row.key!==key||(!finish&&row.scope!=='region'))return row;
      if(choice==null)return {...row,resolved:false,choice:null,error:null};
      if(finish&&choice==='skip')return {...row,resolved:true,choice:'skip',error:null};
      const ids=row.scope==='region'?(Array.isArray(choice)?choice:null):[choice];
      let error=null;
      if(ids&&ids.length>4)error='天赋超过四项，请调整选择';
      else if(!ids||!ids.every(id=>validId(kind,id)))error='请选择本类别的正式天赋';
      else if(new Set(ids).size!==ids.length)error='有重复天赋，请调整选择';
      if(error)return {...row,resolved:false,choice:null,error};
      return {...row,resolved:finish,choice:row.scope==='region'?[...ids]:choice,error:null};
    })}));
  }
  return {
    state,reset,plan,
    skip(){reset('skipped');},
    include(kind,enabled){changeGroup(kind,group=>({...group,include:enabled===true}));},
    item(kind,id,enabled){changeGroup(kind,group=>({...group,items:group.items.map(item=>item.id===id?{...item,checked:enabled===true}:item)}));},
    stageRegion(kind,key,ids){choose(kind,key,ids,false);},
    resolve(kind,key,idOrSkip){choose(kind,key,idOrSkip,true);},
    manual(){
      if(state.value.status!=='error')return false;
      const groups=kinds.map(([kind,title])=>({kind,title,items:[],include:false,unresolved:[emptyRegion(kind)]}));
      publish({status:'ready',manual:true,groups,lines:[],warnings:[]});return true;
    },
    start(file,options={}){
      reset();const current=generation,ownController=makeController();controller=ownController;
      publish({status:'pending',groups:[],lines:[]});
      return Promise.resolve().then(()=>generation===current?recognize(file,ownController?.signal,options):null).then(result=>{
        if(generation!==current)return;
        const groups=groupsFrom(result);
        controller=null;publish({status:'ready',manual:false,groups,lines:Array.isArray(result.lines)?result.lines:[],warnings:Array.isArray(result.warnings)?result.warnings:[]});
      }).catch(error=>{
        if(generation!==current)return;
        controller=null;publish({status:'error',groups:[],lines:[],message:error?.message||'识别失败'});
      });
    }
  };
}
module.exports={createUnifiedTalentReview};

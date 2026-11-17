'use strict';

// These functions are embedded into the application lexical scope. They do not
// read or write game state, and impose no red-equipment composition limits.
function stateUiClone(value) { return JSON.parse(JSON.stringify(value)); }
function stateUiFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) stateUiFreeze(item);
    Object.freeze(value);
  }
  return value;
}
function stateUiKeyboardScrollDelta(rect, viewport) {
  if(!viewport?.keyboardOpen||Math.abs((viewport.scale??1)-1)>.02||!Number.isFinite(rect?.top)||!Number.isFinite(rect?.bottom))return 0;
  const top=viewport.top+12,bottom=viewport.top+viewport.height-12;
  if(bottom<=top)return 0;
  if(rect.bottom-rect.top>bottom-top)return rect.top-top;
  if(rect.bottom>bottom)return rect.bottom-bottom;
  if(rect.top<top)return rect.top-top;
  return 0;
}
function stateUiScrollFocusedIntoViewport(target,viewport,doc,win) {
  let remaining=stateUiKeyboardScrollDelta(target.getBoundingClientRect(),viewport);
  if(!remaining)return 0;
  const root=doc.scrollingElement||doc.documentElement;
  let moved=0,usedRoot=false;
  for(let parent=target.parentElement;parent&&Math.abs(remaining)>.5;parent=parent.parentElement){
    const isRoot=parent===root;
    if(!isRoot&&!/auto|scroll|overlay/.test(win.getComputedStyle(parent).overflowY))continue;
    if(parent.scrollHeight<=parent.clientHeight)continue;
    const before=parent.scrollTop;
    parent.scrollTop=Math.max(0,Math.min(parent.scrollHeight-parent.clientHeight,before+remaining));
    const consumed=parent.scrollTop-before;moved+=consumed;remaining-=consumed;
    if(isRoot)usedRoot=true;
  }
  if(!usedRoot&&Math.abs(remaining)>.5&&root){
    const before=root.scrollTop;
    root.scrollTop=Math.max(0,Math.min(root.scrollHeight-root.clientHeight,before+remaining));
    moved+=root.scrollTop-before;
  }
  return moved;
}
function stateUiInstallKeyboardViewport(doc,win) {
  if(!doc?.addEventListener||!win?.visualViewport?.addEventListener||typeof win.requestAnimationFrame!=='function')return null;
  if(win.__laozuKeyboardViewportDispose)return win.__laozuKeyboardViewportDispose;
  const vv=win.visualViewport,html=doc.documentElement;
  let session=null,frame=null,disposed=false;
  const editable=target=>target?.matches?.('input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=color]),textarea,[contenteditable=true]')&&!target.disabled&&!target.readOnly;
  const geometry=()=>{
    // Compare the current layout viewport with the visible viewport, never a
    // historical maximum: desktop resizing/rotation must not resemble a keyboard.
    const normalHeight=Math.max(win.innerHeight||0,html.clientHeight||0,vv.height);
    const keyboardOpen=!!session&&normalHeight-vv.height>Math.max(80,Math.min(120,normalHeight*.25));
    return {keyboardOpen,top:vv.offsetTop||0,height:vv.height,scale:vv.scale||1};
  };
  function update(){
    frame=null;if(disposed)return;
    if(session&&(!session.target.isConnected||doc.activeElement!==session.target))session=null;
    const view=geometry();
    html.classList.toggle('state-ui-keyboard-open',view.keyboardOpen);
    html.style.setProperty('--state-ui-visible-height',view.height+'px');
    html.style.setProperty('--state-ui-visible-top',view.top+'px');
    // A viewport expansion/keyboard dismissal never changes document scroll.
    // A new focus or further keyboard contraction can reveal the caret again.
    if(session&&view.keyboardOpen&&!session.userMoved&&(!session.keyboardSeen||view.height<=session.lastHeight))stateUiScrollFocusedIntoViewport(session.target,view,doc,win);
    if(session){session.keyboardSeen=view.keyboardOpen;session.lastHeight=view.height;}
  }
  function schedule(){if(disposed||frame!==null)return;frame=win.requestAnimationFrame(update);}
  function focus(event){if(editable(event.target)){session={target:event.target,userMoved:false,keyboardSeen:false,lastHeight:vv.height};schedule();}}
  function blur(){session=null;schedule();}
  function userScroll(){if(session)session.userMoved=true;}
  function pointer(event){if(session&&event.target!==session.target&&!session.target.contains?.(event.target))session.userMoved=true;}
  function pagehide(event){if(!event.persisted)dispose();}
  function dispose(){
    if(disposed)return;disposed=true;if(frame!==null)win.cancelAnimationFrame(frame);frame=null;
    doc.removeEventListener('focusin',focus,true);doc.removeEventListener('focusout',blur,true);
    doc.removeEventListener('touchmove',userScroll,true);doc.removeEventListener('wheel',userScroll,true);doc.removeEventListener('pointerdown',pointer,true);
    vv.removeEventListener('resize',schedule);vv.removeEventListener('scroll',schedule);win.removeEventListener('resize',schedule);win.removeEventListener('pagehide',pagehide);
    html.classList.remove('state-ui-keyboard-open');html.style.removeProperty('--state-ui-visible-height');html.style.removeProperty('--state-ui-visible-top');
    if(win.__laozuKeyboardViewportDispose===dispose)delete win.__laozuKeyboardViewportDispose;
  }
  doc.addEventListener('focusin',focus,true);doc.addEventListener('focusout',blur,true);
  doc.addEventListener('touchmove',userScroll,{capture:true,passive:true});doc.addEventListener('wheel',userScroll,{capture:true,passive:true});doc.addEventListener('pointerdown',pointer,true);
  vv.addEventListener('resize',schedule);vv.addEventListener('scroll',schedule);win.addEventListener('resize',schedule);win.addEventListener('pagehide',pagehide);
  win.__laozuKeyboardViewportDispose=dispose;return dispose;
}
function stateUiLayoutErrors(pieces, board, holdings) {
  const errors=[], occupied=new Set(), copies=new Set();
  const counts=new Map((holdings||[]).map(item=>[item.equipId,item.count]));
  const equips=new Map(z.equips.map(item=>[item.id,item]));
  const shapes=new Map(z.shapes.map(item=>[item.id,item]));
  const blocked=new Set(board.blocked||[]), nextCopy=new Map();
  if (!Array.isArray(pieces)||pieces.length>42) return ['摆盘法宝列表格式不正确或超过 42 件'];
  for (const piece of pieces) {
    const eq=equips.get(piece?.equipId), name=eq?.name||String(piece?.equipId);
    if (!eq) { errors.push('摆盘含未知法宝 '+name); continue; }
    if (!Array.isArray(piece.cells)||!piece.cells.length||piece.cells.length>42) { errors.push(name+' 没有有效占格或超过 42 格'); continue; }
    const validCells=piece.cells.every(cell=>Number.isInteger(cell)&&cell>=0&&cell<42);
    if (!validCells) { errors.push(name+' 的格位必须是 0–41 的整数'); continue; }
    const minRow=Math.min(...piece.cells.map(cell=>Math.floor(cell/7))), minCol=Math.min(...piece.cells.map(cell=>cell%7));
    const actual=piece.cells.map(cell=>[Math.floor(cell/7)-minRow,cell%7-minCol]).map(cell=>cell.join(',')).sort();
    const shape=shapes.get(eq.shapeId), expected=(shape?.cells||[]).map(cell=>cell.join(',')).sort();
    if (JSON.stringify(actual)!==JSON.stringify(expected)) errors.push(name+' 的占格与固定朝向形状不符');
    for (const cell of piece.cells) {
      if (Math.floor(cell/7)>=board.rows||cell%7>=board.cols) errors.push(name+' 越出当前背包');
      if (blocked.has(cell)) errors.push(name+' 占据未解锁格');
      if (occupied.has(cell)) errors.push(name+' 与其他法宝占格重叠');
      occupied.add(cell);
    }
    const copy=piece.copyIndex??(nextCopy.get(eq.id)||0);nextCopy.set(eq.id,Math.max(nextCopy.get(eq.id)||0,copy+1));
    if (!Number.isInteger(copy)||copy<0||copy>=99||copy>=(counts.get(eq.id)||0)) errors.push(name+' 的单件编号不在持有清单内');
    const key=eq.id+':'+copy;
    if (copies.has(key)) errors.push(name+' 的同一件法宝被重复使用');
    copies.add(key);
    if (piece.awakenLevel!==undefined&&(!Number.isInteger(piece.awakenLevel)||piece.awakenLevel<0||piece.awakenLevel>(AWDB[eq.id]?.maxLevel??0))) errors.push(name+' 的觉醒等级不合法');
  }
  return [...new Set(errors)];
}
// The October editor advertised 99 but actually saved every finite input >= 0,
// rounded down. Retain its usable integers, including when a plan is exported.
function stateUiLegacyWeightTag(weights) {
  const high=Object.entries(weights).filter(([,value])=>value>stateUiWeightLimit);
  return high.length?{legacyHighWeights:Object.fromEntries(high)}:{};
}
function stateUiReadWeights(input, recover, issues) {
  const weights=q0(),known=new Set(Object.keys(weights)),values=input.weightMul;
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const previous=input.legacyHighWeights;
  // Old exported configurations carry these original serializer fields and
  // have no zero-policy marker. A partial, newly supplied object is not one.
  const oldExport=input.zeroWeightPolicy===undefined&&object(input.holdings)&&Array.isArray(input.talentPicks)
    &&typeof input.critRateTouched==='boolean'&&typeof input.budgetMs==='number'&&typeof input.objectiveKind==='string';
  if(previous!==undefined&&(!object(previous)||Object.entries(previous).some(([key,value])=>
    !known.has(key)||!Number.isSafeInteger(value)||value<=stateUiWeightLimit||value!==values?.[key]))){
    if(!recover)throw Error('历史超限权重标记与倍率不符');
    issues?.push('已忽略不匹配的历史权重标记');
  }
  if(values===undefined)return weights;
  if(!object(values)){
    if(!recover)throw Error('权重格式不正确');
    issues?.push('权重表格式异常，已恢复默认倍率 1');
    return weights;
  }
  for(const [key,raw] of Object.entries(values)){
    if(!known.has(key)){
      if(!recover)throw Error('未知权重属性 '+key);
      issues?.push('已忽略未知权重属性 '+key);continue;
    }
    const name=da(Number(key))?.name||key;
    const value=recover&&typeof raw==='number'&&raw>=0?Math.floor(raw):raw;
    if(!Number.isSafeInteger(value)||value<0){
      if(!recover)throw Error('权重倍率必须是 0–9999 的整数');
      issues?.push(name+' 的倍率无效，已恢复为 1');continue;
    }
    if(value>stateUiWeightLimit){
      if(!recover&&!oldExport&&previous?.[key]!==value)throw Error('权重倍率必须是 0–9999 的整数');
      if(previous?.[key]!==value)issues?.push(name+' 的历史倍率 '+value+' 按原值计分');
    }else if(raw!==value)issues?.push(name+' 的小数倍率按旧版规则取整为 '+value);
    weights[key]=value;
  }
  return weights;
}
function stateUiNormalize(input, allowLegacyOverflow=false, weightIssues) {
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  if (!object(input)||input.version!==1) throw Error('配置版本或格式不正确');
  const integer=(key,fallback,min,max)=>{
    if (input[key]===undefined) return fallback;
    if (!Number.isSafeInteger(input[key])||input[key]<min||input[key]>max) throw Error(key+' 必须在 '+min+'–'+max+' 之间');
    return input[key];
  };
  const choice=(key,fallback,values)=>{const value=input[key]??fallback;if(!values.includes(value))throw Error(key+' 无效');return value;};
  const bool=(key,fallback)=>{if(input[key]===undefined)return fallback;if(typeof input[key]!=='boolean')throw Error(key+' 必须为布尔值');return input[key];};
  const equips=new Map(z.equips.map(item=>[item.id,item]));
  if (input.holdings!==undefined&&!object(input.holdings)) throw Error('持有清单格式不正确');
  const holdings={};
  for (const [key,count] of Object.entries(input.holdings||{})) {
    if (!equips.has(Number(key))) throw Error('持有清单含未知法宝 '+key);
    if (!Number.isInteger(count)||count<0||count>99) throw Error('每种法宝数量必须是 0–99 的整数');
    if(count)holdings[key]=count;
  }
  const boardRows=integer('boardRows',6,1,6),boardCols=integer('boardCols',7,1,7);
  if(input.blockedCells!==undefined&&!Array.isArray(input.blockedCells))throw Error('未解锁格格式不正确');
  const blockedCells=[...new Set(input.blockedCells||[])];
  if(blockedCells.some(cell=>!Number.isInteger(cell)||cell<0||cell>=42))throw Error('未解锁格必须是 0–41 的整数');
  const critRatePct=input.critRatePct??35;
  if(!Number.isFinite(critRatePct)||critRatePct<0||critRatePct>100)throw Error('基础暴击率必须在 0–100% 之间');
  const weightedMode=choice('weightedMode','linear',['linear','product']);
  const productBaseCritMultiplier=input.productBaseCritMultiplier===undefined?(weightedMode==='product'?1:2):input.productBaseCritMultiplier;
  laozuCalcProductBaseCritMultiplier({productBaseCritMultiplier});
  const weightMul=stateUiReadWeights(input,allowLegacyOverflow,weightIssues);
  const picks=(key,normal,label)=>{
    const value=input[key]??[0,0,0,0];
    if(!Array.isArray(value)||value.length>193||(!allowLegacyOverflow&&value.slice(4).some(Boolean)))throw Error(label+'最多四项；旧档多余项需先清理');
    if(value.some(id=>!Number.isInteger(id)||id<0))throw Error(label+'格式不正确');
    const normalized=normal(value);
    if(value.some((id,index)=>id!==(normalized[index]||0)))throw Error(label+'含未知或重复词条');
    return normalized;
  };
  const talentPicks=picks('talentPicks',ar,'先天天赋'),acquiredTalentPicks=picks('acquiredTalentPicks',acValidate,'后天天赋');
  if(input.elderStars!==undefined&&!object(input.elderStars))throw Error('长老星级格式不正确');
  const elderStars={};
  for(const [key,value] of Object.entries(input.elderStars||{})){
    if(equips.get(Number(key))?.quality!==5||!Number.isInteger(value)||value<0||value>5)throw Error('长老星级无效：'+key);
    if(value)elderStars[key]=value;
  }
  if(input.awaken!==undefined&&!object(input.awaken))throw Error('觉醒配置格式不正确');
  for(const [key,entry] of Object.entries(input.awaken||{})){
    const max=AWDB[key]?.maxLevel;
    if(max===undefined)throw Error('未知觉醒法宝 '+key);
    const levels=Array.isArray(entry)?entry:[entry];
    if(levels.length>99||levels.some(level=>!Number.isInteger(level)||level<0||level>max))throw Error('觉醒等级无效：'+key);
    if(Array.isArray(entry)&&levels.length>(holdings[key]||0))throw Error('觉醒实例超过持有数量：'+key);
  }
  const awaken=awRestore(input.awaken,holdings);
  let currentLayout=null;
  if(input.currentLayout!==undefined&&input.currentLayout!==null){
    const layout=input.currentLayout;
    if(!object(layout)||!Array.isArray(layout.pieces))throw Error('当前摆盘格式不正确');
    // Automatically restored/named configurations may retain a historical
    // screenshot after inventory or board edits. Validate its own geometry and
    // identities without mistaking that comparison baseline for current stock.
    // Explicit cross-address import remains strict against the supplied state.
    const baselineCounts=new Map();
    for(const piece of layout.pieces){const count=baselineCounts.get(piece?.equipId)||0;baselineCounts.set(piece?.equipId,Math.max(count,(piece?.copyIndex??count)+1));}
    const layoutBoard=allowLegacyOverflow?{rows:6,cols:7,blocked:[]}:{rows:boardRows,cols:boardCols,blocked:blockedCells};
    const layoutHoldings=allowLegacyOverflow?[...baselineCounts].map(([equipId,count])=>({equipId,count})):Object.entries(holdings).map(([id,count])=>({equipId:Number(id),count}));
    const errors=stateUiLayoutErrors(layout.pieces,layoutBoard,layoutHoldings);
    if(errors.length)throw Error(errors.join('；'));
    if(layout.missing!==undefined&&(!Number.isInteger(layout.missing)||layout.missing<0))throw Error('未识别件数无效');
    if(layout.unexplainedCells!==undefined&&(!Array.isArray(layout.unexplainedCells)||layout.unexplainedCells.some(cell=>!Number.isInteger(cell)||cell<0||cell>=42)))throw Error('待核对格位无效');
    currentLayout=rr(stateUiClone(layout));
  }
  return {version:1,holdings,boardRows,boardCols,blockedCells:blockedCells.sort((a,b)=>a-b),critRatePct,
    critRateTouched:bool('critRateTouched',false),weightMul,...stateUiLegacyWeightTag(weightMul),objectiveKind:choice('objectiveKind','power',['power','weighted']),
    weightedMode,productBaseCritMultiplier,fillFirst:bool('fillFirst',false),
    budgetMs:integer('budgetMs',20000,500,120000),budgetPresetVersion:1,seed:integer('seed',1,Number.MIN_SAFE_INTEGER,Number.MAX_SAFE_INTEGER),
    elementFilter:integer('elementFilter',1,1,8),threads:integer('threads',St(),1,15),currentLayout,elderStars,awaken,talentPicks,acquiredTalentPicks,
    zeroWeightPolicy:choice('zeroWeightPolicy','legacy-minimum',['zero','legacy-minimum'])};
}
function stateUiConfigurationKey() { return Ea.value; }
function stateUiCancelSolve(reason='已取消本次计算，未采用结果', clearResult=false) {
  if(!stateUiReady)return;
  stateUiGeneration++;
  const handle=r1;r1=null;stateUiRun=null;
  if(handle){try{if(typeof handle.cancel==='function')handle.cancel();else handle.stop();}catch{}}
  be.value=false;Ce.value=null;B1.value=null;s1.value=null;g1.value=null;
  if(clearResult){pe.value=null;t1.value=null;I0.value=[];Bt.value={};ye.value=[];e0.value=false;}
  else {if(pe.value)e0.value=Na!==stateUiConfigurationKey();if(handle)ye.value=[...ye.value,reason];}
}
// Web Storage setItem is atomic per key. Verify a byte-for-byte recovery copy
// before replacing the source and never reuse a key holding a different copy.
function stateUiBackupStored(key,raw) {
  if(localStorage.getItem(key)!==raw)throw Error('存档已在其他页面更改，请重新载入');
  const base=key+':recovery-original';
  for(let index=0;;index++){
    const backup=index?base+':'+index:base,previous=localStorage.getItem(backup);
    if(previous===raw)return;
    if(previous!==null)continue;
    localStorage.setItem(backup,raw);
    if(localStorage.getItem(backup)!==raw)throw Error('原始存档备份未能验证');
    return;
  }
}
function stateUiWriteCurrent(remove=false) {
  if(stateUiRestoreBlocked)return false;
  try{
    if(stateUiStoredOriginal!==null)stateUiBackupStored(A1,stateUiStoredOriginal);
    if(remove)localStorage.removeItem(A1);else localStorage.setItem(A1,JSON.stringify(fa()));
    stateUiStoredOriginal=null;Ve.value=true;stateUiSaveError.value='';return true;
  }catch(error){
    Ve.value=false;stateUiSaveError.value='当前更改尚未保存：'+(error?.message||error?.name||'存储写入失败')+'。旧存档保留，可重试或导出当前配置。';return false;
  }
}
function stateUiRestoreCurrent() {
  let raw;
  try{raw=localStorage.getItem(A1);}
  catch{stateUiRestoreBlocked=true;Ve.value=false;stateUiSaveError.value='旧存档无法读取，已暂停写入。';return false;}
  try{localStorage.setItem(A1+':probe','1');localStorage.removeItem(A1+':probe');Ve.value=true;}catch{Ve.value=false;}
  if(raw===null){stateUiRestoreBlocked=false;stateUiStoredOriginal=null;stateUiSaveError.value='';return true;}
  try{
    const saved=JSON.parse(raw);
    stateUiLoad(saved);
    if(saved.budgetPresetVersion!==1)He.value=20000;
    // Migration stays in memory until the next user save.
    stateUiStoredOriginal=saved.zeroWeightPolicy===undefined||stateUiWeightNotice.value?raw:null;
    stateUiRestoreBlocked=false;stateUiSaveError.value='';return true;
  }catch(error){
    stateUiStoredOriginal=raw;stateUiRestoreBlocked=true;
    stateUiSaveError.value='旧存档未载入：'+error.message+'。已保留原文，暂停写入。';return false;
  }
}
function stateUiWritePlans(next) {
  try{
    const raw=localStorage.getItem(ba);
    if(raw!==null){
      let stored;try{stored=JSON.parse(raw);}catch{}
      const byName=new Map(next.map(plan=>[plan.name,plan]));
      const needsBackup=!Array.isArray(stored)||stored.some(plan=>{
        if(!plan||typeof plan.name!=='string'||plan.state?.version!==Ft)return true;
        if(JSON.stringify(plan.state)===JSON.stringify(byName.get(plan.name)?.state))return false;
        const issues=[];stateUiReadWeights(plan.state,true,issues);
        return plan.state.zeroWeightPolicy===undefined||issues.length>0;
      });
      if(needsBackup)stateUiBackupStored(ba,raw);
    }
    localStorage.setItem(ba,JSON.stringify(next));f1.value=next;
  }catch(error){alert('方案未保存：'+(error?.message||'存储写入失败')+'。原方案保留。');}
}
function stateUiSave() {
  if(stateUiReady){
    const key=stateUiConfigurationKey();
    if(stateUiRun&&stateUiRun.key!==key)stateUiCancelSolve('配置已更改，本次计算已取消；请重新开始');
    if(pe.value)e0.value=Na!==key;
  }
  return stateUiWriteCurrent();
}
function stateUiLoad(input,strict=false) {
  const issues=[],normalized=stateUiNormalize(input,!strict,issues);
  if(stateUiReady)stateUiCancelSolve('已载入另一份配置，本次计算已取消');
  stateUiApplyNormalized(normalized);stateUiZeroWeightPolicy.value=normalized.zeroWeightPolicy;
  stateUiProductBaseCritMultiplier.value=normalized.productBaseCritMultiplier;
  stateUiWeightNotice.value=issues.join('；');
  if(stateUiReady&&stateUiStoredOriginal!==null)stateUiRestoreBlocked=false;
  if(stateUiReady&&pe.value)e0.value=Na!==stateUiConfigurationKey();
  return stateUiClone(normalized);
}
function stateUiImport(input) { const state=stateUiLoad(input,true);return {state,saved:stateUiSave()}; }
function stateUiSourceRows(eq,piece,options,stars,attrName) {
  const rows=[],add=(kind,name,attr,value)=>{if(value)rows.push({kind,attr,attrName:attrName(attr),value,skillName:name,skillDesc:'对本件基础属性生效',fromName:name});};
  for(const attr of [2001,2002,2003])add('star',eq.elder?.name?'长老星级 · '+eq.elder.name:'长老星级',attr,_t(eq,stars)*de);
  const level=awPieceLevel(piece,options);
  for(const [attr,value] of Object.entries(awEffects(eq,level).baseBonus))add('awakening','本件觉醒 '+level,Number(attr),value);
  const acquired=acMergeBase({},options.acquiredTalentPicks);
  const innate=(options.innateTalentPicks||[]).map(id=>z.talents.find(row=>row.id===id)).filter(row=>row&&row.form===eq.weaponForm);
  if(innate.length){for(const row of innate)add('innate',row.name,({2004:2001,2005:2002,2006:2003})[row.attr],row.value);}
  else for(const attr of [2001,2002,2003])add('innate','先天天赋',attr,(options.talents?.[eq.weaponForm]?.[attr]||0)-(acquired[eq.weaponForm]?.[attr]||0));
  for(const row of acRows(options.acquiredTalentPicks))if((row.forms||[]).includes(eq.weaponForm))for(const effect of row.equipBaseEffects||[])add('acquired-base',row.name,({2004:2001,2005:2002,2006:2003})[effect.attr],effect.value);
  return rows;
}
function stateUiSourceText(source) {
  const labels={star:'长老星级',awakening:'觉醒基础加成',innate:'先天天赋','acquired-base':'后天天赋',acquired:'后天天赋',aura:'背包光环',neighbor:'相邻法宝'};
  if(source.kind==='self')return '本件技能「'+source.skillName+'」：每件 +'+_1(source.perUnit||0)+' × '+(source.matchedNames?.length||0)+' 件相邻（'+(source.matchedNames||[]).join('、')+'）';
  return (labels[source.kind]||'法宝效果')+' · '+(source.fromName||'')+'「'+source.skillName+'」';
}
function stateUiCompactBuffRows(eq) {
  // Keep the published compact preview and click-to-expand description. Like
  // the selected-list base stats, its preview follows the first owned copy;
  // full per-instance effects remain in the solve result's source details.
  const level=awLevel({awaken:Aw.value},eq.id,0);
  return awSkills(eq,level).flatMap(id=>{const skill=kr.get(id);return skill?_r(skill):[];});
}
function stateUiModelControls() {
  const legacy=stateUiZeroWeightPolicy.value==='legacy-minimum';
  return r('div',{class:'state-ui-model-controls',children:[
    r('p',{class:legacy?'warn small':'muted small',children:legacy?'此旧方案沿用旧口径：倍率 0 仍按 1% 权重计价。可主动转换，转换会改变结果。':'倍率 0 表示该项权重为零；填满要求请使用“强制填满背包”。'}),
    legacy?r('button',{type:'button',onClick:()=>{stateUiZeroWeightPolicy.value='zero';K();},children:'将此方案转换为真正零权重'}):null
  ]});
}
function stateUiPersistencePanel() {
  const failed=!Ve.value||!!stateUiSaveError.value,notice=stateUiWeightNotice.value;
  if(!failed&&!notice)return null;
  return r('div',{class:'state-ui-persistence warn small',role:'status',children:[notice,failed&&(stateUiSaveError.value||'当前配置尚未保存。'),
    failed&&r('button',{type:'button',onClick:()=>stateUiRestoreBlocked?stateUiRestoreCurrent():stateUiSave(),children:stateUiRestoreBlocked?'重新读取存档':'重试保存'}),
    failed&&r('button',{type:'button',onClick:()=>{if(typeof window.openTalentTransfer==='function')window.openTalentTransfer();else alert(JSON.stringify({format:'laozu-current-config-v1',state:fa()}));},children:'显示并导出当前配置'})]});
}
function stateUiResultNotice() {
  return e0.value?r('p',{class:'state-ui-result-stale warn',role:'status',children:'此结果使用上次计算的配置快照，已与当前输入不同；得分与明细保留原口径，暂停实时对照，请重新计算。'}):null;
}
function stateUiBoardOptions(best) { return best?.objectiveSnapshot||stateUiRun?.request.objective||We.value; }
function stateUiStartSolve() {
  if(be.value||at.value)return;
  let request;
  try {
    // A previous screenshot is a comparison baseline and may legitimately be
    // stale after inventory edits. It is independently checked as an incumbent.
    stateUiNormalize({...fa(),currentLayout:null});
    request=stateUiFreeze(stateUiClone(awPrepareIncumbentRequest({holdings:Te.value,board:c0.value,objective:We.value,budgetMs:He.value,seed:Xe.value},Ae.value,pe.value,Na===Ea.value)));
  }catch(error){ye.value=[...ye.value,'无法开始计算：'+error.message];return;}
  const generation=++stateUiGeneration,key=stateUiConfigurationKey();
  stateUiRun={generation,key,request};be.value=true;Ce.value=null;B1.value=null;g1.value=null;s1.value=null;I0.value=[];Be.value='layout';
  const current=()=>generation===stateUiGeneration&&stateUiRun?.generation===generation;
  const fillFirst=(request.objective.fillBonus??0)>0,usableCells=la(request.board);
  ye.value=['开始计算：'+request.holdings.reduce((sum,row)=>sum+row.count,0)+' 件候选 · 可用格 '+usableCells+' · 口径 '+(request.objective.kind==='power'?'战力':'自定义权重')+' · 预算 '+request.budgetMs/1000+' 秒 · 种子 '+request.seed];
  let lastScore=-Infinity,lastFilled=0,handle;
  const failure=error=>{if(!current())return;if(error?.name!=='AbortError')ye.value=[...ye.value,'计算失败：'+(error?.message||String(error))];};
  try {
    handle=Vn(z,request,{threads:c1.value,onProgress:progress=>{
      if(!current())return;
      Ce.value=progress;
      if(progress.best)B1.value={...progress.best,objectiveSnapshot:request.objective};
      if(progress.best&&u0(fillFirst,progress.best.filledCells,Math.round(progress.bestScore),lastFilled,Math.round(lastScore))){
        const filled=progress.best.filledCells,occupiedImprovement=fillFirst&&filled>lastFilled&&Math.round(progress.bestScore)<=Math.round(lastScore),thread=(progress.thread??0)+1;
        ye.value=[...ye.value,occupiedImprovement
          ?'['+(progress.elapsedMs/1000).toFixed(1)+'s] 占格提升（线程 '+thread+'）：'+lastFilled+'/'+usableCells+' → '+filled+'/'+usableCells+'，总分 '+Re(progress.bestScore)+'（较此前最优 '+Re(progress.bestScore-lastScore)+'，按「强制填满」取占格更多的方案）'
          :'['+(progress.elapsedMs/1000).toFixed(1)+'s] 新最优（线程 '+thread+'）：总分 '+Re(progress.bestScore)+'（攻 '+Re(progress.best.atk)+' / 防 '+Re(progress.best.def)+' / 血 '+Re(progress.best.hp)+'），占格 '+filled+'/'+usableCells];
        lastScore=progress.bestScore;lastFilled=filled;
      }
    }});
    r1=handle;
    Promise.resolve(handle.info).then(info=>{
      if(!current())return;Fl.value=info;
      ye.value=[...ye.value,info.mode==='worker'?'求解在 '+info.threads+' 个 Worker 线程中并行进行，各线程种子不同、取最优':'当前环境不支持 Worker，已回退主线程分片执行'];
    }).catch(()=>{});
    Promise.resolve(handle.promise).then(result=>{
      if(!current())return;
      if(!result||!Number.isFinite(result.score)||!Array.isArray(result.pieces))throw Error('求解器未返回有效结果');
      const errors=Jn(result.pieces,request.board,request.holdings);
      if(errors.length)throw Error('结果未通过合法性校验：'+errors.join('；'));
      const detail=Q1(z,result.pieces,request.objective),actual=request.objective.kind==='power'?detail.powerTotal:detail.weightedTotal;
      if(Math.abs(actual-result.score)>1e-6*Math.max(1,Math.abs(actual)))throw Error('结果分数与请求快照复算不一致');
      const completed={...result,score:actual,objectiveSnapshot:request.objective,requestSnapshot:request};
      awRememberIncumbent(request,completed);pe.value=completed;t1.value=detail;B1.value=null;I0.value=[];
      const counts={};for(const piece of completed.pieces)counts[piece.equipId]=(counts[piece.equipId]||0)+1;Bt.value=counts;
      Na=key;e0.value=key!==stateUiConfigurationKey();
      const completion=completed.warning?'计算结束，保留有效结果':completed.stopped?'已手动中断，返回当前最优':'已达耗时上限，自动停止';
      ye.value=[...ye.value,completion,...(completed.warning?[completed.warning]:[]),'最终解：总分 '+Re(actual)+'，共 '+completed.pieces.length+' 件，占格 '+completed.filledCells+'/'+completed.usableCells+'，累计迭代 '+completed.iterations.toLocaleString('zh-CN')+' 次'];
      be.value=false;awShowCompletedLayout(completed);
    }).catch(failure).finally(()=>{if(current()){be.value=false;Ce.value=null;B1.value=null;r1=null;stateUiRun=null;}});
  }catch(error){failure(error);if(current()){be.value=false;Ce.value=null;B1.value=null;r1=null;stateUiRun=null;}}
}

module.exports=function patchStateUiSafety({app,change}) {
  if(app.includes('/* state-ui-safety-v1 */'))return app;
  const functions=[stateUiClone,stateUiFreeze,stateUiKeyboardScrollDelta,stateUiScrollFocusedIntoViewport,stateUiInstallKeyboardViewport,stateUiLayoutErrors,stateUiLegacyWeightTag,stateUiReadWeights,stateUiNormalize,stateUiConfigurationKey,stateUiCancelSolve,stateUiBackupStored,stateUiWriteCurrent,stateUiRestoreCurrent,stateUiWritePlans,stateUiSave,stateUiLoad,stateUiImport,stateUiSourceRows,stateUiSourceText,stateUiCompactBuffRows,stateUiModelControls,stateUiPersistencePanel,stateUiResultNotice,stateUiBoardOptions,stateUiStartSolve];
  const runtime='/* state-ui-safety-v1 */\nlet stateUiReady=false,stateUiGeneration=0,stateUiRun=null,stateUiStoredOriginal=null,stateUiRestoreBlocked=false;\nconst stateUiWeightLimit=9999,stateUiZeroWeightPolicy=C("zero"),stateUiProductBaseCritMultiplier=C(2),stateUiSaveError=C(""),stateUiWeightNotice=C("");\n'+functions.map(fn=>fn.toString()).join('\n')+'\n';
  app=change(app,'const z=',runtime+'const z=');
  app=change(app,'awaken:Aw.value,acquiredTalentPicks:Ac.value,talentPicks:De.value','awaken:Aw.value,acquiredTalentPicks:Ac.value,talentPicks:De.value,zeroWeightPolicy:stateUiZeroWeightPolicy.value,productBaseCritMultiplier:stateUiProductBaseCritMultiplier.value');
  app=change(app,'weightMul:Ye.value,objectiveKind:ie.value','weightMul:Ye.value,...stateUiLegacyWeightTag(Ye.value),objectiveKind:ie.value');
  app=change(app,'talents:s,awaken:Aw.value,acquiredTalentPicks:Ac.value}', 'talents:s,awaken:Aw.value,acquiredTalentPicks:Ac.value,innateTalentPicks:De.value.slice(0,4),zeroWeightPolicy:stateUiZeroWeightPolicy.value,productBaseCritMultiplier:stateUiProductBaseCritMultiplier.value}',2);
  app=change(app,'ua(a)*ca(Ye.value[a])','ua(a)*ca(Ye.value[a],stateUiZeroWeightPolicy.value)');
  app=change(app,'as(s*ca(a))','as(s*ca(a,stateUiZeroWeightPolicy.value))');
  const range=(start,end,replace)=>{const a=app.indexOf(start),b=app.indexOf(end,a);if(a<0||b<a)throw Error('State UI anchor missing: '+start);app=change(app,app.slice(a,b),replace(app.slice(a,b)));};
  range('K=()=>{if(Ve.value)',',sr=',()=> 'K=()=>stateUiSave()');
  range('sr=()=>{',',Ia=',()=> 'sr=stateUiRestoreCurrent');
  range('Ia=t=>{',',ga=new Set',original=>'Ia=t=>stateUiLoad(t),stateUiApplyNormalized='+original.slice('Ia='.length));
  range('ya=t=>{f1.value=t;',',mr=',()=> 'ya=stateUiWritePlans');
  app=change(app,'lr=()=>{ae.value={}','lr=()=>{stateUiCancelSolve("已清空全部输入",true);stateUiZeroWeightPolicy.value="zero";stateUiProductBaseCritMultiplier.value=2;ae.value={}');
  app=change(app,'try{localStorage.removeItem(A1)}catch{}},E0=', 'stateUiWeightNotice.value="";stateUiWriteCurrent(true)},E0=');
  app=change(app,'E0=(t,e)=>{const s={...ae.value};','E0=(t,e)=>{if(!xt.has(t)||!Number.isFinite(e))return;e=Math.max(0,Math.min(99,Math.floor(e)));const s={...ae.value};');
  app=change(app,'or=(t,e)=>{if(t===e)return;','or=(t,e)=>{if(t===e||!xt.has(t)||!xt.has(e))return;if((ae.value[t]||0)+(ae.value[e]||0)>99){alert("合并后的持有数量超过 99，请先调整数量。");return;}');
  app=change(app,'vr=t=>{const e=f1.value.find(s=>s.name===t);e&&(Ia(e.state),K())}', 'vr=t=>{const e=f1.value.find(s=>s.name===t);if(e)try{Ia(e.state);K();}catch(error){alert("方案未载入："+error.message);}}');
  app=change(app,'const usedCopies=new Set;for(const piece of t)', 'a.push(...stateUiLayoutErrors(t,e,s));const usedCopies=new Set;for(const piece of t)');
  range('Ts=()=>{',';\nfunction awShowCompletedLayout',()=> 'Ts=()=>stateUiStartSolve()');
  app=change(app,'id:"board",children:[r("h2"','id:"board",children:[r(stateUiResultNotice,{}),r("h2"');
  app=change(app,'!Ve.value&&r("p",{class:"warn small",children:"当前浏览器不允许本地存储，本次配置不会被保存。"})','r(stateUiPersistencePanel,{})');
  app=change(app,'const _=Q1(z,t.pieces,We.value),p=ie.value,g=$0.value', 'const _=Q1(z,t.pieces,stateUiBoardOptions(t)),p=stateUiBoardOptions(t).kind,g=(e0.value?"当前输入与计算快照不同":null)||$0.value');
  app=change(app,'k=w?Q1(z,w,We.value):null','k=w?Q1(z,w,stateUiBoardOptions(t)):null');
  app=change(app,'filledCells:t.filledCells}},Ha=', 'filledCells:t.filledCells,objectiveSnapshot:t.objectiveSnapshot}},Ha=');
  app=change(app,'ie.value==="power"?i.powerScore:i.weightedScore','(t.objectiveSnapshot?.kind??ie.value)==="power"?i.powerScore:i.weightedScore');
  app=change(app,'E=s.elderStars?.[b.equipId];for(const row of acRows','E=s.elderStars?.[b.equipId];S.push(...stateUiSourceRows(I,b,s,E,i));for(const row of acRows');
  app=change(app,"kind:'neighbor',skillId:0,skillName:'觉醒光环'","kind:'aura',skillId:0,skillName:'觉醒光环'");
  range('function Cs({equip:t}){','function Ps(',original=>change(original,'const e=Mr(t);','const e=stateUiCompactBuffRows(t);'));
  const sourceStart='i.kind==="self"?r(R,{children:[" ","← 本件技能';
  range(sourceStart,',r("div",{class:"muted small",children:i.skillDesc})',()=> 'r("span",{children:" ← "+stateUiSourceText(i)})');
  app=change(app,'这件法宝没有收到任何加成——旁边没有能与它联动的同系法宝。','这件法宝当前没有适用的静态属性加成。法宝技能伤害和弟子全局效果不计入模型分。');
  app=change(app,'children:"方案属性汇总"','children:"各件法宝属性之和"');
  app=change(app,'children:"逐件贡献"','children:"逐件贡献（高级百分比仅对该件生效）"');
  app=change(app,'件因低阶被同名高阶完全支配而未参与求解','件为超出盘面容量的等价副本，未参与求解');
  app=change(app,'children:"得分与三围汇总见上方「背包摆盘」面板的得分区；这里是逐件核对用的明细。"','children:"得分与明细使用同一计算快照。下面高级百分比是各件效果之和，不是弟子总暴击率，也不会把总和加到每件法宝。"');
  app=change(app,'曲线走平说明再加时间收益有限；仍在上升说明值得调大预算或线程数重跑。','曲线记录真实目标分数。强制填满时先比较占格数，因此占格增加可伴随分数下降；曲线走平不构成最优性证明。');
  app=change(app,'填满与不填满的分差通常很小，想让盘面看着整齐可以放心勾。','优先填满可能明显降低属性分；请按是否需要占满全部可用格选择。');
  app=change(app,'t&&r(R,{children:[r("table",{class:"tbl weights"','t&&r(R,{children:[r(stateUiModelControls,{}),r("table",{class:"tbl weights"');
  app=change(app,'min:0,max:99,step:1,disabled:s===0||n','min:0,max:stateUiWeightLimit,step:1,disabled:s===0||n');
  app=change(app,'Number.isFinite(i)&&i>=0&&(Ye.value={...Ye.value,[e]:Math.floor(i)},K())','Number.isFinite(i)&&i>=0&&(Ye.value={...Ye.value,[e]:Math.min(stateUiWeightLimit,Math.floor(i))},stateUiWeightNotice.value="",K())');
  app=change(app,'r("select",{value:String(He.value),onChange:', 'r("select",{"aria-label":"求解时间",value:String(He.value),onChange:');
  app=change(app,'type:"number",min:1,max:K1,value:c1.value', 'type:"number","aria-label":"计算线程数",min:1,max:K1,value:c1.value');
  app=change(app,'type:"number",value:Xe.value,onInput:', 'type:"number","aria-label":"随机种子",value:Xe.value,onInput:');
  app=change(app,'"几倍看重这项；0 = 几乎不关心（仍保留 1% 用于打破平局）"','a>stateUiWeightLimit?"历史倍率仍按原值计分，编辑上限为 9999":stateUiZeroWeightPolicy.value==="legacy-minimum"?"倍率 0–9999，旧口径下 0 仍保留 1% 权重":"倍率 0–9999，0 表示零权重"');
  range('r(v0,{children:["基础系数是游戏自带的定价',']}),r("label",{class:"chk"',()=> 'r(v0,{children:"基础系数来自游戏配置；实际权重为基础系数乘倍率。倍率允许 0–9999，零权重行为以上方方案口径为准。"})');
  app=change(app,'const Dl=(t,e)=>',`stateUiReady=true;\nif(typeof document!=="undefined"&&typeof window!=="undefined"&&typeof window.requestAnimationFrame==="function")stateUiInstallKeyboardViewport(document,window);\nObject.assign(window.laozuLocal,{validateState:state=>stateUiNormalize(state),importState:stateUiImport,retrySave:stateUiSave,cancelSolve:stateUiCancelSolve,zeroWeightPolicy:stateUiZeroWeightPolicy,persistenceError:stateUiSaveError,solve:stateUiStartSolve});\nconst Dl=(t,e)=>`);
  return app;
};
module.exports.layoutErrorsSource=stateUiLayoutErrors.toString();
module.exports.keyboardViewport={stateUiKeyboardScrollDelta,stateUiScrollFocusedIntoViewport,stateUiInstallKeyboardViewport};

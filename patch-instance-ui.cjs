'use strict';

module.exports=function patchInstanceUI({app,change}){
  app=change(app,'Aw.value=awValidate(t.awaken)','Aw.value=awRestore(t.awaken,ae.value)');
  app=change(app,'e>0?s[t]=e:delete s[t],ae.value=s,K()',
    'e>0?s[t]=e:delete s[t],ae.value=s,Aw.value=awRestore(Aw.value,s),K()');
  app=change(app,'ir=()=>{ae.value={},Bt.value={},K()}',
    'ir=()=>{ae.value={},Aw.value={},Bt.value={},K()}');
  app=change(app,'ae.value=s,e&&(Ae.value=e),K()',
    'ae.value=s,Aw.value=awRestore(Aw.value,s),e&&(Ae.value=e),K()');

  const start=app.indexOf('function bl(){'),end=app.indexOf('window.laozuLocal=',start);
  if(start<0||end<0)throw new Error('Awakening UI boundary missing');
  const panel=`
function awSetCopy(id,copy,level){const normalized=awRestore(Aw.value,ae.value),items=normalized[id]||[];if(copy<0||copy>=items.length)return;items[copy]=level;Aw.value=awValidate(normalized);K();}
function awLevelForPiece(piece){return awPieceLevel(piece,{awaken:Aw.value});}
function awMetadata(piece,fallbackCopy=0){const out={copyIndex:Number.isInteger(piece.copyIndex)?piece.copyIndex:fallbackCopy};if(Number.isInteger(piece.awakenLevel))out.awakenLevel=piece.awakenLevel;return out;}
function bl(){
  const levels=Aw.value,items=wl().filter(eq=>AWDB[eq.id]);
  return r(R,{children:[r(blOriginal,{}),r('h3',{children:'法宝觉醒 · 每件单独设置'}),
    items.length?r('div',{class:'elder-rows',children:items.flatMap(eq=>Array.from({length:ae.value[eq.id]||0},(_,copy)=>{
      const level=awLevel({awaken:levels},eq.id,copy),data=AWDB[eq.id];
      return r('div',{class:'elder-row',children:[r('span',{class:'name',children:eq.name+' · 第'+(copy+1)+'件'}),
        r('select',{'aria-label':eq.name+'第'+(copy+1)+'件觉醒等级',class:level?'elder-select on':'elder-select',value:String(level),disabled:data.maxLevel===0,onChange:event=>awSetCopy(eq.id,copy,Number(event.target.value)),children:Array.from({length:data.maxLevel+1},(_,lv)=>r('option',{value:String(lv),children:lv?'觉醒 '+lv:'未觉醒'},lv))}),
        r('span',{class:data.maxLevel===0?'warn small':'muted small',children:data.maxLevel===0?'官方快照暂无觉醒配置':level?Array.from({length:level},(_,i)=>'觉醒'+(i+1)+'：'+(data.levels[i+1]?.description||'')).join('；'):'此件未觉醒'})]},eq.id+':'+copy);
    }))}):r('p',{class:'muted small',children:'添加长老红宝后，可逐件选择觉醒等级。'}),
    r(v0,{children:'觉醒三保留觉醒一、二效果；技能升级按官方完整技能列表替换，不重复叠加旧值。同名红宝逐件设置；长老星级仍共享。增加的件默认未觉醒，减少数量时从最后一件移除。已选列表的三围预览以第1件为准，摆盘按每件实际等级计算。形态光环叠加与游戏面板的乘算顺序仍待核对。四、五级尚未开放。'})]});
}
`;
  app=change(app,app.slice(start,end),panel);

  // Preserve identity and level in imported, bookmarked and restored layouts.
  app=change(app,'const e=new Set,s=[];for(const a of t){',
    'const e=new Set,s=[],copies=new Map;for(const a of t){');
  app=change(app,'s.push({equipId:a.equipId,cells:[...a.cells].sort((n,l)=>n-l)})',
    'const copy=a.copyIndex??(copies.get(a.equipId)||0);if(!Number.isInteger(copy)||copy<0||copy>=99)return null;if(a.awakenLevel!==undefined&&(!Number.isInteger(a.awakenLevel)||a.awakenLevel<0||a.awakenLevel>(AWDB[a.equipId]?.maxLevel??0)))return null;copies.set(a.equipId,Math.max(copies.get(a.equipId)||0,copy+1));s.push({equipId:a.equipId,...awMetadata(a,copy),cells:[...a.cells].sort((n,l)=>n-l)})');
  app=change(app,'shapeId:n.shapeId,row:Math.min(...a.cells.map($e))',
    'shapeId:n.shapeId,...awMetadata(a),row:Math.min(...a.cells.map($e))');
  app=change(app,'pieces:e.map(o=>({equipId:o.equipId,cells:[...o.cells].sort((c,u)=>c-u)}))',
    'pieces:e.map(o=>({equipId:o.equipId,...awMetadata(o),awakenLevel:awLevelForPiece(o),cells:[...o.cells].sort((c,u)=>c-u)}))');
  app=change(app,'return a},A1="wydl-bag:v1:state"',
    'const usedCopies=new Set;for(const piece of t){if(piece.copyIndex===undefined)continue;const count=i.get(piece.equipId)||0,key=piece.equipId+":"+piece.copyIndex;if(!Number.isInteger(piece.copyIndex)||piece.copyIndex<0||piece.copyIndex>=count)a.push(piece.name+" 的单件编号不在持有清单内");if(usedCopies.has(key))a.push(piece.name+" 的同一件法宝被重复使用");usedCopies.add(key);}return a},A1="wydl-bag:v1:state"');

  // The element stays at the first cell; awakening is on the bottom-right
  // occupied cell of the whole piece, matching the in-game layout.
  app=change(app,'title:`#${M+1} ${T.name} ${T1(T.tier)} · ${Fe[T.element]}`',
    'title:`#${M+1} ${T.name} ${T1(T.tier)} · ${Fe[T.element]} · 觉醒 ${awLevelForPiece(T)} · 同款第${(T.copyIndex??0)+1}件`');
  app=change(app,'children:N.get(M)===q&&r(R,{children:[r("span",{class:`cell-el el${T.element}`,children:Fe[T.element]}),r("span",{class:"cell-num",children:M+1})]})',
    'children:[N.get(M)===q&&r(R,{children:[r("span",{class:`cell-el el${T.element}`,children:Fe[T.element]}),r("span",{class:"cell-num",children:M+1})]}),Math.max(...T.cells)===q&&awLevelForPiece(T)>0&&r("span",{class:"cell-awaken aw"+awLevelForPiece(T),title:"觉醒 "+awLevelForPiece(T),children:String(awLevelForPiece(T))})]');
  app=change(app,'"#",p+1," ",_.name,r("span",{class:"muted",children:',
    '"#",p+1," ",_.name,awLevelForPiece(_)>0&&r("b",{class:"star-tag",children:"觉"+awLevelForPiece(_)}),r("span",{class:"muted",children:');

  app=change(app,'validateAwaken:awValidate};',
    'validateAwaken:awValidate,effects:awEffects,level:awLevel,pieceLevel:awPieceLevel,candidateBuilder:Sn,snapshot:ia,restoreAwaken:awRestore,validatePieces:wa,restorePieces:pa,bookmark:gr,bookmarks:R1,validateLayout:Jn,holdings:ae};');
  return app;
};

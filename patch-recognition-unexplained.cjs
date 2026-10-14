'use strict';

// Preserve unknown item counts: uncovered equipment-coloured cells are a
// separate warning, not an invented number of missing pieces.
module.exports=function patchRecognitionUnexplained({app}){
  if(app.includes('function screenshotLayoutIncomplete('))return app;
  function replace(from,to){
    if(app.split(from).length!==2)throw new Error('Unexplained-cell patch anchor changed: '+from.slice(0,100));
    app=app.replace(from,()=>to);
  }
  replace('const _=[];for(let p=0;p<o1;p++)for(let g=0;g<$1;g++){const w=X(p,g),q=D.get(w);',
    'const unexplainedCells=[],_=[];for(let p=0;p<o1;p++)for(let g=0;g<$1;g++){const w=X(p,g),q=D.get(w);');
  // Reuse the background sample already taken for uncovered cells. No new
  // pixel scan, shape search, template or grid pass is introduced.
  replace('Math.min(M,T)>Y.bgMaxDistance?E[w]="unknown":T<M?(E[w]="locked",_.push(w)):E[w]="empty"}',
    'Math.min(M,T)>Y.bgMaxDistance?(E[w]="unknown",Math.min(V1(k,R0.q2),V1(k,R0.q3),V1(k,R0.q4),V1(k,R0.q5))<=Y.bgMaxDistance&&unexplainedCells.push(w)):T<M?(E[w]="locked",_.push(w)):E[w]="empty"}');
  replace('return{pieces:I,groups:O,cellStates:E,lockedCells:_,redViolation:S,grid:s}',
    'return{pieces:I,groups:O,cellStates:E,unexplainedCells,lockedCells:_,redViolation:S,grid:s}');
  replace('const Tt=t=>{',`function screenshotLayoutIncomplete(layout){return (layout?.missing??0)>0||(layout?.unexplainedCells?.length??0)>0;}
function screenshotLayoutWarning(layout){
  const parts=[];
  if((layout?.missing??0)>0)parts.push('缺 '+layout.missing+' 件');
  if(layout?.unexplainedCells?.length)parts.push(layout.unexplainedCells.length+' 格疑似漏识别，件数未知');
  return '不完整（'+parts.join('；')+'）';
}
const Tt=t=>{`);
  replace('layout:{pieces:a,missing:n.length+l,savedAt:',
    'unexplainedCells:t.unexplainedCells??[],layout:{pieces:a,missing:n.length+l,...(t.unexplainedCells?.length?{unexplainedCells:[...t.unexplainedCells]}:{}),savedAt:');
  replace('return{pieces:e,missing:s,savedAt:typeof t.savedAt=="string"?t.savedAt:""}',
    'return{pieces:e,missing:s,...(Array.isArray(t.unexplainedCells)&&t.unexplainedCells.some(c=>Number.isInteger(c)&&c>=0&&c<42)?{unexplainedCells:[...new Set(t.unexplainedCells.filter(c=>Number.isInteger(c)&&c>=0&&c<42))].sort((a,b)=>a-b)}:{}),savedAt:typeof t.savedAt=="string"?t.savedAt:""}');
  replace('I=(Ae.value?.missing??0)===0','I=!screenshotLayoutIncomplete(Ae.value)');
  replace('P=(q?.missing??0)===0','P=!screenshotLayoutIncomplete(q)');
  replace('children:[" ","· 不完整（缺 ",Ae.value.missing," 件），得分仅供参考"]',
    'children:[" · ",screenshotLayoutWarning(Ae.value),"，得分仅供参考"]');
  replace('`基准缺 ${q.missing} 件，仅供参考`','`基准${screenshotLayoutWarning(q)}，仅供参考`');
  replace('e.layout.missing>0&&r("span",{class:"muted",children:[" · 之前摆盘将标记为「不完整（缺 ",e.layout.missing," 件）」"]})',
    'screenshotLayoutIncomplete(e.layout)&&r("span",{class:"warn",children:[" · 之前摆盘将标记为「",screenshotLayoutWarning(e.layout),"」"]})');
  replace('if(u){for(const [pieceIndex,I] of u.pieces.entries())',
    'if(u){for(const cell of u.unexplainedCells??[]){f.add(cell);d.set(cell,"suspect");}for(const [pieceIndex,I] of u.pieces.entries())');
  replace('e.suspects.length>0&&r(R,{children:[r("h3",',
    'e.unexplainedCells.length>0&&r("p",{class:"warn",children:"红框内 "+e.unexplainedCells.length+" 格疑似有法宝未识别，件数未知。请核对网格或换用清晰原图；直接导入将保留不完整标记。"}),e.suspects.length>0&&r(R,{children:[r("h3",');
  return app;
};

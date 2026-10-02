'use strict';

module.exports = function patchInteraction({app, change}) {
  // Keep the original release history after the two current user-facing items.
  app = change(app, 'const Dr=[{date:"2026-09-23",',
    'const Dr=[{date:"2026-10-03",items:["新增法宝觉醒：觉醒 1–3 效果累计生效，同名法宝可逐件设置等级；截图自动识别觉醒等级，摆盘图右下角显示觉醒标记。","优化移动端操作：缩小截图预览、增加两侧滑动空间和滚动提示；计算时间默认 20 秒，计算完成自动显示最终摆盘。"]},{date:"2026-09-23",');

  app = change(app, 'He=C(8e3),Xe=C(1)', 'He=C(2e4),Xe=C(1)');
  app = change(app, 'He.value=8e3,Xe.value=1', 'He.value=2e4,Xe.value=1');
  app = change(app, 'fillFirst:u1.value,budgetMs:He.value,seed:Xe.value',
    'fillFirst:u1.value,budgetMs:He.value,budgetPresetVersion:1,seed:Xe.value');
  // Migrate only the automatically restored state, once. Later explicit time
  // choices (and named saved plans) continue to round-trip their chosen budget.
  app = change(app, 'Ia(e)},Ia=t=>',
    'Ia(e),e.version===Ft&&e.budgetPresetVersion!==1&&(He.value=2e4,K())},Ia=t=>');

  // Vn settles this one promise for Worker, main-thread fallback and manual
  // stop. Progress updates deliberately do not call the navigation helper.
  app = change(app, 'r1=null})};function Pl(){',
    'r1=null,awShowCompletedLayout(n)})};' + `
function awShowCompletedLayout(result){
  if(!result||!Array.isArray(result.pieces)||result.pieces.length===0||!Number.isFinite(result.score)||I0.value.length)return;
  Be.value="layout";s1.value=null;g1.value=null;
  const reveal=()=>{
    if(be.value||pe.value!==result)return;
    const board=document.getElementById("board");
    if(!board)return;
    try{window.history.replaceState(window.history.state,"","#board");}catch{}
    const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    board.scrollIntoView({behavior:reduced?"auto":"smooth",block:"start"});
  };
  // Wait for the signal-driven render, including the final board's new height.
  if(typeof requestAnimationFrame==="function")requestAnimationFrame(()=>requestAnimationFrame(reveal));
  else setTimeout(reveal,0);
}
function Pl(){`);
  return app;
};

'use strict';

module.exports = function patchInteraction({app, change}) {
  // Prepend the current release while keeping the complete earlier history.
  const currentRelease = {date: "2026-10-15", items: ["资源同步正式服版本", "优化双修识别"]};
  const pendingRelease = {
    "date": "2026-10-13",
    "items": [
      "公式更改：单件攻击、防御、生命分别按“星级基础 B星=floor(B×(1+s))；最终属性≈B星×(1+t+a+g+n)”计算。s 为长老星级加成；t、a、g、n 分别为对应属性的天赋、觉醒基础加成、形态光环和邻接百分比，按百分率相加。先取整星级基础，再按单精度计算合并倍率并取整；具体实现见 README。预览与主线程/Worker 计分同步，伤害和暴击增伤仍为独立通道。",
      "优化识别速度",
      "更新了四五觉"
    ]
  };
  app = change(app, 'const Dr=[{date:"2026-09-23",',
    'const Dr=[' + JSON.stringify(currentRelease) + "," + JSON.stringify(pendingRelease) + ',{date:"2026-10-11",items:["补强法宝截图识别：补充 22 件法宝的 176 个外观样本，修正旧样本标签；区分相似法宝，减少图案误作属性角标及不同红宝合并后误触数量限制的问题。","改进觉醒数字识别：优化小图和 JPEG 压缩后的数字、火焰识别，加入 20 件法宝的 80 个未觉醒参考样本；模糊或证据冲突时保留手动确认。","优化光环计算：缓存当前摆盘实际生效的形态光环，移动、放入和移除法宝时重算受影响部分，减少全盘重复计算。","增强摆盘搜索：满盘时尝试同时重排 6–8 件法宝，按核心法宝与邻接收益引导布局，加入双件微调；连续无提升时继续搜索到设定时间，支持主动停止。","保留已有好方案：重新计算时沿用当前合法摆盘和同配置的已有结果作为候选基准，核对持有数量、位置及每件觉醒等级，并按当前配置重新评分。"]},{date:"2026-10-03",items:["新增法宝觉醒：觉醒 1–3 效果累计生效，同名法宝可逐件设置等级；截图自动识别觉醒等级，摆盘图右下角显示觉醒标记。","优化移动端操作：缩小截图预览、增加两侧滑动空间和滚动提示；计算时间默认 20 秒，计算完成自动显示最终摆盘。"]},{date:"2026-09-23",');

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

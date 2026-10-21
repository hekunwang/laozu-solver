'use strict';

module.exports = function patchInteraction({app, change}) {
  // Prepend the current release while keeping the complete earlier history.
  const fs = require('node:fs'), path = require('node:path');
  const currentRelease = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/release-notes.json'), 'utf8'));
  const history = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/release-history.json'), 'utf8'));
  if (history.some(entry => entry.date === currentRelease.date)) throw new Error('Duplicate current release date');
  const anchor = 'const Dr=[{date:"2026-09-23",';
  app = change(app, anchor, 'const Dr=[' + [currentRelease, ...history.filter(entry => entry.date > '2026-09-23')].map(entry => JSON.stringify(entry)).join(',') + ',{date:"2026-09-23",');

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

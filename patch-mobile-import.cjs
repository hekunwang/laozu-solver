'use strict';

module.exports=function patchMobileImport({app,change}){
  const helpers=`
const importPreviewExpanded=C(false);
function importUpdateScrollbar(scroller){
  if(!scroller?.isConnected)return;
  const track=scroller.parentElement.querySelector('.import-scroll-track');
  if(!track)return;
  const range=scroller.scrollHeight-scroller.clientHeight;
  track.hidden=range<=1;
  if(range<=1)return;
  const thumb=track.firstElementChild,height=Math.min(track.clientHeight,Math.max(32,track.clientHeight*scroller.clientHeight/scroller.scrollHeight));
  thumb.style.height=height+'px';
  thumb.style.transform='translateY('+Math.max(0,Math.min(1,scroller.scrollTop/range))*(track.clientHeight-height)+'px)';
}
let importScrollObserver=null;
function importScrollRef(scroller){
  importScrollObserver?.disconnect();importScrollObserver=null;
  if(!scroller)return;
  requestAnimationFrame(()=>importUpdateScrollbar(scroller));
  if(typeof ResizeObserver==='function'){
    importScrollObserver=new ResizeObserver(()=>importUpdateScrollbar(scroller));
    importScrollObserver.observe(scroller);
    for(const child of scroller.children)importScrollObserver.observe(child);
  }
}
function importScrollTrack(event){
  const track=event.currentTarget,scroller=track.parentElement.querySelector('.import-scroll');
  const bounds=track.getBoundingClientRect(),thumb=track.firstElementChild.getBoundingClientRect();
  const offset=event.target===track.firstElementChild?event.clientY-thumb.top:thumb.height/2;
  const move=pointer=>{
    const ratio=Math.max(0,Math.min(1,(pointer.clientY-bounds.top-offset)/Math.max(1,bounds.height-thumb.height)));
    scroller.scrollTo({top:ratio*(scroller.scrollHeight-scroller.clientHeight),behavior:'auto'});
  };
  const end=()=>{track.removeEventListener('pointermove',move);track.removeEventListener('pointerup',end);track.removeEventListener('pointercancel',end);};
  event.preventDefault();track.setPointerCapture(event.pointerId);
  track.addEventListener('pointermove',move);track.addEventListener('pointerup',end);track.addEventListener('pointercancel',end);move(event);
}
function importPreviewTools(){return r('div',{class:'import-preview-tools',children:[
  r('button',{type:'button',class:'ghost',onClick:()=>importPreviewExpanded.value=!importPreviewExpanded.value,'aria-expanded':importPreviewExpanded.value,children:importPreviewExpanded.value?'缩小预览':'放大校正'}),
  r('span',{class:'muted small',children:'从图片两侧上下滑动'})
]});}
`;
  app=change(app,'let ge=null;function rl(){',helpers+'\nlet ge=null;function rl(){');
  app=change(app,'ht=async t=>{N1.value=null,me.value=',
    'ht=async t=>{N1.value=null,importPreviewExpanded.value=false,me.value=');
  app=change(app,'const t=document.querySelector(".import-dialog");if(!t)return As;const e=getComputedStyle(t),s=t.clientWidth-parseFloat(e.paddingLeft)-parseFloat(e.paddingRight);return Math.min(As,Math.max(120,s))',
    `const t=document.querySelector('.import-scroll')||document.querySelector('.import-dialog');if(!t)return As;const e=getComputedStyle(t),s=t.clientWidth-parseFloat(e.paddingLeft)-parseFloat(e.paddingRight);if(window.innerWidth<=700&&!importPreviewExpanded.value&&V){const maxHeight=Math.max(200,Math.min(380,window.innerHeight*.46));return Math.max(96,Math.min(s*.68,s-80,maxHeight*V.bitmap.w/V.bitmap.h));}return Math.min(As,Math.max(120,s))`);

  // Keep the footer outside the scrolling content, so it is always reachable.
  app=change(app,'V?r(R,{children:[!B0.value&&r("p",',
    'V?r(R,{children:[r("div",{class:"import-scroll-shell",children:[r("div",{class:"import-scroll",tabIndex:0,"aria-label":"截图与识别结果",onScroll:event=>importUpdateScrollbar(event.currentTarget),ref:importScrollRef,children:[!B0.value&&r("p",');
  app=change(app,'r("div",{class:"import-body",children:[r("div",{children:[r(ll,{}),',
    'r("div",{class:"import-body",children:[r("div",{class:"import-preview",children:[r(importPreviewTools,{}),r(ll,{}),');
  app=change(app,'):r(ol,{})]}),r("div",{class:"import-footer row wrap",',
    '):r(ol,{})]})]}),r("div",{class:"import-scroll-track","aria-hidden":true,onPointerDown:importScrollTrack,children:r("span",{class:"import-scroll-thumb"})})]}),r("div",{class:"import-footer row wrap",');
  return app;
};

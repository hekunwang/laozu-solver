'use strict';

// Preserve every sample coordinate, sample order and median calculation.
// Only bypass per-pixel RGB array allocation on the two known bitmap formats.
function sampler(name, geometry, red, green, blue, median) {
  return `function ${name}(bitmap,grid,row,col,step=${geometry}.bgStep){
    let count=0;
    const left=grid.ox+col*grid.pw,top=grid.oy+row*grid.ph;
    const insetX=grid.pw*${geometry}.bgInset,insetY=grid.ph*${geometry}.bgInset;
    const rgba=bitmap.gridRgba,rgb=bitmap.gridRgb;
    const [begin,end]=${geometry}.bgSpan;
    for(let position=begin;position<end;position+=step){
      for(let edge=0;edge<4;edge++){
        const x=Math.round(edge<2?left+grid.pw*position:edge===2?left+insetX:left+grid.pw-insetX);
        const y=Math.round(edge>=2?top+grid.ph*position:edge===0?top+insetY:top+grid.ph-insetY);
        if(!(x>=0&&y>=0&&x<bitmap.w&&y<bitmap.h))continue;
        if(rgba){
          const offset=(y*bitmap.w+x)*4;
          ${red}[count]=rgba[offset];${green}[count]=rgba[offset+1];${blue}[count]=rgba[offset+2];
        }else if(rgb){
          const offset=(y*bitmap.w+x)*3;
          ${red}[count]=rgb[offset];${green}[count]=rgb[offset+1];${blue}[count]=rgb[offset+2];
        }else{
          const pixel=bitmap.px(x,y);
          ${red}[count]=pixel[0];${green}[count]=pixel[1];${blue}[count]=pixel[2];
        }
        count++;
      }
    }
    return count?[${median}(${red},count),${median}(${green},count),${median}(${blue},count)]:null;
  }`;
}

module.exports=function patchGridSpeed({app,change}){
  const mainStart=app.indexOf('function it('),mainEnd=app.indexOf('function p0(',mainStart);
  if(mainStart<0||mainEnd<mainStart)throw new Error('Grid sampler anchor missing');
  app=change(app,app.slice(mainStart,mainEnd),sampler('it','fe','is','os','ds','N0'));
  const workerStart=app.indexOf('function W(t,A,n,c,e=g.bgStep)'),workerEnd=app.indexOf('function $(t,A,n,c,e)',workerStart);
  if(workerStart<0||workerEnd<workerStart)throw new Error('Image Worker sampler anchor missing');
  app=change(app,app.slice(workerStart,workerEnd),sampler('W','g','Y','N','L','I'));
  app=change(app,'return{w:s,h:t.height,px:', 'return{w:s,h:t.height,gridRgba:e,px:');
  app=change(app,'return{w:s,h:a,px:(l,i)=>[n[','return{w:s,h:a,gridRgb:n,px:(l,i)=>[n[');
  app=change(app,'return{w:n,h:c,px:(r,h)=>[e[','return{w:n,h:c,gridRgb:e,px:(r,h)=>[e[');
  app=change(app,'nA({w:n,h:c,px:','nA({w:n,h:c,gridRgba:e,px:');
  return app;
};

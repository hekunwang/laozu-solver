'use strict';

// Callers only consume the upper median of finite RGB values; they never read
// the sorted scratch buffer. Partitioning avoids sorting unused order statistics.
function selectGridMedian(values,count){
  const target=count>>1;
  let left=0,right=count-1;
  while(left<right){
    const pivot=values[(left+right)>>1];
    let low=left,high=right;
    while(low<=high){
      while(values[low]<pivot)low++;
      while(values[high]>pivot)high--;
      if(low<=high){const value=values[low];values[low]=values[high];values[high]=value;low++;high--;}
    }
    if(target<=high)right=high;
    else if(target>=low)left=low;
    else break;
  }
  return values[target];
}

// Compute the two varying coordinates once per step and the four fixed edge
// coordinates once per cell. Preserve sample order and all floating arithmetic.
function sampler(name,geometry,red,green,blue,median){
  function loop(format){
    const sample=(x,y)=>`if(${x}>=0&&${y}>=0&&${x}<bitmap.w&&${y}<bitmap.h){${format==='px'
      ?`const pixel=bitmap.px(${x},${y});${red}[count]=pixel[0];${green}[count]=pixel[1];${blue}[count]=pixel[2];`
      :`const offset=(${y}*bitmap.w+${x})*${format==='rgba'?4:3};${red}[count]=${format}[offset];${green}[count]=${format}[offset+1];${blue}[count]=${format}[offset+2];`}count++;}`;
    return `for(let position=begin;position<end;position+=step){
      const x=Math.round(left+grid.pw*position),y=Math.round(top+grid.ph*position);
      ${sample('x','topEdge')}${sample('x','bottomEdge')}
      ${sample('leftEdge','y')}${sample('rightEdge','y')}
    }`;
  }
  return `function ${name}(bitmap,grid,row,col,step=${geometry}.bgStep){
    let count=0;
    const left=grid.ox+col*grid.pw,top=grid.oy+row*grid.ph;
    const insetX=grid.pw*${geometry}.bgInset,insetY=grid.ph*${geometry}.bgInset;
    const leftEdge=Math.round(left+insetX),rightEdge=Math.round(left+grid.pw-insetX);
    const topEdge=Math.round(top+insetY),bottomEdge=Math.round(top+grid.ph-insetY);
    const rgba=bitmap.gridRgba,rgb=bitmap.gridRgb;
    const [begin,end]=${geometry}.bgSpan;
    if(rgba){${loop('rgba')}}else if(rgb){${loop('rgb')}}else{${loop('px')}}
    return count?[${median}(${red},count),${median}(${green},count),${median}(${blue},count)]:null;
  }`;
}
module.exports=function patchGridSamplingV2({app,change}){
  const replace=(startText,endText,text)=>{
    const start=app.indexOf(startText),end=app.indexOf(endText,start);
    if(start<0||end<start)throw Error('Grid sampling v2 anchor missing');
    app=change(app,app.slice(start,end),text);
  };
  replace('function it(','function p0(',sampler('it','fe','is','os','ds','N0'));
  replace('function W(bitmap,grid,','function $(t,A,n,c,e)',sampler('W','g','Y','N','L','I'));
  replace('N0=(t,e)=>{',',M0=',`N0=${selectGridMedian.toString()}`);
  replace('I=(t,A)=>{',',R=',`I=${selectGridMedian.toString()}`);
  return app;
};
module.exports.selectGridMedian=selectGridMedian;

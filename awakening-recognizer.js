// Local-only recognition of the flame badge ABOVE the resonance disk.
// The small white glyph masks contain only the game's digit strokes, no
// screenshot, player information, or external OCR service.
const AW_GLYPHS={
  // The game uses a narrow 1 without a bottom foot, unlike a generic font.
  1:['#### ','#####','#####','  ###','  ###','  ###','  ###','  ###','  ###','  ###','  ###','  ###','  ###','  ###','  ###','   ##'],
  2:['     ##    ','   ######  ',' ########  ',' ###  #### ',' ##    ### ','###    ### ',' #     ### ','      ###  ','      ###  ','     ###   ','    ####   ','   ####    ','  ####     ',' ####      ',' ######### ','###########',' ######### '],
  3:['    ##    ','  ######  ',' ######## ',' ##    ## ',' ##    ## ','       ## ','      ### ','    ####  ','    ##### ','      ####','       ###','        ##','##     ###','####  ####',' ######## ','  ######  ']
};
function awColorFamily(rgb){
  const [r,g,b]=rgb,max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
  if(max<100||delta<50||delta/max<.27)return 0;
  const hue=((max===r?(g-b)/delta:max===g?(b-r)/delta+2:(r-g)/delta+4)*60+360)%360;
  return hue>=245&&hue<=310?3:hue>=170&&hue<=235?2:hue>=70&&hue<=165?1:0;
}
function awComponents(width,height,predicate){
  const seen=new Uint8Array(width*height),out=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const first=y*width+x;if(seen[first]||!predicate(x,y))continue;
    const todo=[first],points=[];seen[first]=1;let x0=x,x1=x,y0=y,y1=y;
    while(todo.length){const p=todo.pop(),px=p%width,py=Math.floor(p/width);points.push([px,py]);x0=Math.min(x0,px);x1=Math.max(x1,px);y0=Math.min(y0,py);y1=Math.max(y1,py);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=px+dx,ny=py+dy,i=ny*width+nx;if(nx<0||ny<0||nx>=width||ny>=height||seen[i]||!predicate(nx,ny))continue;seen[i]=1;todo.push(i);}
    }
    out.push({x:x0,y:y0,width:x1-x0+1,height:y1-y0+1,points});
  }
  return out;
}
function awGlyphScore(component,rows){
  const width=12,height=18,tw=Math.max(...rows.map(row=>row.length)),th=rows.length;
  const points=new Set(component.points.map(([x,y])=>(y-component.y)*component.width+x-component.x));
  let both=0,a=0,b=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const on=points.has(Math.min(component.height-1,Math.floor((y+.5)*component.height/height))*component.width+Math.min(component.width-1,Math.floor((x+.5)*component.width/width)));
    const target=rows[Math.min(th-1,Math.floor((y+.5)*th/height))][Math.min(tw-1,Math.floor((x+.5)*tw/width))]==='#';
    if(on)a++;if(target)b++;if(on&&target)both++;
  }
  return a+b?2*both/(a+b):0;
}
function awRecognizeBitmap(bitmap,grid,piece){
  const cell=piece.numberCell;if(!cell||!grid||!bitmap)return {awakenLevel:null,awakenConfidence:0,awakenStatus:'uncertain'};
  const pw=grid.pw,ph=grid.ph,left=grid.ox+cell.col*pw,top=grid.oy+cell.row*ph;
  // Stabilize exact pixel boundaries after decimal grid arithmetic. A real
  // negative coordinate still fails the bounds check below.
  const x=Math.floor(left+.55*pw+1e-9),y=Math.floor(top+.12*ph+1e-9),width=Math.ceil(.51*pw),height=Math.ceil(.62*ph);
  const box={x,y,width,height},result=(level,confidence,status,extra={})=>({awakenLevel:level,awakenConfidence:confidence,awakenStatus:status,awakenBox:box,...extra});
  if(![pw,ph,x,y,width,height].every(Number.isFinite)||pw<24||ph<24||x<0||y<0||x+width>bitmap.w||y+height>bitmap.h)return result(null,0,'uncertain');
  const rgb=(cx,cy)=>bitmap.px(x+cx,y+cy);
  const colored=awComponents(width,height,(cx,cy)=>awColorFamily(rgb(cx,cy))>0);
  const colorPixels=colored.reduce((n,c)=>n+c.points.length,0);
  const candidates=[];
  for(const color of colored){
    const cx=(x+color.x+color.width/2-left)/pw,cy=(y+color.y+color.height/2-top)/ph;
    if(color.points.length<Math.max(8,pw*ph*.005)||color.width<pw*.11||color.width>pw*.48||color.height<ph*.19||color.height>ph*.63||cx<.68||cx>1.03||cy<.28||cy>.65)continue;
    const familyCounts=[0,0,0,0];for(const [px,py]of color.points)familyCounts[awColorFamily(rgb(px,py))]++;
    const family=familyCounts.indexOf(Math.max(...familyCounts));
    const glyphs=awComponents(width,height,(px,py)=>{
      if(px<color.x||px>=color.x+color.width||py<color.y+color.height*.33||py>=color.y+color.height)return false;
      const pixel=rgb(px,py);return Math.min(...pixel)>205&&Math.max(...pixel)-Math.min(...pixel)<45;
    });
    for(const glyph of glyphs){
      const centerX=glyph.x+glyph.width/2,centerY=glyph.y+glyph.height/2;
      if(glyph.height<Math.max(5,ph*.09)||glyph.height>ph*.30||glyph.width<pw*.025||glyph.width>pw*.25||glyph.points.length<5||Math.abs(centerX-(color.x+color.width/2))>pw*.11||centerY<color.y+color.height*.45)continue;
      const scores=Object.entries(AW_GLYPHS).map(([level,rows])=>({level:Number(level),score:awGlyphScore(glyph,rows)})).sort((a,b)=>b.score-a.score);
      const best=scores[0],margin=best.score-scores[1].score;
      // A colored flame and a readable digit must agree. Color alone never
      // assigns a nonzero level, nor can the white resonance disk enter here.
      if(best.level!==family||best.score<.72||margin<.065)continue;
      candidates.push({level:best.level,confidence:Math.min(.99,.65+.30*best.score+.3*margin),glyph:{x:x+glyph.x,y:y+glyph.y,width:glyph.width,height:glyph.height},score:best.score,margin});
    }
  }
  candidates.sort((a,b)=>b.confidence-a.confidence);
  if(candidates.length){const best=candidates[0];if(candidates.some(c=>c.level!==best.level&&best.confidence-c.confidence<.08))return result(null,best.confidence,'uncertain');return result(best.level,best.confidence,'recognized',{awakenGlyphBox:best.glyph});}
  // Missing color cannot establish level zero in a low-resolution or very
  // dark crop. In the latter case the flame may have fallen below the color
  // threshold too, so leave it for manual confirmation.
  if(pw>=45&&ph>=45&&colorPixels<Math.max(5,pw*ph*.001)){
    let luminance=0;
    for(let cy=0;cy<height;cy++)for(let cx=0;cx<width;cx++){
      const [r,g,b]=rgb(cx,cy);luminance+=.2126*r+.7152*g+.0722*b;
    }
    if(luminance/(width*height)>=80)return result(0,.9,'none');
  }
  return result(null,0,'uncertain');
}

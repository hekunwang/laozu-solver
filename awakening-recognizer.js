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
function awComponents(width,height,predicate,gap=1){
  const seen=new Uint8Array(width*height),out=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const first=y*width+x;if(seen[first]||!predicate(x,y))continue;
    const todo=[first],points=[];seen[first]=1;let x0=x,x1=x,y0=y,y1=y;
    while(todo.length){const p=todo.pop(),px=p%width,py=Math.floor(p/width);points.push([px,py]);x0=Math.min(x0,px);x1=Math.max(x1,px);y0=Math.min(y0,py);y1=Math.max(y1,py);
      for(let dy=-gap;dy<=gap;dy++)for(let dx=-gap;dx<=gap;dx++){const nx=px+dx,ny=py+dy,i=ny*width+nx;if(nx<0||ny<0||nx>=width||ny>=height||seen[i]||!predicate(nx,ny))continue;seen[i]=1;todo.push(i);}
    }
    out.push({x:x0,y:y0,width:x1-x0+1,height:y1-y0+1,points});
  }
  return out;
}
function awGlyphScore(component,rows){
  // Compare tiny digits at their native resolution. Enlarging a 7x10 glyph
  // with nearest-neighbor sampling loses thin strokes against the large mask.
  const small=component.height<14,width=small?component.width:12,height=small?component.height:18;
  const tw=Math.max(...rows.map(row=>row.length)),th=rows.length;
  const points=new Set(component.points.map(([x,y])=>(y-component.y)*component.width+x-component.x));
  let both=0,a=0,b=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const on=points.has(Math.min(component.height-1,Math.floor((y+.5)*component.height/height))*component.width+Math.min(component.width-1,Math.floor((x+.5)*component.width/width)));
    let target;
    if(small){
      const x0=x*tw/width,x1=(x+1)*tw/width,y0=y*th/height,y1=(y+1)*th/height;
      let ink=0;
      for(let sy=Math.floor(y0);sy<Math.ceil(y1);sy++)for(let sx=Math.floor(x0);sx<Math.ceil(x1);sx++){
        if(rows[sy]?.[sx]==='#')ink+=(Math.min(x1,sx+1)-Math.max(x0,sx))*(Math.min(y1,sy+1)-Math.max(y0,sy));
      }
      target=ink/((x1-x0)*(y1-y0))>=.5;
    }else target=rows[Math.min(th-1,Math.floor((y+.5)*th/height))][Math.min(tw-1,Math.floor((x+.5)*tw/width))]==='#';
    if(on)a++;if(target)b++;if(on&&target)both++;
  }
  return a+b?2*both/(a+b):0;
}
function awZeroSignature(bitmap,box,columns=8,rows=8){
  const signature=[];
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
    const x0=Math.floor(col*box.width/columns),x1=Math.floor((col+1)*box.width/columns);
    const y0=Math.floor(row*box.height/rows),y1=Math.floor((row+1)*box.height/rows);
    const sum=[0,0,0];let count=0;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
      const px=box.x+x,py=box.y+y,ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy;
      const pixel=[...bitmap.px(ix,iy)];
      if(fx||fy){
        const right=bitmap.px(ix+(fx?1:0),iy),below=bitmap.px(ix,iy+(fy?1:0)),diagonal=bitmap.px(ix+(fx?1:0),iy+(fy?1:0));
        for(let channel=0;channel<3;channel++)pixel[channel]=pixel[channel]*(1-fx)*(1-fy)+right[channel]*fx*(1-fy)+below[channel]*(1-fx)*fy+diagonal[channel]*fx*fy;
      }
      for(let channel=0;channel<3;channel++)sum[channel]+=pixel[channel];count++;
    }
    signature.push(...sum.map(value=>count?value/count:0));
  }
  return signature;
}
function awZeroSampleBox(box,grid,cell){
  // The recognition search box crosses the cell edge. Background references
  // must exclude the next cell (or the backpack frame at the rightmost edge).
  return {...box,width:Math.min(box.width,Math.floor(grid.ox+(cell.col+1)*grid.pw+1e-9)-box.x)};
}
function awMatchesZeroSample(bitmap,box,piece,small=false){
  if(typeof AW_ZERO_SAMPLES==='undefined'||AW_ZERO_SAMPLES.version!==1)return false;
  const equip=piece.equip||(typeof Er==='function'&&piece.signature&&piece.candidates?.length===2?Er(piece.signature,piece.candidates)?.equip:null);
  if(!equip)return false;
  const samples=AW_ZERO_SAMPLES.samples.filter(sample=>sample.equipId===equip.id);
  if(!samples.length)return false;
  const offsets=[[0,0]];
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(dx||dy)offsets.push([dx,dy]);
  // A resized icon may sit between pixels. Try half-pixel alignment only for
  // the zero-reference comparison, after all original integer alignments.
  for(let dy=-2;dy<=2;dy+=.5)for(let dx=-2;dx<=2;dx+=.5)if(dx%1||dy%1)offsets.push([dx,dy]);
  for(const [dx,dy]of offsets){
    const shifted={...box,x:box.x+dx,y:box.y+dy};
    if(shifted.x<0||shifted.y<0||shifted.x+shifted.width>bitmap.w||shifted.y+shifted.height>bitmap.h)continue;
    const signature=awZeroSignature(bitmap,shifted,AW_ZERO_SAMPLES.columns,AW_ZERO_SAMPLES.rows);
    if(samples.some(sample=>{
      if(sample.sig.length!==signature.length)return false;
      let total=0,maxBlock=0,luma=0;const bias=[0,0,0];
      for(let i=0;i<signature.length;i+=3){
        const dr=signature[i]-sample.sig[i],dg=signature[i+1]-sample.sig[i+1],db=signature[i+2]-sample.sig[i+2];
        const error=(Math.abs(dr)+Math.abs(dg)+Math.abs(db))/3;
        total+=error;maxBlock=Math.max(maxBlock,error);
        if(small){luma+=Math.abs(.299*dr+.587*dg+.114*db);bias[0]+=dr;bias[1]+=dg;bias[2]+=db;}
      }
      // Both the whole corner and every local block must agree. Alignment is
      // limited to two pixels; it never changes the nonzero badge search box.
      const blocks=signature.length/3;
      if(maxBlock>18)return false;
      if(total/blocks<=3)return true;
      // JPEG chroma subsampling can move color across tiny artwork edges
      // without changing their luminance. Accept only a modest RGB residual
      // with matching brightness, no overall color shift, and the same local
      // block limit; a missing digit alone is never evidence for level zero.
      return small&&total/blocks<=5&&luma/blocks<=3&&bias.every(value=>Math.abs(value/blocks)<=2);
    }))return true;
  }
  return false;
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
  // Keep a purple flame separate from adjacent blue/green equipment artwork.
  const colored=[1,2,3].flatMap(family=>awComponents(width,height,(cx,cy)=>awColorFamily(rgb(cx,cy))===family));
  // Equipment artwork can enter the broad search box at its top/left edge.
  // Only the flame body can establish color evidence for an unreadable badge.
  const bodyColorPixels=colored.reduce((n,c)=>n+c.points.filter(([px,py])=>
    x+px>=left+.75*pw&&y+py>=top+.30*ph&&y+py<=top+.65*ph).length,0);
  const candidates=[];let hasFlameShape=false,hasDigitEvidence=false,hasConflictingDigit=false;
  // JPEG can split tiny flame outlines and dim the antialiased digit edge.
  // Keep the original pass first; only unresolved small badges get a second
  // pass bridging at most two missing pixels in the colored outline.
  for(const smallPass of [false,...(pw<=80&&ph<=80?[true]:[])]){
  if(smallPass&&hasConflictingDigit)break;
  const colors=smallPass?[1,2,3].flatMap(family=>awComponents(width,height,(cx,cy)=>awColorFamily(rgb(cx,cy))===family,3)):colored;
  for(const color of colors){
    const cx=(x+color.x+color.width/2-left)/pw,cy=(y+color.y+color.height/2-top)/ph;
    if(color.points.length<Math.max(8,pw*ph*.005)||color.width<pw*.11||color.width>pw*.48||color.height<ph*.19||color.height>ph*.63||cx<.68||cx>1.03||cy<.28||cy>.65)continue;
    hasFlameShape=true;
    const familyCounts=[0,0,0,0];for(const [px,py]of color.points)familyCounts[awColorFamily(rgb(px,py))]++;
    const family=familyCounts.indexOf(Math.max(...familyCounts));
    const glyphs=awComponents(width,height,(px,py)=>{
      // One side of a tiny flame may be disconnected across the digit's dark
      // outline. Include its adjacent two pixels, keeping the center check.
      const pad=smallPass?2:0;
      if(px<color.x-pad||px>=color.x+color.width+pad||py<color.y+color.height*.33||py>=color.y+color.height)return false;
      const pixel=rgb(px,py);return Math.min(...pixel)>(smallPass?190:205)&&Math.max(...pixel)-Math.min(...pixel)<45;
    });
    for(const glyph of glyphs){
      const centerX=glyph.x+glyph.width/2,centerY=glyph.y+glyph.height/2;
      if(glyph.height<Math.max(5,ph*.09)||glyph.height>ph*.30||glyph.width<pw*.025||glyph.width>pw*.25||glyph.points.length<5||Math.abs(centerX-(color.x+color.width/2))>pw*.11||centerY<color.y+color.height*.45)continue;
      // Antialiasing may extend real strokes, but cannot replace their bright
      // core. Erased or dimmed digits must still require manual confirmation.
      if(smallPass&&glyph.points.filter(([px,py])=>Math.min(...rgb(px,py))>205).length<5)continue;
      const scores=Object.entries(AW_GLYPHS).map(([level,rows])=>({level:Number(level),score:awGlyphScore(glyph,rows)})).sort((a,b)=>b.score-a.score);
      const best=scores[0],margin=best.score-scores[1].score;
      // Normalizing a three-pixel-wide 1 can resemble a 3. The wider digits
      // must retain their width; flame color cannot resolve a collapsed glyph.
      if(glyph.height<14&&best.level>1&&glyph.width/glyph.height<.4)continue;
      if(best.score>=.72&&margin>=.065){hasDigitEvidence=true;if(best.level!==family)hasConflictingDigit=true;}
      // A colored flame and a readable digit must agree. Color alone never
      // assigns a nonzero level, nor can the white resonance disk enter here.
      if(best.level!==family||best.score<.72||margin<.065)continue;
      candidates.push({level:best.level,confidence:Math.min(.99,.65+.30*best.score+.3*margin),glyph:{x:x+glyph.x,y:y+glyph.y,width:glyph.width,height:glyph.height},score:best.score,margin});
    }
  }
  candidates.sort((a,b)=>b.confidence-a.confidence);
  if(candidates.length){const best=candidates[0];if(candidates.some(c=>c.level!==best.level&&best.confidence-c.confidence<.08))return result(null,best.confidence,'uncertain');return result(best.level,best.confidence,'recognized',{awakenGlyphBox:best.glyph});}
  }
  // Missing color cannot establish level zero in a low-resolution or very
  // dark crop. In the latter case the flame may have fallen below the color
  // threshold too, so leave it for manual confirmation.
  if(!hasDigitEvidence&&pw>=45&&ph>=45){
    let luminance=0;
    for(let cy=0;cy<height;cy++)for(let cx=0;cx<width;cx++){
      const [r,g,b]=rgb(cx,cy);luminance+=.2126*r+.7152*g+.0722*b;
    }
    if(luminance/(width*height)>=80&&((!hasFlameShape&&bodyColorPixels<Math.max(5,pw*ph*.001))||awMatchesZeroSample(bitmap,awZeroSampleBox(box,grid,cell),piece,pw<=80&&ph<=80)))return result(0,.9,'none');
  }
  return result(null,0,'uncertain');
}

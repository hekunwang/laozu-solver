'use strict';

// Align already admitted element badges individually. A wider search must not
// admit new anchors from equipment artwork. Keep the original weak-glyph and
// moat gates, and retain original scores when the winning element is unchanged.
// Share each normalized patch across all eight templates to avoid repeated
// pixel reads. Grid fitting, templates, thresholds and number/badge OCR stay
// unchanged. Validated with the historical eight-element screenshot corpus.
function classifyElementGlyph(bitmap, grid, row, col, templates) {
 const entries=[...templates], scores=entries.map(()=>-2),box=Le.elementBox;
 const sample=(dx,dy)=>{const patch=Ma(bitmap,grid,row,col,box,dx,dy);for(let i=0;i<entries.length;i++){const score=Sa(patch,entries[i][1]);if(score>scores[i])scores[i]=score;}};
 const rank=()=>fs(entries.map(([key],i)=>({key,score:scores[i]})));
 for(const dx of Le.shifts)for(const dy of Le.shifts)sample(dx,dy);
 const original=rank();
 const acceptable=q=>q.score>=Y.glyphCorr&&q.margin>=Y.glyphMargin&&q.score+2*q.margin>=Y.glyphCombined&&!(q.score<Y.weakGlyphCorr&&p0(bitmap,grid,row,col,Le.moatBox)>=Y.weakGlyphMoat);
 if(!acceptable(original))return original;
 const shifts=[-.036,-.024,-.012,-.006,0,.006,.012,.024,.036];
 for(const dx of shifts)for(const dy of shifts)if(Math.abs(dx)>.012||Math.abs(dy)>.012)sample(dx,dy);
 const aligned=rank();
 return aligned.key!==original.key&&acceptable(aligned)&&aligned.score-original.score>=Y.glyphMargin?aligned:original;
}

module.exports = function patchGlyphAlignment({app, change}) {
  app = change(app, 'function Jr(t,e){', classifyElementGlyph.toString() + '\nfunction Jr(t,e){');
  return change(app,
    'const q=fs(a.map(P=>({key:P,score:M1(t,s,p,g,Le.elementBox,i1.get(P))})))',
    'const q=classifyElementGlyph(t,s,p,g,i1)');
};

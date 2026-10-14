'use strict';

// A near tie between element glyphs is not a blind appearance match. Admit it
// only when a clear badge, an independently separated built-in appearance and
// its resonance number corroborate the same equipment. Existing blind and
// accepted-glyph paths keep their original gates.
function corroborateCompressedAnchor(bitmap, grid, row, col, glyph, equipId, distance) {
  if (distance > Y.signatureRescueMaxDistance) return false;
  const nearTie = glyph.score >= Y.weakGlyphCorr
      && glyph.margin < Y.glyphMargin
      && p0(bitmap, grid, row, col, Le.badgeBox) >= Y.strictBadge
      && p0(bitmap, grid, row, col, Le.moatBox) <= Y.strictMoat;
  if (nearTie && corroborateCompressedNearTie(bitmap, grid, row, col, glyph, equipId)) return true;
  return !!corroborateCompressedPhase(bitmap, grid, row, col, equipId);
}

function corroborateCompressedNearTie(bitmap, grid, row, col, glyph, equipId) {
  if (glyph.score < Y.weakGlyphCorr
      || glyph.margin >= Y.glyphMargin
      || p0(bitmap, grid, row, col, Le.badgeBox) < Y.strictBadge
      || p0(bitmap, grid, row, col, Le.moatBox) > Y.strictMoat) return false;
  const equip = S0.find(item => item.id === equipId);
  if (!equip) return false;
  const template = i1.get(Fe[equip.element]);
  if (!template || M1(bitmap, grid, row, col, Le.elementBox, template) < glyph.score - Y.glyphMargin) return false;
  const last = Xr(equip.shapeId, row, col);
  if (!last || !Kr(equip.shapeId, row, col)) return false;
  const number = Or.get(String(equip.reson));
  return !!number && M1(bitmap, grid, last.row, last.col, Le.numberBox, number,
    [-.024, -.016, -.008, 0, .008, .016, .024]) >= Y.numberAccept;
}

// A failed low-resolution sample may land on a different pixel after rounding.
// Recheck only a previously rejected, independently identified candidate. A
// phase must corroborate appearance, element, badge, moat and number together;
// any strongly identified competing appearance vetoes the recovery.
function compressedAppearance(signature) {
  const distances=new Map();
  for(const sample of ot){
    const d=n1(signature,sample.sig);
    if(!distances.has(sample.equipId)||d<distances.get(sample.equipId))distances.set(sample.equipId,d);
  }
  const ranked=[...distances].sort((a,b)=>a[1]-b[1]);
  return ranked.length>=2 && ranked[0][1]<=Y.signatureRescueMaxDistance
    && ranked[1][1]-ranked[0][1]>=Y.signatureMinMargin?ranked[0][0]:null;
}

function corroborateCompressedPhase(bitmap, grid, row, col, equipId) {
  const equip=S0.find(item=>item.id===equipId),last=equip&&Xr(equip.shapeId,row,col);
  if(!equip||!last||!Kr(equip.shapeId,row,col)
    ||compressedAppearance(us(bitmap,grid,row,col))!==equipId)return null;
  const number=Or.get(String(equip.reson));if(!number)return null;
  const phases=[];
  for(const step of [.5,1])for(const dx of [-step,0,step])for(const dy of [-step,0,step]){
    if(!dx&&!dy)continue;
    const shifted={...grid,ox:grid.ox+dx,oy:grid.oy+dy};
    const id=compressedAppearance(us(bitmap,shifted,row,col));
    if(id!==null&&id!==equipId)return null;
    if(id===equipId)phases.push(shifted);
  }
  for(const shifted of phases){
    if(p0(bitmap,shifted,row,col,Le.badgeBox)<Y.strictBadge
      ||p0(bitmap,shifted,row,col,Le.moatBox)>Y.strictMoat)continue;
    const q=classifyElementGlyph(bitmap,shifted,row,col,i1);
    if(q.key!==Fe[equip.element]||q.score<Y.weakGlyphCorr||q.margin<Y.glyphMargin
      ||q.score+2*q.margin<Y.glyphCombined)continue;
    const numberScore=M1(bitmap,shifted,last.row,last.col,Le.numberBox,number,
      [-.024,-.016,-.008,0,.008,.016,.024]);
    if(numberScore>=Y.numberAccept)return {grid:shifted,numberScore};
  }
  return null;
}

function recoverCompressedNumber(bitmap, grid, anchor, hits) {
  const id=compressedAppearance(anchor.sig),hit=hits.find(item=>item.eq.id===id);
  if(!hit || anchor.redConstrained && hit.eq.quality===5)return null;
  const phase=corroborateCompressedPhase(bitmap,grid,anchor.row,anchor.col,id);
  return phase?{...hit,numberScore:phase.numberScore}:null;
}

// For an unresolved cluster, repeat only uncertain member samples at the eight
// adjacent half-pixel phases. Every member must pass the original distance and
// separation gates independently. A phase that favors
// the other candidate rejects recovery. Previously accepted built-in OR stored
// choices are preserved; new evidence comes only from the built-in library.
function corroborateClusterSignature(clusters, candidates, pieces, bitmap, grid) {
  for (const cluster of clusters) {
    if (cluster.pieceIndexes.length < 2 || Er(cluster.signature, candidates)) continue;
    const samples = candidates.map(eq => ({eq, signatures:ot.filter(s => s.equipId === eq.id)}));
    if (samples.some(s => !s.signatures.length)) continue;
    let agreed = null, consistent = true;
    const aligned=[];
    for (const index of cluster.pieceIndexes) {
      const piece=pieces[index], signature = piece.signature;
      const rank=sig=>samples.map(s => ({id:s.eq.id, distance:Math.min(...s.signatures.map(t => n1(sig, t.sig)))}))
        .sort((a,b) => a.distance-b.distance),ranking=rank(signature);
      if (ranking[0].distance > Y.signatureMaxDistance || ranking[0].distance === ranking[1].distance
          || (agreed !== null && agreed !== ranking[0].id)) {consistent=false;break;}
      agreed=ranking[0].id;
      let verified=cs(signature,candidates,ot)?.id===agreed?signature:null;
      if(!verified){
        for(const dx of [-.5,0,.5])for(const dy of [-.5,0,.5]){
          if(dx===0&&dy===0)continue;
          const shifted=us(bitmap,{...grid,ox:grid.ox+dx,oy:grid.oy+dy},piece.row,piece.col),order=rank(shifted);
          if(order[0].id!==agreed||order[0].distance===order[1].distance){consistent=false;continue;}
          if(!verified&&cs(shifted,candidates,ot)?.id===agreed)verified=shifted;
        }
      }
      if(!verified||!consistent){consistent=false;break;}
      aligned.push(verified);
    }
    if(consistent&&aligned.length===cluster.pieceIndexes.length){
      // Keep an actual verified member: recomputing a mean can again reduce
      // separation because different templates may minimize each distance.
      cluster.signature=[...aligned[0]];
    }
  }
}

module.exports = function patchRecognitionCompressed({app, change}) {
  app = change(app, 'function Jr(t,e){', [corroborateCompressedAnchor,corroborateCompressedNearTie,
    compressedAppearance,corroborateCompressedPhase,recoverCompressedNumber,corroborateClusterSignature]
    .map(fn=>fn.toString()).join('\n')+'\nfunction Jr(t,e){');
  app = change(app,
    'if(j===void 0||F>Y.signatureBlindMaxDistance||H-F<Y.signatureMinMargin)continue;',
    'if(j===void 0||H-F<Y.signatureMinMargin||(F>Y.signatureBlindMaxDistance&&!corroborateCompressedAnchor(t,s,p,g,q,x,F)))continue;');
  app = change(app,'return $&&g.every(U=>$.numberScore>=U.numberScore-.02)?T($):M("共鸣数字读不出（或该共鸣值的模板缺失）")',
    'if($&&g.every(U=>$.numberScore>=U.numberScore-.02))return T($);const recovered=recoverCompressedNumber(t,s,p,g);return recovered?T(recovered):M("共鸣数字读不出（或该共鸣值的模板缺失）")');
  return change(app, 'O.push({key:g,candidates:q,clusters:k,impossible:M})',
    'if(!M)corroborateClusterSignature(k,q,I,t,s);O.push({key:g,candidates:q,clusters:k,impossible:M})');
};
module.exports.corroborateCompressedAnchor=corroborateCompressedAnchor;
module.exports.corroborateCompressedNearTie=corroborateCompressedNearTie;
module.exports.compressedAppearance=compressedAppearance;
module.exports.corroborateCompressedPhase=corroborateCompressedPhase;
module.exports.recoverCompressedNumber=recoverCompressedNumber;
module.exports.corroborateClusterSignature=corroborateClusterSignature;

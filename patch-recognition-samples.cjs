'use strict';

// Supplement the original appearance matcher with independently labelled
// offline-game samples. Thresholds and the shape/number checks stay unchanged.
module.exports=function patchRecognitionSamples({app,change,catalog,samples}){
  if(samples?.version!==1||!Array.isArray(samples.signatures)||!samples.signatures.length){
    throw new Error('Recognition samples are missing or have an unsupported version');
  }
  const equips=new Map(catalog.equips.map(eq=>[eq.id,eq]));
  const signatures=samples.signatures.map(({equipId,sig})=>{
    const eq=equips.get(equipId);
    if(!eq||!Array.isArray(sig)||sig.length!==48||sig.some(v=>!Number.isFinite(v)||v<0||v>255)){
      throw new Error('Invalid recognition appearance sample for '+equipId);
    }
    return {equipId,name:eq.name,sig};
  });
  // Replace only explicitly audited, mislabeled legacy samples. Every removed
  // equipment ID must have a replacement in the verified sample set.
  const replaceIds=samples.replaceBuiltinEquipIds??[];
  if(!Array.isArray(replaceIds)||replaceIds.some(id=>!signatures.some(s=>s.equipId===id))){
    throw new Error('Missing replacement for a legacy recognition sample');
  }
  const replace=replaceIds.length?`ot.splice(0,ot.length,...ot.filter(s=>!${JSON.stringify(replaceIds)}.includes(s.equipId)));`:'';
  app=change(app,'function Er(t,e){',`${replace}ot.push(...${JSON.stringify(signatures)});function Er(t,e){`);
  // At small scales, artwork inside a known item can resemble an element
  // badge. Remove such an interior anchor only when the parent appearance,
  // form, shape and resonance agree and the interior has no supporting form,
  // number candidate or appearance sample of its own.
  const pruneInteriorAnchors=`{
    const weak=n.filter(p=>!p.formName&&!p.band.length&&p.elementScore<Y.weakGlyphCorr&&ot.every(sample=>n1(p.sig,sample.sig)>Y.signatureMaxDistance)),hidden=new Set;
    if(weak.length)for(const p of n){
      if(!p.formName)continue;
      const candidates=ut.get(L0.get(p.elementName)+'|'+(Wr.get(p.formName)??0))??[];
      const ranked=candidates.map(eq=>({eq,d:Math.min(...ot.filter(sample=>sample.equipId===eq.id).map(sample=>n1(p.sig,sample.sig)))})).filter(x=>Number.isFinite(x.d)).sort((a,b)=>a.d-b.d);
      const best=ranked[0];if(!best||best.d>Y.signatureMaxDistance||(ranked[1]&&ranked[1].d-best.d<Y.signatureMinMargin))continue;
      const cells=Kr(best.eq.shapeId,p.row,p.col),numberCell=Xr(best.eq.shapeId,p.row,p.col);
      if(!cells||!numberCell)continue;
      const numberScore=c(numberCell.row,numberCell.col,best.eq.reson);
      if(!Number.isFinite(numberScore)||numberScore<Y.numberAccept)continue;
      const inside=n.filter(q=>q!==p&&cells.includes(X(q.row,q.col)));
      if(inside.length&&inside.every(q=>weak.includes(q)))for(const q of inside)hidden.add(q);
    }
    if(hidden.size){
      for(let i=n.length-1;i>=0;i--)if(hidden.has(n[i])){l.delete(X(n[i].row,n[i].col));n.splice(i,1);}
      for(const p of n){p.hits=f(p,p.formName?[p.formName]:['其他',...u(p)]);p.band=v(p.hits);}
    }
  }`;
  app=change(app,'const d=[],m=[];n.forEach((p,g)=>{',pruneInteriorAnchors+'const d=[],m=[];n.forEach((p,g)=>{');
  // Similar-looking, confidently identified twins must not collapse into one
  // appearance cluster and accidentally trip the two-copies red-item limit.
  app=change(app,'const d=[],m=[];n.forEach((p,g)=>{',
    'const sampleKnownIds=n.map(p=>{const ids=[...new Set(p.band.map(x=>x.eq.id))],rank=ids.map(id=>({id,d:Math.min(...ot.filter(s=>s.equipId===id).map(s=>n1(p.sig,s.sig)))})).filter(x=>Number.isFinite(x.d)).sort((a,b)=>a.d-b.d);return rank.length&&rank[0].d<=Y.signatureMaxDistance&&(rank.length===1||rank[1].d-rank[0].d>=Y.signatureMinMargin)?rank[0].id:null}),d=[],m=[];n.forEach((p,g)=>{');
  app=change(app,'if(n1(p.sig,d[q].sig)<Y.signatureMaxDistance){w=q;break}',
    'if(n1(p.sig,d[q].sig)<Y.signatureMaxDistance&&!d[q].members.some(i=>sampleKnownIds[g]&&sampleKnownIds[i]&&sampleKnownIds[g]!==sampleKnownIds[i])){w=q;break}');
  app=change(app,'F=k.find(x=>n1(P,x.signature)<Y.signatureMaxDistance)',
    'F=k.find(x=>n1(P,x.signature)<Y.signatureMaxDistance&&!x.pieceIndexes.some(i=>sampleKnownIds[T]&&sampleKnownIds[i]&&sampleKnownIds[T]!==sampleKnownIds[i]))');
  return app;
};

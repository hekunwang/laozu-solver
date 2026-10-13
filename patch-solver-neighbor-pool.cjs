'use strict';

// Applied after the star patch. Attribute buffs share one post-star pool.
// The positive-attribute numeric path follows equipment_numeric_v2 and the
// frozen live comparisons; untested rounding boundaries remain documented.
module.exports=function patchSolverNeighborPool({app,worker,change}){
  const oldBase=`function awBaseAttribute(raw,starMultiplier,baseBonus){
  return Math.floor(raw*starMultiplier*(1+baseBonus));
}`;
  const newBase=`function awBaseAttribute(raw,starMultiplier,baseBonus){
  const starBase=Math.floor(raw*starMultiplier);
  const boosted=Math.fround(Math.fround(starBase)*Math.fround(1+Math.fround(baseBonus)));
  return Math.trunc(Math.fround(boosted+.5));
}`;
  app=change(app,oldBase,newBase);
  worker=change(worker,oldBase,newBase);

  // The detailed UI scorer includes its matching attribute percentage in the
  // same pool as the global aura. Other channels, including damage, stay apart.
  app=change(app,
    'const N=k=>l1(I,E,s.talents,k,I.base.find(M=>M.attr===k)?.value??0,awPieceLevel(b,s),(globalBase[k]||0)/de)',
    'const N=k=>l1(I,E,s.talents,k,I.base.find(M=>M.attr===k)?.value??0,awPieceLevel(b,s),((globalBase[k]||0)+(y.get({2001:2004,2002:2005,2003:2006}[k])||0))/de)');
  app=change(app,
    'D=N(a1)*(1+(y.get(kt)??0)/de),_=N(o0)*(1+(y.get(At)??0)/de),p=N(d0)*(1+(y.get(qt)??0)/de)',
    'D=N(a1),_=N(o0),p=N(d0)');

  for(const attr of ['Atk','Def','Hp']){
    app=change(app,
      `awBaseAttribute(u.rawBase[s.i${attr}],u.starMultiplier,u.baseBonusMultiplier[s.i${attr}]+globalBase[s.i${attr}]/de)*(1+n[s.i${attr}Pct]/de)`,
      `awBaseAttribute(u.rawBase[s.i${attr}],u.starMultiplier,u.baseBonusMultiplier[s.i${attr}]+(globalBase[s.i${attr}]+n[s.i${attr}Pct])/de)`);
    worker=change(worker,
      `awBaseAttribute(u.rawBase[e.i${attr}],u.starMultiplier,u.baseBonusMultiplier[e.i${attr}]+globalBase[e.i${attr}]/E)*(1+o[e.i${attr}Pct]/E)`,
      `awBaseAttribute(u.rawBase[e.i${attr}],u.starMultiplier,u.baseBonusMultiplier[e.i${attr}]+(globalBase[e.i${attr}]+o[e.i${attr}Pct])/E)`);
  }

  for(const main of [true,false]){
    let source=change(main?app:worker,
      'awBaseAttribute(a.rawBase[attr],a.starMultiplier,a.baseBonusMultiplier[attr])*(1+values[pct]/10000)',
      'awBaseAttribute(a.rawBase[attr],a.starMultiplier,a.baseBonusMultiplier[attr]+values[pct]/10000)');
    // The isolated two-piece estimate includes both form and element auras.
    // a and b are separate physical pieces even when they share one profile.
    source=change(source,
      'for(const buff of b.adjBuffs)if(buff.elementMask&a.elementBit)values[buff.attrIndex]+=buff.value;',
      `for(const buff of b.adjBuffs)if(buff.elementMask&a.elementBit)values[buff.attrIndex]+=buff.value;
      for(const buff of b.globalBuffs)if(awGlobalMatches(buff,a)){const index=ctx.attrIndex.get(buff.attr);if(index!==undefined)values[index]+=buff.value;}`);
    if(main)app=source;else worker=source;
  }
  return {app,worker};
};

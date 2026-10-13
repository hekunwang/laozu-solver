'use strict';

// Apply after the instance, aura and search patches. Stars form a separate
// multiplier; the existing floor and post-base neighbor layer are retained.
module.exports = function patchSolverStarMultiplier({app, worker, change}) {
  const shared = `
function awBaseAttribute(raw,starMultiplier,baseBonus){
  return Math.floor(raw*starMultiplier*(1+baseBonus));
}
`;
  app=change(app,'function awEffects(',shared+'\nfunction awEffects(');
  worker=change(worker,'function awEffects(',shared+'\nfunction awEffects(');

  app=change(app,
    'o=l+i+(awEffects(t,level).baseBonus[a]||0)/de+extraGlobal;return o?Math.floor(n*(1+o)):n',
    'o=i+(awEffects(t,level).baseBonus[a]||0)/de+extraGlobal;return l||o?awBaseAttribute(n,1+l,o):n');
  worker=change(worker,
    'l=i+r+(awEffects(n,level).baseBonus[s]||0)/E+extraGlobal;return l?Math.floor(o*(1+l)):o',
    'l=r+(awEffects(n,level).baseBonus[s]||0)/E+extraGlobal;return i||l?awBaseAttribute(o,1+i,l):o');

  app=change(app,
    'baseBonusMultiplier:Float64Array.from(s,attr=>_t(v,m)+',
    'starMultiplier:1+_t(v,m),baseBonusMultiplier:Float64Array.from(s,attr=>');
  worker=change(worker,
    'baseBonusMultiplier:Float64Array.from(e,attr=>pt(c,f)+',
    'starMultiplier:1+pt(c,f),baseBonusMultiplier:Float64Array.from(e,attr=>');

  for(const attr of ['Atk','Def','Hp']){
    app=change(app,
      `Math.floor(u.rawBase[s.i${attr}]*(1+(u.baseBonusMultiplier[s.i${attr}]+globalBase[s.i${attr}]/de)))`,
      `awBaseAttribute(u.rawBase[s.i${attr}],u.starMultiplier,u.baseBonusMultiplier[s.i${attr}]+globalBase[s.i${attr}]/de)`);
    worker=change(worker,
      `Math.floor(u.rawBase[e.i${attr}]*(1+(u.baseBonusMultiplier[e.i${attr}]+globalBase[e.i${attr}]/E)))`,
      `awBaseAttribute(u.rawBase[e.i${attr}],u.starMultiplier,u.baseBonusMultiplier[e.i${attr}]+globalBase[e.i${attr}]/E)`);
  }

  // The pair-gain search guide must use the same star layer as full scoring.
  for(const main of [true,false]){
    const source=change(main?app:worker,
      'Math.floor(a.rawBase[attr]*(1+a.baseBonusMultiplier[attr]))',
      'awBaseAttribute(a.rawBase[attr],a.starMultiplier,a.baseBonusMultiplier[attr])');
    if(main)app=source;else worker=source;
  }
  return {app,worker};
};

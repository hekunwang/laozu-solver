'use strict';

// Applied after the awakening patches, to the main-thread and Worker engines.
module.exports = function patchInstanceEngine({app, worker, change}) {
  const shared = `
function awProfileKey(id,level){return String(id)+':'+String(level);}
function awProfileEquips(eq,options){
  const selected=options?.awaken?.[eq.id],levels=Array.isArray(selected)&&selected.length
    ?[...new Set(selected.map((_,copyIndex)=>awLevel(options,eq.id,copyIndex)))]
    :[awLevel(options,eq.id,0)];
  return levels.map(awakenLevel=>({...eq,awakenLevel}));
}
function awInstanceCandidates(catalog,holdings,usableCells,profileMap){
  const equips=new Map(catalog.equips.map(eq=>[eq.id,eq]));
  const sizes=new Map(catalog.shapes.map(shape=>[shape.id,shape.cells.length]));
  const groups=new Map,tiersSeen=new Map,copyCounts=new Map;
  for(const holding of holdings){
    if(holding.count<=0)continue;
    const eq=equips.get(holding.equipId);
    if(!eq)throw new Error('持有清单引用了不存在的法宝 '+holding.equipId);
    const tiers=tiersSeen.get(eq.groupId)??new Set;
    const separate=eq.groupId===0||tiers.has(eq.tier);
    tiers.add(eq.tier);tiersSeen.set(eq.groupId,tiers);
    const key=separate?'item:'+eq.id:'group:'+eq.groupId;
    const group=groups.get(key)??[];
    const start=copyCounts.get(eq.id)??0;
    for(let offset=0;offset<holding.count;offset++){
      const copyIndex=start+offset;
      group.push({equipId:eq.id,copyIndex,awakenLevel:awLevel({awaken:profileMap.awaken},eq.id,copyIndex)});
    }
    copyCounts.set(eq.id,start+holding.count);groups.set(key,group);
  }
  const candidates=[];let prunedCount=0;
  const keys=[...groups.keys()].sort((a,b)=>
    Math.min(...groups.get(a).map(piece=>piece.equipId))-Math.min(...groups.get(b).map(piece=>piece.equipId)));
  for(const key of keys){
    const pieces=groups.get(key).slice().sort((a,b)=>
      equips.get(b.equipId).tier-equips.get(a.equipId).tier||b.awakenLevel-a.awakenLevel||a.copyIndex-b.copyIndex);
    const size=sizes.get(equips.get(pieces[0].equipId).shapeId);
    const count=Math.min(pieces.length,Math.max(1,Math.floor(usableCells/size)));
    prunedCount+=pieces.length-count;
    for(const piece of pieces.slice(0,count)){
      const eq=equips.get(piece.equipId);
      const equipIndex=profileMap.get(awProfileKey(eq.id,piece.awakenLevel))??profileMap.get(eq.id);
      if(equipIndex===undefined)throw new Error('法宝 '+eq.id+' 不在结算上下文中');
      candidates.push({index:candidates.length,...piece,equipIndex,shapeId:eq.shapeId,name:eq.name,
        tier:eq.tier,element:eq.element,cells:sizes.get(eq.shapeId)});
    }
  }
  return {candidates,prunedCount};
}
`;
  app=change(app,'function awEffects(',shared+'\nfunction awEffects(');
  worker=change(worker,'function awEffects(',shared+'\nfunction awEffects(');

  app=change(app,'for(const v of t.equips){const d=new Float64Array(n),m=e.elderStars?.[v.id];',
    'u.awaken=e.awaken||{};for(const original of t.equips)for(const v of awProfileEquips(original,e)){const d=new Float64Array(n),m=e.elderStars?.[v.id];');
  app=change(app,'u.set(v.id,c.length),c.push({equipId:v.id,',
    'u.has(v.id)||u.set(v.id,c.length),u.set(awProfileKey(v.id,v.awakenLevel),c.length),c.push({equipId:v.id,awakenLevel:v.awakenLevel,');
  worker=change(worker,'for(const c of n.equips){const h=new Float64Array(o),f=t.elderStars?.[c.id];',
    'u.awaken=t.awaken||{};for(const original of n.equips)for(const c of awProfileEquips(original,t)){const h=new Float64Array(o),f=t.elderStars?.[c.id];');
  worker=change(worker,'u.set(c.id,p.length),p.push({equipId:c.id,',
    'u.has(c.id)||u.set(c.id,p.length),u.set(awProfileKey(c.id,c.awakenLevel),p.length),p.push({equipId:c.id,awakenLevel:c.awakenLevel,');

  function replaceCandidateBuilder(source,start,end,replacement){
    const first=source.indexOf(start),last=source.indexOf(end,first);
    if(first<0||last<0)throw new Error('Instance candidate builder boundaries missing: '+start);
    return change(source,source.slice(first,last),replacement);
  }
  app=replaceCandidateBuilder(app,'const Sn=(',',se=-1;',
    'const Sn=(t,e,s,a)=>awInstanceCandidates(t,e,s,a)');
  worker=replaceCandidateBuilder(worker,'const yt=(',',g=-1;',
    'const yt=(n,t,e,s)=>awInstanceCandidates(n,t,e,s)');

  app=change(app,'return{candidateIndex:t,equipId:n.equipId,name:n.name,',
    'return{candidateIndex:t,equipId:n.equipId,copyIndex:n.copyIndex,awakenLevel:n.awakenLevel,name:n.name,');
  worker=change(worker,'return{candidateIndex:n,equipId:o.equipId,name:o.name,',
    'return{candidateIndex:n,equipId:o.equipId,copyIndex:o.copyIndex,awakenLevel:o.awakenLevel,name:o.name,');

  app=change(app,'awSkills(I,s.awaken?.[I.id]||0)',
    'awSkills(I,awPieceLevel(b,s))');
  app=change(app,'awSkills(M,s.awaken?.[M.id]||0)',
    'awSkills(M,awPieceLevel(e[k],s))');
  app=change(app,'awEffects(sourceEq,s.awaken?.[sourceEq.id]||0)',
    'awEffects(sourceEq,awPieceLevel(e[source],s))');
  app=change(app,'s.awaken?.[I.id]||0,(globalBase[k]||0)/de',
    'awPieceLevel(b,s),(globalBase[k]||0)/de');
  app=change(app,'s.awaken?.[I.id]||0,(globalBase[k.attr]||0)/de',
    'awPieceLevel(b,s),(globalBase[k.attr]||0)/de');

  return {app,worker};
};

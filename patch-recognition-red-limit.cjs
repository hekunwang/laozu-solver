'use strict';

// Appearance clusters are not equipment identities: awakening lighting can
// split one ID, and unresolved old/new equipment can share a candidate band.
// Check whether the candidate IDs admit the game's red-item limits, without
// selecting or confirming any unresolved identity.
function screenshotRedLimitFeasible(domains) {
  if (domains.length > 4) return false;
  const pending = domains.map(ids => [...new Set(ids)]).sort((a, b) => a.length - b.length);
  if (pending.some(ids => !ids.length)) return false;
  const counts = new Map();
  function assign(index) {
    if (index === pending.length) return true;
    for (const id of pending[index]) {
      const count = counts.get(id) || 0;
      if (count >= 2 || !count && counts.size >= 2) continue;
      counts.set(id, count + 1);
      if (assign(index + 1)) return true;
      if (count) counts.set(id, count); else counts.delete(id);
    }
    return false;
  }
  return assign(0);
}

function redCandidateConstraints(anchors) {
  const required = anchors.filter(anchor => anchor.onlyRed).map(anchor => anchor.redIds);
  // An already inconsistent red-only set must not force another item into a
  // weaker non-red identity. The final rule guard will reject resolved reds.
  if (!screenshotRedLimitFeasible(required)) return anchors.map(() => false);
  return anchors.map(anchor => !anchor.onlyRed && anchor.hasRed
    && !screenshotRedLimitFeasible([...required, anchor.redIds]));
}

function screenshotEnforceResolvedRedLimits(result, counts, equipment, layout, suspects) {
  const reds = Object.entries(counts).filter(([id]) => equipment.get(Number(id))?.quality === 5);
  if (reds.length <= 2 && reds.every(([, count]) => count <= 2)) return;
  const ids = new Set(reds.map(([id]) => Number(id)));
  // Feasibility never chooses identities. A later automatic or manual cluster
  // choice must independently obey the same limits before entering a layout.
  for (let index = layout.length - 1; index >= 0; index--) {
    if (!ids.has(layout[index].equipId)) continue;
    const piece = result.pieces[layout[index].importPieceIndex];
    suspects.push({row: piece.row, col: piece.col,
      reason: '红色法宝数量违反游戏规则（最多 2 种、每种 2 个），请重新核对候选'});
    layout.splice(index, 1);
  }
  for (const [id] of reds) { delete counts[id]; equipment.delete(Number(id)); }
}

module.exports = function patchRecognitionRedLimit({app, change}) {
  app = change(app,
    'function Vr(t,e){const s=t.map(l=>l.onlyRed),a=new Set(t.filter((l,i)=>s[i]).map(l=>l.cluster)),n=new Map;return t.forEach((l,i)=>{s[i]&&n.set(l.cluster,(n.get(l.cluster)??0)+1)}),t.map((l,i)=>s[i]||!l.hasRed?!1:(e[l.cluster]??0)>=3||(n.get(l.cluster)??0)>=2||!a.has(l.cluster)&&a.size>=2)}',
    screenshotRedLimitFeasible.toString() + '\n' + redCandidateConstraints.toString() + '\n'
      + screenshotEnforceResolvedRedLimits.toString() + '\nfunction Vr(t){return redCandidateConstraints(t)}');
  app = change(app,
    'const A=Vr(n.map((p,g)=>({hasRed:p.band.some(w=>w.eq.quality===5),onlyRed:p.band.length>0&&p.band.every(w=>w.eq.quality===5),cluster:m[g]})),d.map(p=>p.members.length));',
    'const A=Vr(n.map(p=>({hasRed:p.band.some(w=>w.eq.quality===5),onlyRed:p.band.length>0&&p.band.every(w=>w.eq.quality===5),redIds:p.band.filter(w=>w.eq.quality===5).map(w=>w.eq.id)})));');
  app = change(app,
    ',g=new Map;for(const{i:w}of p){const q=m[w];g.set(q,(g.get(q)??0)+1)}if(g.size>2||[...g.values()].some(w=>w>2)){S=!0;',
    ';if(!screenshotRedLimitFeasible(p.map(({p:w})=>w.status==="ok"?[w.equip.id]:w.candidates.filter(q=>q.quality===5).map(q=>q.id)))){S=!0;');
  app = change(app,
    'a.push(awImportMetadata(u,o,c,awCopies)))}),{counts:e,countList:',
    'a.push(awImportMetadata(u,o,c,awCopies)))}),screenshotEnforceResolvedRedLimits(t,e,s,a,n),{counts:e,countList:');
  return app;
};

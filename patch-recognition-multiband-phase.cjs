'use strict';

// Half-pixel sampling phase can move a signature just outside the existing
// rescue threshold. Only recover a multi-ID band when independent glyph and
// terminal-number evidence agrees, all nine phases agree across the complete
// built-in signature library, and several phases satisfy the original limits.
function multiBandPhaseIdentity(ranks, candidateIds, thresholds) {
  if (ranks.length !== 9 || new Set(candidateIds).size < 3) return null;
  const id = ranks[0]?.[0]?.id;
  if (!candidateIds.includes(id)) return null;
  let verified = 0;
  for (const rank of ranks) {
    const best = rank[0], next = rank[1];
    if (!best || !next || best.id !== id || !Number.isFinite(best.distance)
        || !Number.isFinite(next.distance) || best.distance > thresholds.signatureMaxDistance) return null;
    const margin = next.distance - best.distance;
    if (margin <= 0 || next.distance <= thresholds.signatureMaxDistance
        && margin < thresholds.signatureMinMargin) return null;
    if (best.distance <= thresholds.signatureRescueMaxDistance
        && margin >= thresholds.signatureMinMargin) verified++;
  }
  return verified >= 3 ? id : null;
}

function recoverMultiBandPhase(bitmap, grid, anchor, candidates) {
  if (new Set(candidates.map(candidate => candidate.eq.id)).size < 3 || !anchor.formName) return null;
  const element = classifyElementGlyph(bitmap, grid, anchor.row, anchor.col, i1);
  if (element.key !== anchor.elementName
      || !screenshotElementCertain(element, p0(bitmap, grid, anchor.row, anchor.col, Le.moatBox))) return null;
  const form = fs([...ms].map(([key, template]) => ({key,
    score: M1(bitmap, grid, anchor.row, anchor.col, Le.formBox, template)})));
  if (form.key !== anchor.formName || !Number.isFinite(form.score) || !Number.isFinite(form.margin)
      || form.score < Y.formCorr || form.margin < Y.formMargin) return null;

  const samples = new Map();
  for (const sample of ot) {
    const group = samples.get(sample.equipId) || [];
    group.push(sample.sig); samples.set(sample.equipId, group);
  }
  if (candidates.some(candidate => !samples.has(candidate.eq.id))) return null;
  const ranks = [];
  for (const dx of [-.5, 0, .5]) for (const dy of [-.5, 0, .5]) {
    const signature = us(bitmap, {...grid, ox: grid.ox + dx, oy: grid.oy + dy}, anchor.row, anchor.col);
    ranks.push([...samples].map(([id, signatures]) => ({id,
      distance: Math.min(...signatures.map(sample => n1(signature, sample)))}))
      .sort((a, b) => a.distance - b.distance));
  }
  const id = multiBandPhaseIdentity(ranks, candidates.map(candidate => candidate.eq.id), Y);
  const chosen = candidates.find(candidate => candidate.eq.id === id);
  if (!chosen || Fe[chosen.eq.element] !== element.key || Wr.get(form.key) !== chosen.eq.weaponForm
      || !Number.isFinite(chosen.numberScore) || chosen.numberScore < Y.numberAccept) return null;
  const cells = Kr(chosen.eq.shapeId, anchor.row, anchor.col);
  const last = Xr(chosen.eq.shapeId, anchor.row, anchor.col);
  if (!cells || !last || cells.join(',') !== chosen.cells?.join(',')
      || last.row !== chosen.numberCell?.row || last.col !== chosen.numberCell?.col) return null;
  // Read all number templates at this candidate's own terminal cell. Another
  // shape or a number elsewhere on the board cannot corroborate this identity.
  const reading = fs([...Or].map(([key, template]) => ({key,
    score: M1(bitmap, grid, last.row, last.col, Le.numberBox, template,
      [-.024, -.016, -.008, 0, .008, .016, .024])})));
  if (reading.key !== String(chosen.eq.reson) || !Number.isFinite(reading.score)
      || !Number.isFinite(reading.margin) || reading.score < Y.numberAccept
      || reading.margin < Y.numberMargin) return null;
  return chosen;
}

module.exports = function patchRecognitionMultiBandPhase({app, change}) {
  app = change(app, 'function Jr(t,e){', multiBandPhaseIdentity.toString() + '\n'
    + recoverMultiBandPhase.toString() + '\nfunction Jr(t,e){');
  app = change(app,
    'const j=h(p.sig,x);return j?T(j):M(`数字分同档的候选有 ${x.length} 个，无法唯一确定`)',
    'const j=h(p.sig,x)??recoverMultiBandPhase(t,s,p,x);return j?T(j):M(`数字分同档的候选有 ${x.length} 个，无法唯一确定`)');
  return app;
};

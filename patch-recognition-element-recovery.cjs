'use strict';

// An accepted small element glyph can still be wrong (for example 火 -> 土).
// Recover only with independent built-in appearance, shape and number evidence.
// Keep the existing recognition thresholds, grid fit and ambiguity handling.
function recoverElementByAppearance(anchors, samples, equipment, elementName,
  distance, shapeCells, numberCell, numberScore, cellIndex, thresholds, glyphScore) {
  const occupiedAnchors = new Set(anchors.map(p => cellIndex(p.row, p.col)));
  for (const anchor of anchors) {
    const byEquipment = new Map();
    for (const sample of samples) {
      const value = distance(anchor.sig, sample.sig);
      if (!Number.isFinite(value)) continue;
      if (!byEquipment.has(sample.equipId) || value < byEquipment.get(sample.equipId)) {
        byEquipment.set(sample.equipId, value);
      }
    }
    const ranked = [...byEquipment].sort((a, b) => a[1] - b[1]);
    if (!ranked.length || ranked[0][1] > thresholds.signatureRescueMaxDistance) continue;
    if (ranked.length > 1 && ranked[1][1] - ranked[0][1] < thresholds.signatureMinMargin) continue;
    const equip = equipment.get(ranked[0][0]);
    if (!equip || elementName[equip.element] === anchor.elementName) continue;
    const cells = shapeCells(equip.shapeId, anchor.row, anchor.col);
    const last = numberCell(equip.shapeId, anchor.row, anchor.col);
    const first = cellIndex(anchor.row, anchor.col);
    if (!cells || !last || cells.some(cell => cell !== first && occupiedAnchors.has(cell))) continue;
    const number = numberScore(last.row, last.col, equip.reson);
    if (!Number.isFinite(number) || number < thresholds.numberAccept) continue;
    anchor.elementName = elementName[equip.element];
    if (glyphScore) anchor.elementScore = glyphScore(anchor, equip.element);
  }
}

module.exports = function patchElementRecovery({app, change}) {
  app = change(app, 'function Jr(t,e){', recoverElementByAppearance.toString() + '\nfunction Jr(t,e){');
  app = change(app, 'for(const p of n){const g=u(p);',
    'recoverElementByAppearance(n,ot,new Map(S0.map(eq=>[eq.id,eq])),Fe,n1,Kr,Xr,c,X,Y,(p,element)=>M1(t,s,p.row,p.col,Le.elementBox,i1.get(Fe[element])));for(const p of n){const g=u(p);');
  return app;
};
module.exports.recoverElementByAppearance = recoverElementByAppearance;

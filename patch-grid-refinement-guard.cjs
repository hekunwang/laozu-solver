'use strict';

// Glyph correlation alone can prefer artwork over the board badges. Preserve
// the input grid when refinement loses both badge anchors and board colors.
// A tradeoff or an improvement keeps the existing refinement decision.
function guardRefinedGrid(bitmap, original, refined, countAnchors, scoreGrid) {
  if (refined === original) return original;
  return countAnchors(bitmap, refined) < countAnchors(bitmap, original)
    && scoreGrid(bitmap, refined) < scoreGrid(bitmap, original) ? original : refined;
}

module.exports = function patchGridRefinementGuard({app, change}) {
  for (const [name, anchors, colors] of [['gs','vs','e1'], ['refineLatticeGlyphs','_','z']]) {
    const start=app.indexOf('function '+name+'(');
    const end=app.indexOf('return o.g}',start);
    if(start<0||end<start)throw Error('Grid refinement tail missing: '+name);
    const old=app.slice(start,end+'return o.g}'.length);
    const next=guardRefinedGrid.toString()+'\n'+old.replace('return o.g}',
      'return guardRefinedGrid(t,e,o.g,'+anchors+','+colors+')}');
    app=change(app,old,next);
  }
  return app;
};
module.exports.guardRefinedGrid=guardRefinedGrid;

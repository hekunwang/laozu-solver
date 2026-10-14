'use strict';

// A no-op refinement returns the input object. On the same immutable bitmap,
// running it again would select the same anchors and examine the same candidates.
// A changed grid must still receive the second pass (including after row shifts).
function refineGridPair(bitmap, grid, refine) {
  const first = refine(bitmap, grid);
  return first === grid ? first : refine(bitmap, first);
}

// Keep the original coordinate arithmetic, RGB addition order, Float64 values,
// row-major accumulation, variance and normalization. Only remove repeated axis
// calculations, per-pixel RGB arrays and the second patch-sized allocation.
function sampleGlyphPatch(bitmap, grid, row, col, box, shiftX = 0, shiftY = 0) {
  const size = GLYPH_GEOMETRY.patchSize;
  const patch = new Float64Array(size * size), xs = new Float64Array(size);
  const rgba = bitmap.gridRgba, rgb = bitmap.gridRgb;
  for (let x = 0; x < size; x++) {
    const u = box[0] + (x + .5) / size * (box[2] - box[0]) + shiftX;
    xs[x] = Math.round(grid.ox + col * grid.pw + u * grid.pw);
  }
  for (let y = 0; y < size; y++) {
    const v = box[1] + (y + .5) / size * (box[3] - box[1]) + shiftY;
    const py = Math.round(grid.oy + row * grid.ph + v * grid.ph);
    for (let x = 0; x < size; x++) {
      const px = xs[x];
      let value = 128;
      if (px >= 0 && py >= 0 && px < bitmap.w && py < bitmap.h) {
        if (rgba) {
          const offset = (py * bitmap.w + px) * 4;
          value = (rgba[offset] + rgba[offset + 1] + rgba[offset + 2]) / 3;
        } else if (rgb) {
          const offset = (py * bitmap.w + px) * 3;
          value = (rgb[offset] + rgb[offset + 1] + rgb[offset + 2]) / 3;
        } else {
          const pixel = bitmap.px(px, py);
          value = (pixel[0] + pixel[1] + pixel[2]) / 3;
        }
      }
      patch[y * size + x] = value;
    }
  }
  let mean = 0;
  for (let i = 0; i < patch.length; i++) mean += patch[i];
  mean /= patch.length;
  let variance = 0;
  for (let i = 0; i < patch.length; i++) variance += (patch[i] - mean) ** 2;
  const deviation = Math.sqrt(variance / patch.length) || 1;
  for (let i = 0; i < patch.length; i++) patch[i] = (patch[i] - mean) / deviation;
  return patch;
}

module.exports = function patchGridRefineSpeed({app, change}) {
  for (const [name, next, geometry] of [['Ma', 'Sa', 'fe'], ['K', 'V', 'g']]) {
    const start = app.indexOf('function ' + name + '(');
    const end = app.indexOf('const ' + next + '=', start);
    if (start < 0 || end < start) throw Error('Glyph patch sampler anchor missing: ' + name);
    const sampler = sampleGlyphPatch.toString()
      .replace('function sampleGlyphPatch(', 'function ' + name + '(')
      .replace('GLYPH_GEOMETRY', geometry);
    app = change(app, app.slice(start, end), sampler);
  }
  // This patch follows patch-grid-lattice, which emits both implementations.
  for (const name of ['gs', 'refineLatticeGlyphs']) {
    app = change(app, 'function ' + name + '(', refineGridPair.toString() + '\nfunction ' + name + '(');
  }
  app = change(app, 'refine(bitmap,refine(bitmap,candidate.grid))',
    'refineGridPair(bitmap,candidate.grid,refine)', 2);
  app = change(app, 'function Jr(t,e){const s=gs(t,gs(t,e)),',
    'function Jr(t,e){const s=refineGridPair(t,e,gs),');
  return app;
};
module.exports.refineGridPair = refineGridPair;
module.exports.sampleGlyphPatch = sampleGlyphPatch;

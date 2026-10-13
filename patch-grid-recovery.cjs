'use strict';

// A high background-color score alone can accept a grid with the wrong pitch.
// Fewer than three anchors cannot reliably establish a lattice. Leave sparse
// but already supported fits alone so a rescue does not penalize valid boards.
// Make one bounded second attempt at a consistent sampling resolution, then
// verify its evidence against the original pixels before replacing the result.
function recoverScreenshotGrid(bitmap, fitOriginal, countAnchors, scoreGrid) {
  const original = fitOriginal(bitmap);
  if (original.anchors >= 3 || bitmap.w <= 576) return original;

  const width = 576, height = Math.max(1, Math.round(bitmap.h * width / bitmap.w));
  const sx = bitmap.w / width, sy = bitmap.h / height;
  const pixels = new Float64Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = Math.max(0, Math.min(bitmap.w - 1, (x + .5) * sx - .5));
    const v = Math.max(0, Math.min(bitmap.h - 1, (y + .5) * sy - .5));
    const x0 = Math.floor(u), y0 = Math.floor(v), dx = u - x0, dy = v - y0;
    const x1 = Math.min(bitmap.w - 1, x0 + 1), y1 = Math.min(bitmap.h - 1, y0 + 1);
    const a = bitmap.px(x0, y0), b = bitmap.px(x1, y0);
    const c = bitmap.px(x0, y1), d = bitmap.px(x1, y1);
    const offset = (y * width + x) * 3;
    for (let channel = 0; channel < 3; channel++) {
      pixels[offset + channel] = (a[channel] * (1 - dx) + b[channel] * dx) * (1 - dy)
        + (c[channel] * (1 - dx) + d[channel] * dx) * dy;
    }
  }
  const small = {w: width, h: height, gridRgb: pixels, px: (x, y) => {
    const i = (y * width + x) * 3;
    return [pixels[i], pixels[i + 1], pixels[i + 2]];
  }};
  // Call the original fitter, not this wrapper: never retry recursively.
  const fit = fitOriginal(small);
  if (!fit.converged) return original;
  const grid = {ox: fit.grid.ox * sx, oy: fit.grid.oy * sy,
    pw: fit.grid.pw * sx, ph: fit.grid.ph * sy};
  const anchors = countAnchors(bitmap, grid);
  if (anchors < 6 || anchors <= original.anchors) return original;
  return {grid, score: scoreGrid(bitmap, grid), anchors, converged: true};
}

module.exports = function patchGridRecovery({app, change}) {
  const helper = recoverScreenshotGrid.toString();
  app = change(app, 'function zr(t){', 'function gridFitOriginal(t){');
  app = change(app, 'const Ur=1500,Gr=', helper +
    '\nfunction zr(t){return recoverScreenshotGrid(t,gridFitOriginal,vs,e1)}const Ur=1500,Gr=');
  app = change(app, 'function nA(t){', 'function gridFitOriginal(t){');
  app = change(app, 'const S=t=>{self.postMessage(t)};', helper +
    '\nfunction nA(t){return recoverScreenshotGrid(t,gridFitOriginal,_,z)}const S=t=>{self.postMessage(t)};');
  return app;
};
module.exports.recoverScreenshotGrid = recoverScreenshotGrid;

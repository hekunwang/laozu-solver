/* Tiny, deterministic talent-card segmentation. No OCR engine or DOM required.
 * The context bitmap is the shared 共鸣神通 UI title cropped at [526,725,649,752]
 * from talent-ocr-research/xindong/1369428024.jpg. It is not a blind-test image.
 * Name identities are deliberately left to the separate game-font matcher.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LaozuTalentLiteSegmentation = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const WIDTH = 864;
  const ANCHOR_BITS = 'DwAAAAAAAwAAAAAAAAAAGAAwAAAAGAAAAAYAAAAAL4CBAwAAwAAAADAAAPD/+AEcHAAAAH8AOIADAADDxw9A4AAAAP8HwAAcABwADnwAAwcAABgwAAD+H+AAOQADODgAAICAAQD4/wAA+AAA+P8fAAAGBADAOAYAgAcAwB9fAPwxMwA/xjAAAPwHADAwAOCPiQH+MYYBP+4xAACBAQBjDAwAjjEM+BCGAQAIDAAIYyAAMPw/AIZwDABAYABAGAMAgOD/ARD8PwAAAwMAQhgIAAZjDMBgjAEAGBgAEML/A7gYQwADYQgAwP//gBD+H+DJGAI4iGcA/P//B4QA4IAPxhiAw/8D4GEAECAEAANm8P8AMMMYAAAAAAA/ABgwgv8HgBjGAAAIAAD4+c8AGIgBAMYwBgBgQABAwAcGwAAMADiAAACAAw4AAAAwAAZgAOATAAAAD+AAAADAABAAAwD7AwAAPAAOAAAABoAAGAAA+APgYAAgAAAAMAAEwAAAAPyPBwIAAAAAgAAAAAAAAAB+PgAAAAAAAAAAAAAAAAAA8AA=';

  function validate(input) {
    if (!input || !Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width < 1 || input.height < 1 || input.width > 8192 || input.height > 8192 || input.width * input.height > 20000000) throw new TypeError('Invalid RGBA image dimensions');
    if (!ArrayBuffer.isView(input.data) || input.data.BYTES_PER_ELEMENT !== 1 || input.data.length !== input.width * input.height * 4) throw new TypeError('Expected one RGBA byte array');
    return input;
  }

  function resize(input, width, height) {
    const source = input.data, sw = input.width, sh = input.height;
    const output = new Uint8ClampedArray(width * height * 4);
    // Upscaling interpolated RGB would erode the tiny white cores before the
    // contrast mask. Preserve source pixels; later template resampling smooths
    // the binary strokes without inventing brighter text pixels.
    if (width > sw) {
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const sy = Math.min(sh - 1, Math.floor((y + .5) * sh / height)), sx = Math.min(sw - 1, Math.floor((x + .5) * sw / width));
        for (let c = 0; c < 4; c++) output[(y * width + x) * 4 + c] = source[(sy * sw + sx) * 4 + c];
      }
      return { data: output, width, height };
    }
    for (let y = 0; y < height; y++) {
      const fy = Math.max(0, Math.min(sh - 1, (y + .5) * sh / height - .5));
      const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), dy = fy - y0;
      for (let x = 0; x < width; x++) {
        const fx = Math.max(0, Math.min(sw - 1, (x + .5) * sw / width - .5));
        const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), dx = fx - x0;
        const p00 = (y0 * sw + x0) * 4, p01 = (y0 * sw + x1) * 4, p10 = (y1 * sw + x0) * 4, p11 = (y1 * sw + x1) * 4;
        const target = (y * width + x) * 4;
        for (let c = 0; c < 4; c++) output[target + c] = (source[p00 + c] * (1 - dx) + source[p01 + c] * dx) * (1 - dy) + (source[p10 + c] * (1 - dx) + source[p11 + c] * dx) * dy;
      }
    }
    return { data: output, width, height };
  }

  function makeMasks(input) {
    const { data, width, height } = input, count = width * height;
    const gray = new Uint8Array(count), hmin = new Uint8Array(count), white = new Uint8Array(count), muted = new Uint8Array(count);
    const qualities = [new Uint8Array(count), new Uint8Array(count), new Uint8Array(count), new Uint8Array(count), new Uint8Array(count)];
    for (let p = 0; p < count; p++) {
      const i = p * 4, alpha = data[i + 3] / 255;
      const r = data[i] * alpha + 255 * (1 - alpha), g = data[i + 1] * alpha + 255 * (1 - alpha), b = data[i + 2] * alpha + 255 * (1 - alpha);
      gray[p] = (r + g + b) / 3;
      qualities[0][p] = r >= 40 && r <= 130 && Math.max(r, g, b) - Math.min(r, g, b) <= 25;
      // Quality 1 is green. Its hue is a candidate filter only: the available
      // natural fixtures do not include a green talent for identity validation.
      qualities[1][p] = g - r >= 10 && g - b >= 10 && g >= 80 && g <= 225 && r >= 30 && b >= 30;
      qualities[2][p] = b - r >= 10 && g - r >= 15 && g >= 85 && b <= 220 && r >= 40;
      qualities[3][p] = r - g >= 15 && b - g >= 15 && Math.abs(r - b) <= 70 && r >= 115 && r <= 230 && g >= 65;
      qualities[4][p] = r - g >= 12 && r - g <= 60 && g - b >= 12 && g - b <= 70 && r >= 120 && r <= 235 && g >= 85;
      white[p] = r >= 205 && g >= 205 && b >= 185 && Math.max(r, g, b) - Math.min(r, g, b) <= 65;
      muted[p] = r >= 105 && g >= 100 && b >= 95 && Math.max(r, g, b) <= 205 && Math.max(r, g, b) - Math.min(r, g, b) <= 45;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let value = 255;
      for (let xx = Math.max(0, x - 3); xx <= Math.min(width - 1, x + 3); xx++) value = Math.min(value, gray[y * width + xx]);
      hmin[y * width + x] = value;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!white[p] && !muted[p]) continue;
      let value = 255;
      for (let yy = Math.max(0, y - 3); yy <= Math.min(height - 1, y + 3); yy++) value = Math.min(value, hmin[yy * width + x]);
      white[p] = white[p] && gray[p] - value >= 35;
      muted[p] = muted[p] && gray[p] - value >= 25;
    }
    return { white, muted, qualities };
  }

  function runs(values, threshold, gap) {
    const output = []; let start = -1, last = -1;
    for (let index = 0; index < values.length; index++) if (values[index] >= threshold) {
      if (start < 0) start = index;
      else if (index - last > gap + 1) { output.push([start, last + 1]); start = index; }
      last = index;
    }
    if (start >= 0) output.push([start, last + 1]);
    return output;
  }

  function boxSum(mask, width, box) {
    let sum = 0;
    for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) sum += mask[y * width + x];
    return sum;
  }

  function tightBox(mask, width, box) {
    let x0 = box[2], y0 = box[3], x1 = box[0], y1 = box[1];
    for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) if (mask[y * width + x]) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
    }
    return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
  }

  function badgeExtent(mask, width, height, box) {
    const [x0, y0, x1, y1] = box, th = y1 - y0;
    const sx0 = Math.max(0, x0 - Math.round(th * 2.5)), sx1 = Math.min(width, x1 + Math.round(th * 2.5));
    const sy0 = Math.max(0, y0 - Math.round(th * .6)), sy1 = Math.min(height, y1 + Math.round(th * .6));
    const columns = new Uint16Array(sx1 - sx0);
    for (let y = sy0; y < sy1; y++) for (let x = sx0; x < sx1; x++) columns[x - sx0] += mask[y * width + x];
    const cx = (x0 + x1) / 2 - sx0;
    const span = runs(columns, Math.max(2, Math.round((sy1 - sy0) * .12)), 3).find(([a, b]) => a <= cx && cx < b);
    if (!span) return null;
    const [a, b] = span, rows = new Uint16Array(sy1 - sy0);
    for (let y = sy0; y < sy1; y++) for (let x = sx0 + a; x < sx0 + b; x++) rows[y - sy0] += mask[y * width + x];
    const cy = (y0 + y1) / 2 - sy0;
    const yspan = runs(rows, Math.max(2, Math.round((b - a) * .25)), 3).find(([c, d]) => c <= cy && cy < d);
    return yspan ? [sx0 + a, sy0 + yspan[0], sx0 + b, sy0 + yspan[1]] : null;
  }

  function wordCandidates(image, masks, mutedMode) {
    const { width, height } = image, { qualities } = masks, white = mutedMode ? masks.muted : masks.white;
    const left = Math.round(width * .49), right = Math.round(width * .98), top = Math.round(height * .15), bottom = Math.round(height * .60);
    const rows = new Uint16Array(bottom - top), output = [];
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) rows[y - top] += white[y * width + x];
    for (const [a, b] of runs(rows, 6, 2)) {
      if (b - a < 8 || b - a > 44) continue;
      const columns = new Uint16Array(right - left);
      for (let y = top + a; y < top + b; y++) for (let x = left; x < right; x++) columns[x - left] += white[y * width + x];
      for (const [c, d] of runs(columns, 1, Math.max(2, Math.round((b - a) * .45)))) {
        const box = tightBox(white, width, [left + c, top + a, left + d, top + b]);
        if (!box) continue;
        const [x0, y0, x1, y1] = box, tw = x1 - x0, th = y1 - y0;
        if (th < 10 || th > 40 || tw / th < .8 || tw / th > 7) continue;
        const patch = [Math.max(0, x0 - 10), Math.max(0, y0 - 5), Math.min(width, x1 + 10), Math.min(height, y1 + 5)];
        const area = (patch[2] - patch[0]) * (patch[3] - patch[1]), scores = {};
        const allowed = mutedMode ? [0] : [1, 2, 3, 4];
        for (const q of allowed) scores[q] = boxSum(qualities[q], width, patch) / area;
        const ranked = allowed.sort((x, y) => scores[y] - scores[x]), q = scores[ranked[0]] >= .14 ? ranked[0] : null;
        if (mutedMode && q === null) continue;
        output.push({ bbox: box, badgeROI: q !== null ? badgeExtent(qualities[q], width, height, box) : null, qualityCandidates: q !== null ? [q] : [], qualityScores: scores, inkHeight: th, inkWidth: tw, inkDensity: boxSum(white, width, box) / (tw * th), inkMode: mutedMode ? 'muted' : 'white' });
      }
    }
    return output;
  }

  function decodeTemplate() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', bytes = [];
    let value = 0, bits = 0;
    for (const c of ANCHOR_BITS) {
      const n = alphabet.indexOf(c); if (n < 0) continue;
      value = value * 64 + n; bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); value &= (1 << bits) - 1; }
    }
    const data = new Float32Array(123 * 27);
    for (let i = 0; i < data.length; i++) data[i] = (bytes[i >> 3] >> (i & 7)) & 1;
    return { data, width: 123, height: 27 };
  }

  function resizeMono(input, width, height) {
    const output = new Float32Array(width * height), sw = input.width, sh = input.height, data = input.data;
    const intermediate = new Float32Array(width * sh);
    const weights = (source, target) => Array.from({ length: target }, (_, i) => {
      const scale = source / target, center = (i + .5) * scale - .5, radius = Math.max(1, scale), entries = [];
      let total = 0;
      for (let j = Math.max(0, Math.ceil(center - radius)); j <= Math.min(source - 1, Math.floor(center + radius)); j++) {
        const value = Math.max(0, 1 - Math.abs(j - center) / radius); entries.push([j, value]); total += value;
      }
      return entries.map(([j, value]) => [j, value / total]);
    });
    const wx = weights(sw, width), wy = weights(sh, height);
    for (let y = 0; y < sh; y++) for (let x = 0; x < width; x++) {
      let sum = 0; for (const [xx, weight] of wx[x]) sum += data[y * sw + xx] * weight;
      intermediate[y * width + x] = sum;
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0; for (const [yy, weight] of wy[y]) sum += intermediate[yy * width + x] * weight;
      output[y * width + x] = sum;
    }
    return { data: output, width, height };
  }

  const anchorSource = decodeTemplate();
  const anchorTemplates = [.9, 1, 1.1].map(factor => resizeMono(anchorSource, Math.round(123 * .5 * factor), Math.round(27 * .5 * factor)));

  function findAnchor(white, width, height) {
    const small = resizeMono({ data: white, width, height }, 432, Math.floor(height / 2));
    const sw = small.width, sh = small.height, data = small.data, stride = sw + 1;
    const sums = new Float64Array(stride * (sh + 1)), squares = new Float64Array(sums.length);
    for (let y = 0; y < sh; y++) {
      let row = 0, square = 0;
      for (let x = 0; x < sw; x++) {
        const value = data[y * sw + x]; row += value; square += value * value;
        sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
        squares[(y + 1) * stride + x + 1] = squares[y * stride + x + 1] + square;
      }
    }
    const sumBox = (integral, x, y, w, h) => integral[(y + h) * stride + x + w] - integral[y * stride + x + w] - integral[(y + h) * stride + x] + integral[y * stride + x];
    const x0 = Math.round(sw * .42), x1 = Math.round(sw * .97), y0 = Math.round(sh * .22), y1 = Math.round(sh * .55);
    let best = { score: -1, bbox: null };
    for (const template of anchorTemplates) {
      const tw = template.width, th = template.height, count = tw * th, offsets = [], values = [];
      let total = 0, sumSquare = 0;
      for (let yy = 0; yy < th; yy++) for (let xx = 0; xx < tw; xx++) {
        const value = template.data[yy * tw + xx]; total += value; sumSquare += value * value;
        if (value) { offsets.push(yy * sw + xx); values.push(value); }
      }
      const mean = total / count, norm = Math.sqrt(sumSquare - total * total / count);
      for (let y = y0; y + th <= y1; y += 2) for (let x = x0; x + tw <= x1; x += 2) {
        const sum = sumBox(sums, x, y, tw, th), variance = sumBox(squares, x, y, tw, th) - sum * sum / count;
        if (variance <= 1e-8) continue;
        const start = y * sw + x; let dot = 0;
        for (let i = 0; i < offsets.length; i++) dot += data[start + offsets[i]] * values[i];
        const score = (dot - mean * sum) / (Math.sqrt(variance) * norm);
        if (score > best.score) best = { score, bbox: [x * 2, y * 2, (x + tw) * 2, (y + th) * 2] };
      }
    }
    if (!best.bbox) return best;
    // Coarse sampling has a four-source-pixel phase. Resolve only that tiny
    // neighbourhood at full resolution, rather than lowering the title score.
    const coarse = best; best = { score: -1, bbox: null };
    for (const factor of [.9, 1, 1.1]) {
      const template = resizeMono(anchorSource, Math.round(123 * factor), Math.round(27 * factor));
      const tw = template.width, th = template.height, count = tw * th;
      let total = 0, square = 0;
      for (const value of template.data) { total += value; square += value * value; }
      const mean = total / count, norm = Math.sqrt(square - total * total / count);
      for (let y = Math.max(0, coarse.bbox[1] - 4); y <= Math.min(height - th, coarse.bbox[1] + 4); y++) {
        for (let x = Math.max(0, coarse.bbox[0] - 4); x <= Math.min(width - tw, coarse.bbox[0] + 4); x++) {
          let sum = 0, dot = 0;
          for (let yy = 0; yy < th; yy++) for (let xx = 0; xx < tw; xx++) {
            const value = white[(y + yy) * width + x + xx]; sum += value; dot += value * template.data[yy * tw + xx];
          }
          const variance = sum - sum * sum / count;
          const score = variance > 1e-8 ? (dot - mean * sum) / (Math.sqrt(variance) * norm) : -1;
          if (score > best.score) best = { score, bbox: [x, y, x + tw, y + th] };
        }
      }
    }
    best.fineScore = best.score;
    best.coarseScore = coarse.score;
    best.score = Math.max(best.score, coarse.score);
    return best;
  }

  function unknown(input, reason) {
    return { context: 'unknown', contextReliable: false, reason, layout: 'unconfirmed', nativeSize: [input.width, input.height], badges: [], completeKinds: { innate: false, acquired: false }, canClear: false };
  }

  function groupRows(badges) {
    const rows = [];
    for (const item of badges.slice().sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])) {
      const center = (item.bbox[1] + item.bbox[3]) / 2;
      if (!rows.length || Math.abs(center - rows[rows.length - 1].center) > 10) rows.push({ center, items: [item] });
      else rows[rows.length - 1].items.push(item);
    }
    rows.forEach(row => row.items.sort((a, b) => a.bbox[0] - b.bbox[0]));
    return rows;
  }

  function placeholderCandidates(image, masks, rows, modernStart) {
    if (modernStart < 0) return [];
    const first = rows[modernStart], second = rows[modernStart + 1], pitch = second.center - first.center;
    if (pitch < 20 || pitch > 70) return [];
    const centers = first.items.slice(0, 2).map(item => (item.bbox[0] + item.bbox[2]) / 2), step = centers[1] - centers[0];
    const actual = rows.slice(modernStart + 2).find(row => row.center > second.center + 1.3 * pitch && row.center < second.center + 2.3 * pitch && row.items.some(item => Math.abs((item.bbox[0] + item.bbox[2]) / 2 - centers[0]) < step * .2));
    const ybase = actual ? actual.center : second.center + 1.8 * pitch, output = [];
    for (let r = 0; r < 2; r++) for (const cx of centers) {
      const cy = ybase + r * pitch;
      if (rows.some(row => row.items.some(item => Math.abs((item.bbox[0] + item.bbox[2]) / 2 - cx) < step * .22 && Math.abs((item.bbox[1] + item.bbox[3]) / 2 - cy) < pitch * .35))) continue;
      const patch = [Math.max(0, Math.round(cx - step * .38)), Math.max(0, Math.round(cy - pitch * .32)), Math.min(image.width, Math.round(cx + step * .38)), Math.min(image.height, Math.round(cy + pitch * .32))];
      const score = boxSum(masks.qualities[0], image.width, patch) / ((patch[2] - patch[0]) * (patch[3] - patch[1]));
      if (score < .35) continue;
      const box = tightBox(masks.muted, image.width, patch);
      if (!box) continue;
      const tw = box[2] - box[0], th = box[3] - box[1];
      if (tw < step * .35 || th < pitch * .2 || th > pitch * .75) continue;
      const data = new Uint8Array(tw * th);
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) data[y * tw + x] = masks.muted[(box[1] + y) * image.width + box[0] + x];
      output.push({ bbox: box, badgeROI: badgeExtent(masks.qualities[0], image.width, image.height, box), qualityCandidates: [0], qualityScores: { 0: score }, inkMode: 'muted', inkMask: { width: tw, height: th, data }, inkWidth: tw, inkHeight: th, inkDensity: boxSum(masks.muted, image.width, box) / (tw * th) });
    }
    return output;
  }

  function segment(input, options) {
    validate(input); options = options || {};
    if (input.width < 160 || input.height < 160) return unknown(input, 'image_too_small');
    const scale = WIDTH / input.width, height = Math.round(input.height * scale);
    if (height > 4096 || height < 600) return unknown(input, 'unsupported_aspect_ratio');
    const image = resize(input, WIDTH, height), masks = makeMasks(image), words = wordCandidates(image, masks), anchor = findAnchor(masks.white, WIDTH, height);
    const sourceBox = box => box && box.map(value => Math.round(value / scale * 100) / 100);
    if (!anchor.bbox || anchor.score < .55) return { ...unknown(input, 'detail_heading_not_confirmed'), anchor: { bbox: sourceBox(anchor.bbox), score: anchor.score } };
    const ay = anchor.bbox[1];
    let badges = words.filter(item => item.qualityCandidates.length && item.badgeROI && item.bbox[1] >= ay - WIDTH * .36 && item.bbox[3] <= ay - WIDTH * .035);
    let rows = groupRows(badges);
    const aligned = (a, b) => a.items.length === b.items.length && a.items.every((item, i) => Math.abs((item.bbox[0] + item.bbox[2]) / 2 - (b.items[i].bbox[0] + b.items[i].bbox[2]) / 2) <= 12);
    // A stat row can share the badge color. Locate a repeated badge layout;
    // never let an unrelated earlier row change the section assignment.
    let start = rows.findIndex((row, i) => row.items.length === 3 && rows[i + 1]?.items.length === 3 && aligned(row, rows[i + 1]));
    if (start >= 0) {
      badges = badges.concat(placeholderCandidates(image, masks, rows, start));
      rows = groupRows(badges);
      start = rows.findIndex((row, i) => row.items.length === 3 && rows[i + 1]?.items.length === 3 && aligned(row, rows[i + 1]));
    }
    if (start < 0) start = rows.findIndex((row, i) => rows.length - i === 3 && rows.slice(i).every(x => x.items.length === 2) && aligned(row, rows[i + 1]) && aligned(rows[i + 1], rows[i + 2]) && Math.abs((rows[i + 1].center - row.center) - (rows[i + 2].center - rows[i + 1].center)) < 12);
    if (start > 0) rows.splice(0, start);
    badges = rows.flatMap(row => row.items);
    let layout = 'unconfirmed', completeKinds = { innate: false, acquired: false };
    if (rows.length >= 2 && rows[0].items.length === 3 && rows[1].items.length === 3 && aligned(rows[0], rows[1]) && rows[1].center - rows[0].center >= 20 && rows[1].center - rows[0].center <= 70) {
      layout = 'modern_3x2_innate';
      completeKinds.innate = true;
      const pitch = rows[1].center - rows[0].center;
      const innateColumns = { items: rows[0].items.slice(0, 2) };
      // Empty gray slots need an explicit placeholder-text match. Without that
      // evidence, fewer than four acquired badges cannot authorize replacement.
      completeKinds.acquired = rows.length === 4 && rows[2].items.length === 2 && rows[3].items.length === 2 && aligned(innateColumns, rows[2]) && aligned(rows[2], rows[3]) && rows[2].center - rows[1].center > pitch * 1.3 && rows[2].center - rows[1].center < pitch * 2.3 && Math.abs(rows[3].center - rows[2].center - pitch) < 12;
      rows.forEach((row, i) => row.items.forEach(item => { item.kindCandidates = [i < 2 ? 'innate' : 'acquired']; }));
    } else if (rows.length === 3 && rows.every(row => row.items.length === 2) && aligned(rows[0], rows[1]) && aligned(rows[1], rows[2]) && rows[1].center - rows[0].center >= 20 && rows[1].center - rows[0].center <= 70 && Math.abs((rows[1].center - rows[0].center) - (rows[2].center - rows[1].center)) < 12) {
      layout = 'legacy_2x3_innate'; completeKinds = { innate: true, acquired: true };
      badges.forEach(item => { item.kindCandidates = ['innate']; });
    } else badges.forEach(item => { item.kindCandidates = []; });
    const reliable = layout !== 'unconfirmed';
    const result = { context: reliable ? 'disciple_detail' : 'unknown', contextReliable: reliable, reason: reliable ? null : 'badge_layout_not_confirmed', layout, nativeSize: [input.width, input.height], canonicalScale: scale,
      anchor: { bbox: sourceBox(anchor.bbox), score: anchor.score, coarseScore: anchor.coarseScore, fineScore: anchor.fineScore }, rows: rows.map(row => row.items.length), completeKinds,
      canClear: reliable && completeKinds.innate && completeKinds.acquired,
      badges: badges.map(item => ({ ...item, bbox: sourceBox(item.bbox), badgeROI: sourceBox(item.badgeROI), inkHeight: item.inkHeight / scale, inkWidth: item.inkWidth / scale, defaultSelected: false })) };
    if (options.includeMasks) result.masks = { width: WIDTH, height, scale, white: masks.white, muted: masks.muted };
    return result;
  }

  return { segment, makeInkMask: (input, options) => {
    const masks = makeMasks(validate(input));
    if (options?.mutedOnly) return masks.muted;
    if (options?.includeMuted) for (let i = 0; i < masks.white.length; i++) masks.white[i] |= masks.muted[i];
    return masks.white;
  }, version: 1 };
});

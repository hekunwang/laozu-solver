'use strict';

// Candidates require independent appearance and their own terminal-number
// evidence. Background/badge presence cannot compensate for either failure.
// Only independently strong, unambiguous recovery evidence may auto-confirm.
// Recovery never trains signatures or changes the original recognizer.
function screenshotElementCertain(reading, moat) {
  return reading.score >= Y.glyphCorr && reading.margin >= Y.glyphMargin
    && reading.score + 2 * reading.margin >= Y.glyphCombined
    && !(reading.score < Y.weakGlyphCorr && moat >= Y.weakGlyphMoat);
}

function screenshotEvidenceValid(option) {
  const evidence = option.evidence;
  return Number.isFinite(evidence.distance) && evidence.distance <= Y.signatureMaxDistance
    && Number.isFinite(evidence.number) && evidence.number >= Y.numberAccept
    && !evidence.elementConflict && !evidence.formConflict;
}

function screenshotRankSuggestions(options) {
  const valid = options.filter(screenshotEvidenceValid);
  valid.sort((a, b) => a.evidence.distance - b.evidence.distance
    || b.evidence.number - a.evidence.number || a.evidence.bg - b.evidence.bg
    || a.equip.id - b.equip.id || a.row - b.row || a.col - b.col);
  const unique = new Map();
  for (const option of valid) if (!unique.has(option.equip.id)) unique.set(option.equip.id, option);
  const ranked = [...unique.values()], best = ranked[0];
  if (!best) return [];
  return ranked.filter(option => option.evidence.distance - best.evidence.distance < Y.signatureMinMargin).slice(0, 2);
}

function screenshotAutomaticSuggestion(options, bitmap, grid) {
  // Use all legal placements, before UI deduplication, margin filtering or limit.
  const valid = options.filter(screenshotEvidenceValid).sort((a, b) => a.evidence.distance - b.evidence.distance);
  const best = valid[0];
  if (!best || best.evidence.distance > Y.signatureBlindMaxDistance
      || !best.evidence.elementCertain || !best.evidence.formCertain
      || valid.some(option => option !== best && (option.equip.id === best.equip.id
        || option.evidence.distance - best.evidence.distance < Y.signatureMinMargin))) return null;
  // An acceptable target number alone is insufficient if another number fits.
  // This extra read only runs for an otherwise strong, unique recovery candidate.
  const reading = fs([...Or].map(([key, template]) => ({key, score: M1(bitmap, grid,
    best.numberCell.row, best.numberCell.col, Le.numberBox, template, [-.024, -.016, -.008, 0, .008, .016, .024])})));
  if (reading.key !== String(best.equip.reson) || !Number.isFinite(reading.score)
      || !Number.isFinite(reading.margin) || reading.score < Y.numberAccept || reading.margin < Y.numberMargin) return null;
  return {...best, autoEvidence: {number: reading}};
}

function screenshotSuggestionValid(result, option, pieceIndex = -1) {
  const equip = S0.find(eq => eq.id === option.equip.id);
  if (!equip || !Number.isInteger(option.row) || !Number.isInteger(option.col)) return false;
  const cells = Kr(equip.shapeId, option.row, option.col);
  const last = Xr(equip.shapeId, option.row, option.col);
  if (!cells || !last || cells.join(',') !== option.cells.join(',') || last.row !== option.numberCell.row || last.col !== option.numberCell.col) return false;
  const occupied = new Set(result.pieces.flatMap((piece, index) => index === pieceIndex ? [] : piece.cells ?? []));
  const locked = new Set(result.lockedCells);
  const anchors = new Set(result.pieces.flatMap((piece, index) => index === pieceIndex ? [] : [X(piece.row, piece.col)]));
  if (cells.some(cell => occupied.has(cell) || locked.has(cell) || anchors.has(cell))) return false;
  if (equip.quality === 5) {
    const counts = new Map();
    for (const piece of Tt(result).layout.pieces) {
      const eq = S0.find(item => item.id === piece.equipId);
      if (eq?.quality === 5) counts.set(eq.id, (counts.get(eq.id) || 0) + 1);
    }
    counts.set(equip.id, (counts.get(equip.id) || 0) + 1);
    if (counts.size > 2 || [...counts.values()].some(count => count > 2)) return false;
  }
  return true;
}

function screenshotSuggestionPool(result, bitmap, request) {
  const index = request.pieceIndex ?? -1;
  const piece = index >= 0 ? result.pieces[index] : null;
  if (index >= 0 && piece?.status !== 'suspect') return [];
  if (index < 0 && !result.unexplainedCells?.includes(request.cell)) return [];
  const grid = result.grid, occupied = new Set(result.pieces.flatMap((p, i) => i === index ? [] : p.cells ?? []));
  const locked = new Set(result.lockedCells), anchors = new Set(result.pieces.flatMap((p, i) => i === index ? [] : [X(p.row, p.col)]));
  const patches = new Map(), numbers = new Map(), options = [];
  for (const equip of S0) {
    if (equip.quality === 1) continue;
    const samples = ot.filter(sample => sample.equipId === equip.id);
    if (!samples.length) continue;
    for (let row = 0; row < 6; row++) for (let col = 0; col < 7; col++) {
      if (piece && (row !== piece.row || col !== piece.col)) continue;
      const cells = Kr(equip.shapeId, row, col), numberCell = Xr(equip.shapeId, row, col);
      if (!cells || !numberCell || !piece && !cells.includes(request.cell) || cells.some(cell => occupied.has(cell) || locked.has(cell) || anchors.has(cell))) continue;
      const key = X(row, col);
      let patch = patches.get(key);
      if (!patch) {
        patch = {signature: us(bitmap, grid, row, col), bg: it(bitmap, grid, row, col), badge: p0(bitmap, grid, row, col, Le.badgeBox), glyphs: new Map()};
        patches.set(key, patch);
      }
      const distance = Math.min(...samples.map(sample => n1(patch.signature, sample.sig)));
      if (!Number.isFinite(distance) || distance > Y.signatureMaxDistance) continue;
      const numberKey = numberCell.row + ',' + numberCell.col + '|' + equip.reson;
      let number = numbers.get(numberKey);
      if (number === undefined) {
        const template = Or.get(String(equip.reson));
        number = template ? M1(bitmap, grid, numberCell.row, numberCell.col, Le.numberBox, template, [-.024, -.016, -.008, 0, .008, .016, .024]) : 0;
        numbers.set(numberKey, number);
      }
      // A different shape puts the resonance label in a different grid cell.
      // Require the candidate's own value at its own ending cell, rather than
      // treating any smaller shape that fits the free space as plausible.
      if (!Number.isFinite(number) || number < Y.numberAccept) continue;
      if (!patch.elementReading) patch.elementReading = classifyElementGlyph(bitmap, grid, row, col, i1);
      if (!patch.formReading) patch.formReading = fs([...ms].map(([key, template]) => ({key, score: M1(bitmap, grid, row, col, Le.formBox, template)})));
      const elementReading = patch.elementReading, formReading = patch.formReading;
      const elementCertain = screenshotElementCertain(elementReading, p0(bitmap, grid, row, col, Le.moatBox));
      const formCertain = formReading.score >= Y.formCorr && formReading.margin >= Y.formMargin;
      const elementConflict = elementCertain && elementReading.key !== Fe[equip.element];
      const formConflict = formCertain && Wr.get(formReading.key) !== equip.weaponForm;
      // A suspect piece's previous cells may be the recognition error itself.
      // Infer geometry from each candidate's own shape/terminal number and
      // placement checks, never lock it to a rejected previous shape.
      if (elementConflict || formConflict) continue;
      const bg = patch.bg ? V1(patch.bg, R0['q' + equip.quality]) : Infinity;
      let glyph = patch.glyphs.get(equip.element);
      if (glyph === undefined) {
        const template = i1.get(Fe[equip.element]);
        glyph = template ? M1(bitmap, grid, row, col, Le.elementBox, template) : 0;
        patch.glyphs.set(equip.element, glyph);
      }
      const option = {equip, row, col, cells, numberCell, rank: distance, evidence: {distance, number, bg, glyph, elementConflict, formConflict, elementCertain, formCertain}};
      if (screenshotSuggestionValid(result, option, index)) options.push(option);
    }
  }
  return options;
}

function screenshotSuggestions(result, bitmap, request) {
  return screenshotRankSuggestions(screenshotSuggestionPool(result, bitmap, request));
}

function screenshotOpenSuggestions(request, allowAutomatic = false) {
  const result = v1.value;
  if (!result || !V || me.value || !['ox','oy','pw','ph'].every(key => re.value?.[key] === result.grid[key])) return;
  const pool = screenshotSuggestionPool(result, V.bitmap, request), options = screenshotRankSuggestions(pool);
  const automatic = allowAutomatic && !result.autoConfirmSuppressed ? screenshotAutomaticSuggestion(pool, V.bitmap, result.grid) : null;
  if (automatic) {
    const next = screenshotApplySuggestion(result, automatic, request, true);
    if (next) { v1.value = next; N1.value = ''; return true; }
  }
  v1.value = {...result, suggestion: {request, options}};
  return false;
}

function screenshotAutoOpenSuggestions() {
  // Each successful step resolves a piece or covers at least one warning cell.
  for (let step = 0; step < 42; step++) {
    const result = v1.value;
    if (!result || result.suggestion || !V || me.value) return;
    const pieceIndex = result.pieces.findIndex(piece => piece.status === 'suspect');
    const cell = result.unexplainedCells?.[0];
    const request = pieceIndex >= 0 ? {pieceIndex} : cell !== undefined ? {cell} : null;
    if (!request) return;
    try { if (!screenshotOpenSuggestions(request, true)) return; }
    catch {
      // Candidate failure must not discard the valid automatic recognition.
      if (v1.value === result) v1.value = {...result, suggestion: {request, options: []}};
      return;
    }
  }
}

function screenshotApplySuggestion(result, option, request, automatic = false) {
  const index = request.pieceIndex ?? -1;
  if (!V || me.value || v1.value !== result || !['ox','oy','pw','ph'].every(key => re.value?.[key] === result.grid[key])
      || !option || index >= 0 && result.pieces[index]?.status !== 'suspect'
      || index < 0 && !result.unexplainedCells?.includes(request.cell) || !screenshotSuggestionValid(result, option, index)) return null;
  const chosen = {row: option.row, col: option.col, element: option.equip.element, elementName: Fe[option.equip.element], formName: null, signature: us(V.bitmap, result.grid, option.row, option.col), status: 'ok', equip: option.equip, candidates: [], cells: [...option.cells], numberCell: {...option.numberCell}, reason: null, ...(automatic ? {autoIdentity: true, autoEvidence: option.autoEvidence} : {manualIdentity: true})};
  awAttachScreenshot(V.bitmap, {pieces: [chosen], grid: result.grid});
  const pieces = [...result.pieces];
  if (index >= 0) pieces[index] = chosen; else pieces.push(chosen);
  return {...result, pieces, unexplainedCells: (result.unexplainedCells ?? []).filter(cell => !option.cells.includes(cell)), suggestion: null, manualUndo: result};
}

function screenshotChooseSuggestion(optionIndex) {
  const result = v1.value, selection = result?.suggestion;
  if (!selection) return;
  const next = screenshotApplySuggestion(result, selection.options[optionIndex], selection.request);
  if (!next) {
    N1.value = '候选的位置已不可用，请重新查看候选或校正网格';
    return;
  }
  v1.value = next;
  N1.value = '';
  screenshotAutoOpenSuggestions();
}

function screenshotUndoSuggestion() {
  const result = v1.value;
  if (result?.manualUndo && !me.value && ['ox','oy','pw','ph'].every(key => re.value?.[key] === result.grid[key])) {
    v1.value = {...result.manualUndo, autoConfirmSuppressed: true};
    screenshotAutoOpenSuggestions();
  }
}

function screenshotManualLayoutValid(result) {
  if (!result?.manualUndo) return true;
  const summary = Tt(result), occupied = new Set(), locked = new Set(result.lockedCells), reds = new Map();
  for (const piece of summary.layout.pieces) {
    const equip = S0.find(eq => eq.id === piece.equipId);
    if (!equip || !piece.cells?.length) return false;
    for (const cell of piece.cells) {
      if (!Number.isInteger(cell) || cell < 0 || cell >= 42 || locked.has(cell) || occupied.has(cell)) return false;
      occupied.add(cell);
    }
    if (equip.quality === 5) reds.set(equip.id, (reds.get(equip.id) || 0) + 1);
  }
  return reds.size <= 2 && [...reds.values()].every(count => count <= 2);
}

function screenshotSuggestionCrop({option}) {
  const rows = option.cells.map(cell => Math.floor(cell / 7)), cols = option.cells.map(cell => cell % 7);
  const top = Math.min(...rows), left = Math.min(...cols), width = Math.max(...cols) - left + 1, height = Math.max(...rows) - top + 1;
  return r('canvas', {width: 144, height: 112, style: {width: '144px', height: '112px', maxWidth: '100%', border: '1px solid var(--line)'}, 'aria-label': '候选所在原图区域', ref: canvas => {
    if (!canvas || !V || !v1.value) return;
    const grid = v1.value.grid, context = canvas.getContext('2d'), scale = Math.min(144 / (width * grid.pw), 112 / (height * grid.ph));
    context.clearRect(0, 0, 144, 112);
    context.drawImage(V.canvas, grid.ox + left * grid.pw, grid.oy + top * grid.ph, width * grid.pw, height * grid.ph, (144 - width * grid.pw * scale) / 2, (112 - height * grid.ph * scale) / 2, width * grid.pw * scale, height * grid.ph * scale);
  }});
}

function screenshotAdjudicationControls({result}) {
  const suspects = result.pieces.flatMap((piece, index) => piece.status === 'suspect' ? [{piece, index}] : []), unexplained = result.unexplainedCells ?? [];
  const automaticCount = result.pieces.filter(piece => piece.autoIdentity).length;
  const selection = result.suggestion;
  if (!suspects.length && !unexplained.length && !result.manualUndo) return null;
  return r('section', {class: 'import-adjudication', children: [
    r('h3', {children: suspects.length || unexplained.length ? '识别存疑 · 手动裁决' : '候选确认'}),
    automaticCount > 0 && r('p', {class: 'small', children: '已自动确认 ' + automaticCount + ' 件法宝，可撤销。觉醒等级仍单独核对。'}),
    (suspects.length > 0 || unexplained.length > 0) && r('p', {class: 'muted small', children: '证据充分且位置唯一时自动确认；其余候选默认展开，最多两个，不足两个不补齐。未选择的项继续保留存疑。'}),
    r('div', {class: 'row wrap', children: [
      ...suspects.map(({piece, index}) => r('button', {type: 'button', class: 'ghost', onClick: () => screenshotOpenSuggestions({pieceIndex: index}), children: '(' + (piece.row + 1) + ',' + (piece.col + 1) + ') 查看候选'}, 'piece-' + index)),
      ...unexplained.map(cell => r('button', {type: 'button', class: 'ghost', onClick: () => screenshotOpenSuggestions({cell}), children: '(' + (Math.floor(cell / 7) + 1) + ',' + (cell % 7 + 1) + ') 漏识别候选'}, 'cell-' + cell))
    ]}),
    selection && r('div', {class: 'import-card', children: [
      r('b', {children: '相近候选，仅供手动确认'}),
      selection.options.length ? r('div', {class: 'row wrap', children: selection.options.map((option, index) => r('div', {style: {flex: '1 1 160px'}, children: [
        r(screenshotSuggestionCrop, {option}),
        r('p', {class: 'small', children: Fe[option.equip.element] + ' · ' + T1(option.equip.tier) + ' · 共鸣 ' + option.equip.reson + ' · 占 ' + option.cells.length + ' 格 · 起点 (' + (option.row + 1) + ',' + (option.col + 1) + ')'}),
        r('button', {type: 'button', 'aria-label': '选择候选' + (index + 1) + '：' + option.equip.name, onClick: () => screenshotChooseSuggestion(index), children: ['候选 ' + (index + 1) + '：' + option.equip.name, r(pt, {shape: el.get(option.equip.shapeId), tier: option.equip.tier})]})
      ]}, option.equip.id))}) : r('p', {class: 'warn small', children: '没有足够可靠且不重叠的候选。请先校正网格、换用清晰原图或手动添加。'}),
      r('p', {class: 'muted small', children: '如果都不是，请保留存疑；这里的排序不代表识别成功。红宝选定后仍需独立确认觉醒等级。'}),
      r('button', {type: 'button', class: 'ghost', onClick: () => v1.value = {...v1.value, suggestion: null, autoConfirmSuppressed: true}, children: '都不是，保留存疑'})
    ]}),
    result.manualUndo && r('button', {type: 'button', class: 'ghost', onClick: screenshotUndoSuggestion, children: '撤销上次候选确认'})
  ]});
}

module.exports = function patchRecognitionAdjudication({app, change}) {
  const helpers = [screenshotElementCertain, screenshotEvidenceValid, screenshotRankSuggestions, screenshotAutomaticSuggestion, screenshotSuggestionValid, screenshotSuggestionPool, screenshotSuggestions, screenshotOpenSuggestions, screenshotAutoOpenSuggestions, screenshotApplySuggestion, screenshotChooseSuggestion, screenshotUndoSuggestion, screenshotManualLayoutValid, screenshotSuggestionCrop, screenshotAdjudicationControls].map(fn => fn.toString()).join('\n');
  app = change(app, 'function ol(){', helpers + '\nfunction ol(){');
  app = change(app, 'children:[r(awImportControls,{result:t}),t.redViolation', 'children:[r(awImportControls,{result:t}),r(screenshotAdjudicationControls,{result:t}),t.redViolation');
  app = change(app, 'children:"红色法宝识别结果异常（违反「最多 2 种、每种 2 个」），已全部标为存疑。"', 'children:t.manualUndo?"自动识别时红宝数量异常，请继续核对剩余存疑项。":"红色法宝识别结果异常（违反「最多 2 种、每种 2 个」），已全部标为存疑。"');
  app = change(app, 'const e=Tt(t);if(e.awakenPending)return;Aw.value=', 'if(!screenshotManualLayoutValid(t)){N1.value="候选确认结果存在重叠、锁格或红宝数量异常，请撤销并重新选择";return}const e=Tt(t);if(e.awakenPending)return;Aw.value=');
  app = change(app, 're.value = result.grid; d1.value = choices; v1.value = result;\n      me.value = null; F0.value++;', 're.value = result.grid; d1.value = choices; v1.value = result;\n      me.value = null; F0.value++;\n      screenshotAutoOpenSuggestions();');
  return app;
};

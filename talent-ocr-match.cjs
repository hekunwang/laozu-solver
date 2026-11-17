'use strict';
// Exact name matches are suggestions for human review, never silent imports.
const normalize = value => String(value || '').normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
function matchTalents(lines, catalog, abilityRows, options = {}) {
  const innate = abilityRows.filter(row => row.iLevel === 0 && row.iType === 4)
    .map(row => ({kind:'innate', id:row.iAbilityID, name:row.szName, desc:row.szDesc, supported:true}));
  const acquired = catalog.acquiredTalents.map(row => ({kind:'acquired', id:row.id, name:row.name, desc:row.desc, supported:true}));
  const dictionary = [...innate,...acquired].filter(row => normalize(row.name));
  const found = new Map(), observations = Array.isArray(lines) ? lines : [];
  const mode=options.mode==='acquisition'?'acquisition':'detail';
  const detailContext=observations.some(line=>/详情|法宝编辑|重塑/.test(line?.text||''));
  const resonance=observations.filter(line=>/共鸣神通/.test(normalize(line?.text))&&Number.isFinite(line?.bbox?.y));
  for (const line of observations) {
    if (!line || typeof line.text !== 'string') continue;
    const text = normalize(line.text);
    // Never use edit distance: hundreds of official names differ by one character.
    const candidates = dictionary.filter(row => text.includes(normalize(row.name)))
      .sort((a,b) => normalize(b.name).length-normalize(a.name).length);
    const used = [];
    for (const row of candidates) {
      const name = normalize(row.name), start = text.indexOf(name), end = start+name.length;
      if (used.some(range => start < range[1] && end > range[0])) continue;
      used.push([start,end]);
      const key = row.kind+':'+row.id;
      const confidence = Number.isFinite(Number(line.confidence)) ? Number(line.confidence) : 0;
      const exact=text===name,box=line.bbox;
      const excluded=/未获得|尚未|待获得|可替换|替换预览|可选择|选择其中|候选|图鉴|未拥有|未解锁|未激活/.test(text+normalize(line.contextText));
      const inDetailRegion=detailContext&&box&&Number.isFinite(box.x)&&Number.isFinite(box.y)
        &&box.x>=.35&&resonance.some(anchor=>box.y>=anchor.bbox.y-.015&&box.y<=anchor.bbox.y+.22);
      const defaultSelected=exact&&!excluded&&(mode==='acquisition'||inDetailRegion);
      const reviewReason=excluded?'文字表示未获得、候选或替换，请确认是否已持有':!exact?'名称位于较长说明中，请核对':mode==='detail'&&!inDetailRegion?'未确认位于弟子天赋区域，请核对':confidence<.5?'文字置信度较低，请对照原图核对':'';
      const value = {...row, sourceText:line.contextText||line.text, confidence, bbox:line.bbox || null,defaultSelected,reviewReason};
      const old=found.get(key);
      if(!old||Number(defaultSelected)*2+confidence>Number(old.defaultSelected)*2+old.confidence)found.set(key,value);
    }
  }
  return {mode,matches:[...found.values()], lines:observations.map(line => ({text:String(line?.text || ''), confidence:Number(line?.confidence || 0), bbox:line?.bbox || null}))};
}
module.exports = {matchTalents, normalize};

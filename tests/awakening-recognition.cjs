'use strict';
// Pixel-only regressions using independent, isolated flame/digit crops.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),plain=value=>JSON.parse(JSON.stringify(value));
const fixture=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/awakening-badges.json'),'utf8'));
const recognizer={};
vm.runInNewContext(fs.readFileSync(path.join(root,'awakening-recognizer.js'),'utf8')+
  '\nthis.recognize=awRecognizeBitmap;this.family=awColorFamily;',recognizer);
function bitmap(width,height,rgb){
  return {w:width,h:height,px:(x,y)=>{
    const offset=(y*width+x)*3;return [rgb[offset],rgb[offset+1],rgb[offset+2]];
  },rgb};
}
function sampleBitmap(sample){
  const bytes=Buffer.from(sample.rgb,'base64');
  assert.equal(bytes.length,sample.width*sample.height*3,'fixture byte length');
  return bitmap(sample.width,sample.height,bytes);
}
const piece={numberCell:{row:0,col:0}};
const read=(image,grid)=>recognizer.recognize(image,grid,piece);
function uncertain(reading,label){
  assert.equal(reading.awakenLevel,null,label+' must not invent a level');
  assert.equal(reading.awakenStatus,'uncertain',label+' must require confirmation');
}
let pixelCases=0;
assert.deepEqual(fixture.samples.map(sample=>sample.expected),[3,2,3,2,0,0]);
for(const sample of fixture.samples){
  const result=read(sampleBitmap(sample),sample.grid);
  assert.equal(result.awakenLevel,sample.expected,'Real isolated fixture: '+sample.name);
  assert.equal(result.awakenStatus,sample.expected===0?'none':'recognized',sample.name+' status');
  assert(result.awakenConfidence>=.8,sample.name+' confidence');pixelCases++;
}

// Preserve real flame pixels but erase all white digit strokes. Color alone
// cannot assign a level, and a present flame cannot become "unawakened".
for(const sample of fixture.samples.filter(sample=>sample.expected>0)){
  const image=sampleBitmap(sample),bytes=Buffer.from(image.rgb);
  const paint=sample.expected===3?[180,80,235]:[40,160,230];
  for(let offset=0;offset<bytes.length;offset+=3){
    const pixel=[bytes[offset],bytes[offset+1],bytes[offset+2]];
    if(Math.min(...pixel)>205&&Math.max(...pixel)-Math.min(...pixel)<45)
      bytes.set(paint,offset);
  }
  uncertain(read(bitmap(image.w,image.h,bytes),sample.grid),sample.name+' flame without readable digit');pixelCases++;
}

// Recolor the REAL flames while keeping the original digit. A blue 3 or a
// purple 2 is contradictory evidence, so neither color nor digit wins.
for(const sample of fixture.samples.filter(sample=>sample.expected>0)){
  const image=sampleBitmap(sample),bytes=Buffer.from(image.rgb);
  const paint=sample.expected===3?[40,160,230]:[180,80,235];
  for(let offset=0;offset<bytes.length;offset+=3)
    if(recognizer.family([bytes[offset],bytes[offset+1],bytes[offset+2]])>0)bytes.set(paint,offset);
  uncertain(read(bitmap(image.w,image.h,bytes),sample.grid),sample.name+' contradictory color and digit');pixelCases++;
}

// Any clipped ROI, including an unawakened-looking crop, remains unknown.
for(const sample of fixture.samples){
  const image=sampleBitmap(sample);
  uncertain(read(bitmap(image.w,image.h-8,image.rgb.subarray(0,image.w*(image.h-8)*3)),sample.grid),sample.name+' truncated ROI');pixelCases++;
}

// Fifty-percent box filtering includes antialiasing. A low-quality crop may
// become unknown, but must not turn an awakened piece into level zero or a
// different level. No image package or OCR service is involved.
for(const sample of fixture.samples.filter(sample=>sample.expected>0)){
  const image=sampleBitmap(sample),width=Math.ceil(image.w/2),height=Math.ceil(image.h/2);
  const bytes=Buffer.alloc(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let channel=0;channel<3;channel++){
    let sum=0,count=0;
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
      const sx=x*2+dx,sy=y*2+dy;if(sx>=image.w||sy>=image.h)continue;
      sum+=image.rgb[(sy*image.w+sx)*3+channel];count++;
    }
    bytes[(y*width+x)*3+channel]=Math.round(sum/count);
  }
  const grid=Object.fromEntries(Object.entries(sample.grid).map(([key,value])=>[key,value/2]));
  const result=read(bitmap(width,height,bytes),grid);
  assert(result.awakenLevel===sample.expected||result.awakenLevel===null,sample.name+' blurred reduction must be right or unknown');
  if(result.awakenLevel===null)assert.equal(result.awakenStatus,'uncertain');pixelCases++;
}

// Resonance numbers are lower than the awakening ROI. Add a conspicuous blue
// disk with a white 3 below an actual unawakened crop: it must remain level 0.
const empty=fixture.samples.find(sample=>sample.expected===0),original=sampleBitmap(empty);
const extended=Buffer.alloc(original.w*140*3,160);
original.rgb.copy(extended);
for(let y=78;y<125;y++)for(let x=12;x<45;x++)extended.set([40,160,230],(y*original.w+x)*3);
const digit3=[' #### ','##  ##','    ##','  ### ','    ##','##  ##',' #### '];
for(let y=0;y<digit3.length;y++)for(let x=0;x<digit3[y].length;x++)if(digit3[y][x]==='#')
  for(let dy=0;dy<4;dy++)for(let dx=0;dx<3;dx++)extended.set([255,255,255],((86+y*4+dy)*original.w+19+x*3+dx)*3);
assert.equal(read(bitmap(original.w,140,extended),empty.grid).awakenLevel,0,'Resonance disk below ROI is not an awakening badge');pixelCases++;

// Verify the importer blocks uncertain copies, keeps independent metadata,
// and saves the confirmed [1,3,0] array rather than one level for the name.
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const executable=source.slice(source.indexOf('var g0'),source.lastIndexOf(',Ha=document.getElementById'))+';';
const window={matchMedia:()=>({matches:false}),addEventListener:()=>{}},storage=new Map();
vm.runInNewContext(executable,{
  B:(object,key,value)=>{object[key]=value;},window,console,atob,Uint8ClampedArray,
  setTimeout:()=>0,clearTimeout:()=>{},navigator:{hardwareConcurrency:4},
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}
},{filename:'awakening-import-without-dom.js'});
const main=window.laozuLocal;
for(const name of ['recognizeAwakening','importSummary','setScreenshotLevel','screenshotAwaken'])assert.equal(typeof main[name],'function','Missing importer API: '+name);
const red=main.catalog.equips.find(eq=>eq.id===150104);
const screenshot={groups:[],lockedCells:[],pieces:[1,3,null].map((level,index)=>({
  status:'ok',equip:red,cells:[index],row:0,col:index,numberCell:{row:0,col:index},
  awakenLevel:level,awakenConfidence:level===null?0:.95,awakenStatus:level===null?'uncertain':'recognized'
}))};
main.importResult.value=screenshot;
const pending=main.importSummary(screenshot);
assert.equal(pending.awakenPending,1,'Unknown third copy blocks import');
assert.deepEqual(plain(pending.layout.pieces.map(piece=>piece.awakenLevel)),[1,3,null]);
assert.deepEqual(plain(pending.layout.pieces.map(piece=>piece.copyIndex)),[0,1,2]);
assert.throws(()=>main.screenshotAwaken(pending.layout),/尚未确认/,'Unknown must not silently become level zero');
main.setScreenshotLevel(2,0);
const confirmed=main.importSummary(main.importResult.value);
assert.equal(confirmed.awakenPending,0,'Manual confirmation unblocks import');
const levels=main.screenshotAwaken(confirmed.layout);
assert.deepEqual(plain(levels[150104]),[1,3,0],'Different copies retain their own awakening');
main.load({version:1,holdings:confirmed.counts,awaken:levels,currentLayout:confirmed.layout});
main.save();
const saved=JSON.parse(storage.get('wydl-bag:v1:state'));
assert.deepEqual(saved.awaken[150104],[1,3,0],'Confirmed independent levels survive local storage');
assert.deepEqual(saved.currentLayout.pieces.map(piece=>piece.awakenLevel),[1,3,0],'Saved screenshot layout keeps confirmed levels');

console.log(JSON.stringify({passed:true,pixelCases,fixtures:fixture.samples.length,checks:[
  'independent real corner crops','flame without readable digit','color-digit contradiction','clipped ROI',
  '50-percent box-filtered reduction','resonance below ROI excluded','uncertain copy blocks import',
  'manual per-copy confirmation','confirmed independent levels saved'
]},null,2));

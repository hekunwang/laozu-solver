'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createPublicWebArtifacts,readPublicWebInputs,writePublicWeb}=require('./web-build.cjs');
function build(root=__dirname){
const manifest = JSON.parse(fs.readFileSync(path.join(root,'data/manifest.json'),'utf8'));
const preview = manifest.channel === 'prerelease';
if (manifest.channel !== 'formal' && !(preview && manifest.localOnly && process.argv.includes('--local-preview'))) throw new Error('Prerelease requires explicit --local-preview; release requires formal provenance');
execFileSync(process.execPath, [path.join(root, 'patch-upstream.cjs'), ...(preview ? ['--local-preview'] : [])], {stdio: 'inherit'});
const artifacts=createPublicWebArtifacts(readPublicWebInputs(root)),result=writePublicWeb(root,artifacts,{mirrorToRoot:!preview});
console.log(JSON.stringify({publicDirectory:result.directory,rootPage:path.join(root,'index.html'),app:artifacts.manifest.app,
  recognitionWorker:artifacts.manifest.recognitionWorker,talentOcr:artifacts.manifest.talentOcr,files:artifacts.manifest.files.length,
  ...(result.previous?{previousPublicBuild:result.previous}:{})},null,2));
return artifacts.manifest;
}
if(require.main===module)build();
module.exports={build};

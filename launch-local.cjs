'use strict';
const http=require('node:http'),{spawn}=require('node:child_process');
const {buildInfo,resolvePort}=require('./local-build.cjs');
function status(port) {
  return new Promise(resolve=>{
    let finished=false,deadline;
    const finish=value=>{if(finished)return;finished=true;clearTimeout(deadline);resolve(value);};
    const req=http.get({hostname:'127.0.0.1',port,path:'/api/talent-ocr/status',timeout:1000},res=>{
      let body='';res.on('data',data=>{body+=data;if(body.length>65536)req.destroy();});
      res.on('end',()=>{try{finish({occupied:true,value:JSON.parse(body)});}catch{finish({occupied:true});}});
      res.on('error',()=>finish({occupied:true}));res.on('aborted',()=>finish({occupied:true}));
    });
    deadline=setTimeout(()=>{finish({occupied:true});req.destroy();},1200);
    req.on('timeout',()=>req.destroy());req.on('error',error=>finish({occupied:error.code!=='ECONNREFUSED'}));
  });
}
async function launch() {
  const port=resolvePort(),expected=buildInfo(),existing=await status(port);
  if(existing.occupied){
    if(existing.value?.service===expected.service&&existing.value?.buildId===expected.buildId){
      spawn('/usr/bin/open',[`http://127.0.0.1:${port}/`],{stdio:'ignore'}).unref();return;
    }
    console.error(`端口 ${port} 正被另一个版本或程序使用，未打开旧页面。请关闭旧版的启动终端后，再双击本版启动器。`);
    console.error('也可指定独立端口：LAOZU_PORT=18766 node launch-local.cjs');
    process.exitCode=1;return;
  }
  require('./serve.cjs').startServer({port,open:true});
}
if(require.main===module)launch().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={status};

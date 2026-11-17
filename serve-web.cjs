'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),zlib=require('node:zlib');
const MIME={'.webmanifest':'application/manifest+json; charset=utf-8','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8','.wasm':'application/wasm','.gz':'application/gzip','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2'};
function basePath(value='/'){
  if(!value.startsWith('/')||/[?#\\\0]/.test(value)||value.split('/').some(part=>part==='.'||part==='..'))throw Error('Invalid static base path');
  return value.endsWith('/')?value:value+'/';
}
function acceptsGzip(header=''){
  const rows=String(header).split(',').map(row=>row.trim().split(';').map(x=>x.trim()));
  const selected=rows.find(row=>row[0]==='gzip')||rows.find(row=>row[0]==='*');
  if(!selected)return false;const q=selected.find(x=>x.startsWith('q='));return !q||Number(q.slice(2))>0;
}
function createStaticServer({root=path.join(__dirname,'web'),base='/',gzip=true}={}){
  const directory=fs.realpathSync(root),mount=basePath(base),cache=new Map();
  const send=(res,status,message,method='GET',headers={})=>{const body=Buffer.from(message);res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Content-Length':body.length,...headers});res.end(method==='HEAD'?undefined:body);};
  return http.createServer((req,res)=>{
    let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{return send(res,400,'Invalid path',req.method);}
    if(mount!=='/'&&pathname===mount.slice(0,-1))return send(res,308,'Redirecting',req.method,{Location:mount});
    if(!pathname.startsWith(mount))return send(res,404,'Not found',req.method);
    let name=pathname.slice(mount.length)||'index.html';
    if(name.startsWith('api/')||name==='api')return send(res,404,'Not found',req.method);
    if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,'Static files only',req.method,{Allow:'GET, HEAD'});
    if(name.includes('\\')||name.includes('\0')||name.split('/').some(part=>!part||part.startsWith('.')))return send(res,404,'Not found',req.method);
    const ext=path.extname(name).toLowerCase(),mime=MIME[ext]||(/^LICENSE$|^NOTICE$/.test(name)?'text/plain; charset=utf-8':null);
    if(!mime)return send(res,404,'Not found',req.method);
    let filename,stat;try{filename=fs.realpathSync(path.join(directory,name));if(!filename.startsWith(directory+path.sep))throw Error();stat=fs.statSync(filename);if(!stat.isFile())throw Error();}catch{return send(res,404,'Not found',req.method);}
    const encode=gzip&&acceptsGzip(req.headers['accept-encoding'])&&['.html','.js','.css','.json','.txt','.md','.svg','.wasm'].includes(ext);
    const key=filename+'|'+stat.mtimeMs+'|'+stat.size+'|'+encode;
    let cached=cache.get(key);
    if(!cached){
      let data;try{data=fs.readFileSync(filename);if(encode)data=zlib.gzipSync(data);}catch{return send(res,404,'Not found',req.method);}
      cached={data,etag:'"'+crypto.createHash('sha256').update(data).digest('hex')+'"'};
      if(cache.size>=128)cache.clear();cache.set(key,cached);
    }
    const immutable=/^assets\/[^/]+\.[a-f0-9]{12}\.(?:js|css)$/.test(name);
    const headers={'Content-Type':mime,'Cache-Control':immutable?'public, max-age=31536000, immutable':'no-cache',ETag:cached.etag,Vary:'Accept-Encoding','X-Content-Type-Options':'nosniff',...(encode?{'Content-Encoding':'gzip'}:{})};
    if(String(req.headers['if-none-match']||'').split(',').some(value=>value.trim()==='*'||value.trim().replace(/^W\//,'')===cached.etag)){res.writeHead(304,headers);return res.end();}
    res.writeHead(200,{...headers,'Content-Length':cached.data.length});res.end(req.method==='HEAD'?undefined:cached.data);
  });
}
function resolvePort(value=process.env.LAOZU_PORT){const port=value===undefined||value===''?18768:Number(value);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('LAOZU_PORT must be an integer from 1024 to 65535');return port;}
function startStaticServer(options={}){
  const port=options.port??resolvePort(),base=basePath(options.base||'/'),server=createStaticServer({...options,base});
  server.on('error',error=>{console.error('Static QA server: '+error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log('Static web QA: http://127.0.0.1:'+port+base));
  const shutdown=()=>{server.close(()=>process.exit(0));server.closeAllConnections();};
  for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.once(signal,shutdown);
  server.once('close',()=>{for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.removeListener(signal,shutdown);});return server;
}
if(require.main===module){
  const index=process.argv.indexOf('--base-path');
  try{startStaticServer({base:index<0?'/':process.argv[index+1]});}catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={createStaticServer,startStaticServer,resolvePort,basePath,acceptsGzip};

// Local UI, existing private cloud bindings. Never serves the repository root or secrets.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {parseTradeWorkbook} from './trade-workbook.mjs';
import {listTradeLedgers} from './trade-store.mjs';
import {Readable} from 'node:stream';
import {getPlatformProxy} from 'wrangler';
import {inventoryHttp} from './inventory-http.mjs';
const host='127.0.0.1', port=Number(process.env.FLOW_BETA_PORT||8898);
const configPath=process.argv[2];if(!configPath)throw Error('Pass the private inventory bindings configuration path');
const proxy=await getPlatformProxy({configPath,persist:false,remoteBindings:true});
const {INVENTORY_DB:db,INVENTORY_FILES:bucket}=proxy.env,scope='bond-centre-inventory-qa-beta';
const identity=await db.prepare('SELECT scope FROM inventory_cloud_identity WHERE scope=?').bind(scope).first();
if(identity?.scope!==scope || await (await bucket.get('system/cloud-identity.txt'))?.text()!==scope)throw Error('Unexpected cloud storage');
// Immutable transaction blocks can be reused between questions. Keep the cache
// solely in local memory; always resolve the current versions from the cloud.
const cache=new Map();let memory=0;
function cacheBytes(key,bytes){
  memory+=bytes.length-(cache.get(key)?.length||0);cache.set(key,bytes);
  while(memory>96*1024*1024 && cache.size){
    const oldest=cache.keys().next().value;memory-=cache.get(oldest).length;cache.delete(oldest);
  }
}
// Optional startup warmup on the importing machine. Never use a local file as
// an active ledger: verify its cloud hash and the pinned parser block manifest.
async function readCloud(operation){
  for(let attempt=0;;attempt++)try{return await operation();}catch(e){
    if(attempt===2 || !/network|connection|temporar|internal error|5[0-9]{2}/i.test(String(e?.message)))throw e;
    await new Promise(r=>setTimeout(r,350*(attempt+1)));
  }
}
const importDir=process.argv[3];
if(importDir){
  for(const v of await readCloud(()=>listTradeLedgers(db)).catch(()=>[])){
    if(basename(v.filename)!==v.filename)continue;
    const bytes=await readFile(join(importDir,v.filename)).catch(()=>null);
    if(!bytes || createHash('sha256').update(bytes).digest('hex')!==v.sha)continue;
    const {chunks,rowCount,totalCents}=parseTradeWorkbook(bytes,v.filename,{compact:true});
    const record=await readCloud(()=>db.prepare('SELECT doc FROM trade_ledger_versions WHERE id=?').bind(v.id).first()).catch(()=>null);
    if(v.rowCount!==rowCount || v.totalCents!==totalCents || !record || JSON.stringify(JSON.parse(record.doc).blocks)!==JSON.stringify(chunks.map(b=>b.range)))continue;
    chunks.forEach((b,i)=>cacheBytes('trade-ledgers/v1/'+v.id+'/block-'+i+'.json',b.bytes));
  }
}
const cachedBucket={
  async get(key){
    if(!/^trade-ledgers\/v1\/[a-f0-9-]+\/block-\d+\.json$/i.test(key))return bucket.get(key);
    let bytes=cache.get(key);
    if(!bytes){
      const obj=await bucket.get(key);if(!obj)return null;
      bytes=new Uint8Array(await obj.arrayBuffer());cacheBytes(key,bytes);
    }
    return new Response(bytes);
  },
  put:(...args)=>bucket.put(...args),delete:(...args)=>bucket.delete(...args),
};
const envfile=join(process.env.LOCALAPPDATA||process.env.HOME,'BondCentreBeta','secrets','inventory-openai.env');
const origin='http://'+host+':'+port;
const assets=new Map([
  ['/inventory-qa/','inventory-qa/index.html'],...['trades.html','trades.js','inventory.js','inventory.css'].map(f=>['/inventory-qa/'+f,'inventory-qa/'+f]),['/favicon.svg','favicon.svg'],
]);
const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  try{
    if(req.headers.host!==host+':'+port || req.headers.origin&&req.headers.origin!==origin){res.writeHead(403);res.end();return;}
    const url=new URL(req.url,origin),prefix='/api/inventory/';
    if(url.pathname.startsWith(prefix)){
      const secret=await readFile(envfile,'utf8').catch(()=>''), key=secret.match(/^\s*INVENTORY_OPENAI_API_KEY\s*=\s*(.*?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g,'')||'';
      const request=new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})});
      const result=await inventoryHttp(request,url.pathname.slice(prefix.length),async()=>({db,bucket:cachedBucket,apiKey:key,owner:'local-inventory-beta'}),[origin]);
      res.writeHead(result.status,Object.fromEntries(result.headers));if(result.body)Readable.fromWeb(result.body).pipe(res);else res.end();return;
    }
    if(url.pathname==='/'){res.writeHead(302,{Location:'https://tempest07.com/bond-centre/'});res.end();return;}
    const path=assets.get(url.pathname);
    if(req.method!=='GET'||!path){res.writeHead(404);res.end();return;}
    const bytes=await readFile(new URL('../'+path,import.meta.url));
    res.writeHead(200,{'Content-Type':types[path.split('.').pop()],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);
  }catch{if(!res.headersSent)res.writeHead(503);res.end();}
});
server.listen(port,host,()=>console.log('Bond Centre trade beta: '+origin+'/inventory-qa/trades.html'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await proxy.dispose();process.exit(0);}));

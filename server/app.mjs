import http from 'node:http';
import { createHash,timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { Collector } from './collector.mjs';
import { sources } from './sources.mjs';
import { parsePort } from './summary.mjs';
const hash=text=>createHash('sha256').update(text).digest();
export function createApi({store,collector,apiToken=process.env.ANDES_API_TOKEN}={}){
  if(typeof apiToken!=='string'||apiToken.length<32)throw Error('Set ANDES_API_TOKEN to a random token of at least 32 characters');
  const secret=hash(`Bearer ${apiToken}`);
  const server=http.createServer((req,res)=>{
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    const url=new URL(req.url,'http://andes.internal');
    if(req.method==='GET'&&url.pathname==='/')return send(200,{service:'Andes News',version:'0.3',health:'/health'});
    if(req.method==='GET'&&url.pathname==='/health')return send(200,{status:'ok'});
    if(!timingSafeEqual(hash(req.headers.authorization??''),secret))return send(401,{error:'Unauthorized'});
    if(req.method==='GET'&&url.pathname==='/sources')return send(200,{sources});
    if(req.method==='GET'&&url.pathname==='/status')return send(200,{collection:store.getMeta('collection'),nextCollectionAt:store.getMeta('nextCollectionAt'),counts:store.counts(),processing:collector?.processing??false});
    if(req.method==='GET'&&url.pathname==='/articles'){
      const limit=Math.min(200,Math.max(1,Number(url.searchParams.get('limit'))||100)),offset=Math.max(0,Number(url.searchParams.get('offset'))||0);
      if(!Number.isInteger(limit)||!Number.isInteger(offset)||offset>100000)return send(400,{error:'Invalid pagination'});
      const articles=store.list({limit,offset});return send(200,{articles,nextOffset:articles.length===limit?offset+limit:null,collection:store.getMeta('collection'),counts:store.counts(),nextCollectionAt:store.getMeta('nextCollectionAt')});
    }
    const match=/^\/articles\/([a-f0-9]{32})$/.exec(url.pathname);
    if(req.method==='GET'&&match){const article=store.get(match[1]);if(!article)return send(404,{error:'Article not found'});const {contentText,...detail}=article;return send(200,{article:detail});}
    if(url.pathname==='/summary')return send(410,{error:'Upgrade Andes: summaries are prepared from article bodies in the background.'});
    send(404,{error:'Not found'});
  });
  server.headersTimeout=10000;server.requestTimeout=15000;return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const store=new Store(process.env.DATABASE_PATH??'/data/andes.db');
  const collector=new Collector({store});
  const server=createApi({store,collector});
  server.listen(parsePort(process.env.PORT??8787,'PORT'),process.env.HOST??'127.0.0.1',()=>{console.log('Andes News 0.3: article pipeline, collection every two hours');collector.start();});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{collector.stop();server.close(()=>{store.close();process.exit(0);});});
}

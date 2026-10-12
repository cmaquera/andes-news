import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from './app.mjs';
import { Store } from './store.mjs';

const token='test-only-token-with-at-least-32-characters';
const headers={authorization:`Bearer ${token}`};
function fixture(t){
  const store=new Store(':memory:');
  const article=store.discover({title:'Python API release',url:'https://example.com/api',sourceId:'hn',region:'Global',topic:'Programación',published:'2026-10-12T20:00:00Z'}).article;
  store.save({...article,abstract:'Resumen preparado',contentText:'Texto original',content:[{type:'paragraph',text:'Texto original'}]},'ready');
  store.setMeta('nextCollectionAt',123456);
  const app=createApi({store,apiToken:token,collector:{processing:true}});
  t.after(async()=>{await app.close();store.close();});
  return {app,store,article};
}

test('Fastify keeps health public and authenticates every data and unknown route',async(t)=>{
  const {app,article}=fixture(t);
  for(const url of ['/','/health','/health?check=1']){
    const r=await app.inject({url});assert.equal(r.statusCode,200);assert.equal(r.headers['cache-control'],'no-store');assert.match(r.headers['content-type'],/application\/json/);
  }
  for(const url of ['/sources','/status','/articles',`/articles/${article.id}`,'/summary','/missing','/health/private','/articles?limit=invalid']){
    for(const credential of [undefined,'Bearer wrong',`Basic ${token}`]){
      const r=await app.inject({url,headers:credential?{authorization:credential}:{}});assert.equal(r.statusCode,401,url);assert.deepEqual(r.json(),{error:'Unauthorized'});
    }
  }
  assert.equal((await app.inject({url:'/missing',headers})).statusCode,404);
  assert.equal((await app.inject({url:'/summary',headers})).statusCode,410);
  assert.equal((await app.inject({method:'POST',url:'/summary',headers,payload:{text:'Legacy excerpt'}})).statusCode,410);
});
test('Fastify preserves feed, article, sources and worker status contracts',async(t)=>{
  const {app,article}=fixture(t);
  const feed=(await app.inject({url:'/articles?limit=1&offset=0',headers})).json();
  assert.equal(feed.articles[0].abstract,'Resumen preparado');assert.equal(feed.articles[0].content,undefined);assert.equal(feed.nextOffset,1);assert.equal(feed.counts.ready,1);
  const detail=(await app.inject({url:`/articles/${article.id}`,headers})).json();assert.equal(detail.article.content[0].text,'Texto original');assert.equal(detail.article.contentText,undefined);
  assert.equal((await app.inject({url:'/sources',headers})).json().sources.length,6);
  const status=(await app.inject({url:'/status',headers})).json();assert.equal(status.processing,true);assert.equal(status.nextCollectionAt,123456);
  assert.equal((await app.inject({url:'/articles?offset=1',headers})).json().articles.length,0);
});
test('Fastify validates pagination and article IDs without leaking internal errors',async(t)=>{
  const {app,store}=fixture(t);
  for(const query of ['limit=abc','limit=0','limit=-1','limit=201','limit=1.5','offset=-1','offset=100001','offset=abc','limit=1&limit=2']){
    const r=await app.inject({url:`/articles?${query}`,headers});assert.equal(r.statusCode,400,query);assert.deepEqual(r.json(),{error:'Invalid pagination'});
  }
  for(const id of ['not-an-id','A'.repeat(32),'b'.repeat(32)])assert.equal((await app.inject({url:`/articles/${id}`,headers})).statusCode,404);
  store.list=()=>{throw Error('Private database path and credentials');};
  const failed=await app.inject({url:'/articles',headers});assert.equal(failed.statusCode,500);assert.deepEqual(failed.json(),{error:'Internal server error'});
});
test('Fastify starts an HTTP listener and closes cleanly',async(t)=>{
  const {app}=fixture(t);let stopped=false;
  app.addHook('preClose',async()=>{stopped=true;});
  const address=await app.listen({port:0,host:'127.0.0.1'});
  const response=await fetch(`${address}/status`,{headers});assert.equal(response.status,200);assert.equal((await response.json()).processing,true);
  await app.close();assert.equal(stopped,true);assert.equal(app.server.listening,false);
});

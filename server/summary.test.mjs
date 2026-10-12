import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSummaryServer, createOllamaGenerator } from './summary.mjs';
const token='test-only-token-with-at-least-32-characters';
function request(server,method,url,data,auth=`Bearer ${token}`) {
  return new Promise(resolve => {
    const req=Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    Object.assign(req,{method,url,headers:{authorization:auth,'content-type':'application/json'}});
    server.emit('request',req,{status:0,writeHead(status){this.status=status;},end(body){resolve({status:this.status,data:JSON.parse(body)});}});
  });
}
test('Fails closed without a token',()=>assert.throws(()=>createSummaryServer({apiToken:''}),/ANDES_API_TOKEN/));
test('Authenticates requests, persists cache and validates input',async()=>{
  let calls=0;
  mkdirSync(join(process.cwd(),'build'),{recursive:true});
  const directory=mkdtempSync(join(process.cwd(),'build','andes-test-'));
  const cacheFile=join(directory,'cache.json');
  const generate=async(title,excerpt)=>{calls++;if(title==='fail')throw Error();return {titleEs:'Titular traducido',summary:`Resumen: ${excerpt || title}`};};
  const server=createSummaryServer({apiToken:token,cacheFile,generate});
  const post=(data,auth)=>request(server,'POST','/summary',data,auth);
  try {
    assert.equal((await request(server,'GET','/health')).status,200);
    assert.equal((await post({title:'Python',excerpt:'release'},'Bearer wrong')).status,401);
    const data={title:'Python',excerpt:'Nueva versión'};
    const first=await post(data);assert.equal(first.data.titleEs,'Titular traducido');assert.equal(first.data.cached,false);
    assert.equal((await post(data)).data.cached,true);assert.equal(calls,1);
    const restarted=createSummaryServer({apiToken:token,cacheFile,generate});
    assert.equal((await request(restarted,'POST','/summary',data)).data.cached,true);assert.equal(calls,1);
    assert.equal((await post({title:'Only title',excerpt:''})).data.basis,'title');
    assert.equal((await post({title:'Invalid'})).status,400);
    assert.equal((await post({title:'fail',excerpt:''})).status,503);
    assert.equal((await post({title:'Huge',excerpt:'a'.repeat(20000)})).status,413);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
test('A single inference runs at a time',async()=>{
  let resolve;
  const server=createSummaryServer({apiToken:token,generate:()=>new Promise(r=>resolve=r)});
  const first=request(server,'POST','/summary',{title:'One',excerpt:''});
  await new Promise(r=>setImmediate(r));
  assert.equal((await request(server,'POST','/summary',{title:'Two',excerpt:''})).status,429);
  resolve({titleEs:'Uno',summary:'Solo titular'});assert.equal((await first).status,200);
});
test('Ollama receives structured output and small context; truncated responses fail',async()=>{
  let body;
  const generate=createOllamaGenerator({fetchImpl:async(url,options)=>{body=JSON.parse(options.body);assert.ok(url.endsWith('/api/generate'));return {ok:true,json:async()=>({done:true,response:JSON.stringify({titleEs:'Titular',summary:'Resumen'})})};}});
  assert.equal((await generate('Title','Excerpt')).titleEs,'Titular');assert.equal(body.options.num_ctx,2048);assert.equal(body.stream,false);assert.deepEqual(body.format.required,['titleEs','summary']);
  const truncated=createOllamaGenerator({fetchImpl:async()=>({ok:true,json:async()=>({done:true,done_reason:'length',response:'{}'})})});
  await assert.rejects(()=>truncated('Title','Excerpt'));
});

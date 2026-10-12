import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { extractHtml,ArticleExtractor } from './extract.mjs';
import { Store } from './store.mjs';
import { Collector,POLL_INTERVAL } from './collector.mjs';
import { OllamaModel,splitText } from './model.mjs';
import { createApi } from './app.mjs';
import { isPublicAddress,publicUrl,RobotsPolicy } from './net.mjs';
import {loadSource,sources} from './sources.mjs';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,sep} from 'node:path';
const token='test-only-token-with-at-least-32-characters';
const candidate={title:'Release',url:'https://example.com/article',region:'Perú',sourceId:'gestion',sourceName:'Gestión',published:'2026-10-12T10:00:00Z',topic:'Programación'};
const body=`<html lang="en"><head><title>Database release</title></head><body><nav>MENU</nav><article><h1>Database release</h1><p>${'The database introduces incremental backups with documented limits. '.repeat(20)}</p><h2>Technical details</h2><pre>const backup = true;</pre><p>The final paragraph states that the feature is experimental and requires manual activation.</p></article><div class="ad-container">ADVERT</div><div id="cookie-dialog">COOKIES</div><script>INJECTED()</script><footer>FOOTER</footer></body></html>`;
test('Extracts original prose, headings and code without ads, cookies or scripts',()=>{
  const result=extractHtml(body,candidate.url);
  assert.equal(result.coverage,'extracted');assert.ok(result.text.includes('final paragraph'));assert.ok(result.blocks.some(b=>b.type==='code'&&b.text==='const backup = true;'));
  for(const excluded of ['MENU','ADVERT','COOKIES','INJECTED','FOOTER'])assert.ok(!result.text.includes(excluded));
  const restricted=extractHtml(body.replace('<head>','<head><script type="application/ld+json">{"isAccessibleForFree":false}</script>'),candidate.url);assert.equal(restricted.coverage,'partial');
});
test('RSS listings retain provenance and DEV retrieves the full published body',async()=>{
  const rss=await loadSource(sources[0],{get:async()=>({body:'<rss version="2.0"><channel><title>Noticias</title><link>https://example.com</link><description>Noticias</description><item><title>Python release</title><link>https://example.com/article</link><description>RSS teaser only.</description><pubDate>Mon, 12 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>'})});
  assert.equal(rss[0].region,'Perú');assert.equal(rss[0].sourceId,'gestion');assert.equal(rss[0].topic,'Programación');
  let fetched;
  const extractor=new ArticleExtractor({robots:{allowed:async()=>{throw Error('Should use body API');}},get:async url=>{fetched=url;return {body:JSON.stringify({title:'Article',body_html:`<p>${'Texto completo publicado con todos los detalles. '.repeat(20)}</p><pre>print("hello")</pre>`,user:{name:'Autor'}})};}});
  const article=await extractor.extract('https://dev.to/author/article',{sourceId:'dev',apiArticleId:123,title:'Article'});
  assert.equal(fetched,'https://dev.to/api/articles/123');assert.equal(article.extractionMethod,'forem-body-api');assert.ok(article.blocks.some(b=>b.type==='code'));
});
test('Blocks private and metadata addresses and honors robots denial',async()=>{
  for(const ip of ['127.0.0.1','192.168.0.200','10.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1'])assert.equal(isPublicAddress(ip),false,ip);
  assert.equal(isPublicAddress('8.8.8.8'),true);assert.throws(()=>publicUrl('http://localhost/a'));assert.throws(()=>publicUrl('http://example.com:11434/a'));
  const robots=new RobotsPolicy(async()=>({body:'User-agent: *\nDisallow: /private'}));
  await assert.rejects(()=>robots.allowed('https://example.com/private/article'),/robots_denied/);
  const extractor=new ArticleExtractor({get:async()=>{throw Error('Must not fetch');},robots});await assert.rejects(()=>extractor.extract('https://example.com/private/article'),/robots_denied/);
});
test('All article chunks reach the model; Unicode is not lost or silently truncated',async()=>{
  const text=('Primera parte. 😀 '.repeat(180))+'FINAL_UNIQUE_FACT';
  const chunks=splitText(text);assert.equal(chunks.join(''),text);assert.ok(chunks.every(c=>Buffer.byteLength(c)<=1600));
  const inputs=[];
  const model=new OllamaModel({endpoint:'http://localhost:11434',fetchImpl:async(_url,options)=>{
    const request=JSON.parse(options.body),input=JSON.parse(request.prompt);inputs.push(input);
    const result=request.format.properties.notes?{notes:'Notas breves que conservan el hecho.'}:request.format.properties.textEs?{textEs:'Traducción íntegra.'}:{titleEs:'Titular',abstract:'Abstracto de todas las partes.',keyPoints:['Hecho']};
    return {ok:true,json:async()=>({done:true,response:JSON.stringify(result)})};
  }});
  const result=await model.summarize('Article',text);assert.equal(result.summaryParts,chunks.length);assert.equal(inputs.filter(i=>i.text).map(i=>i.text).join(''),text);
  assert.deepEqual((await model.translate([{type:'code',text:'print("hello")'}]))[0],{type:'code',text:'print("hello")'});
});
test('Discovers every two hours, deduplicates and stores captured/translated article',async()=>{
  const store=new Store(':memory:');let now=1000000,calls=0;
  const collector=new Collector({store,now:()=>now,load:async()=>{calls++;return [candidate];},extractor:{extract:async()=>({...extractHtml(body,candidate.url),resolvedUrl:candidate.url})},model:{summarize:async()=>({titleEs:'Nueva versión',abstract:'Resumen del cuerpo entero.',keyPoints:['Experimental'],summaryParts:2}),translate:async blocks=>blocks.map(b=>({...b,text:b.type==='code'?b.text:'Contenido traducido.'}))}});
  await collector.tick();assert.equal(calls,6);await collector.tick();assert.equal(calls,6);now+=POLL_INTERVAL;await collector.tick();assert.equal(calls,12);assert.equal(store.counts().queued,1);
  await collector.processOne();const stored=store.get(store.list()[0].id);assert.equal(stored.status,'ready');assert.ok(stored.contentText.includes('final paragraph'));assert.ok(stored.translatedContent.length);assert.equal(stored.abstract,'Resumen del cuerpo entero.');store.close();
});
function request(server,path,auth=`Bearer ${token}`){
  return new Promise(resolve=>{
    const req=Readable.from([]);Object.assign(req,{method:'GET',url:path,headers:{authorization:auth}});
    server.emit('request',req,{status:0,writeHead(status){this.status=status;},end(body){resolve({status:this.status,data:JSON.parse(body)});}});
  });
}
test('API serves ready metadata and clean article detail, protected by token',async()=>{
  const store=new Store(':memory:'),a=store.discover(candidate).article;store.save({...a,abstract:'Resumen',content:[{type:'paragraph',text:'Original limpio'}],contentText:'Original limpio',status:'ready'},'ready');
  const api=createApi({store,apiToken:token});assert.equal((await request(api,'/articles','')).status,401);
  const feed=(await request(api,'/articles')).data;assert.equal(feed.articles[0].abstract,'Resumen');assert.equal(feed.articles[0].content,undefined);
  assert.equal((await request(api,`/articles/${a.id}`)).data.article.content[0].text,'Original limpio');assert.equal((await request(api,'/articles/nope')).status,404);store.close();
});
test('Database and interrupted jobs survive restart',()=>{
  const root=join(process.cwd(),'build');mkdirSync(root,{recursive:true});
  const directory=mkdtempSync(join(root,'pipeline-'));assert.ok(directory.startsWith(root+sep));
  const path=join(directory,'articles.db');
  try{
    let store=new Store(path);const a=store.discover(candidate).article;
    store.save({...a,contentText:'Cuerpo recuperado antes de reiniciar.',content:[{type:'paragraph',text:'Cuerpo recuperado antes de reiniciar.'}]},'processing');store.setMeta('nextCollectionAt',123456);store.cache('chunk',{notes:'Notas guardadas'});store.close();
    store=new Store(path);assert.equal(store.next().id,a.id);assert.equal(store.next().contentText,'Cuerpo recuperado antes de reiniciar.');assert.equal(store.next().status,'queued');assert.equal(store.getMeta('nextCollectionAt'),123456);assert.equal(store.cached('chunk').notes,'Notas guardadas');store.close();
  }finally{rmSync(directory,{recursive:true,force:true});}
});
test('Collection continues during inference and duplicate workers cannot overlap',async()=>{
  const store=new Store(':memory:');let now=1000000,calls=0,release;
  const collector=new Collector({store,now:()=>now,load:async()=>{calls++;return[candidate];},extractor:{extract:async()=>({...extractHtml(body,candidate.url),resolvedUrl:candidate.url})},model:{summarize:()=>new Promise(resolve=>release=resolve),translate:async blocks=>blocks}});
  await collector.tick();const work=collector.processOne();await new Promise(resolve=>setImmediate(resolve));assert.equal(await collector.processOne(),false);
  now+=POLL_INTERVAL;await collector.tick();assert.equal(calls,12);
  release({titleEs:'Titular',abstract:'Abstracto completo',keyPoints:[]});await work;assert.equal(store.counts().ready,1);store.close();
});

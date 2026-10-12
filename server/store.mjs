import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { publicUrl } from './net.mjs';
import { assessFocus,FOCUS_VERSION } from './focus.mjs';
export function canonicalUrl(value){const url=publicUrl(value);url.hash='';for(const key of [...url.searchParams.keys()])if(key.startsWith('utm_')||key==='fbclid')url.searchParams.delete(key);return url.href;}
export class Store {
  constructor(path){
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS articles(id TEXT PRIMARY KEY,url TEXT UNIQUE NOT NULL,data TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0,discovered INTEGER NOT NULL,updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS model_cache(key TEXT PRIMARY KEY,result TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    this.db.prepare("UPDATE articles SET state='queued',data=json_set(data,'$.status','queued') WHERE state='processing'").run();
    // Upgrade existing text-only articles once, preserving their readable body
    // and abstract while the worker retrieves rich content in the background.
    this.db.prepare("UPDATE articles SET state='queued',attempts=0,retry_at=0,data=json_set(data,'$.status','queued','$.needsRichExtraction',json('true'),'$.richUpgradeScheduled',json('true')) WHERE json_extract(data,'$.contentText')<>'' AND COALESCE(json_extract(data,'$.extractionVersion'),0)<2 AND COALESCE(json_extract(data,'$.richUpgradeScheduled'),0)=0").run();
    // Reassess previously collected stories on upgrade, retaining them for
    // saved-article detail while removing irrelevant stories from feed/worker.
    if(this.getMeta('focusVersion')!==FOCUS_VERSION){
      this.db.exec('BEGIN');try{
        for(const row of this.db.prepare('SELECT data,state FROM articles').all()){
          const article=JSON.parse(row.data),relevance=assessFocus(article,{full:Boolean(article.contentText)});
          this.save({...article,relevance,topic:relevance.topic},relevance.accepted?(row.state==='filtered'?'queued':row.state):'filtered');
        }
        this.setMeta('focusVersion',FOCUS_VERSION);this.db.exec('COMMIT');
      }catch(e){this.db.exec('ROLLBACK');throw e;}
    }
  }
  discover(candidate){
    const url=canonicalUrl(candidate.url),id=createHash('sha256').update(url).digest('hex').slice(0,32),now=Date.now();
    const previous=this.get(id);
    if(previous)return {article:previous,isNew:false};
    const relevance=candidate.relevance??assessFocus(candidate),state=relevance.accepted?'queued':'filtered';
    const data={...candidate,relevance,topic:relevance.topic,id,url,status:state,coverage:'unavailable',content:[],translatedContent:[],contentText:'',abstract:'',titleEs:'',keyPoints:[],discoveredAt:new Date(now).toISOString()};
    this.db.prepare('INSERT INTO articles(id,url,data,state,discovered,updated) VALUES(?,?,?,?,?,?)').run(id,url,JSON.stringify(data),state,now,now);
    return {article:data,isNew:true};
  }
  get(id){const row=this.db.prepare('SELECT data FROM articles WHERE id=?').get(id);return row?JSON.parse(row.data):null;}
  save(article,state=article.status){this.db.prepare('UPDATE articles SET data=?,state=?,updated=? WHERE id=?').run(JSON.stringify({...article,status:state}),state,Date.now(),article.id);}
  next(){const row=this.db.prepare("SELECT data FROM articles WHERE state='queued' AND retry_at<=? ORDER BY discovered,id LIMIT 1").get(Date.now());return row?JSON.parse(row.data):null;}
  fail(article,code){
    const row=this.db.prepare('SELECT attempts FROM articles WHERE id=?').get(article.id),attempts=(row?.attempts??0)+1;
    const state=attempts>=3?'unavailable':'queued';
    const data={...article,status:state,lastError:code};
    this.db.prepare('UPDATE articles SET data=?,state=?,attempts=?,retry_at=?,updated=? WHERE id=?').run(JSON.stringify(data),state,attempts,Date.now()+7200000,Date.now(),article.id);
  }
  list({limit=100,offset=0}={}){
    return this.db.prepare("SELECT data FROM articles WHERE state<>'filtered' AND json_extract(data,'$.relevance.accepted')=1 ORDER BY date(json_extract(data,'$.published'),'-5 hours') DESC, json_extract(data,'$.relevance.priority') DESC, CASE json_extract(data,'$.region') WHEN 'Perú' THEN 0 WHEN 'Latinoamérica' THEN 1 ELSE 2 END,json_extract(data,'$.published') DESC,discovered DESC LIMIT ? OFFSET ?").all(limit,offset).map(row=>{const a=JSON.parse(row.data);delete a.content;delete a.translatedContent;delete a.contentText;return a;});
  }
  counts(){return Object.fromEntries(this.db.prepare('SELECT state,count(*) AS count FROM articles GROUP BY state').all().map(r=>[r.state,r.count]));}
  getMeta(key){const row=this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);return row?JSON.parse(row.value):null;}
  setMeta(key,value){this.db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run(key,JSON.stringify(value));}
  cached(key){const row=this.db.prepare('SELECT result FROM model_cache WHERE key=?').get(key);return row?JSON.parse(row.result):null;}
  cache(key,result){this.db.prepare('INSERT OR REPLACE INTO model_cache(key,result,created) VALUES(?,?,?)').run(key,JSON.stringify(result),Date.now());}
  prune(){const cutoff=Date.now()-60*86400000;this.db.prepare('DELETE FROM articles WHERE updated<?').run(cutoff);this.db.prepare('DELETE FROM model_cache WHERE created<?').run(cutoff);}
  close(){this.db.close();}
}

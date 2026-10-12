import { sources,loadSource } from './sources.mjs';
import { ArticleExtractor } from './extract.mjs';
import { OllamaModel,detectLanguage } from './model.mjs';
import { assessFocus } from './focus.mjs';
export const POLL_INTERVAL=2*60*60*1000;
export class Collector {
  constructor({store,extractor=new ArticleExtractor(),model=new OllamaModel({store}),load=loadSource,now=()=>Date.now(),interval=POLL_INTERVAL}={}){
    this.store=store;this.extractor=extractor;this.model=model;this.load=load;this.now=now;this.interval=interval;this.discovering=false;this.processing=false;this.stopped=false;
  }
  async discover(){
    if(this.discovering)return;this.discovering=true;
    const started=this.now();this.store.setMeta('nextCollectionAt',started+this.interval);
    const errors={};let added=0,filtered=0;
    try{
      for(const source of sources){
        try{
          const candidates=await this.load(source);
          let selected=0;
          for(const candidate of candidates){try{const relevance=assessFocus(candidate);if(!relevance.accepted){filtered++;continue;}if(selected++>=20)break;if(this.store.discover({...candidate,relevance,topic:relevance.topic}).isNew)added++;}catch(_){errors[source.id]='invalid_source_item';}}
        }catch(e){errors[source.id]=e.code??'source_unavailable';}
      }
      this.store.setMeta('collection',{startedAt:new Date(started).toISOString(),completedAt:new Date(this.now()).toISOString(),added,filtered,errors});this.store.prune();
    }finally{this.discovering=false;}
  }
  async processOne(){
    if(this.processing)return false;
    let article=this.store.next();if(!article)return false;
    this.processing=true;this.store.save(article,'processing');
    try{
      if(!article.contentText||article.needsRichExtraction){
        const body=await this.extractor.extract(article.url,article);
        article={...article,content:body.blocks,contentText:body.text,translatedContent:[],needsRichExtraction:false,extractionVersion:body.extractionVersion,coverage:body.coverage,language:detectLanguage(body.blocks.filter(b=>b.type!=='code').map(b=>b.text).join('\n').slice(0,12000),body.language),author:body.author,wordCount:body.wordCount,fetchedAt:body.fetchedAt,extractionMethod:body.extractionMethod,resolvedUrl:body.resolvedUrl,imageUrl:body.imageUrl||article.imageUrl};
        this.store.save(article,'processing');
      }
      article.relevance=assessFocus(article,{full:true});article.topic=article.relevance.topic;
      if(!article.relevance.accepted){this.store.save(article,'filtered');return true;}
      if(!article.abstract){article={...article,...await this.model.summarize(article.title,article.contentText)};this.store.save(article,'processing');}
      if(article.language!=='es'&&!article.translatedContent?.length){article.translatedContent=await this.model.translate(article.content);this.store.save(article,'processing');}
      article.processedAt=new Date(this.now()).toISOString();article.lastError=null;article.status='ready';this.store.save(article,'ready');
    }catch(e){this.store.fail(article,e.code??e.message??'processing_failed');console.warn(`Article ${article.id}: ${e.code??e.message??'failed'}`);}
    finally{this.processing=false;}
    return true;
  }
  async tick(){
    const next=this.store.getMeta('nextCollectionAt')??0;
    if(this.now()>=next&&!this.discovering)await this.discover();
  }
  start(){
    // Collection and inference have separate loops: news discovery continues
    // every two hours even when the GPU is still processing the previous queue.
    this.stopped=false;
    this.collectionTimer=setInterval(()=>this.tick().catch(e=>console.warn('Collection failed:',e.message)),15000);
    this.tick().catch(e=>console.warn('Initial collection failed:',e.message));
    const work=async()=>{
      if(this.stopped)return;
      try{await this.processOne();}catch(e){console.warn('Worker failed:',e.message);}
      if(!this.stopped)this.workerTimer=setTimeout(work,1000);
    };work();
  }
  stop(){this.stopped=true;clearInterval(this.collectionTimer);clearTimeout(this.workerTimer);}
}

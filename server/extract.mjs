import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { SourceError, publicGet, RobotsPolicy } from './net.mjs';

const unwanted='script,style,iframe,form,button,input,nav,footer,aside,noscript,svg,[role="dialog"],[aria-modal="true"],.advertisement,.ad-container,.adsbygoogle,.newsletter-signup,.related-articles,.related-posts,.article-related,[id*="cookie"],[class*="cookie"],[id*="consent"],[class*="consent"]';
const clean=text=>text.replace(/\s+/g,' ').trim();
export function extractHtml(html,url){
  const dom=new JSDOM(html,{url}); // No scripts, subresources or browser execution.
  try{
    const doc=dom.window.document;
    if(doc.querySelector('#challenge-running,#cf-challenge-running')||/just a moment|access denied|verify you are human/i.test(doc.title))throw new SourceError('access_challenge');
    let restricted=Boolean(doc.querySelector('.paywall,[data-paywall],.subscription-wall'));
    for(const script of doc.querySelectorAll('script[type="application/ld+json"]')){
      try{const values=JSON.parse(script.textContent);const records=Array.isArray(values)?values:[values];for(const value of records.flatMap(v=>v['@graph']??[v]))if(value.isAccessibleForFree===false||value.isAccessibleForFree==='false')restricted=true;}catch(_){}
    }
    const imageUrl=doc.querySelector('meta[property="og:image"]')?.content??'';
    doc.querySelectorAll(unwanted).forEach(node=>node.remove());
    const article=new Readability(doc,{charThreshold:250,maxElemsToParse:30000}).parse();
    if(!article?.textContent||clean(article.textContent).length<250)throw new SourceError('insufficient_article');
    const content=new JSDOM(`<body>${article.content}</body>`);
    try{
      const body=content.window.document.body;body.querySelectorAll(unwanted).forEach(n=>n.remove());
      const blocks=[];
      function walk(node){
        for(const child of node.childNodes){
          if(child.nodeType===3){const text=clean(child.textContent);if(text)blocks.push({type:'paragraph',text});continue;}
          if(child.nodeType!==1)continue;
          const tag=child.tagName.toLowerCase();
          if(tag==='pre'){const text=child.textContent.trim();if(text)blocks.push({type:'code',text});}
          else if(/^h[1-6]$/.test(tag)){const text=clean(child.textContent);if(text)blocks.push({type:'heading',text});}
          else if(tag==='p'||tag==='li'||tag==='blockquote'){const text=clean(child.textContent);if(text)blocks.push({type:tag==='li'?'list':tag==='blockquote'?'quote':'paragraph',text});}
          else if(tag==='table'){const text=[...child.querySelectorAll('tr')].map(row=>[...row.querySelectorAll('th,td')].map(c=>clean(c.textContent)).join(' | ')).join('\n');if(text)blocks.push({type:'code',text});}
          else walk(child);
        }
      }
      walk(body);
      const text=blocks.map(b=>b.text).join('\n\n');
      if(text.length<250)throw new SourceError('insufficient_article');
      return {title:clean(article.title??''),author:article.byline??'',language:article.lang??dom.window.document.documentElement.lang??'',blocks,text,wordCount:text.split(/\s+/).length,imageUrl,imageIsFromSource:true,coverage:restricted?'partial':'extracted',extractionMethod:'readability',fetchedAt:new Date().toISOString()};
    }finally{content.window.close();}
  }finally{dom.window.close();}
}
export class ArticleExtractor {
  constructor({get=publicGet,robots=new RobotsPolicy(get)}={}){this.get=get;this.robots=robots;}
  async extract(url,candidate={}){
    // DEV's public article endpoint explicitly supplies the body, unlike the
    // short description in its listing endpoint. It avoids the website shell.
    if(candidate.sourceId==='dev'&&Number.isSafeInteger(candidate.apiArticleId)&&candidate.apiArticleId>0){
      const result=await this.get(`https://dev.to/api/articles/${candidate.apiArticleId}`);
      const article=JSON.parse(result.body);
      if(typeof article.body_html!=='string')throw new SourceError('insufficient_article');
      const escapedTitle=String(article.title??candidate.title??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
      const extracted=extractHtml(`<html><head><title>${escapedTitle}</title></head><body><article>${article.body_html}</article></body></html>`,url);
      return {...extracted,author:typeof article.user?.name==='string'?article.user.name:'',resolvedUrl:url,extractionMethod:'forem-body-api'};
    }
    await this.robots.allowed(url);
    const page=await this.get(url);
    if(!/html|xhtml/i.test(page.type))throw new SourceError('unsupported_content');
    // Recheck the final destination too: a publisher redirect can change origins.
    await this.robots.allowed(page.url);
    return {...extractHtml(page.body,page.url),resolvedUrl:page.url};
  }
}

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch } from 'undici';
import robotsParser from 'robots-parser';

export const USER_AGENT='AndesNews/0.3 (personal article reader)';
export class SourceError extends Error {constructor(code,message=code){super(message);this.code=code;}}
export function isPublicAddress(address){try{return ipaddr.process(address).range()==='unicast';}catch(_){return false;}}
export function publicUrl(value){
  const url=new URL(value);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!['','80','443'].includes(url.port))throw new SourceError('unsafe_url');
  if(url.hostname==='localhost'||url.hostname.endsWith('.localhost')||url.hostname.endsWith('.local'))throw new SourceError('unsafe_url');
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(isIP(host)&&!isPublicAddress(host))throw new SourceError('unsafe_address');
  return url;
}
export async function publicGet(value,{maxBytes=2_000_000,timeout=25000,accept='text/html,application/xhtml+xml,application/xml,application/json,text/plain'}={}){
  let url=publicUrl(value);
  const signal=AbortSignal.timeout(timeout);
  for(let redirects=0;redirects<=5;redirects++){
    const host=url.hostname.replace(/^\[|\]$/g,'');
    const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await lookup(host,{all:true});
    if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address)))throw new SourceError('unsafe_address');
    // Pin the checked address into the socket lookup: redirects and DNS rebinding
    // cannot turn a feed link into a request to the private Ollama/Docker network.
    const target=addresses.find(a=>a.family===4)??addresses[0];
    const agent=new Agent({connect:{lookup:(_host,options,callback)=>options?.all?callback(null,[target]):callback(null,target.address,target.family)}});
    try{
      const response=await fetch(url,{redirect:'manual',dispatcher:agent,signal,headers:{'User-Agent':USER_AGENT,Accept:accept}});
      if(response.status>=300&&response.status<400){await response.body?.cancel();const location=response.headers.get('location');if(!location)throw new SourceError('invalid_redirect');url=publicUrl(new URL(location,url).href);continue;}
      if(!response.ok){await response.body?.cancel();throw new SourceError(`http_${response.status}`);}
      if(Number(response.headers.get('content-length')??0)>maxBytes){await response.body?.cancel();throw new SourceError('too_large');}
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes){await response.body?.cancel().catch(()=>{});throw new SourceError('too_large');}chunks.push(Buffer.from(chunk));}
      return {url:url.href,status:response.status,body:Buffer.concat(chunks).toString('utf8'),type:response.headers.get('content-type')??''};
    }finally{await agent.destroy();}
  }
  throw new SourceError('too_many_redirects');
}
export class RobotsPolicy {
  constructor(get=publicGet){this.get=get;this.cache=new Map();}
  async allowed(value){
    const url=publicUrl(value),origin=url.origin;
    let entry=this.cache.get(origin);
    if(!entry||entry.expires<Date.now()){
      let rules='';
      try{rules=(await this.get(`${origin}/robots.txt`,{maxBytes:200000})).body;}
      catch(e){if(e.code==='http_401'||e.code==='http_403')throw new SourceError('robots_denied');if(e.code!=='http_404'&&e.code!=='http_410')throw new SourceError('robots_unavailable');}
      entry={parser:robotsParser(`${origin}/robots.txt`,rules),expires:Date.now()+7200000};this.cache.set(origin,entry);
    }
    if(entry.parser.isAllowed(url.href,'AndesNews')===false)throw new SourceError('robots_denied');
    return true;
  }
}

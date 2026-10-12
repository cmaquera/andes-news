import { sources } from './sources.mjs';

const pagination={type:'object',properties:{
  limit:{type:'integer',minimum:1,maximum:200,default:100},
  offset:{type:'integer',minimum:0,maximum:100000,default:0},
}};
const articleId={type:'object',required:['id'],properties:{id:{type:'string',pattern:'^[a-f0-9]{32}$'}}};

export async function articleRoutes(app,{store,collector}){
  app.get('/',{config:{public:true}},async()=>({service:'Andes News',version:'0.4.2',health:'/health'}));
  app.get('/health',{config:{public:true}},async()=>({status:'ok'}));
  app.get('/sources',async()=>({sources}));
  app.get('/status',async()=>({collection:store.getMeta('collection'),nextCollectionAt:store.getMeta('nextCollectionAt'),counts:store.counts(),processing:collector?.processing??false}));
  app.get('/articles',{schema:{querystring:pagination}},async(request)=>{
    const {limit,offset}=request.query,articles=store.list({limit,offset});
    return {articles,nextOffset:articles.length===limit?offset+limit:null,collection:store.getMeta('collection'),counts:store.counts(),nextCollectionAt:store.getMeta('nextCollectionAt')};
  });
  app.get('/articles/:id',{schema:{params:articleId}},async(request,reply)=>{
    const article=store.get(request.params.id);
    if(!article)return reply.code(404).send({error:'Article not found'});
    const {contentText,...detail}=article;return {article:detail};
  });
  app.all('/summary',async(_request,reply)=>reply.code(410).send({error:'Upgrade Andes: summaries are prepared from article bodies in the background.'}));
}

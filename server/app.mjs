import Fastify from 'fastify';
import { pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { Collector } from './collector.mjs';
import { parsePort } from './summary.mjs';
import { installAuthentication } from './api_auth.mjs';
import { articleRoutes } from './api_routes.mjs';

export function createApi({store,collector,apiToken=process.env.ANDES_API_TOKEN,logger=false}={}) {
  const app=Fastify({logger:logger?{level:'info',redact:['req.headers.authorization','req.headers.cookie']}:false,requestTimeout:15000,bodyLimit:16384});
  app.server.headersTimeout=10000;
  installAuthentication(app,apiToken);
  app.setErrorHandler((error,request,reply)=>{
    if(error.validation){
      const invalidId=error.validationContext==='params';
      return reply.code(invalidId?404:400).send({error:invalidId?'Article not found':'Invalid pagination'});
    }
    const status=error.statusCode>=400&&error.statusCode<500?error.statusCode:500;
    if(status===500)request.log.error({err:error},'API request failed');
    return reply.code(status).send({error:status===500?'Internal server error':'Invalid request'});
  });
  app.setNotFoundHandler((_request,reply)=>reply.code(404).send({error:'Not found'}));
  app.register(articleRoutes,{store,collector});
  return app;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const store=new Store(process.env.DATABASE_PATH??'/data/andes.db');
  const collector=new Collector({store});
  let app;
  try{
    app=createApi({store,collector,logger:true});
    app.addHook('preClose',async()=>collector.stop());
    app.addHook('onClose',async()=>store.close());
    await app.listen({port:parsePort(process.env.PORT??8787,'PORT'),host:process.env.HOST??'127.0.0.1'});
    collector.start();
    app.log.info('Andes News 0.4.2: Fastify API, collection every two hours');
  }catch(error){
    console.error('Andes startup failed:',error.message);
    if(app)await app.close();else store.close();
    process.exit(1);
  }
  let closing=false;
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{
    if(closing)return;closing=true;
    try{await app.close();process.exit(0);}catch(error){app.log.error({err:error},'Shutdown failed');process.exit(1);}
  });
}

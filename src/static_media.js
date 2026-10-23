import {PUBLIC_MEDIA_PATHS} from './generated/static_pages.js';
export const PUBLIC_MEDIA_BASE='https://dame-camelias.gptjjjgpt.workers.dev/media/';
const paths=new Set(PUBLIC_MEDIA_PATHS);
// Read via the local assets binding; never send tokens or fetch private GitHub.
export async function readPublicMedia(env,url,options={}){
 const parsed=new URL(url);
 if(parsed.origin!==new URL(PUBLIC_MEDIA_BASE).origin||parsed.username||parsed.password||parsed.search||parsed.hash||!paths.has(parsed.pathname))
  return new Response('Not found',{status:404});
 const method=options.method||'GET';
 if(!['GET','HEAD'].includes(method))return new Response('Method not allowed',{status:405});
 if(!env.ASSETS)return new Response('Media unavailable',{status:503});
 const response=await env.ASSETS.fetch(new Request('https://assets.local'+parsed.pathname,{method}));
 if(!response.ok)return new Response('Not found',{status:404});
 return response;
}
export function isPublicMediaPath(path){return paths.has(path);}

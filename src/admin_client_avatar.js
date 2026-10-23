// Display-only Telegram thumbnails. Called only after ADMIN owner authorization
// and registered-client lookup. Never returns bot tokens, file IDs or file URLs.
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Cross-Origin-Resource-Policy":"same-origin"};
const MAX_BYTES=256*1024;
const cache=new Map();
const empty=()=>new Response(null,{status:204,headers});
const picture=(bytes,type)=>new Response(bytes,{headers:{...headers,"Content-Type":type}});
function imageType(b){
 if(b[0]===255&&b[1]===216&&b[2]===255)return "image/jpeg";
 if(b.length>=8&&[137,80,78,71,13,10,26,10].every((n,i)=>b[i]===n))return "image/png";
 if(b.length>=12&&new TextDecoder().decode(b.slice(0,4))==="RIFF"&&new TextDecoder().decode(b.slice(8,12))==="WEBP")return "image/webp";
 return null;
}
export async function readTelegramAvatar(env,fileId){
 if(typeof fileId!=="string"||!/^[-\w]{1,300}$/.test(fileId))return empty();
 const cached=cache.get(fileId);
 if(cached&&cached.until>Date.now())return picture(cached.bytes,cached.type);
 try{
  const response=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/getFile",{
   method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({file_id:fileId}),
   signal:AbortSignal.timeout(4500),redirect:"error"});
  const body=await response.json();
  const file=body?.ok&&body.result?.file_id===fileId?body.result:null;
  const path=file?.file_path;
  if(!response.ok||typeof path!=="string"||!/^photos\/[A-Za-z0-9_/-]+\.(?:jpg|jpeg|png|webp)$/.test(path)||
     path.includes("..")||Number(file.file_size)>MAX_BYTES)return empty();
  const download=await fetch("https://api.telegram.org/file/bot"+env.BOT_TOKEN+"/"+path,{
   signal:AbortSignal.timeout(4500),redirect:"error"});
  if(!download.ok||!download.body||Number(download.headers.get("Content-Length"))>MAX_BYTES)return empty();
  const reader=download.body.getReader(),chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;
   size+=value.length;if(size>MAX_BYTES){await reader.cancel();return empty();}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const type=imageType(bytes);if(!type)return empty();
  if(cache.size>=24)cache.delete(cache.keys().next().value);
  cache.set(fileId,{bytes,type,until:Date.now()+5*60_000});
  return picture(bytes,type);
 }catch{return empty();}
}

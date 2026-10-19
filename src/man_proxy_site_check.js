// Owner-only HTTPS reachability through the encrypted per-man SOCKS5 proxy.
// This is NOT IP verification, Intimcity authentication, or an activation gate.
import {requireManId} from "./man_account_isolation.js";
import {validateProxyInput} from "./man_proxy_vault.js";
import {validIntimcityUrl} from "./man_site_vault.js";
const PREFIX="man-proxy-sealed-v1:";
const te=new TextEncoder();
const allowedHosts=new Set(["intimcity.rip","a.intimcity.rip","b.intimcity.rip"]);
function verifyOwner(actorId,cabinetId,ownerId,id){
 requireManId(id);
 if(id==="yan_first"||!ownerId||actorId!==ownerId||cabinetId!==ownerId)throw Error("Forbidden");
}
export function allowedSiteUrl(url){
 const normalized=validIntimcityUrl(url);
 if(!normalized)return null;
 const u=new URL(normalized);
 return allowedHosts.has(u.hostname)?normalized:null;
}
async function readCredentials(env,id,record){
 if(!record||record.accountId!==id)throw Error("Proxy missing");
 const hex=env?.MAN_PROXY_ENCRYPTION_KEY;
 if(typeof hex!=="string"||!/^[a-f0-9]{64}$/i.test(hex))throw Error("Vault key missing");
 const key=await crypto.subtle.importKey("raw",Uint8Array.from(hex.match(/../g).map(v=>parseInt(v,16))),
  {name:"AES-GCM"},false,["decrypt"]);
 const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(record.iv),
  additionalData:te.encode(id)},key,new Uint8Array(record.sealed));
 return validateProxyInput(JSON.parse(new TextDecoder().decode(plain)));
}
async function checkSiteOverSocks(proxy,host,connectFn,signal){
 if(proxy.protocol!=="socks5")throw Error("unsupported_protocol");
 if(!connectFn)throw Error("executor_unavailable");
 let socket,reader,writer,stage="tcp_connect";
 try{
  socket=connectFn({hostname:proxy.host,port:proxy.port},{secureTransport:"starttls"});
  signal?.addEventListener("abort",()=>{try{socket?.close()}catch{}},{once:true});
  await socket.opened;
  reader=socket.readable.getReader();writer=socket.writable.getWriter();
  let pending=new Uint8Array(0);
  const send=async bytes=>writer.write(bytes);
  const take=async n=>{
   while(pending.length<n){
    const chunk=await reader.read();
    if(chunk.done)throw Error("proxy_unreachable");
    const merged=new Uint8Array(pending.length+chunk.value.length);
    merged.set(pending);merged.set(chunk.value,pending.length);pending=merged;
    if(pending.length>2048)throw Error("invalid_proxy_response");
   }
   const result=pending.slice(0,n);pending=pending.slice(n);return result;
  };
  stage="socks_greeting";
  await send(Uint8Array.from(proxy.username?[5,2,0,2]:[5,1,0]));
  const greeting=await take(2);
  if(greeting[0]!==5||greeting[1]===255)throw Error("proxy_auth_failed");
  if(greeting[1]===2){
   stage="socks_auth";
   const name=te.encode(proxy.username),password=te.encode(proxy.password);
   if(!name.length||name.length>255||!password.length||password.length>255)throw Error("proxy_auth_failed");
   await send(Uint8Array.from([1,name.length,...name,password.length,...password]));
   const ack=await take(2);
   if(ack[0]!==1||ack[1]!==0)throw Error("proxy_auth_failed");
  }else if(greeting[1]!==0)throw Error("proxy_auth_failed");
  stage="socks_connect";
  const dest=te.encode(host);
  await send(Uint8Array.from([5,1,0,3,dest.length,...dest,1,187])); // TLS 443
  const answer=await take(4);
  if(answer[0]!==5||answer[1]!==0){
   const e=new Error("proxy_target_rejected");
   e.socksReply=answer[0]===5?answer[1]:null;
   throw e;
  }
  if(answer[3]===1)await take(6);
  else if(answer[3]===4)await take(18);
  else if(answer[3]===3){const n=(await take(1))[0];await take(n+2);}
  else throw Error("invalid_proxy_response");
  if(pending.length)throw Error("invalid_proxy_response");
  reader.releaseLock();writer.releaseLock();reader=null;writer=null;
  stage="tls";
  socket=socket.startTls({expectedServerHostname:host});
  await socket.opened;
  reader=socket.readable.getReader();writer=socket.writable.getWriter();
  stage="http";
  await writer.write(te.encode("HEAD / HTTP/1.1\r\nHost: "+host+"\r\nConnection: close\r\nUser-Agent: DAME-CAMELIAS-Connection-Check\r\n\r\n"));
  let output="",received=0;
  while(received<4096&&!output.includes("\r\n")){
   const part=await reader.read();
   if(part.done)break;
   received+=part.value.byteLength;
   output+=new TextDecoder().decode(part.value);
  }
  const match=/^HTTP\/1\.[01] ([1-5]\d\d)(?:\s|$)/.exec(output.split("\r\n")[0]||"");
  if(!match)throw Error("invalid_site_response");
  return {httpStatus:Number(match[1])};
 }catch(e){
  const known=new Set(["unsupported_protocol","executor_unavailable","proxy_auth_failed",
   "proxy_target_rejected","invalid_proxy_response","invalid_site_response"]);
  const mapped={tcp_connect:"tcp_connect_failed",socks_greeting:"socks_handshake_failed",
   socks_auth:"proxy_auth_failed",socks_connect:"proxy_target_rejected",
   tls:"tls_tunnel_failed",http:"site_response_failed"};
  const out=new Error(known.has(e?.message)?e.message:mapped[stage]||"site_check_failed");
  if(Number.isInteger(e?.socksReply)&&e.socksReply>=1&&e.socksReply<=8)out.socksReply=e.socksReply;
  throw out;
 }finally{
  try{reader?.releaseLock()}catch{}
  try{writer?.releaseLock()}catch{}
  try{socket?.close()}catch{}
 }
}

async function checkSiteViaHttpConnect(proxy,host,connectFn,signal){
 if(proxy.protocol!=="http")throw Error("unsupported_protocol");
 let socket,reader,writer,stage="tcp",httpProxyStatus=null;
 try{
  socket=connectFn({hostname:proxy.host,port:proxy.port},{secureTransport:"starttls"});
  signal?.addEventListener("abort",()=>{try{socket?.close()}catch{}},{once:true});
  await socket.opened;
  reader=socket.readable.getReader();writer=socket.writable.getWriter();
  stage="connect";
  const raw=te.encode(proxy.username+":"+proxy.password);
  if(!proxy.username||raw.length>1024)throw Error("http_proxy_auth_failed");
  const auth=btoa(String.fromCharCode(...raw));
  await writer.write(te.encode("CONNECT "+host+":443 HTTP/1.1\r\nHost: "+host+
   ":443\r\nProxy-Authorization: Basic "+auth+"\r\nProxy-Connection: keep-alive\r\n\r\n"));
  let header=new Uint8Array(0),end=-1;
  while(header.length<8192&&end<0){
   const next=await reader.read();
   if(next.done)throw Error(header.length?"http_connect_incomplete_headers":"http_connect_empty_response");
   const merged=new Uint8Array(header.length+next.value.length);
   merged.set(header);merged.set(next.value,header.length);header=merged;
   // HTTP proxy responses may arrive split across TCP chunks. Accept CRLF or LF terminators.
   for(let i=1;i<header.length;i++){
    if(i>=3&&header[i-3]===13&&header[i-2]===10&&header[i-1]===13&&header[i]===10){end=i+1;break}
    if(header[i-1]===10&&header[i]===10){end=i+1;break}
   }
  }
  if(end<0)throw Error("http_connect_headers_too_large");
  // Unexpected tunnel bytes cannot be pushed back into a Cloudflare TCP socket.
  // Report distinctly instead of falsely classifying the proxy as unreachable.
  if(end!==header.length)throw Error("http_connect_unexpected_payload");
  const firstLine=new TextDecoder().decode(header.slice(0,end)).split(/\r?\n/)[0];
  const match=/^HTTP\/1\.[01] +(\d{3})(?:\s|$)/.exec(firstLine);
  if(!match)throw Error("http_connect_bad_status_line");
  httpProxyStatus=Number(match[1]);
  if(httpProxyStatus===407)throw Error("http_proxy_auth_failed");
  if(httpProxyStatus!==200)throw Error("http_connect_rejected");
  stage="tls";
  reader.releaseLock();writer.releaseLock();reader=null;writer=null;
  socket=socket.startTls({expectedServerHostname:host});
  await socket.opened;
  reader=socket.readable.getReader();writer=socket.writable.getWriter();
  // GET mirrors browser navigation better than HEAD. Never send site credentials.
  stage="site_write";
  await writer.write(te.encode("GET / HTTP/1.1\r\nHost: "+host+
   "\r\nAccept: text/html\r\nUser-Agent: Mozilla/5.0 (compatible; ConnectionCheck/1.0)\r\nConnection: close\r\n\r\n"));
  stage="site_read";
  let response="",length=0;
  const decoder=new TextDecoder();
  while(length<4096&&!response.includes("\n")){
   const chunk=await reader.read();
   if(chunk.done)break;
   length+=chunk.value.byteLength;
   response+=decoder.decode(chunk.value,{stream:true});
  }
  if(!response)throw Error("site_empty_response");
  const firstLine=response.split(/\r?\n/)[0].trim();
  const status=/^HTTP\/1\.[01]\s+([1-5]\d\d)(?:\s|$)/.exec(firstLine);
  if(!status)throw Error("site_invalid_status_line");
  return {httpStatus:Number(status[1])};
 }catch(error){
  const known=["unsupported_protocol","http_proxy_auth_failed","http_connect_rejected","http_connect_invalid_response","http_connect_incomplete_headers","http_connect_empty_response","http_connect_headers_too_large","http_connect_unexpected_payload","http_connect_bad_status_line","invalid_site_response","site_empty_response","site_invalid_status_line"];
  const codes={tcp:"tcp_connect_failed",connect:"http_connect_failed",tls:"tls_tunnel_failed",site_write:"site_write_failed",site_read:"site_read_failed"};
  const out=new Error(known.includes(error?.message)?error.message:codes[stage]||"site_check_failed");
  if(out.message==="http_connect_rejected")out.httpProxyStatus=httpProxyStatus;
  throw out;
 }finally{
  try{reader?.releaseLock()}catch{}
  try{writer?.releaseLock()}catch{}
  try{socket?.close()}catch{}
 }
}

export async function checkManSiteThroughProxy(storage,env,{actorId,cabinetId,ownerId,accountId,expectedVersion,siteUrl},
 probe=null,connectFn){
 verifyOwner(actorId,cabinetId,ownerId,accountId);
 const cleanUrl=allowedSiteUrl(siteUrl);
 if(!cleanUrl||!Number.isSafeInteger(expectedVersion)||expectedVersion<1)throw Error("Invalid check request");
 const record=await storage.get(PREFIX+accountId);
 if(!record||record.version!==expectedVersion)throw Error("Version conflict");
 const settings=await readCredentials(env,accountId,record);
 const host=new URL(cleanUrl).hostname;
 let result,code="site_reachable",socksReply=null,httpProxyStatus=null;
 const controller=new AbortController();
 let timeoutId;
 try{
  const socketConnect=connectFn??(await import("cloudflare:sockets")).connect;
  result=await Promise.race([
   (probe??(settings.protocol==='http'?checkSiteViaHttpConnect:checkSiteOverSocks))(settings,host,socketConnect,controller.signal),
   new Promise((_,reject)=>{timeoutId=setTimeout(()=>{controller.abort();reject(Error("site_check_timeout"))},12000)})
  ]);
  if(!Number.isInteger(result?.httpStatus)||result.httpStatus<100||result.httpStatus>599)throw Error("invalid_site_response");
  if(result.httpStatus>=500)code="site_server_error";
 }catch(error){
  const codes=new Set(["unsupported_protocol","executor_unavailable","proxy_auth_failed","proxy_target_rejected",
   "invalid_proxy_response","invalid_site_response","tcp_connect_failed",
   "socks_handshake_failed","tls_tunnel_failed","site_response_failed","site_check_timeout",
   "http_proxy_auth_failed","http_connect_failed","http_connect_rejected","http_connect_invalid_response","http_connect_incomplete_headers","http_connect_empty_response","http_connect_headers_too_large","http_connect_unexpected_payload","http_connect_bad_status_line",
   "site_empty_response","site_invalid_status_line","site_write_failed","site_read_failed"]);
  code=codes.has(error?.message)?error.message:"site_check_failed";
  socksReply=Number.isInteger(error?.socksReply)?error.socksReply:null;
  httpProxyStatus=Number.isInteger(error?.httpProxyStatus)?error.httpProxyStatus:null;
 }finally{clearTimeout(timeoutId);}
 // Read-only check; do not write to proxy/IP verification state or touch site credentials.
 const current=await storage.get(PREFIX+accountId);
 if(!current||current.version!==expectedVersion)throw Error("Version conflict");
 return {ok:true,accountId,siteUrl:cleanUrl,reachable:code==="site_reachable",
  httpStatus:result?.httpStatus||null,code,socksReply,httpProxyStatus,protocol:settings.protocol,
  ipVerified:false,identityVerified:false,canPublish:false};
}

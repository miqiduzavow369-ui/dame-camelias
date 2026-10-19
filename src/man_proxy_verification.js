// Owner-initiated SOCKS5 egress probe for accounts 02–30.
// No website login or publication. Never return or log credentials.
import {requireManId} from "./man_account_isolation.js";
import {validateProxyInput} from "./man_proxy_vault.js";
const PREFIX="man-proxy-sealed-v1:";
const CHECK_HOSTS=Object.freeze(["api.ipify.org","ipv4.icanhazip.com"]);
const CHECK_PORT=443;
const TIMEOUT=12000;
const enc=new TextEncoder();
function owner(actor,cabinet,ownerId,id){
 requireManId(id);
 if(id==="yan_first"||!ownerId||actor!==ownerId||cabinet!==ownerId)throw Error("Forbidden");
}
async function keyFrom(env){
 const secret=env?.MAN_PROXY_ENCRYPTION_KEY;
 if(typeof secret!=="string"||!/^[0-9a-f]{64}$/i.test(secret))throw Error("Proxy vault key missing");
 const raw=Uint8Array.from(secret.match(/../g).map(s=>parseInt(s,16)));
 return crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["decrypt"]);
}
async function decrypt(env,id,record){
 if(!record||record.accountId!==id||!Array.isArray(record.iv)||!Array.isArray(record.sealed))
  throw Error("Missing proxy");
 const key=await keyFrom(env);
 const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(record.iv),
  additionalData:enc.encode(id)},key,new Uint8Array(record.sealed));
 return validateProxyInput(JSON.parse(new TextDecoder().decode(plain)));
}
function fail(code){throw Error(code);}
async function probeSocks5(proxy,connectFn,signal,checkHost=CHECK_HOSTS[0]){
 if(!CHECK_HOSTS.includes(checkHost))fail("unexpected_response");
 if(proxy.protocol!=="socks5")fail("unsupported_protocol");
 if(!connectFn)fail("executor_unavailable");
 // Only a public, validated proxy address and a fixed HTTPS echo service may be contacted.
 let socket,reader,writer,stage="tcp_connect";
 try{
  socket=connectFn({hostname:proxy.host,port:proxy.port},{secureTransport:"starttls",allowHalfOpen:false});
  signal?.addEventListener("abort",()=>{try{socket?.close()}catch{}},{once:true});
  await socket.opened;
  stage="socks_greeting";
  writer=socket.writable.getWriter();reader=socket.readable.getReader();
  let buf=new Uint8Array(0);
  const send=async bytes=>{await writer.write(bytes)};
  const take=async n=>{
   while(buf.length<n){
    const chunk=await reader.read();
    if(chunk.done)fail("proxy_unreachable");
    const merged=new Uint8Array(buf.length+chunk.value.length);
    merged.set(buf);merged.set(chunk.value,buf.length);buf=merged;
    if(buf.length>16384)fail("unexpected_response");
   }
   const out=buf.slice(0,n);buf=buf.slice(n);return out;
  };
  const authNeeded=proxy.username.length>0;
  await send(Uint8Array.from(authNeeded?[5,2,0,2]:[5,1,0]));
  const greeting=await take(2);
  if(greeting[0]!==5||greeting[1]===255)fail("proxy_auth_failed");
  if(greeting[1]===2){
   stage="socks_auth";
   const username=enc.encode(proxy.username),password=enc.encode(proxy.password);
   if(username.length===0||username.length>255||password.length===0||password.length>255)fail("proxy_auth_failed");
   await send(Uint8Array.from([1,username.length,...username,password.length,...password]));
   const response=await take(2);
   if(response[0]!==1||response[1]!==0)fail("proxy_auth_failed");
  }else if(greeting[1]!==0)fail("proxy_auth_failed");
  stage="socks_connect";
  const target=enc.encode(checkHost);
  await send(Uint8Array.from([5,1,0,3,target.length,...target,CHECK_PORT>>8,CHECK_PORT&255]));
  const connectReply=await take(4);
  if(connectReply[0]!==5||connectReply[1]!==0){
   const error=new Error("proxy_target_rejected");
   error.socksReply=connectReply[0]===5?connectReply[1]:null;
   throw error;
  }
  const atyp=connectReply[3];
  if(atyp===1)await take(4+2);
  else if(atyp===4)await take(16+2);
  else if(atyp===3){const length=(await take(1))[0];await take(length+2)}
  else fail("unexpected_response");
  if(buf.length!==0)fail("unexpected_response");
  reader.releaseLock();writer.releaseLock();reader=null;writer=null;
  // Upgrade the tunneled TCP stream to TLS, validating the fixed hostname.
  stage="tls_handshake";
  socket=socket.startTls({expectedServerHostname:checkHost});
  await socket.opened;
  writer=socket.writable.getWriter();reader=socket.readable.getReader();
  await writer.write(enc.encode("GET / HTTP/1.1\r\nHost: "+checkHost+"\r\nAccept: text/plain\r\nConnection: close\r\n\r\n"));
  stage="ip_response";
  let response="",size=0;
  while(size<4096){
   const next=await reader.read();if(next.done)break;
   size+=next.value.byteLength;
   response+=new TextDecoder().decode(next.value,{stream:true});
   if(response.includes("\r\n\r\n"))break;
  }
  const parts=response.split("\r\n\r\n");
  if(!/^HTTP\/1\.[01] 200(?: |$)/.test(parts[0])||parts.length<2)fail("unexpected_response");
  let body=parts.slice(1).join("\r\n\r\n").trim();
  while(body.length<7&&size<4096){
   const next=await reader.read();if(next.done)break;
   size+=next.value.byteLength;body+=new TextDecoder().decode(next.value);
  }
  const observed=body.match(/^\d{1,3}(?:\.\d{1,3}){3}/)?.[0];
  if(!observed)fail("unexpected_response");
  return observed;
 }catch(error){
  if(error?.message==="proxy_timeout")throw error;
  const known=new Set(["unsupported_protocol","executor_unavailable","proxy_auth_failed",
   "proxy_unreachable","proxy_target_rejected","unexpected_response"]);
  const codes={tcp_connect:"tcp_connect_failed",socks_greeting:"socks_handshake_failed",
   socks_auth:"proxy_auth_failed",socks_connect:"proxy_target_rejected",
   tls_handshake:"tls_tunnel_failed",ip_response:"ip_echo_failed"};
  const safe=new Error(known.has(error?.message)?error.message:codes[stage]||"unexpected_response");
  safe.stage=stage;
  if(Number.isInteger(error?.socksReply)&&error.socksReply>=1&&error.socksReply<=8)safe.socksReply=error.socksReply;
  throw safe;
 }finally{
  try{reader?.releaseLock()}catch{}
  try{writer?.releaseLock()}catch{}
  try{socket?.close()}catch{}
 }
}
export async function verifyManProxy(storage,env,{actorId,cabinetId,ownerId,accountId,expectedVersion,at},probe=probeSocks5,connectFn){
 owner(actorId,cabinetId,ownerId,accountId);
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1||!Number.isSafeInteger(at))throw Error("Invalid check");
 const old=await storage.get(PREFIX+accountId);
 if(!old||old.version!==expectedVersion)throw Error("Version conflict");
 const settings=await decrypt(env,accountId,old);
 let code="verified",stage="completed",observedIp=null,socksReply=null,checkHost=null;
 const controller=new AbortController();
 let timeoutId;
 try{
  const connection=connectFn??(await import("cloudflare:sockets")).connect;
  const safeProbe=async()=>{
   for(let i=0;i<CHECK_HOSTS.length;i++){
    const host=CHECK_HOSTS[i];checkHost=host;
    try{return await probe(settings,connection,controller.signal,host)}
    catch(error){
     if(error?.message!=="proxy_target_rejected"||i===CHECK_HOSTS.length-1)throw error;
     socksReply=Number.isInteger(error?.socksReply)?error.socksReply:null;
    }
   }
   throw Error("unexpected_response");
  };
  observedIp=await Promise.race([
   safeProbe(),
   new Promise((_,reject)=>{timeoutId=setTimeout(()=>{controller.abort();reject(Error("proxy_timeout"))},TIMEOUT)})
  ]);
  if(observedIp!==settings.expectedIp)code="ip_mismatch";
 }catch(e){
  const known=new Set(["unsupported_protocol","executor_unavailable","proxy_auth_failed",
   "proxy_unreachable","proxy_timeout","unexpected_response","tcp_connect_failed",
   "socks_handshake_failed","proxy_target_rejected","tls_tunnel_failed","ip_echo_failed"]);
  code=known.has(e?.message)?e.message:"unexpected_response";
  stage=typeof e?.stage==="string"?e.stage:code==="proxy_timeout"?"timeout":"system";
  if(Number.isInteger(e?.socksReply))socksReply=e.socksReply;
 }finally{clearTimeout(timeoutId)}
 if(typeof storage.transaction!=="function")throw Error("Atomic storage unavailable");
 return storage.transaction(async tx=>{
  const current=await tx.get(PREFIX+accountId);
  if(current?.version!==expectedVersion)throw Error("Version conflict");
  const success=code==="verified";
  await tx.put(PREFIX+accountId,{...current,
   proxyVerified:success,ipVerified:success,siteIdentityVerified:false,enabled:false,
   verifiedAt:success?at:null});
  return {ok:true,accountId,version:expectedVersion,verified:success,code,
   stage,socksReply:code==="proxy_target_rejected"?socksReply:null,checkHost,observedIp:observedIp||null,expectedIp:settings.expectedIp,canPublish:false};
 });
}

// Owner-initiated SOCKS5 egress probe for accounts 02–30.
// No website login or publication. Never return or log credentials.
import {requireManId} from "./man_account_isolation.js";
import {validateProxyInput} from "./man_proxy_vault.js";
const PREFIX="man-proxy-sealed-v1:";
const CHECK_HOST="api.ipify.org";
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
async function probeSocks5(proxy,connectFn,signal){
 if(proxy.protocol!=="socks5")fail("unsupported_protocol");
 if(!connectFn)fail("executor_unavailable");
 // Only a public, validated proxy address and a fixed HTTPS echo service may be contacted.
 let socket,reader,writer;
 try{
  socket=connectFn({hostname:proxy.host,port:proxy.port},{secureTransport:"starttls",allowHalfOpen:false});
  signal?.addEventListener("abort",()=>{try{socket?.close()}catch{}},{once:true});
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
   const username=enc.encode(proxy.username),password=enc.encode(proxy.password);
   if(username.length===0||username.length>255||password.length===0||password.length>255)fail("proxy_auth_failed");
   await send(Uint8Array.from([1,username.length,...username,password.length,...password]));
   const response=await take(2);
   if(response[0]!==1||response[1]!==0)fail("proxy_auth_failed");
  }else if(greeting[1]!==0)fail("proxy_auth_failed");
  const target=enc.encode(CHECK_HOST);
  await send(Uint8Array.from([5,1,0,3,target.length,...target,CHECK_PORT>>8,CHECK_PORT&255]));
  const connectReply=await take(4);
  if(connectReply[0]!==5||connectReply[1]!==0)fail("proxy_unreachable");
  const atyp=connectReply[3];
  if(atyp===1)await take(4+2);
  else if(atyp===4)await take(16+2);
  else if(atyp===3){const length=(await take(1))[0];await take(length+2)}
  else fail("unexpected_response");
  if(buf.length!==0)fail("unexpected_response");
  reader.releaseLock();writer.releaseLock();reader=null;writer=null;
  // Upgrade the tunneled TCP stream to TLS, validating the fixed hostname.
  socket=socket.startTls({expectedServerHostname:CHECK_HOST});
  writer=socket.writable.getWriter();reader=socket.readable.getReader();
  await writer.write(enc.encode("GET / HTTP/1.1\r\nHost: "+CHECK_HOST+"\r\nAccept: text/plain\r\nConnection: close\r\n\r\n"));
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
 let code="verified",observedIp=null;
 const controller=new AbortController();
 let timeoutId;
 try{
  observedIp=await Promise.race([
   probe(settings,connectFn??(await import("cloudflare:sockets")).connect,controller.signal),
   new Promise((_,reject)=>{timeoutId=setTimeout(()=>{controller.abort();reject(Error("proxy_timeout"))},TIMEOUT)})
  ]);
  if(observedIp!==settings.expectedIp)code="ip_mismatch";
 }catch(e){
  const known=new Set(["unsupported_protocol","executor_unavailable","proxy_auth_failed",
   "proxy_unreachable","proxy_timeout","unexpected_response"]);
  code=known.has(e?.message)?e.message:"proxy_unreachable";
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
   observedIp:observedIp||null,expectedIp:settings.expectedIp,canPublish:false};
 });
}

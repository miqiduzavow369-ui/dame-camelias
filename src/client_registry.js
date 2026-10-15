export const OWNER_ID="5866034656";
export const TRIAL_ID="5627932577";
const LEGACY_PIN="edee29f882543b956620b26d0ee0e7e950399b1c4222f5de05e06425b4c995e9";
export const validId=id=>/^[1-9]\d{4,15}$/.test(String(id));
export async function registry(env,input){
 if(!env.ORDER_REMINDERS)throw Error("Client registry unavailable");
 const stub=env.ORDER_REMINDERS.get(env.ORDER_REMINDERS.idFromName("client-registry:v1"));
 const res=await stub.fetch("https://registry.internal/",{method:"POST",body:JSON.stringify({type:"registry",...input})});
 if(!res.ok)throw Error("Client registry rejected request");
 return res.json();
}
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("");
export async function pinRecord(pin,salt=hex(crypto.getRandomValues(new Uint8Array(16)))){
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(pin),"PBKDF2",false,["deriveBits"]);
 const hash=hex(await crypto.subtle.deriveBits({name:"PBKDF2",salt:new TextEncoder().encode(salt),iterations:100000,hash:"SHA-256"},key,256));
 return {salt,hash,algorithm:"pbkdf2-sha256",iterations:100000};
}
async function matches(record,pin){
 const actual=record.algorithm==="legacy-sha256"?hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(pin))):(await pinRecord(pin,record.salt)).hash;
 if(actual.length!==record.hash.length)return false;
 let diff=0;for(let i=0;i<actual.length;i++)diff|=actual.charCodeAt(i)^record.hash.charCodeAt(i);
 return diff===0;
}
const validCredential=c=>c?.algorithm==="pbkdf2-sha256"&&c.iterations===100000&&/^[a-f0-9]{32}$/.test(c.salt)&&/^[a-f0-9]{64}$/.test(c.hash);
const view=c=>({id:c.id,active:c.active,grant:c.grant,revision:c.revision,authVersion:c.authVersion});
// Called only by the existing private DO binding. All mutations serialize there.
export async function registryRequest(storage,input,now=Date.now()){
 const state=await storage.get("registry_v1")||{clients:{[TRIAL_ID]:{id:TRIAL_ID,active:true,grant:2,revision:1,authVersion:1,pin:{algorithm:"legacy-sha256",hash:LEGACY_PIN}}},operations:{}};
 const uid=String(input.userId||"");
 if(input.action==="get")return {client:state.clients[uid]?view(state.clients[uid]):null};
 if(input.action==="login"){
  const c=state.clients[uid];
  if(!c||!c.active)return {ok:false};
  const attempts=c.attempts||{count:0,until:0};
  if(attempts.until>now)return {ok:false,locked:true};
  if(attempts.until&&attempts.until<=now)c.attempts={count:0,until:0};
  if(typeof input.pin!=="string"||input.pin.length>64)return {ok:false};
  if(!await matches(c.pin,input.pin)){
   const count=(c.attempts?.count||0)+1;
   c.attempts={count,until:count>=5?now+900000:0};
   await storage.put("registry_v1",state);return {ok:false,locked:count>=5};
  }
  if(c.pin.algorithm==="legacy-sha256")c.pin=await pinRecord(input.pin);
  c.attempts={count:0,until:0};
  await storage.put("registry_v1",state);return {ok:true,client:view(c)};
 }
 if(String(input.actorId)!==OWNER_ID)return {ok:false,reason:"forbidden"};
 if(input.action==="list")return {ok:true,clients:Object.values(state.clients).map(view)};
 if(!validId(uid)||uid===OWNER_ID)return {ok:false,reason:"invalid_id"};
 if(!/^[a-f0-9]{16}$/.test(input.operation||""))return {ok:false,reason:"invalid_operation"};
 if(state.operations[input.operation]){
  const prior=state.operations[input.operation];
  return prior.userId===uid&&prior.action===input.action?{ok:true,already:true,client:view(state.clients[uid])}:{ok:false,reason:"operation_mismatch"};
 }
 let c=state.clients[uid];
 if(input.action==="create"){
  if(c)return {ok:false,reason:"exists"};
  if(!validCredential(input.credential)||!Number.isSafeInteger(input.grant)||input.grant<0||input.grant>1000000)return {ok:false,reason:"invalid_values"};
  c={id:uid,active:true,grant:input.grant,revision:1,authVersion:1,pin:input.credential};
  state.clients[uid]=c;
 }else{
  if(!c)return {ok:false,reason:"missing"};
  if(input.action==="suspend"||input.action==="resume"){c.active=input.action==="resume";c.authVersion++;}
  else if(input.action==="topup"){
   if(!Number.isSafeInteger(input.amount)||input.amount<1||c.grant+input.amount>1000000)return {ok:false,reason:"invalid_amount"};
   c.grant+=input.amount;c.revision++;
  }else if(input.action==="pin"){
   if(!validCredential(input.credential))return {ok:false,reason:"invalid_pin"};
   c.pin=input.credential;c.authVersion++;c.attempts={count:0,until:0};
  }else return {ok:false,reason:"invalid_action"};
 }
 state.operations[input.operation]={at:now,userId:uid,action:input.action};
 await storage.put("registry_v1",state);
 return {ok:true,client:view(c)};
}

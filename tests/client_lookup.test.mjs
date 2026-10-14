import test from "node:test";
import assert from "node:assert/strict";
import {validateLookupResult,acceptClientLookup,clientLookupCallback} from "../src/client_lookup.js";
import {clientKey} from "../src/client_isolation.js";
const uid="5627932577",pid="698842",host="b.intimcity.rip",nonce="abcdef123456";
const result={user_id:uid,profile_id:pid,nonce,mode:"profile",status:"found",profile:{id:pid,name:"Example",age:28,metro:"Center",url:"https://"+host+"/indi/anketa"+pid+".htm"}};
test("only authenticated callback identity qualifies as verified",()=>{
 assert.ok(validateLookupResult(result,{userId:uid,profileId:pid,host,nonce}));
 assert.equal(validateLookupResult({...result,user_id:"5866034656"},{userId:uid,profileId:pid,host,nonce}),null);
 assert.equal(validateLookupResult({...result,nonce:"000000000000"},{userId:uid,profileId:pid,host,nonce}),null);
 assert.equal(validateLookupResult({...result,profile:{...result.profile,id:"111111"}},{userId:uid,profileId:pid,host,nonce}),null);
});
test("verified records never appear in owner namespace",async()=>{
 const m=new Map();
 const env={VISITORS_KV:{get:async(k)=>m.has(k)?JSON.parse(m.get(k)):null,put:async(k,v)=>m.set(k,v)}};
 const key=clientKey(uid,"flow");
 m.set(key,JSON.stringify({mode:"profile",status:"pending",profileId:pid,host,nonce}));
 assert.equal(await acceptClientLookup(env,uid,result),true);
 assert.deepEqual(JSON.parse(m.get(clientKey(uid,"library"))),[pid]);
 assert.equal(m.has(clientKey("5866034656","saved",pid)),false);
 assert.equal(await acceptClientLookup(env,uid,result),false);
});

test("unmatched or stale callback never changes saved client data",async()=>{
 const store=new Map();
 const env={VISITORS_KV:{get:async k=>store.has(k)?JSON.parse(store.get(k)):null,put:async(k,v)=>store.set(k,v)}};
 const flow=clientKey(uid,"flow"),saved=clientKey(uid,"saved",pid);
 store.set(flow,JSON.stringify({mode:"profile",status:"pending",profileId:pid,host,nonce}));
 const original=JSON.stringify({id:pid,name:"Already verified",url:result.profile.url});
 store.set(saved,original);
 assert.equal(await acceptClientLookup(env,uid,{...result,user_id:"5866034656"}),false);
 assert.equal(store.get(saved),original);
 assert.equal(await acceptClientLookup(env,uid,{...result,nonce:"000000000000"}),false);
 assert.equal(store.get(saved),original);
 store.set(flow,JSON.stringify({mode:"profile",status:"verified",profileId:pid,host,nonce}));
 assert.equal(await acceptClientLookup(env,uid,result),false);
 assert.equal(store.get(saved),original);
});

test("authenticated client result reaches only matching client and stores verified profile",async()=>{
 const store=new Map(),sent=[];
 const env={ANKETA_CALLBACK_TOKEN:"secret",VISITORS_KV:{
  get:async k=>store.has(k)?JSON.parse(store.get(k)):null,
  put:async(k,v)=>store.set(k,v)
 }};
 store.set(clientKey(uid,"flow"),JSON.stringify({mode:"profile",status:"pending",profileId:pid,host,nonce}));
 const req=(body,auth="Bearer secret")=>new Request("https://worker.test/api/anketa/result",{
  method:"POST",headers:{Authorization:auth,"Content-Type":"application/json"},body:JSON.stringify(body)
 });
 const send=async(_,method,payload)=>{sent.push({method,payload});return {message_id:1};};
 const unauth=await clientLookupCallback(req(result,"Bearer bad"),env,send);
 assert.equal(unauth.status,403);
 assert.equal(store.has(clientKey(uid,"saved",pid)),false);
 const spoof=await clientLookupCallback(req({...result,user_id:"5866034656"}),env,send);
 assert.equal(spoof.status,400);
 const success=await clientLookupCallback(req(result),env,send);
 assert.equal(success.status,200);
 assert.equal(sent.length,1);
 assert.equal(String(sent[0].payload.chat_id),uid);
 assert.equal(JSON.parse(store.get(clientKey(uid,"saved",pid))).name,"Example");
 const replay=await clientLookupCallback(req(result),env,send);
 assert.equal(replay.status,409);
 assert.equal(sent.length,1);
});

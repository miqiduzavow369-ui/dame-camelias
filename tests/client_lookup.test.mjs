import test from "node:test";
import assert from "node:assert/strict";
import {validateLookupResult,acceptClientLookup} from "../src/client_lookup.js";
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

import test from "node:test";
import assert from "node:assert/strict";
import {CityDiaryStore} from "../src/city_diary_store.js";
import {CityDiaryScheduler} from "../src/city_diary_scheduler.js";
import {syncCityDiaryReminders} from "../src/city_diary_bridge.js";

const USER="5866034656", TOKEN="private-test-secret-bridge";
const ID="0123456789abcdef", OP="1111111111111111";
const NOW=Date.parse("2026-10-24T10:00:00.000Z");
const plan={mode:"reminder",action:"profile",at:"2026-10-28T15:30:00.000Z",profileId:null,reviewText:""};
function storage(){
 const map=new Map();
 const copy=x=>x===undefined?undefined:structuredClone(x);
 const adapter={
  db:map,
  get:async k=>copy(map.get(k)),
  put:async(k,v)=>map.set(k,copy(v)),
  transaction:async fn=>{
   const draft=new Map([...map].map(([k,v])=>[k,copy(v)]));
   const tx={get:async k=>copy(draft.get(k)),put:async(k,v)=>draft.set(k,copy(v)),
     delete:async k=>draft.delete(k)};
   const result=await fn(tx);map.clear();
   for(const [k,v] of draft)map.set(k,v);
   return result;
  }
 };
 return adapter;
}
function fixture(){
 const privateStorage=storage();
 const schedulerStorage=storage();
 let armed=0, deleted=0, sends=0, ownerId="";
 const ctx={storage:{...schedulerStorage,
    setAlarm:async()=>{armed++;},deleteAlarm:async()=>{deleted++;}},
   blockConcurrencyWhile:async fn=>fn()};
 const scheduler=new CityDiaryScheduler(ctx,{CITY_DIARY_INTERNAL_TOKEN:TOKEN,BOT_TOKEN:"fake"});
 const ns={idFromName(name){ownerId=name;return "private:"+name;},
  get(id){assert.equal(id,"private:"+USER);return {
   fetch:async(_url,init)=>{sends++;return scheduler.fetch(new Request("https://internal/",init));}
  };}};
 const invoke=()=>syncCityDiaryReminders({storage:privateStorage,authenticatedUserId:USER,
   schedulerNamespace:ns,internalToken:TOKEN});
 return {privateStorage,schedulerStorage,ns,invoke,get ownerId(){return ownerId;},
   get sends(){return sends;},get armed(){return armed;},get deleted(){return deleted;}};
}
test("only reminders from private storage cross the bridge and cancellation removes them",async()=>{
 const x=fixture(),store=new CityDiaryStore(x.privateStorage);
 assert.deepEqual(await x.invoke(),{ok:true,reason:"nothing_to_sync",revision:0});
 await store.create(plan,{id:ID,operation:OP,now:NOW});
 assert.deepEqual(await x.invoke(),{ok:true,reason:"synced",revision:1});
 assert.equal(x.ownerId,USER);
 assert.equal(x.schedulerStorage.db.get("diary_scheduler_events_v1").length,1);
 await store.transition(ID,"cancelled",{operation:"2222222222222222",expectedRevision:1,now:NOW});
 assert.deepEqual(await x.invoke(),{ok:true,reason:"synced",revision:2});
 assert.deepEqual(x.schedulerStorage.db.get("diary_scheduler_events_v1"),[]);
 assert.equal(x.sends,2);
});
test("repeated sync reconciles a committed schedule instead of allocating another revision",async()=>{
 const x=fixture(),store=new CityDiaryStore(x.privateStorage);
 await store.create(plan,{id:ID,operation:OP,now:NOW});
 assert.equal((await x.invoke()).reason,"synced");
 assert.deepEqual(await x.invoke(),{ok:true,reason:"already_synced",revision:1});
 assert.equal(x.schedulerStorage.db.get("diary_scheduler_revision_v1"),1);
});
test("rejects missing private routing, invalid user and weak secret without making requests",async()=>{
 const x=fixture();
 for(const input of [{authenticatedUserId:"x",schedulerNamespace:x.ns,internalToken:TOKEN},
  {authenticatedUserId:USER,schedulerNamespace:x.ns,internalToken:"bad"},
  {authenticatedUserId:USER,internalToken:TOKEN}]){
  const result=await syncCityDiaryReminders({storage:x.privateStorage,...input});
  assert.equal(result.reason,"bridge_unavailable");
 }
 assert.equal(x.sends,0);
});
test("an ambiguous transport failure is safe to retry against the same revision",async()=>{
 const x=fixture(),store=new CityDiaryStore(x.privateStorage);
 await store.create(plan,{id:ID,operation:OP,now:NOW});
 let first=true;
 const namespace={idFromName:x.ns.idFromName,get:()=>({fetch:async(url,init)=>{
   const resp=await x.ns.get("private:"+USER).fetch(url,init);
   if(first){first=false;throw Error("response lost");}
   return resp;
 }})};
 const run=()=>syncCityDiaryReminders({storage:x.privateStorage,
  authenticatedUserId:USER,schedulerNamespace:namespace,internalToken:TOKEN});
 assert.equal((await run()).reason,"sync_unknown");
 assert.equal((await run()).reason,"already_synced");
 assert.equal(x.schedulerStorage.db.get("diary_scheduler_revision_v1"),1);
});
test("bridge never forwards published order plans as reminder snapshots",async()=>{
 const x=fixture(),store=new CityDiaryStore(x.privateStorage);
 await store.create({...plan,mode:"publication",action:"review",profileId:"652282",
  reviewText:"Only personal experience"},{id:ID,operation:OP,now:NOW});
 assert.equal((await x.invoke()).reason,"synced");
 assert.deepEqual(x.schedulerStorage.db.get("diary_scheduler_events_v1"),[]);
 assert.equal(x.armed,0);
});

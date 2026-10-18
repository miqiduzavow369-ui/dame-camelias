import test from "node:test";
import assert from "node:assert/strict";
import {createMockHandoff} from "../src/man_executor_contract.js";
import {enqueueMockManTask,finishMockManTask,readMockManTask} from "../src/man_mock_queue.js";
const OWNER="5866034656",DATE="2026-10-18";
const identity=(man="yan_second",nonce="abcdef123456")=>({userId:OWNER,accountId:man,profileId:"652282",kind:"review",nonce});
const activation=accountId=>({accountId,version:3,enabled:true,siteIdentityVerified:true,proxyVerified:true});
function store(){
 const map=new Map();let tail=Promise.resolve();
 return {
  async get(k){return map.get(k)},
  transaction(fn){
   const p=tail.then(async()=>{
    const draft=new Map(map);
    const result=await fn({get:async k=>draft.get(k),put:async(k,v)=>draft.set(k,v)});
    map.clear();for(const [k,v]of draft)map.set(k,v);
    return result;
   });tail=p.catch(()=>{});return p;
  },snapshot:()=>new Map(map)
 };
}
const enqueue=(storage,accountId="yan_second",nonce="abcdef123456",at=100)=>
 enqueueMockManTask(storage,{actorId:OWNER,ownerId:OWNER,identity:identity(accountId,nonce),
  moscowDate:DATE,serverActivation:activation(accountId),at});
const make=(accountId="yan_second",nonce="abcdef123456")=>
 createMockHandoff(identity(accountId,nonce),{moscowDate:DATE,serverActivation:activation(accountId)});
test("owner mock queue stores credential-free task once, duplicate submissions idempotent",async()=>{
 const s=store();
 const first=await enqueue(s),again=await enqueue(s);
 assert.equal(first.created,true);assert.equal(again.created,false);
 assert.equal(s.snapshot().size,1);
 assert.equal(first.status,"queued");
 assert.equal(JSON.stringify([...s.snapshot()]).includes("proxyPassword"),false);
});
test("concurrent identical enqueue creates one task",async()=>{
 const s=store(),r=await Promise.all([enqueue(s),enqueue(s)]);
 assert.deepEqual(r.map(x=>x.created).sort(),[false,true]);
 assert.equal(s.snapshot().size,1);
});
test("different men and nonces have separate queues but shared site quota identities",async()=>{
 const s=store();
 await enqueue(s,"yan_second");await enqueue(s,"yan_03");
 await enqueue(s,"yan_second","abcabcabcabc");
 assert.equal(s.snapshot().size,3);
 const keys=[...s.snapshot().values()].map(x=>x.task);
 assert.equal(new Set(keys.map(x=>x.correlationKey)).size,3);
 assert.equal(new Set(keys.map(x=>x.globalDailyLock)).size,1);
});
test("completion is final, idempotent and cannot claim real publication",async()=>{
 const s=store(),task=make();
 await enqueue(s);
 const done=await finishMockManTask(s,{actorId:OWNER,ownerId:OWNER,task,moscowDate:DATE,at:200});
 assert.equal(done.changed,true);assert.equal(done.status,"completed");
 assert.equal(done.sitePublished,false);assert.equal(done.creditsDebited,false);
 const second=await finishMockManTask(s,{actorId:OWNER,ownerId:OWNER,task,moscowDate:DATE,at:201});
 assert.equal(second.changed,false);
 await assert.rejects(()=>finishMockManTask(s,{actorId:OWNER,ownerId:OWNER,task,moscowDate:DATE,result:"mock_rejected",at:202}));
 assert.equal((await readMockManTask(s,{actorId:OWNER,ownerId:OWNER,task,moscowDate:DATE})).status,"completed");
});
test("replay, fake task fields, wrong date and nonowner are rejected",async()=>{
 const s=store(),task=make();await enqueue(s);
 for(const candidate of [{...task,accountId:"yan_03"},{...task,nonce:"abcabcabcabc"},
  {...task,globalDailyLock:"daily-profile:652282:2026-10-19"},
  {...task,sitePublished:true},{...task,proxyPassword:"secret"}]){
   await assert.rejects(()=>finishMockManTask(s,{actorId:OWNER,ownerId:OWNER,task:candidate,moscowDate:DATE,at:200}));
 }
 await assert.rejects(()=>finishMockManTask(s,{actorId:"5866034657",ownerId:OWNER,task,moscowDate:DATE,at:200}));
 await assert.rejects(()=>finishMockManTask(s,{actorId:OWNER,ownerId:OWNER,task,moscowDate:"2026-10-19",at:200}));
 await assert.rejects(()=>finishMockManTask(s,{actorId:OWNER,ownerId:OWNER,task,moscowDate:DATE,at:50}));
 assert.equal((await readMockManTask(s,{actorId:OWNER,ownerId:OWNER,task,moscowDate:DATE})).status,"queued");
});
test("unknown task, missing atomic storage and disabled accounts all fail closed",async()=>{
 const s=store(),task=make();
 await assert.rejects(()=>finishMockManTask(s,{actorId:OWNER,ownerId:OWNER,task,moscowDate:DATE,at:100}));
 await assert.rejects(()=>enqueue({get:async()=>null}));
 await assert.rejects(()=>enqueueMockManTask(s,{actorId:OWNER,ownerId:OWNER,identity:identity("yan_30"),moscowDate:DATE,at:100}));
 await assert.rejects(()=>enqueueMockManTask(s,{actorId:OWNER,ownerId:OWNER,identity:identity("yan_first"),moscowDate:DATE,serverActivation:activation("yan_first"),at:100}));
});

test("creation-day scope survives midnight, but a forged completion day is rejected",async()=>{
 const s=store(),task=make();
 await enqueue(s);
 const stored=[...s.snapshot().values()][0];
 assert.equal(stored.moscowDate,DATE);
 await assert.rejects(()=>finishMockManTask(s,{
  actorId:OWNER,ownerId:OWNER,task,moscowDate:"2026-10-19",at:200
 }));
 const done=await finishMockManTask(s,{
  actorId:OWNER,ownerId:OWNER,task,moscowDate:stored.moscowDate,at:200
 });
 assert.equal(done.status,"completed");
 assert.equal(done.sitePublished,false);
 assert.equal([...s.snapshot().values()][0].moscowDate,DATE);
 await assert.rejects(()=>finishMockManTask(s,{
  actorId:OWNER,ownerId:OWNER,task,moscowDate:"2026-10-19",at:201
 }));
});

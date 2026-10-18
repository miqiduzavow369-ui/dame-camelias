import test from "node:test";
import assert from "node:assert/strict";
import {listMockManQueue} from "../src/man_mock_queue_view.js";
import {enqueueMockManTask,finishMockManTask} from "../src/man_mock_queue.js";
import {createMockHandoff} from "../src/man_executor_contract.js";
const OWNER="5866034656",DATE="2026-10-18";
function storage(){
 const map=new Map();let tail=Promise.resolve();
 return {
  get:async k=>map.get(k),
  put:async(k,v)=>{map.set(k,v)},
  list:async({prefix="",limit=300}={})=>{
   const entries=[...map].filter(([k])=>k.startsWith(prefix)).slice(0,limit);
   return new Map(entries);
  },
  transaction(fn){
   const p=tail.then(async()=>{
    const staged=new Map(map);
    const result=await fn({get:async k=>staged.get(k),put:async(k,v)=>{staged.set(k,v)}});
    map.clear();for(const [k,v] of staged)map.set(k,v);
    return result;
   });tail=p.catch(()=>{});return p;
  }
 };
}
const activation=accountId=>({accountId,enabled:true,siteIdentityVerified:true,proxyVerified:true,version:1});
const identity=accountId=>({userId:OWNER,accountId,profileId:"652282",kind:"review",nonce:"abcdef123456"});
const enqueue=(s,accountId)=>enqueueMockManTask(s,{
 actorId:OWNER,ownerId:OWNER,identity:identity(accountId),serverActivation:activation(accountId),
 moscowDate:DATE,at:100
});
test("owner gets sanitized queue cards and account filter",async()=>{
 const s=storage();await enqueue(s,"yan_second");await enqueue(s,"yan_03");
 const all=await listMockManQueue(s,{actorId:OWNER,ownerId:OWNER});
 assert.equal(all.length,2);assert.ok(Object.isFrozen(all));
 const rows=await listMockManQueue(s,{actorId:OWNER,ownerId:OWNER,accountId:"yan_second"});
 assert.equal(rows.length,1);
 assert.equal(rows[0].accountId,"yan_second");
 assert.equal(rows[0].sitePublished,false);
 assert.equal(rows[0].creditsDebited,false);
 for(const forbidden of ["task","userId","activationVersion","proxyHost","password"]){
  assert.equal(Object.hasOwn(rows[0],forbidden),false);
 }
});
test("final result is visible but never a real publication",async()=>{
 const s=storage();await enqueue(s,"yan_second");
 const task=createMockHandoff(identity("yan_second"),{serverActivation:activation("yan_second"),moscowDate:DATE});
 await finishMockManTask(s,{actorId:OWNER,ownerId:OWNER,task,moscowDate:DATE,result:"mock_rejected",at:200});
 const entries=await listMockManQueue(s,{actorId:OWNER,ownerId:OWNER});
 assert.equal(entries[0].status,"rejected");
 assert.equal(entries[0].outcome,"mock_rejected");
 assert.equal(entries[0].sitePublished,false);
});
test("nonowner, unknown account, first man and unbounded reads are rejected",async()=>{
 const s=storage();
 for(const options of [
  {actorId:"5866034657",ownerId:OWNER},
  {actorId:OWNER,ownerId:OWNER,accountId:"yan_first"},
  {actorId:OWNER,ownerId:OWNER,accountId:"yan_31"},
  {actorId:OWNER,ownerId:OWNER,limit:1000}
 ]) await assert.rejects(()=>listMockManQueue(s,options));
});
test("malformed old rows cannot contaminate queue listing",async()=>{
 const s=storage();
 await s.put("man-mock-queue-v1:bad",{task:{schema:1,mode:"simulation",correlationKey:"fake"},status:"completed",createdAt:1,finishedAt:2});
 await s.put("man-mock-queue-v1:foo",{task:{schema:1,mode:"simulation",correlationKey:"foo",accountId:"yan_31"},status:"completed",createdAt:1,finishedAt:2});
 assert.deepEqual(await listMockManQueue(s,{actorId:OWNER,ownerId:OWNER}),[]);
});

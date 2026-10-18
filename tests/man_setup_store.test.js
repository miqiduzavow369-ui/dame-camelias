import test from "node:test";
import assert from "node:assert/strict";
import {readManSetupDraft,changeManSetupDraft,readManSetupDrafts,readManSetupHistory} from "../src/man_setup_store.js";
const owner="5866034656",accounts=[{id:"yan_first"},{id:"yan_second"},{id:"yan_30"}];
// Mock transaction provides a serialized critical section, matching DO storage.
const storage=()=>{const m=new Map();let queue=Promise.resolve();
 const access={get:async k=>m.get(k),put:async(k,v)=>{m.set(k,v)},snapshot:()=>m};
 access.transaction=fn=>{
  const job=queue.then(async()=>{
   const staged=new Map(m);
   const txn={get:async k=>staged.get(k),put:async(k,v)=>{staged.set(k,v)}};
   const result=await fn(txn);
   m.clear();for(const [k,v] of staged)m.set(k,v);
   return result;
  });
  queue=job.catch(()=>{});
  return job;
 };
 return access;
};
const op={actorId:owner,cabinetId:owner,ownerId:owner,accountId:"yan_second"};
test("owner sees drafts without credentials, first man unchanged",async()=>{
 const s=storage(),items=await readManSetupDrafts(s,owner,owner,owner,accounts);
 assert.equal(items.length,3);
 assert.equal(items[0].setup,null);
 assert.equal(items[1].setup.stage,"not_configured");
 assert.equal(items[2].setup.canPublish,false);
 assert.equal(s.snapshot().size,0);
});
test("owner-only plan and reset are durable, versioned, and never activate",async()=>{
 const s=storage();
 const planned=await changeManSetupDraft(s,{...op,action:"plan",expectedVersion:0,at:100});
 assert.equal(planned.setup.version,1);
 assert.equal(planned.setup.stage,"awaiting_credentials");
 assert.equal(planned.setup.canPublish,false);
 assert.equal((await readManSetupDraft(s,"yan_second")).version,1);
 await assert.rejects(changeManSetupDraft(s,{...op,action:"plan",expectedVersion:0,at:200}));
 const reset=await changeManSetupDraft(s,{...op,action:"reset",expectedVersion:1,at:201});
 assert.equal(reset.setup.stage,"not_configured");
 assert.equal((await readManSetupDraft(s,"yan_30")).version,0);
});
test("rejects impostors, legacy changes, and attempts to skip verification",async()=>{
 const s=storage();
 await assert.rejects(changeManSetupDraft(s,{...op,actorId:"12345000",action:"plan",expectedVersion:0,at:1}));
 await assert.rejects(changeManSetupDraft(s,{...op,accountId:"yan_first",action:"plan",expectedVersion:0,at:1}));
 await assert.rejects(changeManSetupDraft(s,{...op,action:"verify",expectedVersion:0,at:1}));
 await assert.rejects(changeManSetupDraft(s,{...op,action:"plan",expectedVersion:0,at:-1}));
 await assert.rejects(readManSetupDrafts(s,"12345000",owner,owner,accounts));
});

test("two simultaneous changes cannot both win same version",async()=>{
 const s=storage();
 const a=changeManSetupDraft(s,{...op,action:"plan",expectedVersion:0,at:100});
 const b=changeManSetupDraft(s,{...op,action:"plan",expectedVersion:0,at:101});
 const settled=await Promise.allSettled([a,b]);
 assert.equal(settled.filter(x=>x.status==="fulfilled").length,1);
 assert.equal(settled.filter(x=>x.status==="rejected").length,1);
 const draft=await readManSetupDraft(s,"yan_second");
 assert.equal(draft.version,1);
 assert.equal(draft.stage,"awaiting_credentials");
});
test("changes reject non-transactional storage instead of risking overwrite",async()=>{
 const unsafe={get:async()=>undefined,put:async()=>{}};
 await assert.rejects(changeManSetupDraft(unsafe,{...op,action:"plan",expectedVersion:0,at:1}),/Atomic storage unavailable/);
});

test("audit is atomic, owner-only and isolated between men",async()=>{
 const s=storage();
 await changeManSetupDraft(s,{...op,action:"plan",expectedVersion:0,at:101});
 await changeManSetupDraft(s,{...op,action:"reset",expectedVersion:1,at:102});
 const list=await readManSetupHistory(s,owner,owner,owner,"yan_second");
 assert.equal(list.length,2);
 assert.deepEqual(list.map(x=>x.action),["plan","reset"]);
 assert.deepEqual(list.map(x=>x.version),[1,2]);
 assert.equal(list[0].accountId,"yan_second");
 assert.equal(JSON.stringify(list).includes("password"),false);
 assert.deepEqual(await readManSetupHistory(s,owner,owner,owner,"yan_30"),[]);
 await assert.rejects(readManSetupHistory(s,"1234567",owner,owner,"yan_second"));
 await assert.rejects(readManSetupHistory(s,owner,owner,owner,"yan_first"));
});
test("failed/stale change adds no audit entry",async()=>{
 const s=storage();
 await changeManSetupDraft(s,{...op,action:"plan",expectedVersion:0,at:200});
 await assert.rejects(changeManSetupDraft(s,{...op,action:"plan",expectedVersion:0,at:201}));
 assert.equal((await readManSetupHistory(s,owner,owner,owner,"yan_second")).length,1);
});
test("history is bounded to fifty records",async()=>{
 const s=storage();
 for(let n=0;n<60;n++){
  await changeManSetupDraft(s,{...op,action:n%2?"reset":"plan",expectedVersion:n,at:500+n});
 }
 const logs=await readManSetupHistory(s,owner,owner,owner,"yan_second");
 assert.equal(logs.length,50);
 assert.equal(logs[0].version,11);
 assert.equal(logs[49].version,60);
});

test("old audit entries are sanitized before next persisted update",async()=>{
 const s=storage();
 await s.put("man-setup-history-v1:yan_second",[
  {accountId:"yan_second",version:1,action:"plan",stage:"awaiting_credentials",at:90,
   proxyPassword:"must-not-survive",ip:"203.0.113.7"},
  {accountId:"yan_30",version:2,action:"reset",stage:"not_configured",at:91,
   token:"must-not-survive"},
  {accountId:"yan_second",version:3,action:"activate",stage:"disabled",at:92,
   secret:"must-not-survive"}
 ]);
 await changeManSetupDraft(s,{...op,action:"plan",expectedVersion:0,at:100});
 const raw=s.snapshot().get("man-setup-history-v1:yan_second");
 assert.equal(raw.length,2);
 assert.deepEqual(Object.keys(raw[0]).sort(),["accountId","action","at","stage","version"].sort());
 assert.ok(!JSON.stringify(raw).includes("must-not-survive"));
 assert.equal(raw[1].version,1);
});

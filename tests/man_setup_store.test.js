import test from "node:test";
import assert from "node:assert/strict";
import {readManSetupDraft,changeManSetupDraft,readManSetupDrafts} from "../src/man_setup_store.js";
const owner="5866034656",accounts=[{id:"yan_first"},{id:"yan_second"},{id:"yan_30"}];
const storage=()=>{const m=new Map();return {get:async k=>m.get(k),put:async(k,v)=>m.set(k,v),snapshot:()=>m}};
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

import test from "node:test";
import assert from "node:assert/strict";
import {secondaryPublicationOperationalStatus} from "../src/secondary_man_publication_status.js";
import {manStorageKey} from "../src/man_account_isolation.js";

const source=(accountId="yan_second")=>({
 userId:"123456789",accountId,profileId:"2468",kind:"rating",nonce:"abcdef123456"
});
function fixture(accountId="yan_second"){
 const i=source(accountId),map=new Map();
 const base=({scope})=>manStorageKey({...i,scope});
 const pub=base({scope:"publication"})+":rating";
 const proof=base({scope:"proof"})+":rating:"+i.nonce+":settlement";
 const archive=base({scope:"history"})+":rating:"+i.nonce;
 const store={get:async k=>map.get(k)};
 return {i,map,store,pub,proof,archive};
}
test("dispatch acceptance and callback proof alone never establish publication",async()=>{
 const f=fixture();
 assert.equal((await secondaryPublicationOperationalStatus(f.store,f.i)).status,"not_started");
 f.map.set(f.pub,{identity:{...f.i,version:1},status:"prepared",attempted:false});
 assert.equal((await secondaryPublicationOperationalStatus(f.store,f.i)).published,false);
 f.map.set(f.pub,{identity:{...f.i,version:1},status:"attempted",attempted:true});
 assert.equal((await secondaryPublicationOperationalStatus(f.store,f.i)).published,false);
 f.map.set(f.proof,{identity:{...f.i,version:1},status:"proof_saved",
  sitePublicationId:"site123456",proofFileId:"proof123456",ledgerStatus:"unsettled"});
 f.map.set(f.archive,{...f.i,sitePublicationId:"site123456",proofFileId:"proof123456"});
 assert.equal((await secondaryPublicationOperationalStatus(f.store,f.i)).published,false);
 f.map.set(f.proof,{identity:{...f.i,version:1},status:"completed",
  sitePublicationId:"site123456",proofFileId:"proof123456",ledgerStatus:"completed"});
 assert.equal((await secondaryPublicationOperationalStatus(f.store,f.i)).published,false);
 f.map.set(f.pub,{identity:{...f.i,version:1},status:"completed",attempted:true});
 const completed=await secondaryPublicationOperationalStatus(f.store,f.i);
 assert.equal(completed.status,"published");
 assert.equal(completed.creditCompleted,true);
 f.map.delete(f.archive);
 const failed=await secondaryPublicationOperationalStatus(f.store,f.i);
 assert.equal(failed.status,"reconciliation_required");
 assert.equal(failed.published,false);
});
test("uncertain results require reconciliation; different man is isolated",async()=>{
 const f=fixture();
 f.map.set(f.pub,{identity:{...f.i,version:1},status:"uncertain",attempted:true});
 const uncertain=await secondaryPublicationOperationalStatus(f.store,f.i);
 assert.equal(uncertain.status,"reconciliation_required");
 assert.equal(uncertain.requiresManualReconciliation,true);
 assert.equal((await secondaryPublicationOperationalStatus(f.store,source("yan_03"))).status,"not_started");
 await assert.rejects(()=>secondaryPublicationOperationalStatus(f.store,source("yan_first")),/immutable/);
});
test("cross-client record cannot leak status",async()=>{
 const f=fixture();
 f.map.set(f.pub,{identity:{...f.i,userId:"987654321",version:1},status:"completed",attempted:true});
 await assert.rejects(()=>secondaryPublicationOperationalStatus(f.store,f.i),/identity mismatch/);
});

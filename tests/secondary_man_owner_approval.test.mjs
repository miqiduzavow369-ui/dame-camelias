import test from "node:test";
import assert from "node:assert/strict";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
import {readSecondaryManApproval,setSecondaryManApproval,approvalMatchesConfiguration} from "../src/secondary_man_owner_approval.js";
const owner="123456789";
function memoryStore(){
 const records=new Map();
 const api={get:async key=>records.get(key),put:async(key,value)=>{records.set(key,value)},
 transaction:async callback=>callback(api)};
 return {api,records};
}
test("owner approvals for all 29 secondary accounts are separate and credential-version bound",async()=>{
 const {api,records}=memoryStore();
 for(const man of MAN_ACCOUNTS.slice(1)){
  const ctx={actorId:owner,cabinetId:owner,ownerId:owner,accountId:man.id};
  const before=await readSecondaryManApproval(api,ctx);
  assert.equal(before.approved,false);
  const saved=await setSecondaryManApproval(api,{...ctx,expectedVersion:0,approved:true,proxyVersion:2,siteVersion:7});
  assert.equal(saved.accountId,man.id);
  assert.equal(approvalMatchesConfiguration(saved,man.id,2,7),true);
  assert.equal(approvalMatchesConfiguration(saved,man.id,3,7),false);
  assert.equal(approvalMatchesConfiguration(saved,man.id,2,8),false);
  assert.equal(approvalMatchesConfiguration(saved,"yan_first",2,7),false);
  await assert.rejects(()=>setSecondaryManApproval(api,{...ctx,expectedVersion:0,approved:false,proxyVersion:2,siteVersion:7}),/version conflict/);
 }
 assert.equal(records.size,29);
 const ctx={actorId:owner,cabinetId:owner,ownerId:owner,accountId:"yan_second"};
 const revoked=await setSecondaryManApproval(api,{...ctx,expectedVersion:1,approved:false,proxyVersion:2,siteVersion:7});
 assert.equal(approvalMatchesConfiguration(revoked,"yan_second",2,7),false);
 assert.equal((await readSecondaryManApproval(api,{...ctx,accountId:"yan_03"})).approved,true);
});
test("owner-only approval cannot update Yan First or impersonate another administrator",async()=>{
 const {api}=memoryStore();
 const base={actorId:owner,cabinetId:owner,ownerId:owner,accountId:"yan_second",expectedVersion:0,approved:true,proxyVersion:1,siteVersion:1};
 await assert.rejects(()=>setSecondaryManApproval(api,{...base,accountId:"yan_first"}),/immutable/);
 await assert.rejects(()=>setSecondaryManApproval(api,{...base,actorId:"987654321"}),/Forbidden/);
 await assert.rejects(()=>setSecondaryManApproval(api,{...base,siteVersion:0}),/Invalid/);
});

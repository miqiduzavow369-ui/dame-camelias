import test from "node:test";
import assert from "node:assert/strict";
import {prepareSecondaryPublication,claimSecondaryPublication,markSecondaryPublicationUncertain} from "../src/secondary_man_publication_gate.js";
const owner="123456789";
function store(){
 const records=new Map();
 const tx={get:async k=>records.get(k),put:async(k,v)=>{records.set(k,v)},transaction:async fn=>fn(tx)};
 return {tx,records};
}
function request(accountId,kind="rating"){
 const identity={userId:owner,accountId,profileId:"2468",kind,nonce:"abcdef123456"};
 return {identity,approval:{accountId,approved:true,version:1,proxyVersion:2,siteVersion:3},
 proxyVersion:2,siteVersion:3,verifiedSiteIdentity:true,ownerConfirmed:true,
 creditReserved:true,moderationApproved:true,executorConnected:true,
 callbackConnected:true,proofAndLedgerConnected:true};
}
test("all 29 men use per-account claims and Yan First cannot enter this route",async()=>{
 const {tx,records}=store();
 const ids=["yan_second",...Array.from({length:28},(_,i)=>"yan_"+String(i+3).padStart(2,"0"))];
 for(const id of ids){
  const p=request(id);
  const op=await prepareSecondaryPublication(tx,p);
  assert.equal(op.identity.accountId,id);
  assert.equal(op.status,"prepared");
  await assert.rejects(()=>prepareSecondaryPublication(tx,p),/already claimed/);
  await claimSecondaryPublication(tx,{original:op.identity,callback:p.identity});
  await assert.rejects(()=>claimSecondaryPublication(tx,{original:op.identity,callback:p.identity}),/already attempted/);
  await markSecondaryPublicationUncertain(tx,{original:op.identity,callback:p.identity});
  await assert.rejects(()=>markSecondaryPublicationUncertain(tx,{original:op.identity,callback:p.identity}),/not found/);
 }
 assert.equal(records.size,29);
 await assert.rejects(()=>prepareSecondaryPublication(tx,request("yan_first")) ,/immutable/);
});
test("cross-account callbacks and missing approvals never claim a publication",async()=>{
 const {tx}=store(),p=request("yan_second","review");
 const op=await prepareSecondaryPublication(tx,p);
 for(const patch of [{accountId:"yan_03"},{profileId:"999"},{userId:"987654321"},{nonce:"abcdef654321"},{kind:"rating"}]){
  await assert.rejects(()=>claimSecondaryPublication(tx,{original:op.identity,callback:{...p.identity,...patch}}),/mismatch/);
 }
 await claimSecondaryPublication(tx,{original:op.identity,callback:p.identity});
 const bads=[
  {verifiedSiteIdentity:false},{ownerConfirmed:false},{creditReserved:false},
  {moderationApproved:false},{executorConnected:false},{callbackConnected:false},
  {proofAndLedgerConnected:false},{proxyVersion:4}
 ];
 for(const item of bads){
  const {tx:local}=store();
  await assert.rejects(()=>prepareSecondaryPublication(local,{...p,...item}),/prerequisites/);
 }
});

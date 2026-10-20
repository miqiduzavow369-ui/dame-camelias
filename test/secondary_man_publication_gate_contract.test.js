import test from "node:test";
import assert from "node:assert/strict";
import {prepareSecondaryPublication,claimSecondaryPublication} from "../src/secondary_man_publication_gate.js";

const identity={userId:"123456789",accountId:"yan_second",profileId:"690230",kind:"rating",nonce:"abcdef123456"};
const approval={accountId:"yan_second",approved:true,version:1,proxyVersion:1,siteVersion:1};
function storage(){
 const values=new Map();
 const tx={get:async key=>values.get(key),put:async(key,value)=>values.set(key,value)};
 return {values,transaction:async fn=>fn(tx)};
}
function inputs(overrides={}){
 return {identity,approval,proxyVersion:1,siteVersion:1,verifiedSiteIdentity:true,
  ownerConfirmed:true,creditReserved:true,independentAuthorConfirmed:true,
  moderationApproved:false,executorConnected:true,callbackConnected:true,
  proofAndLedgerConnected:true,...overrides};
}
test("secondary rating gate records authentic author prerequisite for one-use ticket",async()=>{
 const db=storage();
 const prepared=await prepareSecondaryPublication(db,inputs());
 assert.equal(prepared.independentAuthorConfirmed,true);
 assert.equal(prepared.moderatorApproved,false);
 const claimed=await claimSecondaryPublication(db,{original:identity,callback:identity});
 assert.equal(claimed.status,"attempted");
 assert.equal(claimed.independentAuthorConfirmed,true);
 await assert.rejects(()=>claimSecondaryPublication(db,{original:identity,callback:identity}),/already attempted/);
});
test("rating gate fails closed without independent author confirmation",async()=>{
 await assert.rejects(()=>prepareSecondaryPublication(storage(),inputs({independentAuthorConfirmed:false})),/prerequisites/);
});
test("review requires moderation and persists approval",async()=>{
 const review={...identity,kind:"review"};
 await assert.rejects(()=>prepareSecondaryPublication(storage(),inputs({identity:review})),/prerequisites/);
 const prepared=await prepareSecondaryPublication(storage(),inputs({identity:review,moderationApproved:true}));
 assert.equal(prepared.moderatorApproved,true);
});
test("legacy Yan First cannot enter secondary publication gate",async()=>{
 await assert.rejects(()=>prepareSecondaryPublication(storage(),inputs({identity:{...identity,accountId:"yan_first"}})),/immutable/);
});

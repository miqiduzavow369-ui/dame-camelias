import test from "node:test";
import assert from "node:assert/strict";
import {dispatchApprovedSecondaryPublication} from "../src/secondary_man_runner_bridge.js";

function fixture(accountId="yan_second"){
 const identity={userId:"123456789",accountId,profileId:"2468",kind:"rating",nonce:"abcdef123456"};
 const publication={identity:{...identity,version:1},status:"prepared",attempted:false,
  proxyVersion:2,siteVersion:3,independentAuthorConfirmed:true};
 const prefix=["man-account-v1",identity.userId,accountId].join(":");
 const publicationKey=prefix+":publication:2468:rating";
 const ledgerKey=prefix+":operation:2468:rating:abcdef123456:ledger";
 const records=new Map([
  [publicationKey,publication],
  [ledgerKey,{...identity,status:"reserved"}],
  ["man-proxy-sealed-v1:"+accountId,{accountId,version:2,proxyVerified:true,ipVerified:true}],
  ["man-intimcity-sealed-v1:"+accountId,{accountId,version:3,configured:true,
   boundProxyVersion:2,siteUrl:"https://b.intimcity.rip/"}],
  ["man-owner-approval-v1:"+accountId,{accountId,approved:true,version:1,proxyVersion:2,siteVersion:3}],
  ["secondary-site-identity-v1:"+accountId,{accountId,proxyVersion:2,siteVersion:3,siteAccountId:"test_user"}]
 ]);
 const tx={get:async key=>records.get(key),put:async(key,value)=>{records.set(key,value)},
   transaction:async fn=>fn(tx)};
 return {identity,records,tx,publicationKey};
}
test("one authenticated dispatch consumes the claim and callback ticket exactly once",async()=>{
 const f=fixture();
 let called=0,received;
 const args={identity:f.identity,ownerOperationConfirmed:true,independentAuthorConfirmed:true,
  at:1000,trustedDispatch:async x=>{called++;received=x;return {accepted:true};}};
 const outcome=await dispatchApprovedSecondaryPublication(f.tx,args);
 assert.equal(outcome.status,"attempted");
 assert.equal(outcome.sitePublished,false);
 assert.equal(called,1);
 assert.equal(received.accountId,"yan_second");
 assert.match(received.callbackTicket,/^[a-f0-9]{32}$/);
 assert.equal(f.records.get(f.publicationKey).attempted,true);
 await assert.rejects(()=>dispatchApprovedSecondaryPublication(f.tx,args),/unattempted/);
 assert.equal(called,1);
});
test("dispatch refusal preserves uncertain state and never retries the site operation",async()=>{
 const f=fixture();
 let called=0;
 const args={identity:f.identity,ownerOperationConfirmed:true,independentAuthorConfirmed:true,
  at:1000,trustedDispatch:async()=>{called++;throw Error("network uncertain");}};
 assert.equal((await dispatchApprovedSecondaryPublication(f.tx,args)).status,"reconciliation_required");
 assert.equal(f.records.get(f.publicationKey).status,"uncertain");
 await assert.rejects(()=>dispatchApprovedSecondaryPublication(f.tx,args),/unattempted/);
 assert.equal(called,1);
});
test("missing owner approval and legacy Yan are denied before runner dispatch",async()=>{
 const f=fixture(),calls=[];
 await assert.rejects(()=>dispatchApprovedSecondaryPublication(f.tx,{
  identity:f.identity,ownerOperationConfirmed:false,independentAuthorConfirmed:true,
  at:1000,trustedDispatch:async x=>{calls.push(x);return {accepted:true};}}),/authorized/);
 assert.equal(calls.length,0);
 const legacy=fixture("yan_first");
 await assert.rejects(()=>dispatchApprovedSecondaryPublication(legacy.tx,{
  identity:legacy.identity,ownerOperationConfirmed:true,independentAuthorConfirmed:true,
  at:1000,trustedDispatch:async x=>{calls.push(x);return {accepted:true};}}),/Legacy/);
 assert.equal(calls.length,0);
});

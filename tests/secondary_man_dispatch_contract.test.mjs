import test from "node:test";
import assert from "node:assert/strict";
import {validateSecondaryDispatchContract,readSecondaryDispatchPreflight} from "../src/secondary_man_dispatch_contract.js";

function fixture(accountId="yan_second",kind="rating"){
 const identity={userId:"123456789",accountId,profileId:"2468",kind,nonce:"abcdef123456"};
 const proxy={accountId,version:2,proxyVerified:true,ipVerified:true};
 const site={accountId,version:3,boundProxyVersion:2,configured:true};
 return {identity,proxy,site,publication:{identity:{...identity,version:1},
   status:"prepared",attempted:false,proxyVersion:2,siteVersion:3,
   independentAuthorConfirmed:true,moderatorApproved:true},
  credit:{...identity,status:"reserved"},
  approval:{accountId,version:1,approved:true,proxyVersion:2,siteVersion:3},
  verifiedIdentity:{accountId,proxyVersion:2,siteVersion:3,siteAccountId:"test_member"},
  selectedHost:"b.intimcity.rip",ownerOperationConfirmed:true,independentAuthorConfirmed:true};
}
test("each of 29 secondary men receives an isolated non-submitting dispatch envelope",()=>{
 const ids=["yan_second",...Array.from({length:28},(_,i)=>"yan_"+String(i+3).padStart(2,"0"))];
 for(const id of ids){
  const result=validateSecondaryDispatchContract(fixture(id));
  assert.equal(result.accountId,id);
  assert.equal(result.dispatchRoute,"isolated_secondary_only");
  assert.equal(result.maySubmit,false);
  assert.equal(result.identity.accountId,id);
  assert.equal("password" in result,false);
  assert.equal("proxy" in result,false);
 }
 assert.throws(()=>validateSecondaryDispatchContract(fixture("yan_first")),/Legacy/);
});
test("cross-man and cross-client substitutions fail closed",()=>{
 const base=fixture();
 for(const change of [
  {credit:{...base.credit,accountId:"yan_03"}},
  {credit:{...base.credit,userId:"987654321"}},
  {credit:{...base.credit,nonce:"abcdef000000"}},
  {publication:{...base.publication,identity:{...base.publication.identity,accountId:"yan_03"}}},
  {verifiedIdentity:{...base.verifiedIdentity,accountId:"yan_03"}},
  {proxy:{...base.proxy,accountId:"yan_03"}},
  {site:{...base.site,accountId:"yan_03"}},
  {approval:{...base.approval,accountId:"yan_03"}},
  {selectedHost:"evil.example"},
  {selectedHost:"B.INTIMCITY.RIP"},
  {ownerOperationConfirmed:false},
  {independentAuthorConfirmed:false}
 ]) assert.throws(()=>validateSecondaryDispatchContract({...base,...change}));
});
test("stale credentials, already claimed attempts, and unauthorized review fail closed",()=>{
 const base=fixture();
 for(const change of [
  {proxy:{...base.proxy,version:4}},
  {site:{...base.site,boundProxyVersion:99}},
  {approval:{...base.approval,approved:false}},
  {verifiedIdentity:{...base.verifiedIdentity,siteVersion:7}},
  {publication:{...base.publication,attempted:true}},
  {publication:{...base.publication,status:"uncertain"}},
  {credit:{...base.credit,status:"completed"}}
 ]) assert.throws(()=>validateSecondaryDispatchContract({...base,...change}));
 const review=fixture("yan_second","review");
 assert.throws(()=>validateSecondaryDispatchContract({...review,
   publication:{...review.publication,moderatorApproved:false}}),/authorized/);
});

test("preflight reads existing private records rather than browser-supplied flags",async()=>{
 const request=fixture();
 const {identity:i,publication,credit,proxy,site,approval,verifiedIdentity}=request;
 const prefix=["man-account-v1",i.userId,i.accountId].join(":");
 const kv=new Map([
  [prefix+":publication:"+i.profileId+":"+i.kind,publication],
  [prefix+":operation:"+i.profileId+":"+i.kind+":"+i.nonce+":ledger",credit],
  ["man-proxy-sealed-v1:"+i.accountId,proxy],
  ["man-intimcity-sealed-v1:"+i.accountId,{...site,siteUrl:"https://b.intimcity.rip/"}],
  ["man-owner-approval-v1:"+i.accountId,approval],
  ["secondary-site-identity-v1:"+i.accountId,verifiedIdentity]
 ]);
 const storage={get:async key=>kv.get(key)};
 const result=await readSecondaryDispatchPreflight(storage,{
  identity:i,ownerOperationConfirmed:true,independentAuthorConfirmed:true});
 assert.equal(result.accountId,"yan_second");
 assert.equal(result.maySubmit,false);
 kv.set("man-proxy-sealed-v1:yan_second",{...proxy,version:4});
 await assert.rejects(()=>readSecondaryDispatchPreflight(storage,{
  identity:i,ownerOperationConfirmed:true,independentAuthorConfirmed:true}),/changed/);
 kv.set("man-proxy-sealed-v1:yan_second",proxy);
 kv.delete(prefix+":operation:"+i.profileId+":"+i.kind+":"+i.nonce+":ledger");
 await assert.rejects(()=>readSecondaryDispatchPreflight(storage,{
  identity:i,ownerOperationConfirmed:true,independentAuthorConfirmed:true}),/credit/);
});

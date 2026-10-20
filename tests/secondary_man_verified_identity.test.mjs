import test from "node:test";
import assert from "node:assert/strict";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
import {validateIdentityEvidence,recordVerifiedIdentity,currentVerifiedIdentity} from "../src/secondary_man_verified_identity.js";
function memory(){const values=new Map(),db={get:async k=>values.get(k),put:async(k,v)=>values.set(k,v),transaction:async fn=>fn(db)};return {db,values};}
function fixture(id){return {accountId:id,expectedSiteAccountId:"site-user-1234",observedSiteAccountId:"site-user-1234",proxyVersion:1,siteVersion:2,technicalLogin:true,source:"trusted_authenticated_account_page",approval:{accountId:id,approved:true,version:1,proxyVersion:1,siteVersion:2}};}
test("all 29 men require their OWN independently verified website identity",()=>{
 for(const man of MAN_ACCOUNTS.slice(1)){
  const p=fixture(man.id),result=validateIdentityEvidence(p);
  assert.equal(result.accountId,man.id);
  for(const changed of [
    {observedSiteAccountId:"someone-else"},
    {technicalLogin:false},{source:"login_form_only"},
    {proxyVersion:9},
    {approval:{...p.approval,accountId:"yan_first"}},
    {approval:{...p.approval,approved:false}}
  ])assert.throws(()=>validateIdentityEvidence({...p,...changed}),/not verified/);
 }
 assert.throws(()=>validateIdentityEvidence(fixture("yan_first")),/immutable/);
});
test("identity evidence invalidates on proxy rotation, site replacement or approval revocation",async()=>{
 const {db,values}=memory(),id="yan_second",p=fixture(id),e=validateIdentityEvidence(p);
 values.set("man-proxy-sealed-v1:"+id,{accountId:id,version:1,proxyVerified:true,ipVerified:true});
 values.set("man-intimcity-sealed-v1:"+id,{accountId:id,version:2,boundProxyVersion:1});
 values.set("man-owner-approval-v1:"+id,p.approval);
 assert.equal((await currentVerifiedIdentity(db,id)).verified,false);
 await recordVerifiedIdentity(db,{accountId:id,evidence:e,at:100});
 assert.equal((await currentVerifiedIdentity(db,id)).verified,true);
 values.set("man-proxy-sealed-v1:"+id,{accountId:id,version:3,proxyVerified:true,ipVerified:true});
 assert.equal((await currentVerifiedIdentity(db,id)).verified,false);
 values.set("man-proxy-sealed-v1:"+id,{accountId:id,version:1,proxyVerified:true,ipVerified:true});
 values.set("man-owner-approval-v1:"+id,{...p.approval,approved:false});
 assert.equal((await currentVerifiedIdentity(db,id)).verified,false);
});

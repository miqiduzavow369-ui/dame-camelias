import test from "node:test";
import assert from "node:assert/strict";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
import {clientMenAvailability,LEGACY_CLIENT_ROUTE,requireClientPublicationRoute} from "../src/man_client_parity.js";

const others=MAN_ACCOUNTS.filter(m=>m.id!=="yan_first");
function ready(accountId){return {
  executorConnected:true,callbackConnected:true,proofAndLedgerConnected:true,
  ownerApproved:true,
  activation:{accountId,enabled:true,siteIdentityVerified:true,proxyVerified:true,version:1}
};}

test("all 29 secondary men share Yan First stage ordering without inheriting publication permission",()=>{
 assert.equal(others.length,29);
 assert.equal(others[0].id,"yan_second");
 assert.equal(others[28].id,"yan_30");
 const all=clientMenAvailability();
 assert.equal(all.filter(x=>x.enabled).length,1);
 for(const m of others){
  const row=all.find(x=>x.id===m.id);
  assert.deepEqual(row.ratingRoute,LEGACY_CLIENT_ROUTE.rating);
  assert.deepEqual(row.reviewRoute,LEGACY_CLIENT_ROUTE.review);
  assert.equal(row.enabled,false);
  assert.throws(()=>requireClientPublicationRoute(m.id),/not connected/);
 }
});
test("each of 29 men requires separate owner approval and independent server activation",()=>{
 for(const man of others){
  const map=new Map([[man.id,ready(man.id)]]);
  const catalog=clientMenAvailability(map);
  assert.deepEqual(catalog.filter(x=>x.enabled).map(x=>x.id),["yan_first",man.id]);
  const missingOwner=new Map([[man.id,{...ready(man.id),ownerApproved:false}]]);
  assert.deepEqual(clientMenAvailability(missingOwner).filter(x=>x.enabled).map(x=>x.id),["yan_first"]);
  for(const flag of ["proxyVerified","siteIdentityVerified","enabled"]){
   const claim=ready(man.id);
   claim.activation[flag]=false;
   assert.deepEqual(clientMenAvailability(new Map([[man.id,claim]])).filter(x=>x.enabled).map(x=>x.id),["yan_first"]);
  }
  const wrong=ready(man.id);
  wrong.activation.accountId="yan_first";
  assert.deepEqual(clientMenAvailability(new Map([[man.id,wrong]])).filter(x=>x.enabled).map(x=>x.id),["yan_first"]);
 }
});
test("one man's approval does not activate neighboring men or modify Yan First",()=>{
 const list=clientMenAvailability(new Map([["yan_second",ready("yan_second")],["yan_04",ready("yan_04")]]));
 assert.deepEqual(list.filter(x=>x.enabled).map(x=>x.id),["yan_first","yan_second","yan_04"]);
 assert.equal(list[0].route,"legacy_yan_first");
 assert.equal(list.find(x=>x.id==="yan_03").enabled,false);
 assert.equal(list.find(x=>x.id==="yan_30").enabled,false);
 // The existing production legacy publisher cannot be called using a new man ID.
 assert.throws(()=>requireClientPublicationRoute("yan_second"),/not connected/);
});

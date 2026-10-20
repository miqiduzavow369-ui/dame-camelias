import test from "node:test";
import assert from "node:assert/strict";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
import {clientMenAvailability,requireClientPublicationRoute} from "../src/man_client_parity.js";

function valid(id){
 return {executorConnected:true,callbackConnected:true,proofAndLedgerConnected:true,
 ownerApproved:true,activation:{accountId:id,enabled:true,proxyVerified:true,siteIdentityVerified:true,version:1}};
}
test("all 29 secondary men are catalog-ready only from complete private server state",()=>{
 const available=clientMenAvailability();
 assert.equal(available.length,30);
 assert.deepEqual(available.filter(x=>x.enabled).map(x=>x.id),["yan_first"]);
 for(const man of MAN_ACCOUNTS.slice(1)){
  const map=new Map([[man.id,valid(man.id)]]);
  const rows=clientMenAvailability(map);
  assert.deepEqual(rows.filter(x=>x.enabled).map(x=>x.id),["yan_first",man.id]);
  assert.equal(rows.find(x=>x.id===man.id).route,"isolated_man_v1");
  assert.throws(()=>requireClientPublicationRoute(man.id),/not connected/);
  const disabledFields=["executorConnected","callbackConnected","proofAndLedgerConnected","ownerApproved"];
  for(const field of disabledFields){
   const cfg={...valid(man.id),[field]:false};
   assert.equal(clientMenAvailability(new Map([[man.id,cfg]])).find(x=>x.id===man.id).enabled,false);
  }
  for(const activation of [
   {...valid(man.id).activation,accountId:"yan_first"},
   {...valid(man.id).activation,proxyVerified:false},
   {...valid(man.id).activation,siteIdentityVerified:false},
   {...valid(man.id).activation,enabled:false}
  ])assert.equal(clientMenAvailability(new Map([[man.id,{...valid(man.id),activation}]])).find(x=>x.id===man.id).enabled,false);
 }
});
test("Yan First cannot be overwritten by secondary readiness, and all others remain independent",()=>{
 const state=new Map(MAN_ACCOUNTS.map(x=>[x.id,valid(x.id)]));
 const all=clientMenAvailability(state);
 assert.equal(all[0].route,"legacy_yan_first");
 assert.equal(all[0].verification,"legacy_unreported");
 assert.equal(all.filter(x=>x.enabled).length,30);
 state.delete("yan_second");
 const next=clientMenAvailability(state);
 assert.equal(next.find(x=>x.id==="yan_second").enabled,false);
 assert.equal(next.find(x=>x.id==="yan_03").enabled,true);
});

import test from "node:test";
import assert from "node:assert/strict";
import {MAN_ACCOUNTS, getManAccount, publicManAccounts} from "../src/man_accounts.js";
import {requireManId, manStorageKey, createAccountOperation, verifyAccountCallback, requireServerActivation} from "../src/man_account_isolation.js";
import {requireClientPublicationRoute, clientMenAvailability} from "../src/man_client_parity.js";

const EXPECTED_IDS = ["yan_first", "yan_second", ...Array.from({length:28}, (_,i)=>"yan_"+String(i+3).padStart(2,"0"))];
const IDENTITY = {userId:"123456789",profileId:"12345",kind:"rating",nonce:"abcdef123456"};

test("all 30 account ids are stable, unique, ordered and exact",()=>{
 assert.deepEqual(MAN_ACCOUNTS.map(x=>x.id), EXPECTED_IDS);
 assert.deepEqual(publicManAccounts().map(x=>x.id), EXPECTED_IDS);
 assert.equal(new Set(EXPECTED_IDS).size,30);
 for(const [index,id] of EXPECTED_IDS.entries()){
  assert.equal(getManAccount(id)?.number,index+1);
  assert.equal(requireManId(id),id);
 }
 for(const bad of ["yan_01","yan_02","yan_1","yan_2","yan_3","yan_third","YAN_FIRST","yan_second ","yan_31","yan_00","",null,undefined]){
  assert.equal(getManAccount(bad),null);
  assert.throws(()=>requireManId(bad),/Unknown man account/);
 }
});

test("technical id is preserved unchanged in action dispatch payload and callback identities",()=>{
 for(const accountId of EXPECTED_IDS){
  const actionPayload=JSON.parse(JSON.stringify({ref:"main",inputs:{account_id:requireManId(accountId),nonce:IDENTITY.nonce}}));
  assert.equal(actionPayload.inputs.account_id,accountId);
  const original=createAccountOperation({...IDENTITY,accountId});
  const callback=JSON.parse(JSON.stringify({...IDENTITY,accountId}));
  assert.equal(verifyAccountCallback(original,callback),true);
  for(const otherId of EXPECTED_IDS.filter(id=>id!==accountId)){
   assert.equal(verifyAccountCallback(original,{...callback,accountId:otherId}),false);
  }
 }
});

test("all 30 accounts have non-overlapping scoped keys without changing historical vault keys",()=>{
 const keys=EXPECTED_IDS.map(accountId=>manStorageKey({userId:IDENTITY.userId,accountId,scope:"publication",profileId:IDENTITY.profileId}));
 assert.equal(new Set(keys).size,30);
 for(const [i,key] of keys.entries())assert.equal(key,`man-account-v1:${IDENTITY.userId}:${EXPECTED_IDS[i]}:publication:${IDENTITY.profileId}`);
});

test("registry never authorizes publication for the other 29 men",()=>{
 const available=clientMenAvailability();
 assert.deepEqual(available.map(x=>x.id),EXPECTED_IDS);
 assert.deepEqual(available.filter(x=>x.enabled).map(x=>x.id),["yan_first"]);
 assert.equal(requireClientPublicationRoute("yan_first").route,"legacy_yan_first");
 for(const accountId of EXPECTED_IDS.slice(1)){
  assert.throws(()=>requireClientPublicationRoute(accountId),/not connected/);
  assert.throws(()=>requireServerActivation(accountId,{accountId,enabled:false,proxyVerified:true,siteIdentityVerified:true,version:1}),/not activated/);
 }
});

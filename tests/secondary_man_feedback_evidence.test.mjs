import test from "node:test";
import assert from "node:assert/strict";
import {appendVerifiedFeedbackEvidence,readVerifiedFeedbackEvidence} from "../src/secondary_man_feedback_evidence.js";
const store=()=>{const m=new Map(),db={get:async k=>m.get(k),put:async(k,v)=>m.set(k,v),transaction:async f=>f(db)};return {db,m}};
function request(accountId,userId="123456789",profileId="2468"){
 return {identity:{accountId,userId,profileId,kind:"review",nonce:"abcdef123456"},
 sitePublicationId:"site-proof-1234",proofFileId:"file_reference-3456",
 moderatorApproved:true,independentAuthorConfirmed:true,at:100};
}
test("genuine evidence archives are independent for men, clients and profiles",async()=>{
 const {db,m}=store();
 const a=request("yan_second"),b=request("yan_03"),c=request("yan_second","987654321");
 for(const item of [a,b,c])await appendVerifiedFeedbackEvidence(db,item);
 assert.equal(m.size,3);
 for(const item of [a,b,c]){
  const row=await readVerifiedFeedbackEvidence(db,item.identity);
  assert.equal(row.accountId,item.identity.accountId);
  assert.equal(row.userId,item.identity.userId);
  assert.equal(row.creditSettlement,"not_requested");
  await assert.rejects(()=>appendVerifiedFeedbackEvidence(db,item),/already recorded/);
 }
 assert.equal(await readVerifiedFeedbackEvidence(db,request("yan_04").identity),null);
});
test("no fake proof or unapproved content can be archived",async()=>{
 for(const variant of [
  {independentAuthorConfirmed:false},{moderatorApproved:false},
  {sitePublicationId:""},{proofFileId:""}]){
  await assert.rejects(()=>appendVerifiedFeedbackEvidence(store().db,{...request("yan_second"),...variant}),/cannot be archived/);
 }
 await assert.rejects(()=>appendVerifiedFeedbackEvidence(store().db,request("yan_first")),/immutable/);
});

import test from "node:test";
import assert from "node:assert/strict";
import {readSecondaryOperationDiagnostics} from "../src/secondary_man_operation_diagnostics.js";
import {createAccountOperation,manStorageKey} from "../src/man_account_isolation.js";
import fs from "node:fs";
const identity=(accountId="yan_second",userId="123456789")=>
 ({accountId,userId,profileId:"2468",kind:"review",nonce:"abcdef123456"});
function source(){const map=new Map();return {map,storage:{get:async k=>map.get(k),put:async(k,v)=>map.set(k,v)}};}
function keys(i){
 const prefix={userId:i.userId,accountId:i.accountId,profileId:i.profileId};
 return {
 publication:manStorageKey({...prefix,scope:"publication"})+":"+i.kind,
 credit:manStorageKey({...prefix,scope:"operation"})+":"+i.kind+":"+i.nonce+":ledger",
 ticket:manStorageKey({...prefix,scope:"callback"})+":"+i.kind+":"+i.nonce,
 result:manStorageKey({...prefix,scope:"proof"})+":"+i.kind+":"+i.nonce+":settlement",
 evidence:manStorageKey({...prefix,scope:"history"})+":"+i.kind+":"+i.nonce
 };
}
test("empty operation is not reported as published and never exposes retry",async()=>{
 const {storage}=source(),result=await readSecondaryOperationDiagnostics(storage,identity());
 assert.equal(result.publicationStatus,"not_started");
 assert.equal(result.completed,false);
 assert.equal(result.canRetrySitePost,false);
 assert.equal(result.publicationEnabled,false);
 await assert.rejects(()=>readSecondaryOperationDiagnostics(storage,identity("yan_first")),/immutable/);
});
test("distinct men and clients have separately diagnosed proof, ticket and credit",async()=>{
 const {storage}=source(),i=identity(),k=keys(i);
 await storage.put(k.publication,{identity:createAccountOperation(i),status:"attempted",attempted:true});
 await storage.put(k.ticket,{identity:createAccountOperation(i),status:"consumed",token:"private-ticket"});
 await storage.put(k.credit,{...i,status:"reserved",ledgerNonce:"hidden-ledger-nonce"});
 await storage.put(k.result,{identity:createAccountOperation(i),status:"proof_saved",sitePublicationId:"site-12345",proofFileId:"telegram-54321"});
 await storage.put(k.evidence,{...i,sitePublicationId:"site-12345",proofFileId:"telegram-54321"});
 const status=await readSecondaryOperationDiagnostics(storage,i);
 assert.equal(status.proofPresent,true);
 assert.equal(status.completed,false);
 assert.equal(status.creditStatus,"reserved");
 assert.ok(!JSON.stringify(status).includes("private-ticket"));
 assert.ok(!JSON.stringify(status).includes("telegram-54321"));
 assert.ok(!JSON.stringify(status).includes("hidden-ledger-nonce"));
 assert.equal((await readSecondaryOperationDiagnostics(storage,identity("yan_03"))).publicationStatus,"not_started");
 assert.equal((await readSecondaryOperationDiagnostics(storage,identity("yan_second","987654321"))).publicationStatus,"not_started");
});
test("only matching completed proof and credit marks the operation finished",async()=>{
 const {storage}=source(),i=identity(),k=keys(i);
 await storage.put(k.publication,{identity:createAccountOperation(i),status:"completed"});
 await storage.put(k.credit,{...i,status:"completed"});
 await storage.put(k.result,{identity:createAccountOperation(i),status:"completed",sitePublicationId:"site-12345",proofFileId:"telegram-54321"});
 await storage.put(k.evidence,{...i,sitePublicationId:"site-12345",proofFileId:"telegram-54321"});
 let status=await readSecondaryOperationDiagnostics(storage,i);
 assert.equal(status.completed,true);
 assert.equal(status.needsReview,false);
 await storage.put(k.evidence,{...i,sitePublicationId:"site-12345",proofFileId:"different-54321"});
 status=await readSecondaryOperationDiagnostics(storage,i);
 assert.equal(status.completed,false);
 assert.equal(status.proofPresent,false);
 assert.equal(status.needsReview,true);
});
test("uncertain attempted post with consumed token needs human reconciliation",async()=>{
 const {storage}=source(),i=identity(),k=keys(i);
 await storage.put(k.publication,{identity:createAccountOperation(i),status:"uncertain"});
 await storage.put(k.ticket,{status:"consumed"});
 const status=await readSecondaryOperationDiagnostics(storage,i);
 assert.equal(status.needsReview,true);
 assert.equal(status.canRetrySitePost,false);
});

test("ADMIN diagnostics are read-only, authenticated and scoped to client",()=>{
 const admin=fs.readFileSync("src/admin_app_api.js","utf8");
 const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
 const start=admin.indexOf('if(action==="secondary_operation_status")');
 const end=admin.indexOf('  if(action==="client"){',start);
 const block=admin.slice(start,end);
 assert.ok(block.includes('cabinetRPC(env,uid,'));
 assert.ok(block.includes('admin_secondary_operation_status'));
 assert.ok(block.includes('registry(env,{action:"get",userId:uid})'));
 assert.ok(block.includes('actorId:OWNER_ID'));
 assert.ok(!block.includes('credits(env')&&!block.includes('adjustCredits('));
 const event=runtime.slice(runtime.indexOf('if(event.kind==="admin_secondary_operation_status")'),runtime.indexOf('if(event.kind==="mini_review_action")'));
 assert.ok(event.includes('event.actorId!==OWNER_ID'));
 assert.ok(event.includes('readSecondaryOperationDiagnostics(storage,'));
 assert.ok(event.includes('userId:uid'));
 assert.ok(!event.includes('dispatch(')&&!event.includes('settleSecondaryVerifiedResult('));
});

test("interrupted proof archive and ambiguous credit debit require admin review",async()=>{
 for(const [resultState,creditState] of [["proof_pending","reserved"],["proof_saved","reconciliation_required"]]){
  const {storage}=source(),i=identity(),k=keys(i);
  await storage.put(k.publication,{identity:createAccountOperation(i),status:"attempted",attempted:true});
  await storage.put(k.credit,{...i,status:creditState});
  await storage.put(k.result,{identity:createAccountOperation(i),status:resultState,
   sitePublicationId:"site-12345",proofFileId:"telegram-54321"});
  const status=await readSecondaryOperationDiagnostics(storage,i);
  assert.equal(status.needsReview,true);
  assert.equal(status.completed,false);
  assert.equal(status.canRetrySitePost,false);
 }
});

test("divergent final proof, publication and credit states demand reconciliation",async()=>{
 for(const changed of ["publication","credit","result"]){
  const {storage}=source(),i=identity(),k=keys(i);
  await storage.put(k.publication,{identity:createAccountOperation(i),status:changed==="publication"?"attempted":"completed"});
  await storage.put(k.credit,{...i,status:changed==="credit"?"reserved":"completed"});
  await storage.put(k.result,{identity:createAccountOperation(i),status:changed==="result"?"proof_saved":"completed",
   sitePublicationId:"site-12345",proofFileId:"telegram-54321"});
  await storage.put(k.evidence,{...i,sitePublicationId:"site-12345",proofFileId:"telegram-54321"});
  const state=await readSecondaryOperationDiagnostics(storage,i);
  assert.equal(state.completed,false);
  assert.equal(state.needsReview,true);
  assert.equal(state.canRetrySitePost,false);
 }
});

test("admin diagnostics remains available and flags inaccessible proof storage",async()=>{
 const {storage}=source(),i=identity(),k=keys(i);
 await storage.put(k.publication,{identity:createAccountOperation(i),status:"attempted",attempted:true});
 await storage.put(k.credit,{...i,status:"reserved"});
 await storage.put(k.result,{identity:createAccountOperation(i),status:"proof_saved",
  sitePublicationId:"site-12345",proofFileId:"telegram-54321"});
 const broken={get:async key=>{
  if(key===k.evidence)throw Error("Evidence storage temporarily unavailable");
  return storage.get(key);
 }};
 const status=await readSecondaryOperationDiagnostics(broken,i);
 assert.equal(status.needsReview,true);
 assert.equal(status.proofPresent,false);
 assert.equal(status.canRetrySitePost,false);
 assert.equal(status.publicationEnabled,false);
 assert.ok(!JSON.stringify(status).includes("telegram-54321"));
});

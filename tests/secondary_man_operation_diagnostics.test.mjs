import test from "node:test";
import assert from "node:assert/strict";
import {readSecondaryOperationDiagnostics} from "../src/secondary_man_operation_diagnostics.js";
import {createAccountOperation,manStorageKey} from "../src/man_account_isolation.js";
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
});
test("uncertain attempted post with consumed token needs human reconciliation",async()=>{
 const {storage}=source(),i=identity(),k=keys(i);
 await storage.put(k.publication,{identity:createAccountOperation(i),status:"uncertain"});
 await storage.put(k.ticket,{status:"consumed"});
 const status=await readSecondaryOperationDiagnostics(storage,i);
 assert.equal(status.needsReview,true);
 assert.equal(status.canRetrySitePost,false);
});

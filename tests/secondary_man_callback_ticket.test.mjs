import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {createAccountOperation,manStorageKey} from "../src/man_account_isolation.js";
import {signSecondaryResultAttestation} from "../src/secondary_man_callback_attestation.js";
import {recordTicketedSecondaryResult,secondaryVerifiedResultStatus} from "../src/secondary_man_result_settlement.js";
import {issueSecondaryCallbackTicket,claimSecondaryCallbackTicket,secondaryCallbackTicketStatus} from "../src/secondary_man_callback_ticket.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const secret="ab".repeat(32);
const i=(accountId="yan_second")=>({userId:"123456789",accountId,profileId:"2468",kind:"review",nonce:"abcdef123456"});
const input=(identity=i())=>({identity,proxyVersion:1,siteVersion:2,
 issuedAt:1000000,status:"verified_published",
 sitePublicationId:"site-proof-1234",proofFileId:"file-original-5678"});
function storage(){
 const rows=new Map();
 const tx={get:async key=>rows.get(key),put:async(k,v)=>rows.set(k,v),
 transaction:async fn=>fn(tx)};
 return {rows,tx};
}
async function attempted(tx,identity=i(),proxyVersion=1){
 await tx.put(manStorageKey({userId:identity.userId,accountId:identity.accountId,
 profileId:identity.profileId,scope:"publication"})+":"+identity.kind,
 {identity:createAccountOperation(identity),status:"attempted",attempted:true,
  proxyVersion,siteVersion:2,independentAuthorConfirmed:true,moderatorApproved:true});
 await tx.put(manStorageKey({userId:identity.userId,accountId:identity.accountId,
 profileId:identity.profileId,scope:"operation"})+":"+identity.kind+":"+identity.nonce+":ledger",
 {accountId:identity.accountId,userId:identity.userId,profileId:identity.profileId,
 kind:identity.kind,nonce:identity.nonce,status:"reserved"});
}
test("ticket is issued only for an attempted publication and consumed once after signed proof",async()=>{
 const {tx}=storage(),identity=i(),proof=input(identity);
 await assert.rejects(()=>issueSecondaryCallbackTicket(tx,{identity,proxyVersion:1,siteVersion:2,at:1000000}),/not eligible/);
 await attempted(tx,identity);
 const ticket=await issueSecondaryCallbackTicket(tx,{identity,proxyVersion:1,siteVersion:2,at:1000000});
 assert.match(ticket.token,/^[a-f0-9]{32}$/);
 await assert.rejects(()=>issueSecondaryCallbackTicket(tx,{identity,proxyVersion:1,siteVersion:2,at:1000000}),/not eligible/);
 const signature=await signSecondaryResultAttestation(secret,proof);
 await assert.rejects(()=>claimSecondaryCallbackTicket(tx,{identity,token:ticket.token,
  secret,input:proof,signature:"00".repeat(32),at:1000001}),/invalid/);
 assert.equal((await secondaryCallbackTicketStatus(tx,identity)).status,"issued");
 assert.equal((await claimSecondaryCallbackTicket(tx,{identity,token:ticket.token,
  secret,input:proof,signature,at:1000001})).ticketConsumed,true);
 assert.equal((await secondaryCallbackTicketStatus(tx,identity)).status,"consumed");
 await assert.rejects(()=>claimSecondaryCallbackTicket(tx,{identity,token:ticket.token,
  secret,input:proof,signature,at:1000002}),/consumed/);
});
test("another man's valid signed proof and expired or changed versions never consume the ticket",async()=>{
 const {tx}=storage(),identity=i(),proof=input(identity);
 await attempted(tx,identity);
 const ticket=await issueSecondaryCallbackTicket(tx,{identity,proxyVersion:1,siteVersion:2,at:1000000,ttlMs:30000});
 const stranger=input(i("yan_03"));
 await attempted(tx,stranger.identity);
 const foreignSignature=await signSecondaryResultAttestation(secret,stranger);
 await assert.rejects(()=>claimSecondaryCallbackTicket(tx,{identity,token:ticket.token,
  secret,input:stranger,signature:foreignSignature,at:1000001}),/mismatch/);
 const signature=await signSecondaryResultAttestation(secret,proof);
 await assert.rejects(()=>claimSecondaryCallbackTicket(tx,{identity,token:ticket.token,
  secret,input:proof,signature,at:1030001}),/expired/);
 assert.equal((await secondaryCallbackTicketStatus(tx,identity)).status,"issued");
 await assert.rejects(()=>issueSecondaryCallbackTicket(tx,{identity:i("yan_first"),
  proxyVersion:1,siteVersion:2,at:1000000}),/immutable/);
});

test("ticketed callback records one proof and never accepts repeat delivery",async()=>{
 const {tx}=storage(),identity=i(),proof=input(identity);
 await attempted(tx,identity);
 const ticket=await issueSecondaryCallbackTicket(tx,{identity,proxyVersion:1,siteVersion:2,at:1000000});
 const signature=await signSecondaryResultAttestation(secret,proof);
 const request={identity,token:ticket.token,secret,input:proof,signature,at:1000001,
  moderatorApproved:true,independentAuthorConfirmed:true};
 assert.equal((await recordTicketedSecondaryResult(tx,request)).status,"proof_saved");
 assert.equal((await secondaryVerifiedResultStatus(tx,identity)).proofPresent,true);
 await assert.rejects(()=>recordTicketedSecondaryResult(tx,request),/consumed/);
 await assert.rejects(()=>recordTicketedSecondaryResult(tx,{...request,signature:"00".repeat(32)}),/invalid/);
});

test("callback ticket refuses missing credit, author consent and review moderation",async()=>{
 const {tx,rows}=storage(),identity=i();
 await attempted(tx,identity);
 const publicationKey=manStorageKey({userId:identity.userId,accountId:identity.accountId,
 profileId:identity.profileId,scope:"publication"})+":"+identity.kind;
 const creditKey=manStorageKey({userId:identity.userId,accountId:identity.accountId,
 profileId:identity.profileId,scope:"operation"})+":"+identity.kind+":"+identity.nonce+":ledger";
 const issue=()=>issueSecondaryCallbackTicket(tx,{identity,proxyVersion:1,siteVersion:2,at:1000000});
 const claim=rows.get(publicationKey),credit=rows.get(creditKey);
 rows.delete(creditKey);
 await assert.rejects(issue,/not eligible/);
 rows.set(creditKey,{...credit,accountId:"yan_03"});
 await assert.rejects(issue,/not eligible/);
 rows.set(creditKey,credit);
 rows.set(publicationKey,{...claim,independentAuthorConfirmed:false});
 await assert.rejects(issue,/not eligible/);
 rows.set(publicationKey,{...claim,moderatorApproved:false});
 await assert.rejects(issue,/not eligible/);
 rows.set(publicationKey,claim);
 assert.equal((await issue()).identity.accountId,"yan_second");
});

test("issued callback ticket is rejected if ledger or authorization changes before receipt",async()=>{
 for(const mutation of ["credit_missing","credit_changed","author_revoked","moderation_revoked","proxy_rotated"]){
  const {tx,rows}=storage(),identity=i(),proof=input(identity);
  await attempted(tx,identity);
  const ticket=await issueSecondaryCallbackTicket(tx,{identity,proxyVersion:1,siteVersion:2,at:1000000});
  const pubKey=manStorageKey({...identity,scope:"publication"})+":"+identity.kind;
  const creditKey=manStorageKey({...identity,scope:"operation"})+":"+identity.kind+":"+identity.nonce+":ledger";
  if(mutation==="credit_missing")rows.delete(creditKey);
  if(mutation==="credit_changed")rows.set(creditKey,{...rows.get(creditKey),status:"settling"});
  if(mutation==="author_revoked")rows.set(pubKey,{...rows.get(pubKey),independentAuthorConfirmed:false});
  if(mutation==="moderation_revoked")rows.set(pubKey,{...rows.get(pubKey),moderatorApproved:false});
  if(mutation==="proxy_rotated")rows.set(pubKey,{...rows.get(pubKey),proxyVersion:3});
  const signature=await signSecondaryResultAttestation(secret,proof);
  await assert.rejects(()=>claimSecondaryCallbackTicket(tx,{identity,token:ticket.token,
   secret,input:proof,signature,at:1000001}),/invalid|expired|mismatched/);
  assert.equal((await secondaryCallbackTicketStatus(tx,identity)).status,"issued",mutation);
 }
});

test("consumed callback ticket with interrupted proof recording locks publication uncertain",async()=>{
 const {tx,rows}=storage(),identity=i(),proof=input(identity);
 await attempted(tx,identity);
 const ticket=await issueSecondaryCallbackTicket(tx,{identity,proxyVersion:1,siteVersion:2,at:1000000});
 const signature=await signSecondaryResultAttestation(secret,proof);
 const resultKey=manStorageKey({...identity,scope:"proof"})+":"+identity.kind+":"+identity.nonce+":settlement";
 const pubKey=manStorageKey({...identity,scope:"publication"})+":"+identity.kind;
 const broken={...tx,transaction:async fn=>fn({...tx,put:async (key,value)=>{
  if(key===resultKey)throw Error("Proof storage offline");
  return tx.put(key,value);
 }})};
 const request={identity,token:ticket.token,secret,input:proof,signature,at:1000001,
  moderatorApproved:true,independentAuthorConfirmed:true};
 await assert.rejects(()=>recordTicketedSecondaryResult(broken,request),/Proof storage offline/);
 assert.equal((await secondaryCallbackTicketStatus(tx,identity)).status,"consumed");
 assert.equal(rows.get(pubKey).status,"uncertain");
 assert.equal(rows.get(resultKey),undefined);
 await assert.rejects(()=>recordTicketedSecondaryResult(tx,request),/consumed|invalid/);
});

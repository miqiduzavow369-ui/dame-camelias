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
  proxyVersion,siteVersion:2});
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

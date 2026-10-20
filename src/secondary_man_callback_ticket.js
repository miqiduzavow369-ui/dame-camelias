// One-use, account-bound authorization ticket for a future authenticated
// Chromium result endpoint. This module NEVER dispatches or repeats a site POST.
// Ticket issuer and claimant must run inside a trusted per-client Durable Object.
import {createAccountOperation,verifyAccountCallback,manStorageKey} from "./man_account_isolation.js";
import {verifySecondaryResultAttestation} from "./secondary_man_callback_attestation.js";

const TOKEN=/^[a-f0-9]{32}$/;
function operationKey(i){return manStorageKey({userId:i.userId,accountId:i.accountId,
 profileId:i.profileId,scope:"publication"})+":"+i.kind;}
function ticketKey(i){return manStorageKey({userId:i.userId,accountId:i.accountId,
 profileId:i.profileId,scope:"callback"})+":"+i.kind+":"+i.nonce;}
function creditKey(i){return manStorageKey({userId:i.userId,accountId:i.accountId,
 profileId:i.profileId,scope:"operation"})+":"+i.kind+":"+i.nonce+":ledger";}
function identityOf(original){
 const i=createAccountOperation(original);
 if(i.accountId==="yan_first")throw Error("Legacy publisher immutable");
 return i;
}
export async function issueSecondaryCallbackTicket(storage,{
 identity,proxyVersion,siteVersion,at,ttlMs=480000
}){
 const i=identityOf(identity);
 if(!Number.isSafeInteger(at)||at<0||!Number.isSafeInteger(ttlMs)||
   ttlMs<30000||ttlMs>480000||!Number.isSafeInteger(proxyVersion)||
   !Number.isSafeInteger(siteVersion)||proxyVersion<1||siteVersion<1||
   typeof storage.transaction!=="function")throw Error("Invalid callback ticket request");
 const token=crypto.randomUUID().replace(/-/g,"");
 return storage.transaction(async tx=>{
  const publication=await tx.get(operationKey(i)),old=await tx.get(ticketKey(i));
  const credit=await tx.get(creditKey(i));
  if(old||publication?.status!=="attempted"||publication.attempted!==true||
    !verifyAccountCallback(publication.identity,i)||
    publication.independentAuthorConfirmed!==true||
    (i.kind==="review"&&publication.moderatorApproved!==true)||
    credit?.status!=="reserved"||credit.accountId!==i.accountId||
    credit.userId!==i.userId||credit.profileId!==i.profileId||
    credit.kind!==i.kind||credit.nonce!==i.nonce||
    publication.proxyVersion!==proxyVersion||publication.siteVersion!==siteVersion)
    throw Error("Publication attempt not eligible for a new ticket");
  await tx.put(ticketKey(i),{identity:i,token,proxyVersion,siteVersion,
   issuedAt:at,expiresAt:at+ttlMs,status:"issued"});
  return Object.freeze({identity:i,token,expiresAt:at+ttlMs});
 });
}
export async function claimSecondaryCallbackTicket(storage,{
 identity,token,secret,input,signature,at
}){
 const i=identityOf(identity);
 if(!TOKEN.test(token||"")||typeof storage.transaction!=="function"||
   !Number.isSafeInteger(at))throw Error("Invalid callback ticket");
 // Verify HMAC and the pinned publication operation BEFORE consuming a ticket.
 const evidence=await verifySecondaryResultAttestation(storage,{secret,input,signature,at});
 if(!verifyAccountCallback(i,evidence.identity))throw Error("Callback identity mismatch");
 await storage.transaction(async tx=>{
  const key=ticketKey(i),ticket=await tx.get(key);
  const publication=await tx.get(operationKey(i));
  const credit=await tx.get(creditKey(i));
  if(ticket?.status!=="issued"||ticket.token!==token||
    ticket.issuedAt>at||ticket.expiresAt<at||
    !verifyAccountCallback(ticket.identity,i)||
    ticket.proxyVersion!==input.proxyVersion||
    ticket.siteVersion!==input.siteVersion||
    publication?.status!=="attempted"||publication.attempted!==true||
    !verifyAccountCallback(publication.identity,i)||
    publication.independentAuthorConfirmed!==true||
    (i.kind==="review"&&publication.moderatorApproved!==true)||
    publication.proxyVersion!==ticket.proxyVersion||
    publication.siteVersion!==ticket.siteVersion||
    credit?.status!=="reserved"||credit.userId!==i.userId||
    credit.accountId!==i.accountId||credit.profileId!==i.profileId||
    credit.kind!==i.kind||credit.nonce!==i.nonce)
    throw Error("Callback ticket expired, consumed or mismatched");
  // Consume BEFORE any external evidence/ledger call. A partial result must
  // be reconciled by an administrator, never retried with the same ticket.
  await tx.put(key,{...ticket,status:"consumed",consumedAt:at});
 });
 return Object.freeze({...evidence,ticketConsumed:true});
}
export async function secondaryCallbackTicketStatus(storage,identity){
 const i=identityOf(identity),ticket=await storage.get(ticketKey(i));
 return {accountId:i.accountId,status:ticket?.status||"not_issued",
  expiresAt:ticket?.expiresAt||null};
}

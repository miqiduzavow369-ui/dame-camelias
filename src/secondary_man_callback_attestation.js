// Cryptographic verification contract for future secondary-man Chromium callbacks.
// Nothing here launches site publication, opens an HTTP endpoint, or authorizes a
// draft to publish. Verification is required before touching evidence/credits.
import {createAccountOperation,verifyAccountCallback,manStorageKey} from "./man_account_isolation.js";

const HEX=/^[a-f0-9]{64}$/i;
const REFERENCE=/^[A-Za-z0-9_-]{6,300}$/;
const MAX_AGE=8*60*1000;
const encoder=new TextEncoder();
function reject(){throw Error("Secondary callback attestation invalid");}
function validated(input){
 const identity=createAccountOperation(input?.identity);
 if(identity.accountId==="yan_first")reject();
 if(!Number.isSafeInteger(input?.proxyVersion)||input.proxyVersion<1||
    !Number.isSafeInteger(input?.siteVersion)||input.siteVersion<1||
    !Number.isSafeInteger(input?.issuedAt)||input.issuedAt<0||
    !REFERENCE.test(input?.sitePublicationId||"")||
    !REFERENCE.test(input?.proofFileId||"")||
    input?.status!=="verified_published")reject();
 return {identity,proxyVersion:input.proxyVersion,siteVersion:input.siteVersion,
  issuedAt:input.issuedAt,status:input.status,
  sitePublicationId:input.sitePublicationId,proofFileId:input.proofFileId};
}
function canonical(input){
 const x=validated(input),i=x.identity;
 // No JSON property-order dependence. Each value is constrained and no colon is
 // allowed in identifiers, so the representation is stable and unambiguous.
 return ["secondary-result-v1",i.userId,i.accountId,i.profileId,i.kind,i.nonce,
  x.proxyVersion,x.siteVersion,x.issuedAt,x.status,x.sitePublicationId,x.proofFileId].join(":");
}
async function sign(secret,input){
 if(typeof secret!=="string"||!HEX.test(secret))reject();
 const key=await crypto.subtle.importKey("raw",
  Uint8Array.from(secret.match(/../g).map(x=>parseInt(x,16))),
  {name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const signed=await crypto.subtle.sign("HMAC",key,encoder.encode(canonical(input)));
 return [...new Uint8Array(signed)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
// ONLY the authenticated runner may sign, using its own short-lived secret.
// Never export the secret through a signed client Mini App endpoint.
export async function signSecondaryResultAttestation(secret,input){
 return sign(secret,input);
}
export async function verifySecondaryResultAttestation(storage,{
 secret,input,signature,at
}){
 if(typeof signature!=="string"||!HEX.test(signature)||
    !Number.isSafeInteger(at))reject();
 const x=validated(input),i=x.identity;
 if(x.issuedAt>at+30000||at-x.issuedAt>MAX_AGE)reject();
 const actual=await sign(secret,x);
 const a=Uint8Array.from(actual.match(/../g).map(h=>parseInt(h,16)));
 const b=Uint8Array.from(signature.match(/../g).map(h=>parseInt(h,16)));
 // Constant-work comparison without early exit on the first mismatched byte.
 let mismatch=0;
 for(let k=0;k<a.length;k++)mismatch|=a[k]^b[k];
 if(mismatch!==0)reject();
 const key=manStorageKey({userId:i.userId,accountId:i.accountId,
  profileId:i.profileId,scope:"publication"})+":"+i.kind;
 const operation=await storage.get(key);
 if(!operation||operation.status!=="attempted"||operation.attempted!==true||
    !verifyAccountCallback(operation.identity,i)||
    operation.proxyVersion!==x.proxyVersion||
    operation.siteVersion!==x.siteVersion)reject();
 return Object.freeze({identity:i,sitePublicationId:x.sitePublicationId,
  proofFileId:x.proofFileId,verifiedByTrustedExecutor:true,at});
}

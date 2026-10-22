import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {createAccountOperation,manStorageKey} from "../src/man_account_isolation.js";
import {claimSecondaryReviewRunnerPayload,recordSecondaryReviewSubmitBoundary} from "../src/secondary_man_review_runner_grant.js";
import {approveSecondaryReviewForSubmission,launchApprovedSecondaryReview} from "../src/secondary_man_review_launch.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const userId="123456789",accountId="yan_second",profileId="690230";
const i={userId,accountId,profileId,kind:"review",nonce:"abcdef123456"};
const key=scope=>manStorageKey({...i,scope});
const TOK="a".repeat(32),PROXY_KEY="bb".repeat(32),SITE_KEY="cc".repeat(32);
const TEXT="Это подтвержденный индивидуальный текст настоящего отзыва.";
function store(){
 const rows=new Map(),tx={get:async k=>rows.get(k),put:async(k,v)=>{rows.set(k,v);},
 transaction:async fn=>fn(tx)};return {rows,tx};
}
async function encrypt(secret,value,aad){
 const iv=webcrypto.getRandomValues(new Uint8Array(12));
 const key=await webcrypto.subtle.importKey("raw",
  Uint8Array.from(secret.match(/../g),h=>parseInt(h,16)),
  {name:"AES-GCM"},false,["encrypt"]);
 const sealed=await webcrypto.subtle.encrypt({name:"AES-GCM",iv,
  additionalData:new TextEncoder().encode(aad)},key,new TextEncoder().encode(JSON.stringify(value)));
 return {iv:[...iv],sealed:[...new Uint8Array(sealed)]};
}
async function seed(tx){
 const digest=Array.from(new Uint8Array(await webcrypto.subtle.digest("SHA-256",
  new TextEncoder().encode(TEXT))),v=>v.toString(16).padStart(2,"0")).join("");
 await tx.put(key("review-draft")+":review",{...i,text:TEXT,kind:"review",authorAttested:true,version:1});
 await tx.put("man-owner-approval-v1:"+accountId,{accountId,approved:true,version:1,proxyVersion:2,siteVersion:3});
 await tx.put("secondary-site-identity-v1:"+accountId,{
  accountId,siteAccountId:"author@example.test",proxyVersion:2,siteVersion:3});
 await tx.put("man-proxy-sealed-v1:"+accountId,{
  accountId,version:2,proxyVerified:true,ipVerified:true,expectedIp:"8.8.8.8",
  ...await encrypt(PROXY_KEY,{protocol:"http",host:"proxy.example.test",port:8080,
   expectedIp:"8.8.8.8",username:"a",password:"b"},accountId)});
 await tx.put("man-intimcity-sealed-v1:"+accountId,{
  accountId,version:3,boundProxyVersion:2,siteUrl:"https://b.intimcity.rip/",
  ...await encrypt(SITE_KEY,{siteUrl:"https://b.intimcity.rip/",
   login:"author@example.test",password:"site-secret"},accountId+":intimcity:2")});
 await tx.put(key("operation")+":review:"+i.nonce+":ledger",{
  ...i,status:"reserved",ledgerNonce:"987654321abc"});
 await tx.put(key("publication")+":review",{identity:createAccountOperation(i),
  status:"attempted",attempted:true,proxyVersion:2,siteVersion:3,
  independentAuthorConfirmed:true,moderatorApproved:true});
 await tx.put(key("callback")+":review:"+i.nonce,{identity:createAccountOperation(i),
  status:"issued",token:TOK,proxyVersion:2,siteVersion:3,issuedAt:1000,expiresAt:100000});
 return digest;
}
const env={MAN_PROXY_ENCRYPTION_KEY:PROXY_KEY,MAN_SITE_ENCRYPTION_KEY:SITE_KEY,SECONDARY_CALLBACK_HMAC_KEY:"cd".repeat(32)};
test("one-use review payload binds exact man, text, site and proxy; boundary is irreversible",async()=>{
 const {tx}=store(),digest=await seed(tx);
 const grant=await claimSecondaryReviewRunnerPayload(tx,env,{identity:i,token:TOK,at:2000});
 assert.equal(grant.accountId,"yan_second");
 assert.equal(grant.approvedTextSha256,digest);
 assert.equal(grant.approvedText,TEXT);
 assert.equal(grant.verifiedSiteLogin,"author@example.test");
 await assert.rejects(()=>claimSecondaryReviewRunnerPayload(tx,env,{identity:i,token:TOK,at:2001}),/preflight/);
 assert.equal((await recordSecondaryReviewSubmitBoundary(tx,{
  identity:i,token:TOK,approvedTextSha256:digest,at:2002
 })).stage,"review_submit_boundary");
 await assert.rejects(()=>recordSecondaryReviewSubmitBoundary(tx,{
  identity:i,token:TOK,approvedTextSha256:digest,at:2003
 }),/already used/);
});
test("invalid secondary review credentials and cross-man grants are denied",async()=>{
 const {tx}=store();
 await seed(tx);
 await assert.rejects(()=>claimSecondaryReviewRunnerPayload(tx,env,{
  identity:{...i,accountId:"yan_first"},token:TOK,at:2000}),/invalid/);
 await assert.rejects(()=>claimSecondaryReviewRunnerPayload(tx,env,{
  identity:i,token:"b".repeat(32),at:2000}),/preflight/);
});
test("admin approves only exact draft; duplicate approval cannot bypass changed text",async()=>{
 const {tx}=store(),digest=await seed(tx);
 const pub=key("publication")+":review";
 await tx.put(pub,null);
 await assert.rejects(()=>approveSecondaryReviewForSubmission(tx,{
  identity:i,draftVersion:1,expectedTextSha256:"0".repeat(64),
  moderatorApproved:true,at:2000
 }),/changed/);
 const approved=await approveSecondaryReviewForSubmission(tx,{
  identity:i,draftVersion:1,expectedTextSha256:digest,
  moderatorApproved:true,at:2000});
 assert.equal(approved.moderated,true);
});


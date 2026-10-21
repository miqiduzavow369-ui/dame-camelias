import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {webcrypto,createHash} from "node:crypto";
import {createAccountOperation,manStorageKey} from "../src/man_account_isolation.js";
import {issueSecondaryCallbackTicket} from "../src/secondary_man_callback_ticket.js";
import {recordTicketedSecondaryResult,secondaryVerifiedResultStatus} from "../src/secondary_man_result_settlement.js";
import {signSecondaryResultAttestation} from "../src/secondary_man_callback_attestation.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const jpegBuffer=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(100),Buffer.from([255,217])]);
const proofId="jpeg_"+createHash("sha256").update(jpegBuffer).digest("hex").slice(0,40);
function proofStorage(){
 const rows=new Map();
 return {get:async key=>rows.get(key)||null,put:async (key,value)=>{rows.set(key,value);},rows};
}

function tx(){const entries=new Map();const storage={get:async k=>entries.get(k),put:async(k,v)=>entries.set(k,v),transaction:async fn=>fn(storage)};return {storage,entries};}
const identity={userId:"123456789",accountId:"yan_second",profileId:"2468",kind:"review",nonce:"abcdef123456"};
const signed={identity,proxyVersion:1,siteVersion:2,issuedAt:1000000,status:"verified_published",
 sitePublicationId:"site-confirmed-2345",proofFileId:proofId};
const secret="ab".repeat(32);
test("signed result endpoint is gated by bearer auth, HMAC, stored author and moderation, and per-client isolation",()=>{
 const worker=fs.readFileSync("src/index.js","utf8");
 const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
 assert.ok(worker.includes('url.pathname === "/api/secondary-man/result"'));
 assert.ok(worker.includes('cabinetEndpoint(request,env,"secondary_man_signed_result")'));
 const start=runtime.indexOf('if(event.kind==="secondary_man_signed_result")');
 const stop=runtime.indexOf('if(event.kind==="secondary_profile_probe_payload"',start);
 assert.ok(start>0&&stop>start);
 const block=runtime.slice(start,stop);
 assert.match(block,/SECONDARY_CALLBACK_HMAC_KEY/);
 assert.match(block,/identity\.userId!==uid/);
 assert.match(block,/publication\?\.independentAuthorConfirmed!==true/);
 assert.match(block,/publication\?\.moderatorApproved!==true/);
 assert.match(block,/recordTicketedSecondaryResult\(storage/);
 assert.ok(!block.includes("body.moderatorApproved")&&!block.includes("body.independentAuthorConfirmed"));
 assert.ok(block.includes('if(result?.status==="proof_saved"&&identity.kind==="review")'));
 assert.ok(block.includes("settleSecondaryVerifiedResult(storage,rawEnv"));
 const auth=runtime.slice(runtime.indexOf('export async function cabinetEndpoint'),runtime.indexOf('async function telegram'));
 assert.ok(auth.includes('env.ANKETA_CALLBACK_TOKEN'));
 assert.ok(auth.includes('"Bearer "+env.ANKETA_CALLBACK_TOKEN'));
});
test("signed callback proof cannot be replayed or redirected to another user",async()=>{
 const {storage,entries}=tx();
 const key=manStorageKey({...identity,scope:"publication"})+":"+identity.kind;
 await storage.put(key,{identity:createAccountOperation(identity),status:"attempted",attempted:true,
  proxyVersion:1,siteVersion:2,independentAuthorConfirmed:true,moderatorApproved:true});
 await storage.put(manStorageKey({...identity,scope:"operation"})+":"+identity.kind+":"+identity.nonce+":ledger",
  {userId:identity.userId,accountId:identity.accountId,profileId:identity.profileId,
   kind:identity.kind,nonce:identity.nonce,status:"reserved"});
 const ticket=await issueSecondaryCallbackTicket(storage,{identity,proxyVersion:1,siteVersion:2,at:1000000});
 const signature=await signSecondaryResultAttestation(secret,signed);
 const opts={identity,token:ticket.token,secret,input:signed,signature,at:1000001,
  independentAuthorConfirmed:true,moderatorApproved:true,
  proofKv:proofStorage(),originalJpegBase64:jpegBuffer.toString("base64")};
 assert.equal((await recordTicketedSecondaryResult(storage,opts)).status,"proof_saved");
 assert.equal((await secondaryVerifiedResultStatus(storage,identity)).proofPresent,true);
 await assert.rejects(()=>recordTicketedSecondaryResult(storage,opts),/consumed/);
 assert.equal([...entries.values()].filter(v=>v.status==="proof_saved").length,1);
});

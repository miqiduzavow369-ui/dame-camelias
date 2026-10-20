import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {secondaryDraftAction} from "../src/secondary_man_client_draft.js";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
function storage(){
 const rows=new Map();
 const tx={get:async k=>rows.get(k),put:async(k,v)=>{rows.set(k,v)},transaction:async f=>f(tx)};
 return {rows,tx};
}
function params(accountId,kind="review",userId="123456789"){
 return {accountId,profileId:"2468",userId,kind,action:"save",
  text:"I personally experienced the service and am describing it here.",
  ratings:[5,4,5,4],profileOwned:true,authorAttested:true};
}
test("all 29 men keep independent review and rating drafts for the same client and profile",async()=>{
 const {tx,rows}=storage();
 for(const man of MAN_ACCOUNTS.slice(1)){
  for(const kind of ["rating","review"]){
   const p=params(man.id,kind);
   const saved=await secondaryDraftAction(tx,p);
   assert.equal(saved.saved,true);
   assert.equal(saved.publicationAvailable,false);
   const read=await secondaryDraftAction(tx,{...p,action:"status"});
   assert.equal(read.version,1);
   assert.equal((await secondaryDraftAction(tx,p)).version,2);
  }
 }
 assert.equal(rows.size,58);
 const other=params("yan_second","review","987654321");
 assert.equal((await secondaryDraftAction(tx,{...other,action:"status"})).saved,false);
 await assert.rejects(()=>secondaryDraftAction(tx,params("yan_first")),/Legacy route/);
});
test("signed client drafts require owned profile and author's attestation",async()=>{
 for(const patch of [{profileOwned:false},{authorAttested:false},
  {text:""}, {ratings:[0,5],kind:"rating"}]){
  await assert.rejects(()=>secondaryDraftAction(storage().tx,{...params("yan_second"),...patch}),/required|Invalid/);
 }
 const {tx,rows}=storage();
 const p=params("yan_second");
 await secondaryDraftAction(tx,p);
 rows.set("man-account-v1:123456789:yan_second:publication:2468:review",{status:"attempted"});
 await assert.rejects(()=>secondaryDraftAction(tx,p),/already reserved or attempted/);
});
test("new route uses signed Telegram initData, checks saved profile and never publishes",()=>{
 const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
 const entry=fs.readFileSync("src/index.js","utf8");
 assert.match(runtime,/event.kind==="mini_secondary_draft"/);
 assert.match(runtime,/owner_anketa_library:/);
 assert.match(runtime,/profileOwned,authorAttested/);
 assert.match(entry,/\/api\/anketa\/mini-secondary-draft/);
 const endpoint=entry.slice(entry.indexOf('url.pathname==="/api/anketa/mini-secondary-draft"'),entry.indexOf('url.pathname==="/api/anketa/mini-rating-action"'));
 assert.match(endpoint,/validWebApp\(body\?\.initData,env\.BOT_TOKEN,3600\)/);
 assert.doesNotMatch(endpoint,/engine\.miniReviewAction|engine\.miniRatingAction|credits\(/);
});

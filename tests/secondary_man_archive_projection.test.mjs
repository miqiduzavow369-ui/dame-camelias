import test from "node:test";
import assert from "node:assert/strict";
import {readPublicationArchive} from "../src/publication_archive.js";
const uid="123456789",other="987654321";
function source(){
 const entries=new Map();
 const storage={get:async k=>entries.get(k),list:async({prefix,startAfter,limit})=>new Map(
  [...entries].filter(([k])=>k.startsWith(prefix)&&(!startAfter||k>startAfter)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit)
 )};
 const kv={list:async()=>({keys:[],list_complete:true}),get:async()=>null};
 return {entries,storage,kv};
}
function write(entries,{userId=uid,man="yan_second",profile="2468",kind="review",nonce="abcdef123456",status="completed",creditStatus="completed",file="original-proof-123"}={}){
 const key=["man-account-v1",userId,man,"proof",profile,kind,nonce,"settlement"].join(":");
 entries.set(key,{
  identity:{userId,accountId:man,profileId:profile,kind,nonce,version:1},
  status,ledgerStatus:creditStatus,at:Date.parse("2026-10-20T04:00:00Z"),proofFileId:file
 });
}
test("secondary archive shows only ledger-completed, proven publications for the owning client",async()=>{
 const s=source();
 write(s.entries,{});
 write(s.entries,{man:"yan_03",profile:"2468",kind:"rating",file:"other-man-original"});
 write(s.entries,{man:"yan_04",profile:"9999",status:"proof_saved"});
 write(s.entries,{man:"yan_05",profile:"9999",creditStatus:"requires_reconciliation"});
 write(s.entries,{userId:other,man:"yan_second",file:"private-foreign-file"});
 const result=await readPublicationArchive(s.storage,s.kv,uid);
 assert.equal(result.items.length,2);
 assert.deepEqual(new Set(result.items.map(x=>x.account)),new Set(["yan_second","yan_03"]));
 assert.equal(result.items[0].fileId!==null,true);
 assert.equal(result.items[1].fileId!==null,true);
 assert.ok(!JSON.stringify(result).includes("private-foreign-file"));
 assert.ok(!JSON.stringify(result).includes("yan_04"));
});
test("falsified receipt identity, invalid screenshot ID and unconfirmed settlement are excluded",async()=>{
 const s=source();
 write(s.entries,{man:"yan_second",file:"https://invalid.example"});
 write(s.entries,{man:"yan_03",status:"uncertain"});
 write(s.entries,{man:"yan_04",creditStatus:"pending"});
 write(s.entries,{man:"yan_05",profile:"333333",file:"valid-photo"});
 const forged="man-account-v1:"+uid+":yan_05:proof:333333:review:abcdef123456:settlement";
 s.entries.get(forged).identity.accountId="yan_03";
 assert.deepEqual((await readPublicationArchive(s.storage,s.kv,uid)).items.map(x=>x.account),["yan_second"]);
 assert.equal((await readPublicationArchive(s.storage,s.kv,uid)).items[0].fileId,null);
});

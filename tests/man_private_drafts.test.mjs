import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {validatePrivateDraft,privateDraftStatus,savePrivateDraft,importPrivateDrafts} from "../src/man_private_drafts.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const env={MAN_PROXY_ENCRYPTION_KEY:"ab".repeat(32)};
function storage(){
 const m=new Map();
 const api={get:async k=>m.get(k),put:async(k,v)=>{m.set(k,v)},
  transaction:async(fn)=>fn(api)};
 return {api,m};
}
const ident=(accountId="yan_second")=>({actorId:"12345",cabinetId:"12345",ownerId:"12345",accountId});
const settings={technicalName:"member@example.com",siteLogin:"login@example.com",host:"45.39.104.69",httpPort:6408,socksPort:16408,username:"myuser"};
test("safe drafts reject passwords and legacy proxy modifications",()=>{
 assert.deepEqual(validatePrivateDraft("yan_first",{technicalName:"legacy@example.com"}),{technicalName:"legacy@example.com"});
 assert.throws(()=>validatePrivateDraft("yan_first",settings),/Unexpected private draft field/);
 assert.throws(()=>validatePrivateDraft("yan_second",{...settings,password:"forbidden"}),/Unexpected private draft field/);
 assert.throws(()=>validatePrivateDraft("yan_second",{...settings,siteLogin:"invalid"}),/Invalid proxy draft/);
 assert.throws(()=>validatePrivateDraft("yan_second",{...settings,host:"127.0.0.1"}),/Invalid proxy/);
});
test("encrypted owner-only drafts and update revisions",async()=>{
 const {api,m}=storage(),ctx=ident();
 await assert.rejects(privateDraftStatus(api,env,{...ctx,actorId:"wrong"}),/Forbidden/);
 const created=await savePrivateDraft(api,env,{...ctx,expectedVersion:0,settings,at:1});
 assert.equal(created.canPublish,false);
 assert.equal(created.version,1);
 assert.equal(JSON.stringify([...m.values()]).includes("member@example.com"),false);
 assert.equal(JSON.stringify([...m.values()]).includes("45.39.104.69"),false);
 assert.equal(JSON.stringify([...m.values()]).includes("login@example.com"),false);
 const read=await privateDraftStatus(api,env,ctx);
 assert.deepEqual(read.settings,settings);
 await assert.rejects(savePrivateDraft(api,env,{...ctx,expectedVersion:0,settings,at:2}),/Version conflict/);
});
test("atomic 30 drafts refuse partial and repeated imports",async()=>{
 const {api,m}=storage();
 const rows=Array.from({length:30},(_,i)=>({
  accountId:i===0?"yan_first":i===1?"yan_second":"yan_"+String(i+1).padStart(2,"0"),
  settings:i===0?{technicalName:"legacy@example.com"}:{...settings,technicalName:"u"+i+"@example.com"}
 }));
 const ctx=ident();
 const added=await importPrivateDrafts(api,env,{...ctx,rows,at:2});
 assert.equal(added.imported,30);
 assert.equal(m.size,30);
 await assert.rejects(importPrivateDrafts(api,env,{...ctx,rows,at:3}),/Draft already exists/);
 const bad=rows.map((x,i)=>i===4?{...x,settings:{...settings,host:"127.0.0.1"}}:x);
 await assert.rejects(importPrivateDrafts(api,env,{...ctx,rows:bad,at:3}),/Invalid proxy/);
});

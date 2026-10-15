import test from "node:test";
import assert from "node:assert/strict";
import {handleLedgerBackup, readLedgerBackup, EXPORT_UNTIL} from "../src/admin_ledger_backup.js";
import {OrderReminder} from "../src/reminders.js";
const env={ANKETA_CALLBACK_TOKEN:"test-only"};
const now=EXPORT_UNTIL-1000;
const req=(suffix="",method="GET",token="test-only")=>new Request("https://test.workers.dev/api/admin/ledger-backup"+suffix,{method,headers:{Authorization:"Bearer "+token}});
test("unauthorized, expired, mutating and query requests never access objects",async()=>{
 const e={...env,ORDER_REMINDERS:{idFromName(){throw Error("must not access DO");}}};
 for(const [r,t,status] of [[req("","GET","bad"),now,403],[req(),EXPORT_UNTIL,410],[req("","POST"),now,405],[req("?name=other"),now,400]])
   assert.equal((await handleLedgerBackup(r,e,t)).status,status);
});
test("exports exact existing owner record, including history and reservations, using get only",async()=>{
 const ledger={grant:10,spent:3,claims:{"rating:123":{nonce:"abcdef123456",status:"reserved"}},history:[{key:"review:456",at:123}]};
 const storage=new Proxy({get:async key=>{assert.equal(key,"credits_v1");return ledger;}},{get(target,key){if(!(key in target))throw Error("unexpected storage access: "+String(key));return target[key];}});
 const response=await readLedgerBackup(req(),env,storage,now);
 assert.equal(response.status,200);assert.equal(response.headers.get("Cache-Control"),"no-store");
 const result=await response.json();assert.deepEqual(result.value,ledger);assert.equal(result.userId,"5866034656");
 assert.deepEqual(ledger.claims["rating:123"],{nonce:"abcdef123456",status:"reserved"});
 assert.equal((await readLedgerBackup(req(),env,{get:async()=>undefined},now)).status,404);
});
test("outer handler fixes object identity, forwards auth and never accepts an alternate target",async()=>{
 const e={...env,ORDER_REMINDERS:{idFromName(name){assert.equal(name,"publication-credits:5866034656");return name;},get(){return {fetch:async(url,options)=>{
 assert.equal(url,"https://reminder.internal/__admin/ledger-backup");assert.equal(options.method,"GET");assert.equal(options.headers.Authorization,"Bearer test-only");
 return Response.json({ok:true});}};}}};
 assert.deepEqual(await (await handleLedgerBackup(req(),e,now)).json(),{ok:true});
});
test("real DO export route bypasses legacy JSON parser and ledger seeding",async()=>{
 let reads=0;
 const object=new OrderReminder({blockConcurrencyWhile:fn=>fn(),storage:{get:async key=>{reads++;assert.equal(key,"credits_v1");return {grant:10,spent:1,claims:{},history:[]};}}},env);
 const response=await object.fetch(new Request("https://reminder.internal/__admin/ledger-backup",{headers:{Authorization:"Bearer test-only"}}));
 // Route uses actual wall clock; after expiry it must fail closed without storage access.
 if(Date.now()>=EXPORT_UNTIL){assert.equal(response.status,410);assert.equal(reads,0);}
 else {assert.equal(response.status,200);assert.equal(reads,1);}
});

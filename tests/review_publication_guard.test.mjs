import test from "node:test";
import assert from "node:assert/strict";
import {OrderReminder} from "../src/reminders.js";
import {reviewGuard} from "../src/review_publication_guard.js";

test("review claim permanently blocks duplicate attempt and cannot be reset",async()=>{
  const values=new Map();
  const context={
    storage:{get:async k=>values.get(k),put:async(k,v)=>{values.set(k,v);}},
    blockConcurrencyWhile:fn=>fn()
  };
  const object=new OrderReminder(context,{});
  const ids=[];
  const env={ORDER_REMINDERS:{
    idFromName:n=>{ids.push(n);return n;},
    get:()=>({fetch:(url,options)=>object.fetch(new Request(url,options))})
  }};
  const a=await reviewGuard(env,"652282","review_claim","aaaaaaaaaaaaaaaa");
  assert.equal(a.claimed,true);
  const b=await reviewGuard(env,"652282","review_claim","bbbbbbbbbbbbbbbb");
  assert.equal(b.claimed,false);
  assert.equal(b.status,"submission_maybe_sent");
  const status=await reviewGuard(env,"652282","review_status");
  assert.equal(status.claimed,true);
  assert.ok(ids.every(x=>x==="review-publication:yan_first:652282"));
  await assert.rejects(reviewGuard(env,"../","review_status"),/unavailable/);
  const rejected=await object.fetch(new Request("https://reminder.internal/",{
    method:"POST",body:JSON.stringify({type:"review_verified",nonce:"bbbbbbbbbbbbbbbb"})
  }));
  assert.equal(rejected.status,409);
  const confirmed=await reviewGuard(env,"652282","review_verified","aaaaaaaaaaaaaaaa");
  assert.equal(confirmed.ok,true);
  const after=await reviewGuard(env,"652282","review_claim","cccccccccccccccc");
  assert.equal(after.claimed,false);
  assert.equal(after.status,"published");
});

test("preflight failures are distinguishable but cannot automatically unlock claim",async()=>{
 const m=new Map();
 const ctx={storage:{get:async k=>m.get(k),put:async(k,v)=>m.set(k,v)},blockConcurrencyWhile:fn=>fn()};
 const object=new OrderReminder(ctx,{});
 const env={ORDER_REMINDERS:{idFromName:n=>n,get:()=>({
   fetch:(url,opts)=>object.fetch(new Request(url,opts))})}};
 const nonce="1111111111111111";
 assert.equal((await reviewGuard(env,"652282","review_claim",nonce)).claimed,true);
 assert.equal((await reviewGuard(env,"652282","review_preflight_failed",nonce)).ok,true);
 assert.equal((await reviewGuard(env,"652282","review_status")).status,"preflight_failed");
 assert.equal((await reviewGuard(env,"652282","review_claim","2222222222222222")).claimed,false);
});
test("submit boundary prevents reclassification as safe preflight failure",async()=>{
 const m=new Map();
 const ctx={storage:{get:async k=>m.get(k),put:async(k,v)=>m.set(k,v)},blockConcurrencyWhile:fn=>fn()};
 const object=new OrderReminder(ctx,{});
 const env={ORDER_REMINDERS:{idFromName:n=>n,get:()=>({
   fetch:(url,opts)=>object.fetch(new Request(url,opts))})}};
 const nonce="1111111111111111";
 await reviewGuard(env,"652282","review_claim",nonce);
 assert.equal((await reviewGuard(env,"652282","review_submit_boundary",nonce)).ok,true);
 await assert.rejects(reviewGuard(env,"652282","review_preflight_failed",nonce));
 assert.equal((await reviewGuard(env,"652282","review_status")).status,"submission_started");
});

test("owner recovery accepts legacy maybe-sent only for specific profile",async()=>{
 const m=new Map();
 const ctx={storage:{get:async k=>m.get(k),put:async(k,v)=>m.set(k,v),
 delete:async k=>m.delete(k)},blockConcurrencyWhile:fn=>fn()};
 const obj=new OrderReminder(ctx,{});
 const env={ORDER_REMINDERS:{idFromName:n=>n,get:()=>({fetch:(u,o)=>obj.fetch(new Request(u,o))})}};
 const old="cccccccccccccccc",newNonce="dddddddddddddddd";
 assert.equal((await reviewGuard(env,"652282","review_claim",old)).claimed,true);
 await assert.rejects(reviewGuard(env,"652283","review_recover_652282",old));

 const r=await reviewGuard(env,"652282","review_recover_652282",old);
 assert.equal(r.ok,true);
 assert.equal((await reviewGuard(env,"652282","review_status")).claimed,false);
 assert.equal((await reviewGuard(env,"652282","review_claim",newNonce)).claimed,true);
 await assert.rejects(reviewGuard(env,"652282","review_recover_652282",newNonce));
});
test("manual recovery allowed after submit boundary but not while workflow active",async()=>{
 const m=new Map();
 const ctx={storage:{get:async k=>m.get(k),put:async(k,v)=>m.set(k,v),
 delete:async k=>m.delete(k)},blockConcurrencyWhile:fn=>fn()};
 const obj=new OrderReminder(ctx,{});
 const env={ORDER_REMINDERS:{idFromName:n=>n,get:()=>({fetch:(u,o)=>obj.fetch(new Request(u,o))})}};
 const nonce="eeeeeeeeeeeeeeee";
 await reviewGuard(env,"652282","review_claim",nonce);
 await reviewGuard(env,"652282","review_submit_boundary",nonce);
 assert.equal((await reviewGuard(env,"652282","review_recover_652282",nonce)).ok,true);
 assert.equal((await reviewGuard(env,"652282","review_status")).status,"available");
});

test("confirmed preflight failure allows manual repeated recovery after each failure",async()=>{
 const m=new Map();
 const ctx={storage:{get:async k=>m.get(k),put:async(k,v)=>m.set(k,v),
 delete:async k=>m.delete(k)},blockConcurrencyWhile:fn=>fn()};
 const obj=new OrderReminder(ctx,{});
 const env={ORDER_REMINDERS:{idFromName:n=>n,get:()=>({fetch:(u,o)=>obj.fetch(new Request(u,o))})}};
 const old="abababababababab",next="cdcdcdcdcdcdcdcd";
 await reviewGuard(env,"652282","review_claim",old);
 await reviewGuard(env,"652282","review_preflight_failed",old);
 assert.equal((await reviewGuard(env,"652282","review_status")).status,"preflight_failed");
 assert.equal((await reviewGuard(env,"652282","review_recover_652282",old)).ok,true);
 assert.equal((await reviewGuard(env,"652282","review_claim",next)).claimed,true);
 await reviewGuard(env,"652282","review_preflight_failed",next);
 assert.equal((await reviewGuard(env,"652282","review_recover_652282",next)).ok,true);
 assert.equal((await reviewGuard(env,"652282","review_status")).status,"available");
});

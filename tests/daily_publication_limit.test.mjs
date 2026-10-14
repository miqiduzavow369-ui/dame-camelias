import test from "node:test";
import assert from "node:assert/strict";
import {OrderReminder} from "../src/reminders.js";
import {dailyLimit,moscowDay} from "../src/daily_publication_limit.js";
function setup(){
  const objects=new Map();
  return {ORDER_REMINDERS:{
    idFromName:name=>name,
    get:name=>{
      if(!objects.has(name)){
        const values=new Map();
        objects.set(name,new OrderReminder({storage:{
          get:async key=>values.get(key),put:async(key,val)=>values.set(key,val)
        },blockConcurrencyWhile:fn=>fn()},{}));
      }
      return {fetch:(url,opt)=>objects.get(name).fetch(new Request(url,opt))};
    }
  }};
}
test("two publication slots per profile shared across user IDs",async()=>{
  const env=setup(),date="2026-10-14";
  assert.equal((await dailyLimit(env,"5866034656","790188","status","","",date)).remaining,2);
  assert.equal((await dailyLimit(env,"5866034656","790188","reserve","rating","aaaaaaaaaaaa",date)).ok,true);
  assert.equal((await dailyLimit(env,"123456789","790188","reserve","review","bbbbbbbbbbbb",date)).ok,true);
  assert.equal((await dailyLimit(env,"987654321","790188","reserve","rating","cccccccccccc",date)).reason,"limit_reached");
  assert.equal((await dailyLimit(env,"5866034656","790188","status","","",date)).remaining,0);
  await dailyLimit(env,"5866034656","790188","complete","rating","aaaaaaaaaaaa",date);
  await dailyLimit(env,"5866034656","790188","complete","rating","aaaaaaaaaaaa",date);
  assert.equal((await dailyLimit(env,"5866034656","790188","status","","",date)).remaining,0);
  assert.equal((await dailyLimit(env,"5866034656","790188","status","","","2026-10-15")).remaining,2);
  assert.equal((await dailyLimit(env,"5866034656","790189","status","","",date)).remaining,2);
});
test("reservation can be released safely before submission",async()=>{
 const env=setup(),date="2026-10-14";
 await dailyLimit(env,"5866034656","790188","reserve","rating","aaaaaaaaaaaa",date);
 const released=await dailyLimit(env,"5866034656","790188","release","rating","aaaaaaaaaaaa",date);
 assert.equal(released.remaining,2);
});
test("Moscow midnight creates the next date",()=>{
 assert.equal(moscowDay(new Date("2026-10-14T20:59:59Z")),"2026-10-14");
 assert.equal(moscowDay(new Date("2026-10-14T21:00:00Z")),"2026-10-15");
});

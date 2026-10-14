import test from "node:test";
import assert from "node:assert/strict";
import {OrderReminder} from "../src/reminders.js";
import {credits} from "../src/publication_credits.js";
import {renderCreditsBanner} from "../src/credits_banner.js";

function setup(){
  const objects=new Map();
  const names=[];
  const env={ORDER_REMINDERS:{
    idFromName:name=>{names.push(name);return name;},
    get:name=>{
      if(!objects.has(name)){
        const values=new Map();
        const context={storage:{get:async key=>values.get(key),
          put:async(key,val)=>{values.set(key,val);}},
          blockConcurrencyWhile:fn=>fn()};
        objects.set(name,new OrderReminder(context,{}));
      }
      return {fetch:(url,opt)=>objects.get(name).fetch(new Request(url,opt))};
    }
  }};
  return {env,names};
}
test("credits start at ten for owner, reserve, settle only once",async()=>{
  const {env}=setup(),uid="5866034656";
  let balance=await credits(env,uid,"status");
  assert.equal(balance.available,10);
  const first=await credits(env,uid,"reserve","rating","802453","aaaaaaaaaaaa");
  assert.equal(first.ok,true);
  balance=await credits(env,uid,"status");
  assert.equal(balance.remaining,10);
  assert.equal(balance.available,9);
  const duplicate=await credits(env,uid,"reserve","rating","802453","bbbbbbbbbbbb");
  assert.equal(duplicate.ok,false);
  const complete=await credits(env,uid,"complete","rating","802453","aaaaaaaaaaaa");
  assert.equal(complete.remaining,9);
  const again=await credits(env,uid,"complete","rating","802453","aaaaaaaaaaaa");
  assert.equal(again.already,true);
  assert.equal((await credits(env,uid,"status")).spent,1);
});
test("balances are separate for different Telegram IDs",async()=>{
  const {env,names}=setup();
  assert.equal((await credits(env,"5866034656","status")).remaining,10);
  assert.equal((await credits(env,"123456789","status")).remaining,0);
  assert.ok(names.includes("publication-credits:5866034656"));
  assert.ok(names.includes("publication-credits:123456789"));
});
test("banner renders a valid PNG",async()=>{
  const png=await renderCreditsBanner("5866034656",10);
  assert.deepEqual([...png.slice(0,8)],[137,80,78,71,13,10,26,10]);
  assert.ok(png.length>1000);
});

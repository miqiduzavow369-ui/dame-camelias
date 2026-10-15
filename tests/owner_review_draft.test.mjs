import test from "node:test";
import assert from "node:assert/strict";
import {createCabinet,handleOwnerAnketa,ownerReviewPayload} from "../src/owner_anketa.js";

const OWNER=5866034656;
const PREFIX="owner_anketa_";
function setup(){
  const store=new Map();
  const actions=[];
  const env={VISITORS_KV:{
    get:async (key)=>store.has(key)?JSON.parse(store.get(key)):null,
    put:async (key,value)=>{store.set(key,value);},
    delete:async key=>{store.delete(key);}
  },ORDER_REMINDERS:{
    idFromName:name=>name,
    get:()=>({fetch:async()=>Response.json({ok:true,available:10,remaining:10,balance:10})})
  }};
  let next=100;
  // Tests model an owner who has already passed the cabinet PIN challenge.
  store.set("owner_cabinet_session:"+OWNER,JSON.stringify({authorized:true,telegramId:String(OWNER)}));
  const send=async (_env,method,payload)=>{
    actions.push({method,payload});
    return {message_id:next++};
  };
  const cb=data=>({callback_query:{id:"test",from:{id:OWNER},
    message:{message_id:5,chat:{id:OWNER,type:"private"}},data}});
  const msg=text=>({message:{message_id:7,from:{id:OWNER},chat:{id:OWNER,type:"private"},text}});
  store.set(PREFIX+"saved:"+OWNER+":771053",JSON.stringify({
    profile:{id:"771053",name:"Evelyn"},host:"b.intimcity.rip"
  }));
  store.set(PREFIX+"selected_account:"+OWNER,JSON.stringify({
    profileId:"771053",account:"yan_first",expiresAt:Date.now()+120000
  }));
  return {env,store,actions,send,cb,msg};
}
test("review text remains unchanged in preview and is not published",async()=>{
  const s=setup();
  await handleOwnerAnketa(s.cb("owner_anketa:savedreview:771053"),s.env,s.send);
  const entry=s.actions.filter(x=>x.method==="sendMessage" || x.method==="editMessageText").at(-1);
  assert.match(entry.payload.text,/НОВЫЙ ОТЗЫВ/);
  const original="Подтверждаю, что текст написан мной самостоятельно.";
  await handleOwnerAnketa(s.msg(original),s.env,s.send);
  const draft=JSON.parse(s.store.get("owner_anketa_state:"+OWNER));
  assert.equal(draft.step,"review_preview");
  assert.equal(draft.text,original);
  assert.match(s.actions.filter(x=>x.method==="sendMessage"||x.method==="editMessageText").at(-1).payload.text,/ПРОВЕРКА ОТЗЫВА/);
  assert.match(s.actions.filter(x=>x.method==="sendMessage"||x.method==="editMessageText").at(-1).payload.text,/Подтверждаю, что текст соответствует реальности и не ведет в заблуждение клиентов\./);
  assert.equal(s.actions.filter(x=>x.method==="sendPhoto").length,0);
});
test("review editing returns to text input without website submission",async()=>{
  const s=setup();
  await handleOwnerAnketa(s.cb("owner_anketa:savedreview:771053"),s.env,s.send);
  await handleOwnerAnketa(s.msg("Первоначальный вариант сообщения для проверки"),s.env,s.send);
  const draft=JSON.parse(s.store.get("owner_anketa_state:"+OWNER));
  await handleOwnerAnketa(s.cb("owner_anketa:reviewedit:"+draft.nonce),s.env,s.send);
  const updated=JSON.parse(s.store.get("owner_anketa_state:"+OWNER));
  assert.equal(updated.step,"review_input");
  assert.equal(updated.id,"771053");
});
test("owner's ordinary messages are untouched outside review input state",async()=>{
  const s=setup();
  assert.equal(await handleOwnerAnketa(s.msg("Обычный текст клиента"),s.env,s.send),false);
});

test("consent is explicit and editing clears it",async()=>{
 const s=setup();
 await handleOwnerAnketa(s.cb("owner_anketa:savedreview:771053"),s.env,s.send);
 await handleOwnerAnketa(s.msg("Это проверяемый текст настоящего отзыва"),s.env,s.send);
 const draft=JSON.parse(s.store.get("owner_anketa_state:"+OWNER));
 assert.equal(draft.step,"review_preview");
 assert.equal(draft.agreedAt,undefined);
 await handleOwnerAnketa(s.cb("owner_anketa:reviewagree:"+draft.nonce),s.env,s.send);
 const agreed=JSON.parse(s.store.get("owner_anketa_state:"+OWNER));
 assert.equal(agreed.step,"review_agreed");
 assert.ok(agreed.agreedAt>0);
 await handleOwnerAnketa(s.cb("owner_anketa:reviewedit:"+draft.nonce),s.env,s.send);
 const changed=JSON.parse(s.store.get("owner_anketa_state:"+OWNER));
 assert.equal(changed.step,"review_input");
 assert.equal(changed.agreedAt,null);
});

test("review publication requires consent, claims once and issues single private grant",async()=>{
  const s=setup();
  const oldFetch=globalThis.fetch;
  let dispatched=0;
  globalThis.fetch=async (_url,options)=>{
    dispatched++;
    assert.equal(options.method,"POST");
    return {status:204};
  };
  const claimed=new Map();
  s.env.DC_ACTIONS_TOKEN="testing-actions-token";
  s.env.ANKETA_CALLBACK_TOKEN="testing-callback-token";
  s.env.ORDER_REMINDERS={
    idFromName:name=>name,
    get:name=>({fetch:async(_url,options)=>{
      const data=JSON.parse(options.body);
      if(data.type==="review_claim"){
        if(claimed.has(name))return Response.json({claimed:false,status:"submission_maybe_sent"});
        claimed.set(name,true);
        return Response.json({claimed:true,status:"submission_maybe_sent"});
      }
      if(data.type==="credits_status")return Response.json({ok:true,available:10,remaining:10});
      if(data.type==="daily_status")return Response.json({ok:true,remaining:2});
      if(data.type==="daily_reserve"||data.type==="credits_reserve")return Response.json({ok:true});
      if(data.type==="review_status")return Response.json({
        claimed:claimed.has(name),status:claimed.has(name)?"submission_maybe_sent":"available"});
      return Response.json({ok:true});
    }})
  };
  try{
    await handleOwnerAnketa(s.cb("owner_anketa:savedreview:771053"),s.env,s.send);
    const original="Реальный текст автора об этой встрече и качестве общения.";
    await handleOwnerAnketa(s.msg(original),s.env,s.send);
    const initial=JSON.parse(s.store.get("owner_anketa_state:"+OWNER));
    await handleOwnerAnketa(s.cb("owner_anketa:reviewfinal:"+initial.nonce),s.env,s.send);
    assert.equal(dispatched,0,"must not publish without explicit consent");
    await handleOwnerAnketa(s.cb("owner_anketa:reviewagree:"+initial.nonce),s.env,s.send);
    await handleOwnerAnketa(s.cb("owner_anketa:reviewfinal:"+initial.nonce),s.env,s.send);
    const waiting=JSON.parse(s.store.get("owner_anketa_state:"+OWNER));
    assert.equal(waiting.step,"review_moderation");assert.equal(dispatched,0);assert.equal(claimed.size,0);
    const engine=createCabinet(String(OWNER));
    assert.equal((await engine.moderateReview(s.env,s.send,{action:"approve",ticket:initial.nonce,text:original})).ok,true);
    const next=JSON.parse(s.store.get("owner_anketa_state:"+OWNER));
    assert.equal(next.step,"review_dispatch");
    assert.equal(dispatched,1);
    assert.equal(claimed.size,1);
    assert.ok(s.store.has("owner_anketa_review_pending_v1:yan_first:771053"));
    await handleOwnerAnketa(s.cb("owner_anketa:reviewfinal:"+initial.nonce),s.env,s.send);
    assert.equal(dispatched,1,"duplicate callback must never publish twice");
    const url="https://worker.example/api/anketa/review-payload?profile_id=771053&nonce="+
      next.nonce+"&mode=review_publish";
    const headers={Authorization:"Bearer testing-callback-token"};
    const granted=await ownerReviewPayload(new Request(url,{headers}),s.env);
    assert.equal(granted.status,200);
    assert.equal((await granted.json()).text,original);
    const repeated=await ownerReviewPayload(new Request(url,{headers}),s.env);
    assert.equal(repeated.status,409,"private grant cannot be re-issued");
  } finally {globalThis.fetch=oldFetch;}
});

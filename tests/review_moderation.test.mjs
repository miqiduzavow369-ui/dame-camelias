import test from "node:test";
import assert from "node:assert/strict";
import {moderationEvent,moderationAlarm,handleModeration,MODERATION_CHAT,MODERATOR_ID} from "../src/review_moderation.js";
const uid="123456789",ticket="aaaaaaaaaaaaaaaa";
function setup(){const data=new Map(),sent=[],calls=[];let messageId=100;return {data,sent,calls,storage:{get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),setAlarm:async()=>{}},send:async(e,m,p)=>{sent.push({m,p});return {message_id:m==="editMessageText"?p.message_id:++messageId};},cabinet:async(e,u,event)=>{calls.push({u,event});return {ok:true};},register:async()=>({ok:true})};}
const enqueue={action:"enqueue",profileId:"771053",account:"yan_first",text:"Исходный текст настоящего отзыва клиентки.",username:"test_client"};
const action=(name,record,extra={})=>({action:name,actorId:MODERATOR_ID,chatId:MODERATION_CHAT,messageId:record.messageId,version:record.version,...extra});
const run=(s,event)=>moderationEvent(s.storage,{}, {userId:uid,ticket,event},s.send,s.cabinet,s.register);
test("review stays pending without cabinet publication; only owner in the configured group can decide",async()=>{
 const s=setup();await run(s,enqueue);let record=s.data.get("moderation");assert.equal(record.status,"pending");assert.equal(s.calls.length,0);
 assert.match(s.sent[0].p.text,/@test_client/);assert.match(s.sent[0].p.text,/Ян Первый/);
 assert.equal((await run(s,action("approve",record,{actorId:"987654321"}))).forbidden,true);
 assert.equal((await run(s,action("approve",record,{chatId:"-1001111111111"}))).forbidden,true);
 assert.equal(s.calls.length,0);await run(s,action("approve",record));assert.equal(s.calls.length,1);
 assert.equal(s.calls[0].event.text,enqueue.text);await run(s,action("approve",record));assert.equal(s.calls.length,1);
});
test("correction requires owner reply, invalidates stale buttons and is not an approval",async()=>{
 const s=setup();await run(s,enqueue);const old=s.data.get("moderation");await run(s,action("edit",old));let record=s.data.get("moderation");
 assert.equal(record.status,"editing");assert.equal(s.calls.length,0);
 assert.equal((await run(s,action("approve",old))).ok,false);
 assert.equal((await run(s,{action:"replace",actorId:MODERATOR_ID,chatId:MODERATION_CHAT,replyTo:1,text:"Исправленный полный текст отзыва."})).ok,false);
 await run(s,{action:"replace",actorId:MODERATOR_ID,chatId:MODERATION_CHAT,replyTo:record.editPromptId,text:"Исправленный полный текст отзыва.",messageId:200});record=s.data.get("moderation");
 assert.equal(record.status,"pending");assert.equal(record.text,"Исправленный полный текст отзыва.");assert.equal(record.revisions[0].text,enqueue.text);assert.equal(s.calls.length,0);
 await run(s,action("approve",record));assert.equal(s.calls[0].event.text,record.text);
});
test("cancellation closes the ticket and cannot later become publication",async()=>{
 const s=setup();await run(s,enqueue);const record=s.data.get("moderation");await run(s,action("cancel",record));
 assert.equal(s.data.get("moderation").status,"cancelled");assert.equal(s.calls[0].event.action,"cancel");
 assert.equal((await run(s,action("approve",record))).ok,false);assert.equal(s.calls.length,1);
});
test("publication notice waits for delivered proof and links the original request exactly once",async()=>{
 const s=setup();await run(s,enqueue);let record=s.data.get("moderation");
 assert.equal((await run(s,{action:"published",profileId:"771053",proofDelivered:true})).ok,false);
 await run(s,action("approve",record));assert.equal((await run(s,{action:"published",profileId:"771053",proofDelivered:false})).ok,false);
 await run(s,{action:"published",profileId:"771053",proofDelivered:true});
 assert.ok(!s.sent.some(x=>x.m==="sendMessage"&&x.p.text.includes("Подтверждение доставлено")));
 await moderationAlarm(s.storage,{},s.send);await moderationAlarm(s.storage,{},s.send);
 const notices=s.sent.filter(x=>x.m==="sendMessage"&&x.p.text.includes("Подтверждение доставлено"));assert.equal(notices.length,1);assert.match(notices[0].p.text,/https:\/\/t.me\/c\/3900552612\/101/);
});
test("untrusted group button never reaches any cabinet or private data",async()=>{
 const sent=[];const update={callback_query:{id:"wrong",from:{id:123456789},message:{message_id:1,chat:{id:Number(MODERATION_CHAT),type:"supergroup"}},data:"reviewmod:approve:"+uid+":"+ticket+":1"}};
 assert.equal(await handleModeration(update,{},async(e,m,p)=>{sent.push({m,p});}),true);assert.equal(sent[0].m,"answerCallbackQuery");assert.equal(sent[0].p.show_alert,true);
});

import test from "node:test";
import assert from "node:assert/strict";
import {AGREEMENT_SECTIONS,AGREEMENT_VERSION,agreementEvent,agreementLabel,handleAgreement,signedAgreement} from "../src/agreement.js";
const uid="123456789",now=Date.parse("2026-10-15T21:30:45Z");
function setup(){
 const data=new Map(),sent=[];let last=100;
 const storage={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),delete:async k=>data.delete(k)};
 const send=async(e,method,payload)=>{sent.push({method,payload});return {message_id:payload.message_id||++last};};
 const env={ORDER_REMINDERS:{idFromName:n=>n,get:()=>({fetch:async()=>Response.json({client:{id:uid,active:true}})})}};
 const run=event=>agreementEvent(storage,env,{userId:uid,event},send,now);
 const next=action=>run({action,token:data.get("flow").token,step:data.get("flow").step,sourceMessageId:data.get("navigation").id});
 return {data,sent,storage,send,env,run,next};
}
test("all six screens are sequential, one message is reused, final acceptance is saved before registration",async()=>{
 const s=setup();assert.deepEqual(await s.run({action:"status"}),{status:"not_accepted"});
 await s.run({action:"start",sourceMessageId:1});assert.equal(s.data.get("flow").step,0);
 await s.next("accept");assert.equal(s.data.has("accepted"),false,"cannot bypass the five preceding confirmations");
 for(let i=0;i<5;i++){assert.equal(s.data.get("flow").step,i);await s.next("yes");}
 const last=s.sent.filter(x=>x.method==="editMessageText").at(-1).payload;
 assert.equal(last.reply_markup.inline_keyboard[0][0].text,"✅ Принимаю соглашение");
 assert.equal((await s.next("accept")).home,true);
 const record=s.data.get("accepted");assert.equal(record.userId,uid);assert.equal(record.acceptedAt,now);assert.equal(record.version,AGREEMENT_VERSION);
 assert.deepEqual(record.sections,AGREEMENT_SECTIONS);assert.notEqual(record.sections,AGREEMENT_SECTIONS);
 assert.equal(s.sent.filter(x=>x.method==="sendMessage").length,1);assert.equal(s.sent.filter(x=>x.method==="editMessageText").length,5);
 assert.deepEqual(s.sent.filter(x=>x.method==="deleteMessage").map(x=>x.payload.message_id),[1,101]);
 assert.equal(s.data.has("flow"),false);assert.equal(s.data.has("navigation"),false);
 assert.equal((await s.run({action:"status"})).status,"accepted");
});
test("declining cleans navigation, records refusal and does not erase earlier acceptance",async()=>{
 const s=setup();await s.run({action:"start",sourceMessageId:1});await s.next("yes");assert.equal((await s.next("no")).home,true);
 assert.equal((await s.run({action:"status"})).status,"declined");assert.equal(s.data.has("accepted"),false);assert.equal(s.data.has("navigation"),false);
 await s.run({action:"start",sourceMessageId:2});for(let i=0;i<5;i++)await s.next("yes");await s.next("accept");const accepted=s.data.get("accepted");
 await s.run({action:"start",sourceMessageId:3});await s.next("no");assert.deepEqual(s.data.get("accepted"),accepted);
 assert.equal((await s.run({action:"status"})).acceptedAt,now);
});
test("stale and mismatched buttons cannot advance or accept another flow",async()=>{
 const s=setup();await s.run({action:"start",sourceMessageId:1});const flow=s.data.get("flow");
 await s.run({action:"accept",token:flow.token,step:5,sourceMessageId:101});assert.equal(s.data.has("accepted"),false);assert.equal(s.data.get("flow").step,0);
 await s.run({action:"yes",token:"wrong",step:0,sourceMessageId:101});assert.equal(s.data.get("flow").step,0);
 await s.run({action:"yes",token:flow.token,step:0,sourceMessageId:999});assert.equal(s.data.get("flow").step,0);
});
test("signed copy uses the accepted snapshot, Moscow date and ID, with a clean return to cabinet",async()=>{
 const s=setup();await s.run({action:"start",sourceMessageId:1});for(let i=0;i<5;i++)await s.next("yes");await s.next("accept");
 await s.run({action:"signed",sourceMessageId:8});const copy=s.sent.filter(x=>x.method==="sendMessage").at(-1).payload;
 assert.equal(copy.text,signedAgreement(s.data.get("accepted")));assert.ok(copy.text.length<4096);assert.match(copy.text,/16\.10\.2026/);assert.match(copy.text,/00:30:45/);assert.match(copy.text,/Подписан ID:<\/b> 123456789/);
 for(const section of AGREEMENT_SECTIONS)assert.ok(copy.text.includes(section.body));
 assert.equal(copy.reply_markup.inline_keyboard[0][0].text,"🌹 Вернуться к анкетам");assert.equal((await s.run({action:"back"})).cabinet,true);assert.equal(s.data.has("navigation"),false);
});
test("agreement source preserves the owner's exact wording including the final original grammar",()=>{
 assert.equal(AGREEMENT_SECTIONS.length,6);
 assert.equal(AGREEMENT_SECTIONS[0].body,"Уважаемые девушки! Для поддержания честной конкуренции и уважительной атмосферы на сайте действуют единые правила публикации отзывов и оценок.\nЗапрещается использовать отзывы для дискредитации других девушек");
 assert.equal(AGREEMENT_SECTIONS[1].body,"Запрещается оставлять оскорбительные, провокационные и унизительные комментарии в адрес других девушек, в том числе под собственной анкетой.\nТакже запрещается намеренно публиковать негативные отзывы и занижать оценки под анкетами конкуренток с целью ухудшения их репутации.");
 assert.equal(AGREEMENT_SECTIONS[2].body,"В текстах отзывов запрещается:\n\n• Злоупотреблять нецензурной лексикой.\n\n• Использовать эмодзи и смайлики.\n\n• Писать рекламные заявления вроде «Я лучшая на сайте», «Лучше меня никого нет» и подобные.");
 assert.equal(AGREEMENT_SECTIONS[3].body,"Разрешается оставлять не более одного отзыва и одной оценки на одну анкету в течение суток.\nОграничение действует независимо от количества используемых аккаунтов.");
 assert.equal(AGREEMENT_SECTIONS[4].body,"Все поступающие отзывы проходят обязательную проверку администрацией бота перед публикацией на сайте.\nАдминистрация оставляет за собой право корректировать, сокращать или отклонять отзывы, нарушающие установленные правила.\nПри корректировке сохраняется первоначальный смысл допустимой части отзыва. Отправка отзыва не гарантирует его публикацию.");
 assert.equal(AGREEMENT_SECTIONS[5].body,"За нарушение перечисленных требований администрация вправе вынести предупреждение, удалить отзыв или временно ограничить доступ к кабинету.\nПри грубых или систематических нарушениях возможна бессрочная блокировка личного кабинета и доступа к боту без возврата денежных средств за оставшийся оплаченное количество публикации.\n\nПросим соблюдать правила и уважительно относиться к другим участницам площадки.");
 assert.equal(agreementLabel({status:"declined"}),"❌ Отказалась от соглашения");assert.equal(agreementLabel({status:"accepted"}),"✅ Соглашение подписано");
});
test("public agreement callbacks require a private chat bound to the same sender",async()=>{
 const s=setup();const result=await handleAgreement({callback_query:{id:"bad",from:{id:123456789},message:{message_id:1,chat:{id:987654321,type:"private"}},data:"agreement:start"}}, {}, s.send);
 assert.equal(result.handled,true);assert.equal(s.sent.at(-1).method,"answerCallbackQuery");
});

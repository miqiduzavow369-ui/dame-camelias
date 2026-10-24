import test from "node:test";
import assert from "node:assert/strict";
import {handleVerifiedCityDiaryWebhook} from "../src/city_diary_webhook_gate.js";
import {diaryThanksCallback} from "../src/city_diary_delivery.js";
const SECRET="test_private_telegram_webhook_token_2026";
const INTERNAL="private-internal-diary-token";
const USER="5866034656", EVENT="0123456789abcdef", ATTEMPT="2222222222222222";
const callbackData=diaryThanksCallback(EVENT,ATTEMPT);
const update={update_id:781,
 callback_query:{id:"query-123",from:{id:Number(USER)},
 message:{chat:{id:Number(USER),type:"private"},message_id:777},
 data:callbackData}};
function fixture(){
 let calls=0,answer=0,deleted=0;
 const schedulerNamespace={
  idFromName:id=>id,
  get:id=>{
   assert.equal(id,USER);
   return {fetch:async(_url,opt)=>{
    calls++;
    const req=JSON.parse(opt.body);
    assert.equal(req.userId,USER);
    if(req.type==="acknowledge")
     return Response.json({ok:true,record:{eventId:EVENT,telegramMessageId:777,
       state:"acknowledged"}});
    return Response.json({ok:true,record:{eventId:EVENT,telegramMessageId:777,
      state:"acknowledged",cleanupStatus:"deleted"}});
   }};
  }
 };
 const telegram={answerCallbackQuery:async()=>{answer++;return true;},
 deleteMessage:async()=>{deleted++;return true;}};
 const settings={webhookSecret:SECRET,internalToken:INTERNAL,schedulerNamespace,telegram};
 const request=(data=update,secret=SECRET,extra={})=>new Request("https://diary.invalid/webhook",{
  method:"POST",headers:{"Content-Type":"application/json",
  "X-Telegram-Bot-Api-Secret-Token":secret,...extra},
  body:JSON.stringify(data)});
 return {request,settings,get calls(){return calls;},get answer(){return answer;},
   get deleted(){return deleted;}};
}
test("authenticated Telegram update is verified before calling private diary handler",async()=>{
 const f=fixture();
 const outcome=await handleVerifiedCityDiaryWebhook(f.request(),f.settings);
 assert.equal(outcome.ok,true);
 assert.equal(outcome.deleted,true);
 assert.equal(outcome.cleanupRecorded,true);
 assert.equal(f.calls,2);
 assert.equal(f.answer,1);
 assert.equal(f.deleted,1);
});
test("missing, incorrect or short webhook secret fails closed before downstream actions",async()=>{
 const f=fixture();
 for(const bad of ["bad",SECRET+"x",SECRET.replace("2026","2027")]){
  const result=await handleVerifiedCityDiaryWebhook(f.request(update,bad),f.settings);
  assert.equal(result.status,403);
 }
 assert.equal((await handleVerifiedCityDiaryWebhook(f.request(),{
  ...f.settings,webhookSecret:"short"})).status,403);
 assert.equal(f.calls,0);
});
test("only POST JSON with valid update_id is accepted",async()=>{
 const f=fixture();
 const get=await handleVerifiedCityDiaryWebhook(
  new Request("https://diary.invalid/webhook",{method:"GET"}),f.settings);
 assert.equal(get.status,405);
 const bad=await handleVerifiedCityDiaryWebhook(
  f.request({...update,update_id:"781"}),f.settings);
 assert.equal(bad.status,400);
 assert.equal(f.calls,0);
});
test("body size cap prevents oversized updates before parsing",async()=>{
 const f=fixture();
 const huge={...update,extra:"a".repeat(70000)};
 assert.equal((await handleVerifiedCityDiaryWebhook(f.request(huge),f.settings)).status,413);
 assert.equal(f.calls,0);
});
test("unrelated Telegram updates are not consumed by diary handler",async()=>{
 const f=fixture();
 const other={update_id:782,message:{chat:{id:Number(USER),type:"private"},text:"Hello"}};
 const result=await handleVerifiedCityDiaryWebhook(f.request(other),f.settings);
 assert.equal(result.handled,false);
 assert.equal(f.calls,0);
});

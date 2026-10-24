import test from "node:test";
import assert from "node:assert/strict";
import {handleCityDiaryThanks} from "../src/city_diary_callback.js";
import {diaryThanksCallback} from "../src/city_diary_delivery.js";

const USER="5866034656", TOKEN="private-test-secret-bridge";
const EVENT="0123456789abcdef", ATTEMPT="2222222222222222";
const CALLBACK=diaryThanksCallback(EVENT,ATTEMPT);
function fixture(){
 const calls={scheduler:0,answer:0,delete:0};
 let allowed=true,deleteOk=true,cleanupStatus=null,cleanupAttempts=0;
 const schedulerNamespace={
  idFromName(id){assert.equal(id,USER);return id;},
  get(id){assert.equal(id,USER);return {
   async fetch(_url,init){
    calls.scheduler++;
    const body=JSON.parse(init.body);
    assert.equal(body.userId,USER);
    assert.equal(init.headers.Authorization,"Bearer "+TOKEN);
    if(body.type==="record_cleanup"){
      if(body.deleted===true)cleanupStatus="deleted";
      else cleanupStatus="failed";
      cleanupAttempts++;
      return Response.json({ok:true,record:{eventId:EVENT,telegramMessageId:777,
        state:"acknowledged",cleanupStatus,cleanupAttempts}});
    }
    if(!allowed)return Response.json({ok:false,reason:"invalid_acknowledgement"},{status:409});
    return Response.json({ok:true,replay:calls.scheduler>1,
      record:{eventId:EVENT,telegramMessageId:777,state:"acknowledged",
        cleanupStatus,cleanupAttempts}});
   }
  };}
 };
 const telegram={
  async answerCallbackQuery(){calls.answer++;return true;},
  async deleteMessage(){calls.delete++;return deleteOk;}
 };
 const update={callback_query:{id:"q123456",from:{id:Number(USER)},
   message:{message_id:777,chat:{id:Number(USER),type:"private"}},data:CALLBACK}};
 const run=(overrides={})=>handleCityDiaryThanks(update,{
   trustedWebhook:true,schedulerNamespace,internalToken:TOKEN,telegram,...overrides});
 return {calls,update,run,setAllowed:x=>allowed=x,setDeleteOk:x=>deleteOk=x};
}
test("valid private owner Thanks click authenticates before deletion",async()=>{
 const x=fixture();
 const result=await x.run();
 assert.equal(result.ok,true);
 assert.equal(result.acknowledged,true);
 assert.equal(result.deleted,true);
 assert.deepEqual(x.calls,{scheduler:2,answer:1,delete:1});
 assert.equal(result.cleanupRecorded,true);
 assert.equal(result.cleanupStatus,"deleted");
});
test("untrusted webhook, foreign sender, and group callback never touch private scheduler",async()=>{
 const x=fixture();
 const bad=[{...x.update,callback_query:{...x.update.callback_query,from:{id:1234567890}}},
  {...x.update,callback_query:{...x.update.callback_query,message:{
    message_id:777,chat:{id:Number(USER),type:"supergroup"}}}}];
 for(const update of bad){
  const result=await handleCityDiaryThanks(update,{trustedWebhook:true,
   schedulerNamespace:{idFromName:()=>{throw Error("must not call")}}});
  assert.equal(result.ok,false);
 }
 assert.equal((await x.run({trustedWebhook:false})).reason,"untrusted_webhook");
 assert.equal(x.calls.scheduler,0);
});
test("invalid callback proof is rejected without deletion",async()=>{
 const x=fixture();x.setAllowed(false);
 const result=await x.run();
 assert.equal(result.reason,"ack_rejected");
 assert.deepEqual(x.calls,{scheduler:1,answer:0,delete:0});
});
test("Telegram delete failure leaves truthful acknowledged cleanup state",async()=>{
 const x=fixture();x.setDeleteOk(false);
 const result=await x.run();
 assert.equal(result.ok,true);
 assert.equal(result.deleted,false);
 assert.equal(result.cleanupRequired,true);
 assert.equal(result.acknowledged,true);
 assert.equal(result.cleanupRecorded,true);
 assert.equal(result.cleanupStatus,"failed");
});
test("duplicate verified clicks are idempotent acknowledgements",async()=>{
 const x=fixture();
 assert.equal((await x.run()).replay,false);
 assert.equal((await x.run()).replay,true);
 assert.equal(x.calls.scheduler,3);
 assert.equal(x.calls.delete,1);
});
test("unrelated Telegram callbacks bypass this adapter",async()=>{
 const x=fixture();
 const result=await handleCityDiaryThanks({
  callback_query:{...x.update.callback_query,data:"other:callback"}
 },{trustedWebhook:true});
 assert.equal(result.handled,false);
 assert.equal(x.calls.scheduler,0);
});

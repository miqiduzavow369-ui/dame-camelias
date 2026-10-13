import test from "node:test";
import assert from "node:assert/strict";
import {handleOwnerAnketa,ownerAllowed} from "../src/owner_anketa.js";

const ownerId = 123456789;
const env = {ADMIN_TELEGRAM_USER_ID:String(ownerId)};
const message = (id,chatId=id,kind="private",text="/anketa 750206") => ({
  message:{from:{id},chat:{id:chatId,type:kind},text}
});
test("access denied when secret absent",()=>assert.equal(ownerAllowed(message(ownerId),{}),false));
test("owner private chat accepted",()=>assert.equal(ownerAllowed(message(ownerId),env),true));
test("other user rejected",()=>assert.equal(ownerAllowed(message(54321),env),false));
test("group rejected even if owner",()=>assert.equal(ownerAllowed(message(ownerId,-55,"supergroup"),env),false));
test("foreign callback rejected, without posting",async()=>{
  const sent=[];
  const update={callback_query:{id:"cb",from:{id:99},message:{chat:{id:99,type:"private"}},data:"owner_anketa:rating:750206"}};
  assert.equal(await handleOwnerAnketa(update,env,async(_e,m,d)=>sent.push({m,d})),true);
  assert.equal(sent.length,1);
  assert.equal(sent[0].m,"answerCallbackQuery");
});
test("owner sees no publication action",async()=>{
  const sent=[];
  await handleOwnerAnketa(message(ownerId),env,async(_e,m,d)=>sent.push({m,d}));
  assert.equal(sent[0].m,"sendMessage");
  assert.ok(sent[0].d.text.includes("750206"));
});

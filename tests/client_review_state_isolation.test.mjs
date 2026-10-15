import test from "node:test";
import assert from "node:assert/strict";
import {saveClientReviewDraft,readClientReviewDraft} from "../src/client_review_draft.js";
import {clientKey} from "../src/client_isolation.js";

test("separate client draft storage does not overwrite navigation state",async()=>{
 const data=new Map();
 const env={VISITORS_KV:{
  get:async key=>data.has(key)?JSON.parse(data.get(key)):null,
  put:async(key,value)=>data.set(key,value)
 }};
 const user="5627932577",profile="698842";
 const url="https://b.intimcity.rip/indi/anketa698842.htm";
 data.set(clientKey(user,"saved",profile),JSON.stringify({id:profile,url,verifiedAt:Date.now()}));
 data.set(clientKey(user,"pending"),JSON.stringify({mode:"url"}));
 const saved=await saveClientReviewDraft(env,user,profile,url,"Сохраненный подробный текст отзыва");
 assert.equal(saved.ok,true);
 assert.deepEqual(JSON.parse(data.get(clientKey(user,"pending"))),{mode:"url"});
 assert.ok(data.has(clientKey(user,"review_draft",profile)));
 assert.equal((await readClientReviewDraft(env,user,profile,url)).text,saved.draft.text);
});

import test from "node:test";
import assert from "node:assert/strict";
import {saveClientReviewDraft,readClientReviewDraft} from "../src/client_review_draft.js";
import {clientKey} from "../src/client_isolation.js";
const id="5627932577",other="5866034656",pid="698842",url="https://b.intimcity.rip/indi/anketa698842.htm";
function env(){const records=new Map();return {records,VISITORS_KV:{get:async k=>records.has(k)?JSON.parse(records.get(k)):null,put:async(k,v)=>records.set(k,v)}};}
test("review draft requires verified exact profile and stays in client namespace",async()=>{
 const e=env();
 assert.equal((await saveClientReviewDraft(e,id,pid,url,"Достаточно подробный отзыв")).reason,"unverified");
 e.records.set(clientKey(id,"saved",pid),JSON.stringify({id:pid,url,verifiedAt:Date.now()}));
 assert.equal((await saveClientReviewDraft(e,id,pid,url,"Коротко")).reason,"length");
 assert.equal((await saveClientReviewDraft(e,id,pid,url,"Достаточно подробный отзыв")).ok,true);
 assert.equal((await readClientReviewDraft(e,id,pid,url)).text,"Достаточно подробный отзыв");
 assert.equal(await readClientReviewDraft(e,id,pid,"https://a.intimcity.rip/indi/anketa698842.htm"),null);
 assert.equal(await readClientReviewDraft(e,other,pid,url),null);
 assert.equal(e.records.has(clientKey(other,"pending")),false);
});
test("changing verified link or profile invalidates old review draft",async()=>{
 const e=env();e.records.set(clientKey(id,"saved",pid),JSON.stringify({id:pid,url,verifiedAt:Date.now()}));
 await saveClientReviewDraft(e,id,pid,url,"Достаточно подробный отзыв");
 e.records.set(clientKey(id,"saved",pid),JSON.stringify({id:pid,url:"https://a.intimcity.rip/indi/anketa698842.htm",verifiedAt:Date.now()}));
 assert.equal(await readClientReviewDraft(e,id,pid,url),null);
});

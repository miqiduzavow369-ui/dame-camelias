import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {secondaryDraftAction} from "../src/secondary_man_client_draft.js";

const source=()=>readFileSync("anketa/mini-preview.html","utf8");
test("Yan First's original compact interface stays free of visible stage rows and extra secondary drafts",()=>{
 const html=source();
 assert.match(html,/if\(false\)body\.append\(status\)/);
 assert.match(html,/\[\]\.forEach\(\(step,i\)=>/);
 assert.doesNotMatch(html,/\(legacySteps\[kind\]\|\|\[\]\)\.forEach\(\(step,i\)=>/);
 assert.match(html,/\$\("secondaryDraftCard"\)\.hidden=true/);
 assert.match(html,/send\.textContent="✅ Опубликовать оценки"/);
 assert.match(html,/send\.disabled=true/);
 assert.match(html,/secondaryStatuses\[String\(p\.id\)\]/);
 assert.doesNotMatch(html,/publish\.textContent="🔎 Подготовить публикацию"/);
 assert.match(html,/draft_saved:kind==="rating"\?"✅ Оценки подготовлены":"✅ Отзыв подготовлен"/);
});
test("secondary review drafts are indexed independently for home progress",async()=>{
 const map=new Map();
 const tx={get:async k=>map.get(k),put:async(k,v)=>{map.set(k,v)},transaction:async fn=>fn(tx)};
 const uid="123456789",profileId="690230";
 const args={userId:uid,profileId,accountId:"yan_second",kind:"review",
  action:"save",text:"Настоящий подробный отзыв автора",profileOwned:true,authorAttested:true};
 const first=await secondaryDraftAction(tx,args);
 assert.equal(first.saved,true);
 const idx=map.get("secondary-review-progress-v1:"+uid);
 assert.equal(idx["690230:yan_second"].stage,"draft_saved");
 assert.equal(idx["690230:yan_second"].version,1);
 assert.equal(idx["690230:yan_first"],undefined);
 await secondaryDraftAction(tx,{...args,accountId:"yan_03"});
 const after=map.get("secondary-review-progress-v1:"+uid);
 assert.equal(after["690230:yan_second"].version,1);
 assert.equal(after["690230:yan_03"].version,1);
 assert.equal(map.get("secondary-review-progress-v1:987654321"),undefined);
});

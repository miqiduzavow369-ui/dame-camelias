import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
import {secondaryDraftAction} from "../src/secondary_man_client_draft.js";

const storage=()=>{
 const rows=new Map();
 const tx={get:async k=>rows.get(k),put:async(k,v)=>{rows.set(k,v)},transaction:async fn=>fn(tx)};
 return tx;
};
test("secondary review editor loads and edits only the current author's draft",async()=>{
 const tx=storage(),args={userId:"123456789",profileId:"690230",accountId:"yan_second",kind:"review"};
 const save={...args,action:"save",text:"Мой проверенный реальный опыт посещения",profileOwned:true,authorAttested:true};
 assert.equal((await secondaryDraftAction(tx,save)).version,1);
 const own=await secondaryDraftAction(tx,{...args,action:"load",profileOwned:true});
 assert.match(own.text,/реальный опыт/);
 assert.equal((await secondaryDraftAction(tx,{...args,accountId:"yan_03",action:"load",profileOwned:true})).text,"");
 assert.equal((await secondaryDraftAction(tx,{...args,userId:"987654321",action:"load",profileOwned:true})).text,"");
 await assert.rejects(()=>secondaryDraftAction(tx,{...args,action:"load",profileOwned:false}),/Saved profile/);
});
test("common Yan review editor uses secondary draft API but never Yan publish API for second man",()=>{
 const html=readFileSync("anketa/mini-preview.html","utf8");
 const src=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(src);
 assert.doesNotThrow(()=>new Script(src));
 assert.match(html,/if\(selectedAccount!=="yan_first"\)\{\s*if\(action==="submit"/);
 assert.match(html,/fetch\("\/api\/anketa\/mini-secondary-draft"/);
 assert.match(html,/draftKind:"review",action:mapped/);
 assert.match(html,/send\.textContent="💾 Сохранить отзыв"/);
 assert.match(html,/editSaved\.onclick=async/);
 assert.match(html,/if\(selectedAccount!=="yan_first"\)saveDraft\.hidden=true/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {openSecondaryRatingForm,saveSecondaryRatingForm} from "../src/secondary_man_rating_form.js";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
import {savePersonalCriteria} from "../src/secondary_personal_rating_criteria.js";

const userId="123456789",profileId="765432";
const catalog=[
 {label:"isFair",options:["Фото соответствует"]},
 {label:"Общая оценка",options:["1","2","3","4","5"]},
 {label:"Реальная инди",options:["Да","Нет"]}
];
function context(){
 const values=new Map();
 const cache=new Map();
 const kv={get:async(key)=>key==="owner_anketa_saved:"+userId+":"+profileId?
  {confirmed:true,profile:{id:profileId,name:"Анкета"},catalog}:cache.get(key)||null,
  put:async(key,val)=>cache.set(key,JSON.parse(val))};
 const tx={get:async k=>values.get(k),put:async(k,v)=>{values.set(k,v)}};
 const storage={get:tx.get,transaction:async fn=>fn(tx)};
 return {storage,kv,values};
}
test("all 29 secondary men require their own inspected site criteria without posting",async()=>{
 const {storage,kv}=context();
 for(const man of MAN_ACCOUNTS.slice(1)){
  await assert.rejects(()=>openSecondaryRatingForm(storage,kv,{userId,profileId,accountId:man.id}),/Rating catalog not ready/);
  await savePersonalCriteria(kv,{accountId:man.id,profileId,siteHost:"b.intimcity.rip",catalog});
  const form=await openSecondaryRatingForm(storage,kv,{userId,profileId,accountId:man.id});
  assert.equal(form.ok,true);
  assert.equal(form.publicationAvailable,false);
  assert.equal(form.catalog[0].label,"Фото соответствует");
  assert.deepEqual(form.catalog[1].options,["5"]);
  assert.deepEqual(form.catalog[2].options,["Да"]);
 }
});
test("men's selected ratings persist separately; Yan First legacy state untouched",async()=>{
 const {storage,kv,values}=context();
 for(const accountId of ["yan_second","yan_03"]){
  await savePersonalCriteria(kv,{accountId,profileId,siteHost:"b.intimcity.rip",catalog});
  const result=await saveSecondaryRatingForm(storage,kv,{
   userId,profileId,accountId,selected:{"1":"5","2":"Да"},metElsewhere:false
  });
  assert.equal(result.publicationAvailable,false);
  assert.deepEqual(result.selected,{"0":"Фото соответствует","1":"5","2":"Да"});
 }
 assert.equal(values.size,3);
 assert.equal(values.get("secondary-rating-progress-v1:"+userId)[profileId+":yan_second"].count,3);
 const second=await openSecondaryRatingForm(storage,kv,{userId,profileId,accountId:"yan_second"});
 assert.deepEqual(second.selected,{"0":"Фото соответствует","1":"5","2":"Да"});
 await assert.rejects(()=>openSecondaryRatingForm(storage,kv,{userId,profileId,accountId:"yan_first"}),/immutable/);
});
test("invalid site choice, foreign profiles and claimed operations reject safely",async()=>{
 const {storage,kv,values}=context();
 await savePersonalCriteria(kv,{accountId:"yan_second",profileId,siteHost:"b.intimcity.rip",catalog});
 const x={userId,profileId,accountId:"yan_second",metElsewhere:false};
 await assert.rejects(()=>saveSecondaryRatingForm(storage,kv,{...x,selected:{"1":"4"}}),/Invalid rating selection/);
 await assert.rejects(()=>openSecondaryRatingForm(storage,kv,{...x,profileId:"999999"}),/Saved profile not verified/);
 await assert.rejects(()=>saveSecondaryRatingForm(storage,kv,{...x,selected:{"5":"5"}}),/Invalid rating selection/);
 const pub="man-account-v1:"+userId+":yan_second:publication:"+profileId+":rating";
 values.set(pub,{status:"attempted"});
 await assert.rejects(()=>saveSecondaryRatingForm(storage,kv,{...x,selected:{"1":"5"}}),/Publication already claimed/);
});
test("signed rating API never drops selected man; secondary saves cannot reach legacy publisher",()=>{
 const index=fs.readFileSync("src/index.js","utf8");
 const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
 const html=fs.readFileSync("anketa/mini-preview.html","utf8");
 for(const kind of ["mini_rating_open","mini_rating_form","mini_rating_save","mini_rating_action"])
  assert.ok(index.includes('kind:"'+kind+'",accountId:body?.accountId??"yan_first"'));
 assert.ok(runtime.includes("openSecondaryRatingForm(storage,rawEnv.VISITORS_KV"));
 assert.ok(runtime.includes("saveSecondaryRatingForm(storage,rawEnv.VISITORS_KV"));
 assert.ok(html.includes('selectedProgress.rating'));
 assert.ok(html.includes('confirmed:action==="publish"&&selectedAccount!=="yan_first"'));
});

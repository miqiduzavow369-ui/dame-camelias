import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {saveSharedCriteria,readSharedCriteria} from "../src/shared_rating_criteria.js";
import {savePersonalCriteria} from "../src/secondary_personal_rating_criteria.js";
import {openSecondaryRatingForm,saveSecondaryRatingForm} from "../src/secondary_man_rating_form.js";
const userId="123456789",profileId="765432";
function storage(){
 const entries=new Map();
 const tx={get:async k=>entries.get(k),put:async(k,v)=>entries.set(k,v)};
 return {get:tx.get,transaction:async fn=>fn(tx),entries};
}
function kv(savedCatalog=[]){
 const entries=new Map();
 entries.set("owner_anketa_saved:"+userId+":"+profileId,{confirmed:true,
  profile:{id:profileId,name:"Анкета"},catalog:savedCatalog});
 return {entries,put:async(k,v,opts)=>{assert.ok(opts.expirationTtl<=86400);entries.set(k,JSON.parse(v));},
  get:async(k)=>entries.get(k)||null};
}
const catalog=[{label:"Общая оценка",group:"Оценки анкеты",
  options:["1","2","3","4","5"],control:{type:"select",name:"score",id:"score",values:["1","2","3","4","5"]}}];
test("Mikhail's catalog does not authorize another man's rating form",async()=>{
 const db=storage(),cache=kv();
 await savePersonalCriteria(cache,{accountId:"yan_second",profileId,siteHost:"b.intimcity.rip",catalog});
 const first=await openSecondaryRatingForm(db,cache,{userId,accountId:"yan_second",profileId});
 assert.equal(first.catalog.length,1);
 await assert.rejects(()=>openSecondaryRatingForm(db,cache,{userId,accountId:"yan_03",profileId}),/Rating catalog not ready/);
 await savePersonalCriteria(cache,{accountId:"yan_03",profileId,siteHost:"b.intimcity.rip",catalog});
 const other=await openSecondaryRatingForm(db,cache,{userId,accountId:"yan_03",profileId});
 assert.equal(other.catalog.length,1);
 await saveSecondaryRatingForm(db,cache,{userId,accountId:"yan_second",profileId,selected:{"0":"5"},metElsewhere:false});
 const untouched=await openSecondaryRatingForm(db,cache,{userId,accountId:"yan_03",profileId});
 assert.deepEqual(untouched.selected,{});
 assert.equal(untouched.publicationAvailable,false);
});
test("historical shared catalog and saved owner catalog cannot override own site inspection",async()=>{
 const cache=kv([{label:"Локальный критерий",options:["5"]}]);
 await saveSharedCriteria(cache,{accountId:"yan_second",profileId,siteHost:"b.intimcity.rip",catalog});
 await assert.rejects(()=>openSecondaryRatingForm(storage(),cache,{userId,accountId:"yan_03",profileId}),/Rating catalog not ready/);
 await savePersonalCriteria(cache,{accountId:"yan_03",profileId,siteHost:"b.intimcity.rip",catalog});
 const form=await openSecondaryRatingForm(storage(),cache,{userId,accountId:"yan_03",profileId});
 assert.equal(form.catalog[0].label,"Общая оценка");
});
test("invalid or cross-account shared updates cannot be stored",async()=>{
 const cache=kv();
 for(const patch of [
  {accountId:"yan_first"},{accountId:"someone_else"},{siteHost:"bad.example"},
  {profileId:"../../shared"},{catalog:[]},{catalog:[{label:"Bad",options:[123]}]}
 ]){
  await assert.rejects(()=>saveSharedCriteria(cache,{accountId:"yan_second",profileId,
   siteHost:"b.intimcity.rip",catalog,...patch}),/Invalid/);
 }
 assert.equal(await readSharedCriteria(cache,profileId),null);
});
test("expired or tampered cache is not reused",async()=>{
 const cache=kv();
 await saveSharedCriteria(cache,{accountId:"yan_second",profileId,siteHost:"b.intimcity.rip",catalog});
 cache.entries.get("shared-rating-criteria-v1:"+profileId).verifiedAt=Date.now()-25*3600000;
 assert.equal(await readSharedCriteria(cache,profileId),null);
});
test("trusted secondary runner and owner cabinet connect to personal catalog",()=>{
 const runner=fs.readFileSync("tools/secondary_man_profile_readonly.py","utf8");
 const adapter=fs.readFileSync("tools/secondary_man_profile_probe.py","utf8");
 const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
 const legacy=fs.readFileSync("src/owner_anketa.js","utf8");
 assert.ok(runner.includes('inspect(str(profile_id), "ratings")'));
 assert.ok(adapter.includes('"catalog":catalog if code=="profile_verified" else []'));
 assert.ok(runtime.includes("await savePersonalCriteria(rawEnv.VISITORS_KV"));
 assert.ok(legacy.includes("await readSharedCriteria(env.VISITORS_KV,profileId)"));
});

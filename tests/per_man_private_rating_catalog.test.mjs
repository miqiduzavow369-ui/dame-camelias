import test from "node:test";
import assert from "node:assert/strict";
import {readPersonalCriteria,savePersonalCriteria,personalCriteriaKey} from "../src/secondary_personal_rating_criteria.js";
import fs from "node:fs";

function kv(){
 const rows=new Map();
 return {rows,put:async(k,v)=>rows.set(k,JSON.parse(v)),
  get:async k=>rows.get(k)||null};
}
const c=[{label:"Отношение к клиенту",group:"Оценки",options:["5","6"]}];
test("same Intimcity profile requires own verified criterion catalog for each secondary man",async()=>{
 const store=kv();
 await savePersonalCriteria(store,{accountId:"yan_second",profileId:"690230",
  siteHost:"b.intimcity.rip",catalog:c});
 assert.ok(await readPersonalCriteria(store,"yan_second","690230"));
 assert.equal(await readPersonalCriteria(store,"yan_03","690230"),null);
 assert.equal(await readPersonalCriteria(store,"yan_second","690231"),null);
 assert.notEqual(personalCriteriaKey("yan_second","690230"),
  personalCriteriaKey("yan_03","690230"));
 await assert.rejects(()=>readPersonalCriteria(store,"yan_first","690230"));
});
test("secondary rating form ignores legacy saved and globally shared criteria",()=>{
 const form=fs.readFileSync("src/secondary_man_rating_form.js","utf8");
 assert.ok(form.includes("readPersonalCriteria(kv,x.accountId,x.profileId)"));
 assert.ok(!form.includes("readSharedCriteria("));
 assert.ok(!form.includes("shared||record.catalog"));
 const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
 const start=runtime.indexOf("async function autoStartSecondaryCatalogLookup(");
 const end=runtime.indexOf("async function isSecondaryCabinetReady(",start);
 const lookup=runtime.slice(start,end);
 assert.ok(lookup.includes("readPersonalCriteria(rawEnv.VISITORS_KV,accountId,profileId)"));
 assert.ok(!lookup.includes("readSharedCriteria("));
 assert.ok(!lookup.includes("Array.isArray(record.catalog)"));
 assert.ok(lookup.includes('"secondary-auto-rating-lookup-v1:"+accountId+":"+profileId'));
 assert.ok(runtime.includes("savePersonalCriteria(rawEnv.VISITORS_KV,{accountId,profileId,"));
 assert.ok(!runtime.includes("saveSharedCriteria(rawEnv.VISITORS_KV,"));
 assert.ok(runtime.includes("startProfileProbe(storage,{accountId,profileId"));
 const legacy=fs.readFileSync("src/owner_anketa.js","utf8");
 assert.ok(legacy.includes("async function miniRatingOpen("));
 assert.ok(legacy.includes("readSharedCriteria(env.VISITORS_KV,profileId)")); // Yan remains untouched.
});

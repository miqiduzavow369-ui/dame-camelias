import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import fs from "node:fs";
import {preflightSecondaryRating} from "../src/secondary_man_rating_launch.js";
import {manStorageKey} from "../src/man_account_isolation.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;

const i={userId:"123456789",accountId:"yan_second",profileId:"690230",kind:"rating",nonce:"000000000000"};
const labels=["Фото соответствует","Соответствие параметров","Реальная инди",
 "Отношение к клиенту","Общая оценка","Массаж","Классический секс",
 "БДСМ","Окончание на грудь","Гигиена","Цена"];
const catalog=labels.map((label,index)=>({label,options:index===0?["Фото соответствует"]:["5"]}));
const selected=Object.fromEntries(catalog.map((f,j)=>[String(j),f.options[0]]));
const prefix=manStorageKey({...i,scope:"rating-draft"})+":rating";
function fake(overrides={}){
 const rows=new Map([
  [prefix,{...i,kind:"rating",version:1,selected,metElsewhere:false,
   catalogSignature:JSON.stringify(catalog)}],
  ["man-proxy-sealed-v1:yan_second",{accountId:"yan_second",version:2,proxyVerified:true,ipVerified:true}],
  ["man-intimcity-sealed-v1:yan_second",{accountId:"yan_second",version:3,boundProxyVersion:2}],
  ["man-owner-approval-v1:yan_second",{accountId:"yan_second",approved:true,version:1,proxyVersion:2,siteVersion:3}],
  ["secondary-site-identity-v1:yan_second",{accountId:"yan_second",proxyVersion:2,siteVersion:3,siteAccountId:"author@example.test"}]
 ]);
 for(const [k,v] of Object.entries(overrides))rows.set(k,v);
 const storage={get:async k=>rows.get(k),transaction:async()=>{throw Error("Prepare must be read only")}};
 const env={DC_ACTIONS_TOKEN:"present",ANKETA_CALLBACK_TOKEN:"present",
  SECONDARY_CALLBACK_HMAC_KEY:"present",MAN_PROXY_ENCRYPTION_KEY:"present",
  MAN_SITE_ENCRYPTION_KEY:"present",ORDER_REMINDERS:{},
  VISITORS_KV:{get:async k=>k==="owner_anketa_saved:123456789:690230"?
   {confirmed:true,profile:{id:"690230"}}:null}};
 return {rows,storage,env};
}
test("preflight validates complete secondary selection before any credit or dispatch",async()=>{
 const {storage,env}=fake();
 const result=await preflightSecondaryRating(storage,env,{identity:i});
 assert.equal(result.selections.length,11);
 assert.equal(result.fingerprint.length,64);
 assert.equal(result.site.version,3);
});
test("preflight blocks incomplete mandatory rating before exposing publish",async()=>{
 const {storage,env,rows}=fake();
 const draft=rows.get(prefix);
 const less={...draft.selected};delete less["4"];
 rows.set(prefix,{...draft,selected:less});
 await assert.rejects(()=>preflightSecondaryRating(storage,env,{identity:i}),/Incomplete rating selections/);
});
test("preflight denies mixed proxy/site and different man without side effects",async()=>{
 const ctx=fake({"man-intimcity-sealed-v1:yan_second":{accountId:"yan_second",version:3,boundProxyVersion:99}});
 await assert.rejects(()=>preflightSecondaryRating(ctx.storage,ctx.env,{identity:i}),
  /rating_site_binding_mismatch/);
 await assert.rejects(()=>preflightSecondaryRating(ctx.storage,ctx.env,{
  identity:{...i,accountId:"yan_first"}}),/immutable/);
});
test("Mini App hides submit button after a failed rating operation",()=>{
 const html=fs.readFileSync("anketa/mini-preview.html","utf8");
 assert.ok(html.includes('catch(e){send.hidden=true;check.hidden=false;'));
 const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
 const snippet=runtime.slice(runtime.indexOf('if(event.kind==="mini_rating_action")'),
  runtime.indexOf('if(event.kind==="mini_rating_open")'));
 assert.ok(snippet.includes('await preflightSecondaryRating(storage,env,{identity:candidate})'));
 assert.ok(snippet.indexOf('await preflightSecondaryRating(')<snippet.indexOf('launchApprovedSecondaryRating('));
});


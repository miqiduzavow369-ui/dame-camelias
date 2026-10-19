import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
import {siteLoginStatus} from "../src/man_site_login_preflight.js";

const html=fs.readFileSync("admin/preview-v3.html","utf8");
const cabinet=fs.readFileSync("src/cabinet_runtime.js","utf8");
const owner={actorId:"12345",cabinetId:"12345",ownerId:"12345"};
const all=MAN_ACCOUNTS.filter(x=>x.id!=="yan_first");
const readyCode="login_authenticated_identity_unconfirmed";
function sample(id,version=1,loginVersion=1){
 const values=new Map([
  ["man-site-login-check-v1:"+id,{accountId:id,status:"completed",code:readyCode,
     proxyVersion:version,siteVersion:loginVersion,finishedAt:100}],
  ["man-intimcity-sealed-v1:"+id,{accountId:id,version:loginVersion,boundProxyVersion:version}],
  ["man-proxy-sealed-v1:"+id,{accountId:id,version,proxyVerified:true,ipVerified:true}]
 ]);
 return {storage:{get:async k=>values.get(k),put:async(k,v)=>values.set(k,v)},values};
}
test("all 29 secondary men get the exact same readiness policy",async()=>{
 assert.equal(all.length,29);
 for(const x of all){
  const {storage}=sample(x.id);
  const result=await siteLoginStatus(storage,{...owner,accountId:x.id});
  assert.equal(result.technicalReady,true,x.id);
  assert.equal(result.connectionVerified,true,x.id);
  assert.equal(result.canPublish,false,x.id);
  assert.equal(result.siteIdentityVerified,false,x.id);
 }
});
test("proxy and credential changes immediately revoke technical readiness",async()=>{
 const id="yan_second",p={...owner,accountId:id};
 const {storage,values}=sample(id);
 assert.equal((await siteLoginStatus(storage,p)).technicalReady,true);
 values.set("man-proxy-sealed-v1:"+id,{...values.get("man-proxy-sealed-v1:"+id),version:2});
 assert.equal((await siteLoginStatus(storage,p)).technicalReady,false);
 const v=sample(id);
 v.values.set("man-intimcity-sealed-v1:"+id,{...v.values.get("man-intimcity-sealed-v1:"+id),version:2});
 assert.equal((await siteLoginStatus(v.storage,p)).technicalReady,false);
});
test("an incomplete or foreign identity never counts as a verified login",async()=>{
 const id="yan_second",p={...owner,accountId:id};
 const v=sample(id);
 for(const code of ["login_rejected","login_attempted_unconfirmed","ip_mismatch"]){
  v.values.set("man-site-login-check-v1:"+id,{...v.values.get("man-site-login-check-v1:"+id),code});
  assert.equal((await siteLoginStatus(v.storage,p)).technicalReady,false);
 }
 const w=sample(id);
 w.values.set("man-proxy-sealed-v1:"+id,{...w.values.get("man-proxy-sealed-v1:"+id),accountId:"yan_03"});
 assert.equal((await siteLoginStatus(w.storage,p)).technicalReady,false);
 const z=sample(id);
 z.values.set("man-proxy-sealed-v1:"+id,{...z.values.get("man-proxy-sealed-v1:"+id),ipVerified:false});
 assert.equal((await siteLoginStatus(z.storage,p)).technicalReady,false);
 await assert.rejects(siteLoginStatus(z.storage,{...owner,accountId:"yan_first"}),/Legacy/);
});
test("ADMIN reflects owner-only individual verified login state, without enabling publication",()=>{
 assert.match(cabinet,/siteLoginStatus\(storage,params\)/);
 assert.match(cabinet,/readiness:readinessMap\.get\(x\.id\)/);
 assert.match(cabinet,/canPublish:false/);
 assert.match(html,/x\.readiness\?\.technicalReady===true/);
 assert.match(html,/login\?\.technicalReady===true/);
 assert.match(html,/Подключён · Вход подтверждён/);
 assert.match(html,/callAdmin\('man_site_login_status'/);
 assert.match(html,/browser\?\.version===data\.proxy\.version/);
 assert.ok(!html.includes("const identityOK=false"));
 const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script);
 new vm.Script(script);
});

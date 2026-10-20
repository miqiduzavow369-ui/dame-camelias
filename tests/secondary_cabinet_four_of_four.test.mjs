import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {secondaryCabinetAvailability,requireClientPublicationRoute} from "../src/man_client_parity.js";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";

function ready(id){return {accountId:id,proxyVerified:true,ipVerified:true,
 proxyVersion:2,siteConfigured:true,boundProxyVersion:2,
 loginVerified:true,browserVerified:true};}
test("verified setup 4/4 opens secondary client cabinet, never grants site POST",()=>{
 for(const man of MAN_ACCOUNTS.slice(1)){
  const men=secondaryCabinetAvailability(new Map([[man.id,ready(man.id)]]));
  assert.equal(men.length,30);
  assert.equal(men.find(m=>m.id===man.id).cabinetReady,true);
  assert.equal(men.find(m=>m.id===man.id).enabled,false);
  assert.equal(men.find(m=>m.id===man.id).route,"not_connected");
  assert.equal(men.filter(m=>m.cabinetReady).length,2);
  assert.throws(()=>requireClientPublicationRoute(man.id),/not connected/);
 }
});
test("mismatched or incomplete credentials do not grant cabinet entry",()=>{
 const id="yan_second";
 for(const patch of [
  {accountId:"yan_03"},{proxyVerified:false},{ipVerified:false},
  {siteConfigured:false},{boundProxyVersion:3},{loginVerified:false},
  {browserVerified:false}]){
  const men=secondaryCabinetAvailability(new Map([[id,{...ready(id),...patch}]]));
  assert.equal(men.find(m=>m.id===id).cabinetReady,false);
 }
});
test("client reads a server-provided cabinet readiness flag, not publisher permission",()=>{
 const html=fs.readFileSync("anketa/mini-preview.html","utf8");
 assert.ok(html.includes("cabinetReady:record.cabinetReady===true"));
 assert.ok(html.includes("man.cabinetReady===true"));
 assert.ok(html.includes('selectedProgress.rating'));
 assert.ok(html.includes('connected?"check_in_bot":"account_disabled"'));
});

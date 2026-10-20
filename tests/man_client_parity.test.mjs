import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {clientMenAvailability,LEGACY_CLIENT_ROUTE,requireClientPublicationRoute} from "../src/man_client_parity.js";
test("30 client men use exactly one shared stage contract, but only Yan First is available",()=>{
 const men=clientMenAvailability();
 assert.equal(men.length,30);assert.equal(new Set(men.map(x=>x.id)).size,30);
 assert.equal(men[0].id,"yan_first");assert.equal(men[1].id,"yan_second");
 assert.equal(men.filter(x=>x.enabled).length,1);
 for(const [i,man] of men.entries()){
  assert.deepEqual(man.ratingRoute,LEGACY_CLIENT_ROUTE.rating);
  assert.deepEqual(man.reviewRoute,LEGACY_CLIENT_ROUTE.review);
  if(i>0){assert.equal(man.enabled,false);assert.equal(man.route,"not_connected");}
 }
});
test("client cannot dispatch an unconnected man to the legacy publisher",()=>{
 assert.deepEqual(requireClientPublicationRoute("yan_first"),{accountId:"yan_first",route:"legacy_yan_first"});
 for(const x of clientMenAvailability().slice(1))assert.throws(()=>requireClientPublicationRoute(x.id),/not connected/);
});
test("client catalog is server-bound and Mini App JS still parses",()=>{
 const html=fs.readFileSync("anketa/mini-preview.html","utf8");
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 new vm.Script(script[1]);
 assert.match(html,/function applyServerMen\(rows\)/);
 assert.match(html,/applyServerMen\(data\.men\)/);
 assert.match(html,/if\(!availableMen\.some\(m=>m\.id===account&&m\.visible!==false\)\)return/);
 assert.match(html,/selectedAccount!=="yan_first"\?"account_disabled"/);
});

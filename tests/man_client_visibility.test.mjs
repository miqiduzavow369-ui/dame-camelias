import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
import {manVisibility,changeManVisibility,clientManVisibilityMap} from "../src/man_client_visibility.js";
const owner="123456789";
function storage(){
 const map=new Map();
 const tx={get:async key=>map.get(key),put:async(key,value)=>{map.set(key,value)},transaction:async fn=>fn(tx)};
 return tx;
}
test("all 30 visibility defaults preserve existing client display and are separate",async()=>{
 const db=storage();
 const map=await clientManVisibilityMap(db,MAN_ACCOUNTS);
 assert.equal(map.size,30);
 for(const man of MAN_ACCOUNTS)assert.equal(map.get(man.id),true);
 const id="yan_second";
 const record=await changeManVisibility(db,{actorId:owner,cabinetId:owner,ownerId:owner,accountId:id,visible:false,expectedVersion:0});
 assert.equal(record.visible,false);
 assert.equal((await manVisibility(db,id)).version,1);
 assert.equal((await manVisibility(db,"yan_first")).visible,true);
 assert.equal((await manVisibility(db,"yan_03")).visible,true);
 await assert.rejects(()=>changeManVisibility(db,{actorId:owner,cabinetId:owner,ownerId:owner,accountId:id,visible:true,expectedVersion:0}),/version conflict/);
 await assert.rejects(()=>changeManVisibility(db,{actorId:"222222222",cabinetId:owner,ownerId:owner,accountId:id,visible:true,expectedVersion:1}),/Forbidden/);
 const restored=await changeManVisibility(db,{actorId:owner,cabinetId:owner,ownerId:owner,accountId:id,visible:true,expectedVersion:1});
 assert.equal(restored.visible,true);
});
test("visibility wiring exists exclusively in ADMIN and signed client snapshot",()=>{
 const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
 const api=fs.readFileSync("src/admin_app_api.js","utf8");
 const html=fs.readFileSync("admin/preview-v3.html","utf8");
 const client=fs.readFileSync("anketa/mini-preview.html","utf8");
 assert.match(api,/secondary_man_approval_set/);
 assert.match(api,/man_visibility_set/);
 assert.match(runtime,/event.kind==="admin_man_visibility"/);
 assert.match(runtime,/clientManVisibilityMap\(storage,MAN_ACCOUNTS\)/);
 assert.match(client,/visible:record.visible!==false/);
 assert.match(client,/availableMen.filter\(m=>m.visible!==false\)/);
 assert.match(html,/toggleManClientVisibility/);
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new vm.Script(script[1]));
});

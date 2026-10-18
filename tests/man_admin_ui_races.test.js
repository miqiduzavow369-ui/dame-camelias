import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const html=readFileSync(new URL("../admin/preview-v3.html",import.meta.url),"utf8");
const start=html.indexOf("async function reloadManHistory(");
const stop=html.indexOf("function searchMen(v)",start);
if(start<0||stop<start)throw Error("Man detail functions not found");
const functions=html.slice(start,stop);
const deferred=()=>{
 let resolve,reject;
 const promise=new Promise((r,j)=>{resolve=r;reject=j});
 return {promise,resolve,reject};
};
function harness(callAdmin){
 const scope={
  selectedManId:"yan_second",menHistoryRequest:0,menHistory:[],menHistoryError:"",
  manAccounts:[
   {id:"yan_second",setup:{version:0,stage:"not_configured"}},
   {id:"yan_03",setup:{version:0,stage:"not_configured"}}
  ],
  menChanging:false,menBusy:false,menError:"",state:{page:"man-detail"},
  render:()=>{},toast:()=>{},callAdmin
 };
 vm.createContext(scope);
 vm.runInContext(functions+";globalThis.actions={reloadManHistory,changeManPlanning,reloadMen};",scope);
 return scope;
}
test("late history from former account must not overwrite current man's history",async()=>{
 const second=deferred(),third=deferred();
 const s=harness((_action,req)=>req.accountId==="yan_second"?second.promise:third.promise);
 const a=s.actions.reloadManHistory("yan_second");
 s.selectedManId="yan_03";
 const b=s.actions.reloadManHistory("yan_03");
 third.resolve({items:[{accountId:"yan_03",version:1}]});
 await b;
 second.resolve({items:[{accountId:"yan_second",version:2}]});
 await a;
 assert.equal(s.menHistory.length,1);
 assert.equal(s.menHistory[0].accountId,"yan_03");
});
test("older request for the SAME account cannot replace fresher history",async()=>{
 const old=deferred(),fresh=deferred();
 let count=0;
 const s=harness(()=>++count===1?old.promise:fresh.promise);
 const first=s.actions.reloadManHistory("yan_second");
 const second=s.actions.reloadManHistory("yan_second");
 fresh.resolve({items:[{accountId:"yan_second",version:2}]});
 await second;
 old.resolve({items:[{accountId:"yan_second",version:1}]});
 await first;
 assert.equal(s.menHistory[0].version,2);
});
test("planning response updates original man even if user switches cards",async()=>{
 const pending=deferred();
 const s=harness((action,req)=>{
  assert.equal(action,"man_setup_draft");
  assert.equal(req.accountId,"yan_second");
  return pending.promise;
 });
 const op=s.actions.changeManPlanning("plan");
 s.selectedManId="yan_03";
 pending.resolve({setup:{accountId:"yan_second",version:1,stage:"awaiting_credentials",canPublish:false}});
 await op;
 assert.equal(s.manAccounts[0].setup.version,1);
 assert.equal(s.manAccounts[1].setup.version,0);
 assert.equal(s.menHistory.length,0);
});

test("network error on refresh preserves cached accounts and renders current detail",async()=>{
 let renders=0;
 const s=harness(async()=>{throw Error("offline")});
 s.render=()=>{renders++};
 const original=s.manAccounts;
 await s.actions.reloadMen();
 assert.equal(s.manAccounts,original);
 assert.equal(s.manAccounts.length,2);
 assert.match(s.menError,/Ошибка загрузки/);
 assert.equal(s.menBusy,false);
 assert.ok(renders>=1);
});
test("failed planning operation preserves other man's cached status",async()=>{
 const s=harness(async()=>{throw Error("offline")});
 await s.actions.changeManPlanning("plan");
 assert.equal(s.manAccounts.length,2);
 assert.equal(s.manAccounts[0].setup.version,0);
 assert.equal(s.manAccounts[1].setup.version,0);
 assert.match(s.menError,/Ошибка загрузки/);
 assert.equal(s.menChanging,false);
});

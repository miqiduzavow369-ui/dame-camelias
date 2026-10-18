import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {STAGING_DASHBOARD_HTML} from "../src/man_staging_dashboard.js";

// Exercise the real inline load() function without making any network calls.
const start=STAGING_DASHBOARD_HTML.indexOf("async function load(){");
const end=STAGING_DASHBOARD_HTML.indexOf("async function boot(){",start);
if(start<0||end<0)throw Error("staging queue loader missing");
const source=STAGING_DASHBOARD_HTML.slice(start,end);
function deferred(){
 let resolve,reject;
 const promise=new Promise((yes,no)=>{resolve=yes;reject=no});
 return {promise,resolve,reject};
}
function harness(api){
 const rendered=[],empty={textContent:""};
 const scope={
  queueRequestVersion:0,select:{value:"yan_second"},
  api,empty,jobRow:x=>x,
  list:{replaceChildren(){rendered.length=0},appendChild(x){rendered.push(x)}}
 };
 vm.createContext(scope);
 vm.runInContext(source+";globalThis.loadQueue=load;",scope);
 return {scope,rendered,load:()=>scope.loadQueue()};
}
test("stale response from previously selected man never replaces current history",async()=>{
 const old=deferred(),fresh=deferred();
 const h=harness((_action,payload)=>payload.accountId==="yan_second"?old.promise:fresh.promise);
 const first=h.load();
 h.scope.select.value="yan_03";
 const second=h.load();
 fresh.resolve({items:[{accountId:"yan_03",status:"queued"}]});
 await second;
 old.resolve({items:[{accountId:"yan_second",status:"queued"}]});
 await first;
 assert.equal(h.rendered.length,1);
 assert.equal(h.rendered[0].accountId,"yan_03");
});
test("out-of-order refreshes for same man retain most recent result",async()=>{
 const old=deferred(),fresh=deferred();let count=0;
 const h=harness(()=>++count===1?old.promise:fresh.promise);
 const first=h.load(),second=h.load();
 fresh.resolve({items:[{accountId:"yan_second",status:"completed"}]});
 await second;
 old.resolve({items:[{accountId:"yan_second",status:"queued"}]});
 await first;
 assert.equal(h.rendered[0].status,"completed");
});
test("empty latest result clears the old list; stale nonempty result cannot refill it",async()=>{
 const old=deferred(),fresh=deferred();let count=0;
 const h=harness(()=>++count===1?old.promise:fresh.promise);
 const first=h.load(),second=h.load();
 fresh.resolve({items:[]});
 await second;
 old.resolve({items:[{accountId:"yan_second"}]});
 await first;
 assert.equal(h.rendered.length,0);
 assert.match(h.scope.empty.textContent,/Заданий пока нет/);
});

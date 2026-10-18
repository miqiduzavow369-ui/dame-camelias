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
const fixtureRow=(accountId="yan_second",status="queued")=>({accountId,status,profileId:"652282",kind:"review",nonce:"abcdef123456",createdAt:100,correlationKey:"man-mock-v1:5866034656:"+accountId+":652282:review:abcdef123456",sitePublished:false,creditsDebited:false});
test("stale response from previously selected man never replaces current history",async()=>{
 const old=deferred(),fresh=deferred();
 const h=harness((_action,payload)=>payload.accountId==="yan_second"?old.promise:fresh.promise);
 const first=h.load();
 h.scope.select.value="yan_03";
 const second=h.load();
 fresh.resolve({items:[fixtureRow("yan_03","queued")]});
 await second;
 old.resolve({items:[fixtureRow("yan_second","queued")]});
 await first;
 assert.equal(h.rendered.length,1);
 assert.equal(h.rendered[0].accountId,"yan_03");
});
test("out-of-order refreshes for same man retain most recent result",async()=>{
 const old=deferred(),fresh=deferred();let count=0;
 const h=harness(()=>++count===1?old.promise:fresh.promise);
 const first=h.load(),second=h.load();
 fresh.resolve({items:[fixtureRow("yan_second","completed")]});
 await second;
 old.resolve({items:[fixtureRow("yan_second","queued")]});
 await first;
 assert.equal(h.rendered[0].status,"completed");
});
test("empty latest result clears the old list; stale nonempty result cannot refill it",async()=>{
 const old=deferred(),fresh=deferred();let count=0;
 const h=harness(()=>++count===1?old.promise:fresh.promise);
 const first=h.load(),second=h.load();
 fresh.resolve({items:[]});
 await second;
 old.resolve({items:[fixtureRow("yan_second")]});
 await first;
 assert.equal(h.rendered.length,0);
 assert.match(h.scope.empty.textContent,/Заданий пока нет/);
});

test("obsolete network error is ignored after switching to another man",async()=>{
 const old=deferred(),fresh=deferred();
 const h=harness((_action,payload)=>payload.accountId==="yan_second"?old.promise:fresh.promise);
 const first=h.load();
 h.scope.select.value="yan_03";
 const second=h.load();
 fresh.resolve({items:[fixtureRow("yan_03","completed")]});
 await second;
 old.reject(Error("offline for prior account"));
 await assert.doesNotReject(first);
 assert.equal(h.rendered[0].accountId,"yan_03");
});
test("obsolete network error on same man does not override latest refresh",async()=>{
 const old=deferred(),fresh=deferred();let count=0;
 const h=harness(()=>++count===1?old.promise:fresh.promise);
 const first=h.load(),second=h.load();
 fresh.resolve({items:[fixtureRow("yan_second","completed")]});
 await second;
 old.reject(Error("obsolete connection"));
 await assert.doesNotReject(first);
 assert.equal(h.rendered[0].status,"completed");
});
test("latest network error remains visible to the caller and preserves cached history",async()=>{
 const h=harness(async()=>{throw Error("current connection failed")});
 h.rendered.push(fixtureRow("yan_second","queued"));
 await assert.rejects(h.load(),/current connection failed/);
 assert.equal(h.rendered.length,1);
 assert.equal(h.rendered[0].status,"queued");
});

test("cross-account server response is rejected without clearing previous history",async()=>{
 const h=harness(async()=>({items:[fixtureRow("yan_03")]}));
 h.rendered.push(fixtureRow("yan_second","completed"));
 await assert.rejects(h.load(),/Некорректная история/);
 assert.equal(h.rendered[0].accountId,"yan_second");
 assert.equal(h.rendered[0].status,"completed");
});
test("malformed response never reaches queue history or action buttons",async()=>{
 for(const result of [
  {items:null},{items:[{...fixtureRow(),sitePublished:true}]},
  {items:[{...fixtureRow(),profileId:{value:"652282"}}]},
  {items:[{...fixtureRow(),correlationKey:null}]},
  {items:[{...fixtureRow(),correlationKey:fixtureRow("yan_03").correlationKey}]},
  {items:[{...fixtureRow(),status:"published"}]}
 ]){
  const h=harness(async()=>result);
  await assert.rejects(h.load(),/Некорректная история/);
  assert.equal(h.rendered.length,0);
 }
});

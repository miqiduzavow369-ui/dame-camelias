import test from "node:test";
import assert from "node:assert/strict";
import {publicationEligibility} from "../src/client_publication_policy.js";
function mock(credit,day){
 const calls=[];
 return {calls,ORDER_REMINDERS:{
  idFromName:name=>name,
  get:name=>({fetch:async(_url,request)=>{
   const body=JSON.parse(request.body);calls.push({name,body});
   const value=name.startsWith("client-registry:")?{client:{id:"5627932577",grant:2,revision:1}}:name.startsWith("publication-credits:")?credit:day;
   if(value instanceof Error)return {ok:false};
   return {ok:true,json:async()=>value};
  }})
 }};
}
test("no client publication without available credits and global daily permission",async()=>{
 const uid="5627932577",pid="698842";
 for(const [credit,day,reason] of [
  [{available:0},{remaining:2},"credits"],
  [{available:2},{remaining:0},"daily_limit"],
  [{available:2},{allowed:true},"daily_limit"],
  [{remaining:2},{remaining:2},"credits"]]){
  const env=mock(credit,day);
  assert.equal((await publicationEligibility(env,uid,pid,"review")).reason,reason);
 }
});
test("global profile daily namespace independent of client",async()=>{
 const env=mock({available:2},{remaining:2});
 const result=await publicationEligibility(env,"5627932577","698842","rating");
 assert.equal(result.allowed,true);
 assert.equal(result.remaining,2);
 assert.ok(env.calls.some(c=>c.name.startsWith("publication-credits:5627932577")));
 assert.ok(env.calls.some(c=>c.name.startsWith("daily-profile:698842:")));
 assert.ok(env.calls.every(c=>c.body.userId==="5627932577"));
});
test("unknown response and invalid requests fail closed",async()=>{
 assert.equal((await publicationEligibility(mock({available:2},new Error("failed")),"5627932577","698842","review")).allowed,false);
 assert.equal((await publicationEligibility(mock({available:2},{remaining:2}),"invalid","698842","review")).allowed,false);
 assert.equal((await publicationEligibility(mock({remaining:2},{allowed:true}),"5627932577","698842","other")).allowed,false);
});

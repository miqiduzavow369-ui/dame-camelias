import test from "node:test";
import assert from "node:assert/strict";
import {checkDiaryManualHistory} from "../src/city_diary_eligibility.js";
const base={accountId:"yan_second",profileId:"12345",action:"review",
 archive:[],statuses:{},existingPlans:[]};
test("already published manual City review blocks only same man and kind",()=>{
 const archive=[{account:"yan_second",profileId:"12345",kind:"review"}];
 assert.equal(checkDiaryManualHistory({...base,archive}).reason,"already_published");
 assert.equal(checkDiaryManualHistory({...base,archive,action:"rating"}).ok,true);
 assert.equal(checkDiaryManualHistory({...base,archive,accountId:"yan_first"}).ok,true);
});
test("publication in progress or moderation blocks planning",()=>{
 for(const state of ["published","checking","moderation","draft_saved","reconciliation_required"]){
  assert.equal(checkDiaryManualHistory({...base,statuses:{review:state}}).ok,false,state);
 }
});
test("an already scheduled action cannot be duplicated through the diary",()=>{
 const existingPlans=[{id:"event1",accountId:"yan_second",profileId:"12345",
   mode:"publication",action:"rating_review",status:"scheduled"}];
 assert.equal(checkDiaryManualHistory({...base,existingPlans}).reason,"already_planned");
 assert.equal(checkDiaryManualHistory({...base,existingPlans,excludeEventId:"event1"}).ok,true);
 assert.equal(checkDiaryManualHistory({...base,existingPlans,accountId:"yan_first"}).ok,true);
});
test("combined review and rating requires both actions available",()=>{
 const archive=[{account:"yan_second",profileId:"12345",kind:"rating"}];
 assert.equal(checkDiaryManualHistory({...base,action:"rating_review",archive}).kind,"rating");
});
test("missing identity and corrupt archive fail closed",()=>{
 assert.equal(checkDiaryManualHistory({...base,accountId:null}).ok,false);
 assert.equal(checkDiaryManualHistory({...base,archive:null}).ok,false);
});

import test from "node:test";
import assert from "node:assert/strict";
import {assessDiaryConnection} from "../src/city_diary_preflight.js";

const valid={profileConfirmed:true,domainChanged:false,currentVersionVerified:true,
 identityVerified:true,ownerApproved:true};
test("no site status or changed domain fails closed",()=>{
 assert.deepEqual(assessDiaryConnection(),{ready:false,reason:"connection_unavailable"});
 assert.equal(assessDiaryConnection({...valid,domainChanged:true}).reason,"domain_changed");
});
test("stale versions, identity and owner approval fail closed",()=>{
 for(const field of ["profileConfirmed","currentVersionVerified","identityVerified","ownerApproved"]){
  const v=assessDiaryConnection({...valid,[field]:false});
  assert.equal(v.ready,false,field);
 }
});
test("passing diagnostics explicitly do not permit publication",()=>{
 const v=assessDiaryConnection(valid);
 assert.equal(v.ready,true);
 assert.equal(v.publicationAuthorized,false);
});

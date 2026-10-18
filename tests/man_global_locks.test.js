import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {globalPublicationLock,globalReviewLock,globalDailyLock} from "../src/man_global_locks.js";

const men=["yan_first","yan_second","yan_03","yan_30"];
test("all 30 men share the exact legacy publication lock namespace",()=>{
 for(const type of ["rating","review"]){
  const ids=men.map(man=>globalPublicationLock(man,"652282",type));
  assert.equal(new Set(ids).size,1);
  assert.equal(ids[0],"publication-claim:yan_first:"+type+":652282");
 }
});
test("review idempotency is shared across men",()=>{
 const ids=men.map(man=>globalReviewLock(man,"652282"));
 assert.equal(new Set(ids).size,1);
 assert.equal(ids[0],"review-publication:yan_first:652282");
});
test("daily allowance is shared across men and Telegram customers",()=>{
 const ids=men.map(man=>globalDailyLock(man,"652282","2026-10-18"));
 assert.equal(new Set(ids).size,1);
 assert.equal(ids[0],"daily-profile:652282:2026-10-18");
});
test("different profiles, kinds, and days are separate locks",()=>{
 assert.notEqual(globalPublicationLock("yan_second","652282","review"),globalPublicationLock("yan_second","652283","review"));
 assert.notEqual(globalPublicationLock("yan_second","652282","review"),globalPublicationLock("yan_second","652282","rating"));
 assert.notEqual(globalDailyLock("yan_second","652282","2026-10-18"),globalDailyLock("yan_second","652282","2026-10-19"));
});
test("invalid IDs and dates cannot inject or alias lock keys",()=>{
 for(const man of ["yan_31","yan_first:x",null])
  assert.throws(()=>globalReviewLock(man,"652282"));
 for(const profile of ["652282:other","../652282","",null])
  assert.throws(()=>globalReviewLock("yan_second",profile));
 for(const day of ["2026-02-30","2026-13-01","2026-00-01","2026-2-1","2026-10-18:other"])
  assert.throws(()=>globalDailyLock("yan_second","652282",day));
 assert.throws(()=>globalPublicationLock("yan_second","652282","publish"));
});
test("global namespaces match the existing production declarations",()=>{
 const prodClaim=readFileSync(new URL("../src/publication_claim.js",import.meta.url),"utf8");
 const prodReview=readFileSync(new URL("../src/review_publication_guard.js",import.meta.url),"utf8");
 const prodDaily=readFileSync(new URL("../src/daily_publication_limit.js",import.meta.url),"utf8");
 assert.ok(prodClaim.includes('"publication-claim:yan_first:"'));
 assert.ok(prodReview.includes('"review-publication:"+OWNER_ACCOUNT+":"'));
 assert.ok(prodDaily.includes('"daily-profile:"+id+":"+date'));
});

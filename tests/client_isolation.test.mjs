import test from "node:test";
import assert from "node:assert/strict";
import {clientKey,guardKey,privateMessageTarget} from "../src/client_isolation.js";
const owner="5866034656",trial="5627932577";
test("owner and client profile state have independent namespaces",()=>{
 for(const k of ["session","flow","library","saved","proof","navigation","selected","pending"]){
  const a=clientKey(owner,k,k==="saved"?"698842":"");
  const b=clientKey(trial,k,k==="saved"?"698842":"");
  assert.notEqual(a,b);
  assert.ok(a.includes(owner));assert.ok(b.includes(trial));
 }
});
test("publication guards stay common for same profile",()=>{
 assert.equal(guardKey("698842","rating"),guardKey("698842","rating"));
 assert.notEqual(guardKey("698842","rating"),guardKey("698842","review"));
});
test("reject injected IDs, unknown key types and cross-chat access",()=>{
 assert.throws(()=>clientKey("bad:value","saved","1"));
 assert.throws(()=>clientKey(owner,"saved","../"));
 assert.throws(()=>clientKey(trial,"admin"));
 assert.equal(privateMessageTarget(trial,trial,"private",trial),true);
 assert.equal(privateMessageTarget(owner,owner,"private",trial),false);
 assert.equal(privateMessageTarget(trial,owner,"private",trial),false);
 assert.equal(privateMessageTarget(trial,trial,"group",trial),false);
});

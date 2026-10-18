import test from "node:test";
import assert from "node:assert/strict";
import {ownerManRegistry} from "../src/man_admin_registry.js";
const owner="5866034656";
test("read-only inventory requires exact owner actor and owner cabinet",()=>{
 assert.equal(ownerManRegistry(owner,owner,owner).ok,true);
 for(const [actor,uid] of [["5866034657",owner],[owner,"5866034657"],["",owner],[null,owner],[owner,null]])
  assert.deepEqual(ownerManRegistry(actor,uid,owner),{ok:false,status:403});
});
test("returns all thirty names with credentials excluded and second disabled",()=>{
 const r=ownerManRegistry(owner,owner,owner);
 assert.equal(r.accounts.length,30);
 assert.equal(r.readOnly,true);
 assert.equal(r.accounts[0].connection,"legacy_active");
 assert.equal(r.accounts[1].connection,"not_configured");
 assert.equal(r.accounts[29].name,"Ян Тридцатый");
 assert.ok(r.accounts.every(x=>x.configurable===false));
 assert.ok(r.accounts.every(x=>Object.keys(x).every(key=>!/(password|token|host|port|ip|secret)/i.test(key))));
});

import test from "node:test";
import assert from "node:assert/strict";
import {MAN_ACCOUNTS,getManAccount,isKnownManAccount,isManEnabledByDefault,publicManAccounts} from "../src/man_accounts.js";

test("exactly 30 immutable, unique accounts", () => {
 assert.equal(MAN_ACCOUNTS.length, 30);
 assert.equal(new Set(MAN_ACCOUNTS.map(x=>x.id)).size, 30);
 assert.ok(Object.isFrozen(MAN_ACCOUNTS));
 assert.ok(MAN_ACCOUNTS.every(Object.isFrozen));
});
test("existing ids remain stable", () => {
 assert.equal(getManAccount("yan_first").name,"Ян Первый");
 assert.equal(getManAccount("yan_second").name,"Ян Второй");
 assert.equal(getManAccount("yan_30").name,"Ян Тридцатый");
 assert.equal(getManAccount("yan_03").name,"Ян Третий");
});
test("new accounts default disabled and malformed ids rejected", () => {
 assert.equal(isManEnabledByDefault("yan_first"),true);
 assert.equal(MAN_ACCOUNTS.filter(x=>x.enabledByDefault).length,1);
 for(const bad of ["yan_2","YAN_FIRST","yan_31","__proto__",null,2])assert.equal(isKnownManAccount(bad),false);
 assert.ok(publicManAccounts().every(x=>Object.keys(x).sort().join(",")==="enabled,id,name,number"));
});

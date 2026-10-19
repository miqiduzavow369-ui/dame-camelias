import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
import {clientMenAvailability} from "../src/man_client_parity.js";

test("29 secondary men have unique identifiers and remain disabled",()=>{
 const secondary=MAN_ACCOUNTS.slice(1);
 assert.equal(secondary.length,29);
 assert.equal(new Set(secondary.map(x=>x.id)).size,29);
 assert.ok(secondary.every(x=>x.enabledByDefault===false));
 assert.ok(clientMenAvailability().slice(1).every(x=>x.enabled===false&&x.route==="not_connected"));
});
test("owner-only readiness projection does not serialize vault records",()=>{
 const backend=fs.readFileSync("src/cabinet_runtime.js","utf8");
 const block=backend.slice(backend.indexOf('if(event.kind==="admin_man_registry")'),
                            backend.indexOf('if(event.kind==="admin_man_setup_history")'));
 assert.match(block,/if\(uid!==OWNER_ID\|\|event.actorId!==OWNER_ID\)/);
 assert.match(block,/if\(x.id==="yan_first"\)return \[x.id,null\]/);
 assert.match(block,/browserCheckStatus\(/);
 assert.match(block,/browserVerified&&network\?\.ipVerified===true/);
 assert.match(block,/siteIdentityVerified:false,clientUnlocked:false,canPublish:false/);
 assert.doesNotMatch(block,/sealed:|proxyPassword:|sitePassword:/);
});
test("admin renders verified proxy as restricted, never active",()=>{
 const html=fs.readFileSync("admin/preview-v3.html","utf8");
 assert.match(html,/IP ✓ · вход закрыт/);
 assert.match(html,/Вход на сайт и публикации для мужчин 02–30 остаются закрыты/);
});
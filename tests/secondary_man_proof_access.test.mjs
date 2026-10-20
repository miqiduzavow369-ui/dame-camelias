import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
test("client proof route supports all 30 account IDs through private archive authorization",()=>{
 const runtime=fs.readFileSync("src/cabinet_runtime.js","utf8");
 const index=fs.readFileSync("src/index.js","utf8");
 const start=runtime.indexOf('if(event.kind==="mini_proof")');
 const end=runtime.indexOf('if(event.kind==="mini_preview")',start);
 assert.ok(start>0&&end>start);
 const block=runtime.slice(start,end);
 assert.match(block,/MAN_ACCOUNTS\.some\(man=>man\.id===account\)/);
 assert.match(block,/agreementStatus\(env,uid\)/);
 assert.match(block,/readPublicationArchive\(storage,rawEnv\.VISITORS_KV,uid\)/);
 assert.match(block,/item\.account===account/);
 assert.ok(index.includes('url.pathname==="/api/anketa/mini-proof"'));
 assert.ok(index.includes('validWebApp(body?.initData,env.BOT_TOKEN,3600)'));
 assert.equal(MAN_ACCOUNTS.length,30);
});

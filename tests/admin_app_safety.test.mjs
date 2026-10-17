import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const html=readFileSync(new URL('../admin/preview-v3.html',import.meta.url),'utf8');
const index=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const api=readFileSync(new URL('../src/admin_app_api.js',import.meta.url),'utf8');

test('ADMIN V3 inline JavaScript parses',()=>{
 const matches=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
 assert.equal(matches.length,1);
 new Script(matches[0][1],{filename:'admin/preview-v3.html'});
});
test('ADMIN uses live API and never commits demo operations',()=>{
 assert.match(html,/callAdmin\('clients'\)/);
 assert.match(html,/async function commitLive\(/);
 assert.doesNotMatch(html,/commitDemo\(\)/);
 assert.match(html,/Модерация пока доступна/);
});
test('ADMIN routes are isolated from other application endpoints',()=>{
 assert.match(index,/url\.pathname==="\/api\/admin\/app"/);
 assert.match(index,/handleAdminApi\(request,env\)/);
 assert.match(api,/validWebApp\(input\?\.initData,env\.BOT_TOKEN/);
 assert.match(api,/String\(JSON\.parse\(new URLSearchParams\(input\.initData\)/);
 assert.match(api,/OWNER_ID/);
});
test('ADMIN writes reuse existing atomic providers',()=>{
 assert.match(api,/registry\(env,mutation\)/);
 assert.match(api,/adjustCredits\(env,uid/);
 assert.match(api,/cabinetRPC\(env,uid/);
 assert.match(api,/validOp\(body\.operation\)/);
 assert.doesNotMatch(api,/env\.VISITORS_KV\.put\(/);
});

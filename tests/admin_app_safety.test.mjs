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

test('ADMIN archive proofs are owner protected and agreement is status-only',()=>{
 assert.match(api,/action==="archive_proof"/);
 assert.match(api,/archive\.archive\?\.items\?\.find/);
 assert.match(api,/validWebApp\(input\?\.initData,env\.BOT_TOKEN/);
 assert.match(api,/photos/);
 assert.doesNotMatch(api,/agreement_view/);
 assert.doesNotMatch(html,/openAgreement/);
 assert.match(html,/async function loadProof\(/);
 assert.match(html,/padding-bottom:calc\(170px/);
});

test('ADMIN review history reuses only published archives',()=>{
 assert.match(api,/action==="review_history"/);
 assert.match(api,/kind:"admin_archive"/);
 assert.match(api,/x\.kind==="review"/);
 assert.doesNotMatch(api,/moderationRPC\(/);
 assert.match(html,/История отзывов/);
 assert.match(html,/callAdmin\('review_history'\)/);
 assert.doesNotMatch(html,/Модерация в подготовке/);
 assert.doesNotMatch(html,/Входящие отзывы · решения/);
});

test('ADMIN Telegram nicknames and chat links are owner-only UI features',()=>{
 assert.match(api,/telegramUsername\(env/);
 assert.match(api,/getChat/);
 assert.match(api,/usernameCache/);
 assert.match(html,/const chatHref=/);
 assert.match(html,/class="client-chat"/);
 assert.match(html,/class="detail-chat"/);
 assert.match(html,/tg:\/\/user\?id=/);
 assert.match(html,/https:\/\/t\.me\//);
});

test('ADMIN review decisions are durable and never cause duplicate publications',()=>{
 assert.match(api,/moderationHistory\(env\)/);
 assert.match(api,/source:"moderation_decisions_and_publication_archive"/);
 assert.match(html,/Решение по отзыву/);
 assert.match(html,/Отклонено/);
 assert.match(html,/Одобрено/);
 assert.doesNotMatch(api,/moderationRPC\(/);
});

import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
import {MAN_CHECK_ERRORS,readManDiagnostics,prepareManRetry} from "../src/man_check_diagnostics.js";
const owner="1234567890",accountId="yan_second",actor={actorId:owner,cabinetId:owner,ownerId:owner,accountId};
function store(){const m=new Map(),t={get:async k=>m.get(k),put:async(k,v)=>m.set(k,v)};return {...t,transaction:async fn=>fn(t),m};}
test("error taxonomy covers recoverable proxy and Intimcity cases",()=>{
 for(const code of ["proxy_unreachable","proxy_auth_failed","ip_mismatch","proxy_timeout","site_login_rejected","site_identity_mismatch","site_session_expired","executor_unavailable"])assert.ok(MAN_CHECK_ERRORS[code]?.hint,code);
});
test("readiness never claims verified or client unlocked without executor",async()=>{
 const s=store(),env={};
 let d=await readManDiagnostics(s,env,actor);
 assert.equal(d.diagnostic.code,"proxy_key_missing");
 assert.equal(d.prerequisites.clientUnlocked,false);
 assert.equal(d.diagnostic.canPublish,false);
 env.MAN_PROXY_ENCRYPTION_KEY="defined";
 env.MAN_SITE_ENCRYPTION_KEY="defined";
 d=await readManDiagnostics(s,env,actor);
 assert.equal(d.diagnostic.code,"proxy_missing");
 await s.put("man-proxy-sealed-v1:"+accountId,{accountId,version:1,proxyVerified:true,ipVerified:true});
 await s.put("man-intimcity-sealed-v1:"+accountId,{accountId,version:1,identityVerified:true});
 d=await readManDiagnostics(s,env,actor);
 assert.equal(d.diagnostic.code,"executor_unavailable");
 assert.equal(d.prerequisites.siteIdentityVerified,false);
});
test("owner-only versioned retry can never activate an account",async()=>{
 const s=store(),env={};
 await assert.rejects(prepareManRetry(s,env,{...actor,accountId:"yan_first",expectedVersion:0,at:5}));
 await assert.rejects(prepareManRetry(s,env,{...actor,actorId:"9999999999",expectedVersion:0,at:5}));
 let x=await prepareManRetry(s,env,{...actor,expectedVersion:0,at:100});
 assert.equal(x.diagnostic.retryPrepared,true);
 assert.equal(x.diagnostic.canPublish,false);
 await assert.rejects(prepareManRetry(s,env,{...actor,expectedVersion:0,at:101}),/Version conflict/);
 let d=await readManDiagnostics(s,env,actor);
 assert.equal(d.diagnostic.retryPrepared,true);
 await s.put("man-proxy-sealed-v1:"+accountId,{accountId,version:2,proxyVerified:false,ipVerified:false});
 d=await readManDiagnostics(s,env,actor);
 assert.equal(d.diagnostic.retryPrepared,false);
 assert.equal(d.prerequisites.clientUnlocked,false);
});
test("mobile ADMIN JavaScript parses and retry is owner-server-backed",()=>{
 const html=readFileSync("admin/preview-v3.html","utf8");
 const script=html.match(/<script>([\s\S]*?)<\/script>/);assert.ok(script);
 new Script(script[1]);
 for(const marker of ["renderManDiagnostic","reloadManChecks","prepareManCheckRetry","man_check_status","man_check_retry"])assert.ok(html.includes(marker));
});

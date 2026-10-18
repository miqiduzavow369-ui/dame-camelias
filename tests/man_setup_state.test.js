import test from "node:test";
import assert from "node:assert/strict";
import {newManSetup,validateManSetup,advanceManSetup,publicManSetup,MAN_SETUP_STAGES} from "../src/man_setup_state.js";

test("legacy account cannot be modified by new setup controller",()=>{
 assert.throws(()=>newManSetup("yan_first"));
 assert.throws(()=>validateManSetup({}, "yan_first"));
 assert.throws(()=>newManSetup("yan_31"));
});
test("new account has disabled, empty, credential-free staging state",()=>{
 const first=newManSetup("yan_second");
 assert.ok(Object.isFrozen(first));
 assert.equal(first.stage,"not_configured");
 assert.equal(first.enabled,false);
 assert.equal(first.configured,false);
 assert.equal(first.proxyVerified,false);
 assert.equal(first.siteIdentityVerified,false);
 assert.equal(first.version,0);
});
test("state transitions require exact version and valid adjacent stage",()=>{
 const start=newManSetup("yan_second");
 const next=advanceManSetup(start,{accountId:"yan_second",expectedVersion:0,nextStage:"awaiting_credentials",at:12345});
 assert.equal(next.version,1);
 assert.equal(next.stage,"awaiting_credentials");
 assert.throws(()=>advanceManSetup(start,{accountId:"yan_second",expectedVersion:1,nextStage:"awaiting_credentials",at:12345}));
 assert.throws(()=>advanceManSetup(start,{accountId:"yan_second",expectedVersion:0,nextStage:"ready_for_owner_approval",at:12345}));
 assert.throws(()=>advanceManSetup(start,{accountId:"yan_third",expectedVersion:0,nextStage:"awaiting_credentials",at:12345}));
});
test("even approved staging cannot enable site access",()=>{
 let state=newManSetup("yan_30");
 for (const stage of MAN_SETUP_STAGES.slice(1,5)){
   state=advanceManSetup(state,{accountId:"yan_30",expectedVersion:state.version,nextStage:stage,at:100+state.version});
 }
 const ui=publicManSetup(state,"yan_30");
 assert.equal(ui.stage,"ready_for_owner_approval");
 assert.equal(ui.canPublish,false);
 assert.equal(ui.canEditCredentials,false);
 assert.equal(ui.canChangeProxy,false);
 assert.throws(()=>validateManSetup({...state,enabled:true},"yan_30"));
});
test("injected secret fields get stripped from persisted projection",()=>{
 const draft={...newManSetup("yan_second"),proxyPassword:"secret",sitePassword:"secret",host:"test.invalid"};
 const projected=validateManSetup(draft,"yan_second");
 assert.equal(JSON.stringify(projected).includes("secret"),false);
 assert.equal(Object.hasOwn(projected,"host"),false);
});

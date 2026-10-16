import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src/owner_anketa.js",import.meta.url),"utf8");
test("Mini App lookup source is marked before dispatch",()=>{
 assert.match(source,/step:"loading",source:"mini_app"/);
});
test("Mini App lookup success and failure return before legacy chat messages",()=>{
 const block=source.indexOf('if(current?.step==="loading"&&current.source==="mini_app"&&current.id===id');
 const firstFound=source.indexOf('const found=data.status==="found"?validProfile(data.profile,id,current.host):null;',block);
 const legacy=source.indexOf('const found=data.status==="found"?validProfile(data.profile,id,current.host):null;',firstFound+20);
 assert.ok(block>0&&legacy>block);
 const mini=source.slice(block,legacy);
 assert.match(mini,/step:"confirm",source:"mini_app"/);
 assert.match(mini,/return Response\.json\(\{ok:true,found:true\}\)/);
 assert.doesNotMatch(mini,/navigationSay\(|say\(env,send/);
});
test("Lookup error does not send legacy recovery notices",()=>{
 const first=source.indexOf('if(data.status==="error"&&current?.step==="loading"&&current.source==="mini_app"');
 const legacy=source.indexOf('if(data.status==="error"&&current?.id===id',first);
 assert.ok(first>0&&legacy>first);
 assert.match(source.slice(first,legacy),/return Response\.json/);
});

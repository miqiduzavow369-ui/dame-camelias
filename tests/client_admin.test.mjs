import test from "node:test";
import assert from "node:assert/strict";
import {handleClientAdmin} from "../src/client_admin.js";
function fixture(){
 const kv=new Map(),sent=[];
 const env={VISITORS_KV:{get:async k=>kv.has(k)?JSON.parse(kv.get(k)):null,put:async(k,v)=>kv.set(k,v),delete:async k=>kv.delete(k)}};
 const send=async(e,method,data)=>{sent.push({method,data});return {message_id:sent.length};};
 const click=(id,action)=>({callback_query:{id:"q",from:{id},data:"client_admin:"+action,message:{chat:{id,type:"private"}}}});
 const msg=(id,text)=>({message:{from:{id},chat:{id,type:"private"},text}});
 return {env,send,kv,sent,click,msg};
}
test("reject another Telegram ID",async()=>{
 const f=fixture();
 assert.equal(await handleClientAdmin(f.click(123456789,"open"),f.env,f.send),true);
 assert.equal(f.kv.size,0);
 assert.equal(f.sent.some(x=>x.method==="sendMessage"),false);
});
test("requires authenticated owner session",async()=>{
 const f=fixture();
 await handleClientAdmin(f.click(5866034656,"open"),f.env,f.send);
 assert.match(f.sent.at(-1).data.text,/Сначала войдите/);
 assert.equal(f.kv.size,0);
});
test("records a pending request without storing the PIN or altering credits",async()=>{
 const f=fixture(),owner=5866034656;
 f.kv.set("owner_cabinet_session:"+owner,JSON.stringify({authorized:true}));
 for(const [kind,value] of [["cb","add"],["msg","5627932577"],["msg","2222"],["msg","2"],["cb","confirm"]]){
  await handleClientAdmin(kind==="cb"?f.click(owner,value):f.msg(owner,value),f.env,f.send);
 }
 const rec=JSON.parse(f.kv.get("dc_client_registry_v1:records"));
 assert.equal(rec["5627932577"].publications,2);
 assert.equal(rec["5627932577"].enabled,false);
 assert.equal(rec["5627932577"].status,"pending_integration");
 assert.ok(!JSON.stringify([...f.kv]).includes("2222"));
 assert.equal(f.kv.has("publication-credits:5627932577"),false);
});

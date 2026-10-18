// Isolated manual integration sandbox. NOT the production bot.
// Deliberately no GitHub workflows, Telegram send API, proxy, customer KV, or site calls.
import {validWebApp} from "./telegram_auth.js";
import {MAN_ACCOUNTS} from "./man_accounts.js";
import {ownerManRegistry} from "./man_admin_registry.js";
import {readManSetupDrafts,changeManSetupDraft,readManSetupHistory} from "./man_setup_store.js";
import {listMockManQueue} from "./man_mock_queue_view.js";
import {enqueueMockManTask,finishMockManTask} from "./man_mock_queue.js";
import {moscowDay} from "./daily_publication_limit.js";
import {requireManId} from "./man_account_isolation.js";
import {STAGING_DASHBOARD_HTML} from "./man_staging_dashboard.js";

const OWNER_ID="5866034656";
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const json=(value,status=200)=>Response.json(value,{status,headers});
const MAX_BODY_BYTES=16000;
async function boundedJson(request){
 const advertised=Number(request.headers.get("content-length")||0);
 if(!Number.isFinite(advertised)||advertised>MAX_BODY_BYTES)return {tooLarge:true};
 // Read no more than MAX_BODY_BYTES + 1, even if Content-Length is absent or false.
 const reader=request.body?.getReader();
 if(!reader)return {invalid:true};
 const parts=[];let bytes=0;
 try{
  while(true){
   const item=await reader.read();
   if(item.done)break;
   bytes+=item.value.byteLength;
   if(bytes>MAX_BODY_BYTES){await reader.cancel().catch(()=>{});return {tooLarge:true};}
   parts.push(item.value);
  }
  const combined=new Uint8Array(bytes);
  let offset=0;for(const p of parts){combined.set(p,offset);offset+=p.byteLength;}
  const value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(combined));
  return value&&typeof value==="object"&&!Array.isArray(value)?{value}:{invalid:true};
 }catch{return {invalid:true};}
 finally{reader.releaseLock();}
}
export class ManStagingAccounts {
 constructor(state){this.storage=state.storage;}
 async fetch(request){
  if(request.method!=="POST")return json({ok:false,reason:"method_not_allowed"},405);
  const body=await request.json().catch(()=>null);
  if(!body || body.ownerId!==OWNER_ID)return json({ok:false,reason:"forbidden"},403);
  try{
   if(body.action==="list"){
    const info=ownerManRegistry(OWNER_ID,OWNER_ID,OWNER_ID);
    const drafts=await readManSetupDrafts(this.storage,OWNER_ID,OWNER_ID,OWNER_ID,MAN_ACCOUNTS);
    const lookup=new Map(drafts.map(x=>[x.id,x.setup]));
    return json({...info,accounts:info.accounts.map(x=>({...x,setup:lookup.get(x.id)??null}))});
   }
   if(body.action==="history"){
    const items=await readManSetupHistory(this.storage,OWNER_ID,OWNER_ID,OWNER_ID,body.accountId);
    return json({ok:true,items});
   }
   if(body.action==="mock_queue"){
    const items=await listMockManQueue(this.storage,{actorId:OWNER_ID,ownerId:OWNER_ID,accountId:body.accountId});
    return json({ok:true,items,simulationOnly:true});
   }
   if(body.action==="mock_seed"){
    requireManId(body.accountId);
    if(body.accountId==="yan_first"||!/^[0-9]{1,9}$/.test(body.profileId)||!["rating","review"].includes(body.kind))throw Error("Invalid mock input");
    if(typeof this.storage.list!=="function")throw Error("Mock queue unavailable");
    if((await this.storage.list({prefix:"man-mock-queue-v1:",limit:301})).size>=300)throw Error("Mock queue at capacity");
    const nonce=crypto.randomUUID().replace(/-/g,"").slice(0,12);
    const result=await enqueueMockManTask(this.storage,{
     actorId:OWNER_ID,ownerId:OWNER_ID,
     identity:{userId:OWNER_ID,accountId:body.accountId,profileId:body.profileId,kind:body.kind,nonce},
     moscowDate:moscowDay(),at:Date.now(),
     // Hard-coded synthetic activation for test-only handoff; no real auth or proxy.
     serverActivation:{accountId:body.accountId,enabled:true,proxyVerified:true,siteIdentityVerified:true,version:1}
    });
    return json({...result,ok:true,simulationOnly:true});
   }
   if(body.action==="mock_finish"){
    if(typeof body.correlationKey!=="string"||!/^man-mock-v1:[0-9]{5,16}:yan_(?:second|[0-9]{2}):[0-9]{1,9}:(?:rating|review):[a-f0-9]{12}$/.test(body.correlationKey))throw Error("Invalid mock reference");
    const item=await this.storage.get("man-mock-queue-v1:"+body.correlationKey);
    if(!item?.task||item.task.correlationKey!==body.correlationKey)throw Error("Unknown mock job");
    const result=await finishMockManTask(this.storage,{
     actorId:OWNER_ID,ownerId:OWNER_ID,task:item.task,moscowDate:item.moscowDate,
     result:body.outcome==="mock_rejected"?"mock_rejected":body.outcome==="mock_success"?"mock_success":"invalid",at:Date.now()
    });
    return json({...result,ok:true,simulationOnly:true});
   }
   if(body.action==="draft"){
    const result=await changeManSetupDraft(this.storage,{
     actorId:OWNER_ID,cabinetId:OWNER_ID,ownerId:OWNER_ID,
     accountId:body.accountId,expectedVersion:body.expectedVersion,
     action:body.setupAction,at:Date.now()
    });
    return json(result);
   }
   return json({ok:false,reason:"unknown_action"},400);
  }catch{return json({ok:false,reason:"operation_rejected"},409);}
 }
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==="/test-admin"&&request.method==="GET")
   return new Response(STAGING_DASHBOARD_HTML,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY"}});
  if(url.pathname==="/health" && request.method==="GET")
   return json({ok:true,environment:"man-staging",publicationEnabled:false});
  if(url.pathname!=="/api/man-staging"||request.method!=="POST")
   return json({ok:false,reason:"not_found"},404);
  if(env.MAN_STAGING_ONLY!=="true"||
     env.CABINET_PUBLICATIONS_ENABLED!=="false"||
     env.CABINET_CLIENTS_ENABLED!=="false"||
     !env.MAN_STAGING_ACCOUNTS||
     typeof env.MAN_STAGING_BOT_TOKEN!=="string"||
     !env.MAN_STAGING_BOT_TOKEN||
     // Fail closed if a staging deploy accidentally receives a production binding.
     // The staging worker must never have access to customer data or bot secrets.
     "ORDER_REMINDERS" in env||
     "VISITORS_KV" in env||
     "BOT_TOKEN" in env||
     "ANKETA_CALLBACK_TOKEN" in env||
     "INTIMCITY_LOGIN" in env||
     "INTIMCITY_PASSWORD" in env||
     "PROXY_PASSWORD" in env)
   return json({ok:false,reason:"staging_unconfigured"},503);
  const parsed=await boundedJson(request);
  if(parsed.tooLarge)return json({ok:false,reason:"too_large"},413);
  const body=parsed.value;
  if(!body || !["list","draft","history","mock_queue","mock_seed","mock_finish"].includes(body.action))
   return json({ok:false,reason:"invalid_request"},400);
  if(!await validWebApp(body.initData,env.MAN_STAGING_BOT_TOKEN,900))
   return json({ok:false,reason:"forbidden"},403);
  let uid="";
  try{uid=String(JSON.parse(new URLSearchParams(body.initData).get("user"))?.id||"");}catch{}
  if(uid!==OWNER_ID)return json({ok:false,reason:"forbidden"},403);
  const payload={ownerId:OWNER_ID,action:body.action,
    accountId:body.accountId,expectedVersion:body.expectedVersion,setupAction:body.setupAction,
    profileId:body.profileId,kind:body.kind,correlationKey:body.correlationKey,outcome:body.outcome};
  const stub=env.MAN_STAGING_ACCOUNTS.get(env.MAN_STAGING_ACCOUNTS.idFromName("owner-man-setup-v1"));
  return stub.fetch("https://staging.internal/",{method:"POST",body:JSON.stringify(payload)});
 }
};

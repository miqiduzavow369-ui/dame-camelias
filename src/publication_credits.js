import {registry} from "./client_registry.js";
// Owner-approved grants. To add credits in a later change, increment revision
// and update totalGranted for the specified Telegram ID. The Durable Object
// applies only the positive difference, preserving spent credits and claims.
const CREDIT_GRANTS={
  "5866034656":{totalGranted:10,revision:1},
  "5627932577":{totalGranted:2,revision:1}
};
// Atomic publication credits, isolated by Telegram user ID.
// Only trusted bot code invokes this private Durable Object.
export async function credits(env,userId,type,kind="",profileId="",nonce=""){
  const id=String(userId);
  if(!env.ORDER_REMINDERS || !/^\d{5,16}$/.test(id))throw Error("Credits unavailable");
  const object=env.ORDER_REMINDERS.get(env.ORDER_REMINDERS.idFromName("publication-credits:"+id));
  let grant=CREDIT_GRANTS[id];
  if(id!=="5866034656"){
    const {client}=await registry(env,{action:"get",userId:id});
    grant=client?{totalGranted:client.grant,revision:client.revision}:{totalGranted:0,revision:0};
  }
  const settlement={ledger:"credits",action:type,userId:id,kind,profileId:String(profileId),nonce};
  if(["complete","release"].includes(type)&&env.__enqueueLedger)await env.__enqueueLedger(settlement);
  const res=await object.fetch("https://reminder.internal/",{
    method:"POST",body:JSON.stringify({type:"credits_"+type,userId:id,kind,profileId:String(profileId),nonce,grant})
  });
  if(!res.ok)throw Error("Credits ledger request failed");
  const result=await res.json();
  if(["complete","release"].includes(type)){
    if(!result.ok)throw Error("Credit settlement pending");
    if(env.__settleLedger)await env.__settleLedger(settlement);
  }
  return result;
}

// Owner-only adjustment preserves every claim, spend and grant revision.
// Read-only financial operations from the same atomic credit object.
export async function creditHistory(env,userId){
 const id=String(userId);
 if(!env.ORDER_REMINDERS||!/^\d{5,16}$/.test(id))throw Error("Credits unavailable");
 const object=env.ORDER_REMINDERS.get(env.ORDER_REMINDERS.idFromName("publication-credits:"+id));
 const res=await object.fetch("https://credits.internal/",{method:"POST",body:JSON.stringify({type:"credits_history",userId:id})});
 if(!res.ok)throw Error("Credit history unavailable");
 return res.json();
}
export async function adjustCredits(env,userId,target,expected,operation,actorId){
 await credits(env,userId,"status");
 const object=env.ORDER_REMINDERS.get(env.ORDER_REMINDERS.idFromName("publication-credits:"+userId));
 const response=await object.fetch("https://credits.internal/",{method:"POST",body:JSON.stringify({type:"credits_adjust",userId:String(userId),target,expected,operation,actorId:String(actorId)})});
 if(!response.ok)throw Error("Credit adjustment rejected");return response.json();
}

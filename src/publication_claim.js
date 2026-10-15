export async function claimPublication(env,userId,profileId,kind,nonce){
 if(!env.ORDER_REMINDERS)throw Error("Publication guard unavailable");
 const object=env.ORDER_REMINDERS.get(env.ORDER_REMINDERS.idFromName("publication-claim:yan_first:"+kind+":"+profileId));
 const res=await object.fetch("https://guard.internal/",{method:"POST",body:JSON.stringify({type:"publication_claim",userId,profileId,kind,nonce})});
 if(!res.ok)throw Error("Publication guard rejected request");return res.json();
}
export async function publicationState(env,profileId,kind){
 if(!env.ORDER_REMINDERS)throw Error("Publication guard unavailable");
 const object=env.ORDER_REMINDERS.get(env.ORDER_REMINDERS.idFromName("publication-claim:yan_first:"+kind+":"+profileId));
 const response=await object.fetch("https://guard.internal/",{method:"POST",body:JSON.stringify({type:"publication_status",profileId,kind})});
 if(!response.ok)throw Error("Publication guard unavailable");return response.json();
}

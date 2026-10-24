// Dormant, server-only bridge for one authenticated client's diary.
// No exported Worker route, no DO binding, and no Telegram side effects.
// The caller supplies userId ONLY from its trusted cabinet context.
import {CityDiaryStore} from "./city_diary_store.js";
const USER=/^[1-9]\d{4,15}$/;
export async function syncCityDiaryReminders({storage,authenticatedUserId,schedulerNamespace,internalToken}={}) {
  const userId=String(authenticatedUserId||"");
  if(!USER.test(userId)||!storage?.transaction||
     !schedulerNamespace?.idFromName||!schedulerNamespace?.get||
     typeof internalToken!=="string"||internalToken.length<16)
    return {ok:false,reason:"bridge_unavailable"};
  const snapshot=await new CityDiaryStore(storage).reminderSnapshot();
  if(snapshot.scheduleRevision===0)
    return {ok:true,reason:"nothing_to_sync",revision:0};
  // Stable user-specific DO identity, derived from the authenticated cabinet
  // context, not from any request body or user-provided account ID.
  const stub=schedulerNamespace.get(schedulerNamespace.idFromName(userId));
  if(!stub?.fetch)return {ok:false,reason:"bridge_unavailable"};
  let response;
  try{
    response=await stub.fetch("https://city-diary.internal/sync",{
      method:"POST",
      headers:{"Authorization":"Bearer "+internalToken,"Content-Type":"application/json"},
      body:JSON.stringify({type:"replace_schedule",userId,
        scheduleRevision:snapshot.scheduleRevision,events:snapshot.events})
    });
  }catch{
    // An ambiguous response may mean the target committed successfully. Do
    // not invent a new revision. A subsequent sync reads the same source
    // revision, then the scheduler returns its recorded version.
    return {ok:false,reason:"sync_unknown",retryable:true};
  }
  let result;
  try{result=await response.json();}catch{
    return {ok:false,reason:"sync_unknown",retryable:true};
  }
  if(response.ok&&result?.ok&&result.scheduleRevision===snapshot.scheduleRevision)
    return {ok:true,reason:"synced",revision:snapshot.scheduleRevision};
  if(response.status===409&&result?.reason==="stale_schedule"&&
     result.currentRevision===snapshot.scheduleRevision)
    return {ok:true,reason:"already_synced",revision:snapshot.scheduleRevision};
  if(response.status===409&&result?.reason==="stale_schedule"&&
     Number.isSafeInteger(result.currentRevision)&&
     result.currentRevision>snapshot.scheduleRevision)
    return {ok:false,reason:"target_ahead",retryable:false};
  return {ok:false,reason:"sync_rejected",retryable:false};
}

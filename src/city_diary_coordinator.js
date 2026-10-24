// Optional, dormant orchestrator for the authenticated private cabinet.
// Never invoked from public routes until dedicated scheduler is provisioned.
// A durable diary write and remote synchronization are separate outcomes.
import {cityDiaryRequest} from "./city_diary_rpc.js";
import {syncCityDiaryReminders} from "./city_diary_bridge.js";
const MUTATIONS=new Set(["create","batch","edit","cancel","archive_cancelled_reminders"]);
const REPLIES=new Set(["synced","already_synced","nothing_to_sync"]);
export async function cityDiaryRequestWithReminderSync(storage,request,context={},bridge={}) {
  // The pre-existing ownership and manual history checks remain authoritative.
  const result=await cityDiaryRequest(storage,request,context);
  if(!result.ok||!MUTATIONS.has(request?.action))return result;
  // Nothing here implies notification was delivered to Telegram.
  const {authenticatedUserId,schedulerNamespace,internalToken}=bridge;
  let sync;
  try{
    sync=await syncCityDiaryReminders({storage,authenticatedUserId,
      schedulerNamespace,internalToken});
  }catch{
    sync={ok:false,reason:"sync_unknown",retryable:true};
  }
  const status=sync.ok&&REPLIES.has(sync.reason)?"synced":"pending";
  return {...result,reminderSync:{status,reason:sync.reason,
    retryable:sync.retryable===true}};
}

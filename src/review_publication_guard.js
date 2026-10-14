// Atomic, permanent single-attempt guard scoped to account + profile + review.
// Reuses the already-migrated OrderReminder Durable Object without affecting
// its normal visitor/reminder identities.
const OWNER_ACCOUNT="yan_first";
function stub(env,id){
  if(!env.ORDER_REMINDERS || !/^\d{1,9}$/.test(String(id)))throw Error("Review guard unavailable");
  return env.ORDER_REMINDERS.get(env.ORDER_REMINDERS.idFromName("review-publication:"+OWNER_ACCOUNT+":"+id));
}
export async function reviewGuard(env,id,type,nonce){
  const response=await stub(env,id).fetch("https://reminder.internal/",{
    method:"POST",body:JSON.stringify({type,profileId:String(id),account:OWNER_ACCOUNT,nonce})
  });
  if(!response.ok)throw Error("Review guard request failed");
  return response.json();
}

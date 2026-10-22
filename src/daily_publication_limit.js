// Moscow calendar-day allowance shared across Telegram users.
// Atomic claims live in one Durable Object per profile and Moscow date.
export function moscowDay(at=new Date()){
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"Europe/Moscow",year:"numeric",month:"2-digit",day:"2-digit"
  }).format(at);
}
export async function dailyLimit(env,userId,profileId,type,kind="",nonce="",date=moscowDay(),accountId=null){
  const id=String(profileId),uid=String(userId);
  if(!env.ORDER_REMINDERS || !/^\d{1,9}$/.test(id) ||
     !/^\d{5,16}$/.test(uid) || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw Error("Daily allowance unavailable");
  const object=env.ORDER_REMINDERS.get(env.ORDER_REMINDERS.idFromName("daily-profile:"+id+":"+date));
  const settlement={ledger:"daily",action:type,userId:uid,profileId:id,kind,nonce,date};
  if(["complete","release"].includes(type)&&env.__enqueueLedger)await env.__enqueueLedger(settlement);
  const res=await object.fetch("https://reminder.internal/",{
    method:"POST",body:JSON.stringify({type:"daily_"+type,userId:uid,profileId:id,moscowDate:date,kind,nonce,...(accountId?{accountId}:{})})
  });
  if(!res.ok)throw Error("Daily allowance request failed");
  const result=await res.json();
  if(["complete","release"].includes(type)){
    if(!result.ok)throw Error("Daily settlement pending");
    if(env.__settleLedger)await env.__settleLedger(settlement);
  }
  return result;
}


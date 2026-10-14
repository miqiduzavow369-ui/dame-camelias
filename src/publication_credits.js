// Atomic publication credits, isolated by Telegram user ID.
// Only trusted bot code invokes this private Durable Object.
export async function credits(env,userId,type,kind="",profileId="",nonce=""){
  const id=String(userId);
  if(!env.ORDER_REMINDERS || !/^\d{5,16}$/.test(id))throw Error("Credits unavailable");
  const object=env.ORDER_REMINDERS.get(env.ORDER_REMINDERS.idFromName("publication-credits:"+id));
  const res=await object.fetch("https://reminder.internal/",{
    method:"POST",body:JSON.stringify({type:"credits_"+type,userId:id,kind,profileId:String(profileId),nonce})
  });
  if(!res.ok)throw Error("Credits ledger request failed");
  return res.json();
}

// Owner-approved grants. To add credits in a later change, increment revision
// and update totalGranted for the specified Telegram ID. The Durable Object
// applies only the positive difference, preserving spent credits and claims.
const CREDIT_GRANTS={
  "5866034656":{totalGranted:10,revision:1}
};
// Atomic publication credits, isolated by Telegram user ID.
// Only trusted bot code invokes this private Durable Object.
export async function credits(env,userId,type,kind="",profileId="",nonce=""){
  const id=String(userId);
  if(!env.ORDER_REMINDERS || !/^\d{5,16}$/.test(id))throw Error("Credits unavailable");
  const object=env.ORDER_REMINDERS.get(env.ORDER_REMINDERS.idFromName("publication-credits:"+id));
  const grant=CREDIT_GRANTS[id]||{totalGranted:0,revision:0};
  const res=await object.fetch("https://reminder.internal/",{
    method:"POST",body:JSON.stringify({type:"credits_"+type,userId:id,kind,profileId:String(profileId),nonce,grant})
  });
  if(!res.ok)throw Error("Credits ledger request failed");
  return res.json();
}

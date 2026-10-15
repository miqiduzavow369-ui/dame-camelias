import {validClientId,validProfileId} from "./client_isolation.js";
import {credits} from "./publication_credits.js";
import {dailyLimit} from "./daily_publication_limit.js";

// Fail closed: client actions are not publishable unless every shared guard agrees.
// This helper does not itself reserve or commit publication slots.
export async function publicationEligibility(env,userId,profileId,kind){
 const uid=String(userId),pid=String(profileId);
 if(!validClientId(uid)||!validProfileId(pid)||!["rating","review"].includes(kind))
   return {allowed:false,reason:"invalid"};
 try{
  const [balance,day]=await Promise.all([
   credits(env,uid,"status"),
   dailyLimit(env,uid,pid,"status",kind)
  ]);
  const remaining=balance?.available;
  if(!Number.isSafeInteger(remaining)||remaining<=0)
   return {allowed:false,reason:"credits"};
  // Daily Object is shared across all Telegram IDs for this profile.
  // An unknown response cannot be interpreted as permission.
  if(!Number.isSafeInteger(day?.remaining)||day.remaining<=0)
   return {allowed:false,reason:"daily_limit"};
  return {allowed:true,remaining};
 }catch{
  return {allowed:false,reason:"unavailable"};
 }
}

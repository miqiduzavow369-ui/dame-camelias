// Cross-account site-global lock IDs for future 30-man execution.
// No DO operations or real publication are performed by this module.
// Current production legacy lock names are deliberately reused, not changed.
import {requireManId} from "./man_account_isolation.js";

const PROFILE=/^\d{1,9}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const KIND=new Set(["rating","review"]);
function validated(accountId,profileId,kind){
 requireManId(accountId);
 if(typeof profileId!=="string"||!PROFILE.test(profileId))throw Error("Invalid profile for global lock");
 if(kind!==undefined&&!KIND.has(kind))throw Error("Invalid publication type");
 return profileId;
}
// Keep legacy publication-claim:yan_first:* namespace shared across every man.
// Using accountId in this key would allow two men to bypass duplicate protection.
export function globalPublicationLock(accountId,profileId,kind){
 validated(accountId,profileId,kind);
 if(!KIND.has(kind))throw Error("Invalid publication type");
 return "publication-claim:yan_first:"+kind+":"+profileId;
}
// Legacy review publication guard is per profile, site-global for all men.
export function globalReviewLock(accountId,profileId){
 validated(accountId,profileId);
 return "review-publication:yan_first:"+profileId;
}
// Daily limit already uses profile + Moscow calendar day, not male account.
export function globalDailyLock(accountId,profileId,moscowDate){
 validated(accountId,profileId);
 if(typeof moscowDate!=="string"||!DATE.test(moscowDate))throw Error("Invalid Moscow date");
 const [year,month,day]=moscowDate.split("-").map(Number);
 const d=new Date(Date.UTC(year,month-1,day));
 if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)
   throw Error("Invalid Moscow date");
 return "daily-profile:"+profileId+":"+moscowDate;
}

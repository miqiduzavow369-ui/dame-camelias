// Multi-man publication *routing preflight*, not a publication dispatcher.
// Site access, credit operations and workflow dispatch are intentionally absent.
// The existing yan_first workflow is never routed through this module.
import {requirePublicationIdentity,requireServerActivation,manStorageKey} from "./man_account_isolation.js";
import {globalPublicationLock,globalReviewLock,globalDailyLock} from "./man_global_locks.js";
import {validateManSetup} from "./man_setup_state.js";

const PROFILE_DATE=/^\d{4}-\d{2}-\d{2}$/;
export function planManRoute(identity,{moscowDate,serverActivation,stagingDraft}={}){
 const checked=requirePublicationIdentity(identity);
 if(checked.accountId==="yan_first")throw Error("Legacy publication router is unchanged");
 // Validate even adversarial/stale draft input. Draft status is never authorization.
 if(stagingDraft!==undefined)validateManSetup(stagingDraft,checked.accountId);
 // A trusted server-owned activation record is mandatory, independent of draft.
 const active=requireServerActivation(checked.accountId,serverActivation);
 const keys=Object.freeze({
  operation:manStorageKey({...checked,scope:"operation"}),
  proof:manStorageKey({...checked,scope:"proof"}),
  callback:manStorageKey({...checked,scope:"callback"}),
  publication:manStorageKey({...checked,scope:"publication"}),
  // Site-global locks intentionally omit the man ID; preserve legacy names.
  globalPublication:globalPublicationLock(checked.accountId,checked.profileId,checked.kind),
  globalReview:checked.kind==="review"?globalReviewLock(checked.accountId,checked.profileId):null,
  globalDaily:globalDailyLock(checked.accountId,checked.profileId,moscowDate)
 });
 return Object.freeze({
  accountId:active.accountId,activationVersion:active.version,
  identity:checked,keys,previewOnly:true,canDispatch:false,canDebit:false
 });
}

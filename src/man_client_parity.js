// Client-facing catalogue for the existing Mini App. New men remain locked
// until a separately audited per-man executor and publication coordinator exist.
// Registry and appearance are never sufficient for activation.
import {MAN_ACCOUNTS} from "./man_accounts.js";
export const LEGACY_CLIENT_ROUTE=Object.freeze({
 rating:Object.freeze(["select_profile","select_man","check_duplicate_and_daily_limit","choose_ratings",
 "save_draft","review_ratings","dryfill_on_site","owner_confirm","reserve_credit_and_lock",
 "submit_once","verify_result","save_original_proof","archive_and_settle"]),
 review:Object.freeze(["select_profile","select_man","check_duplicate_and_daily_limit","write_review",
 "save_draft","review_text","moderation","owner_confirm","reserve_credit_and_lock",
 "submit_once","verify_result","save_original_proof","archive_and_settle"])
});
export function clientMenAvailability(){
 return MAN_ACCOUNTS.map(x=>({
  id:x.id,number:x.number,name:x.name,
  // Legacy is still the only wired publication executor in src/owner_anketa.js.
  enabled:x.id==="yan_first",route:"legacy_yan_first",
  readiness:x.id==="yan_first"?"legacy":"awaiting_isolated_executor",
  verification:x.id==="yan_first"?"legacy_unreported":"unverified",
  ratingRoute:[...LEGACY_CLIENT_ROUTE.rating],
  reviewRoute:[...LEGACY_CLIENT_ROUTE.review]
 })).map(x=>x.id==="yan_first"?x:({...x,route:"not_connected"}));
}
export function requireClientPublicationRoute(accountId){
 if(accountId!=="yan_first")throw Error("New male account publication route not connected");
 return {accountId,route:"legacy_yan_first"};
}

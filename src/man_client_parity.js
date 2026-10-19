// Client-facing catalog: only trusted server readiness may expose an executor.
// The historical Yan First route remains constant and cannot be overridden.
import {MAN_ACCOUNTS} from "./man_accounts.js";
import {requireServerActivation} from "./man_account_isolation.js";
export const LEGACY_CLIENT_ROUTE=Object.freeze({
 rating:Object.freeze(["select_profile","select_man","check_duplicate_and_daily_limit","choose_ratings",
 "save_draft","review_ratings","dryfill_on_site","owner_confirm","reserve_credit_and_lock",
 "submit_once","verify_result","save_original_proof","archive_and_settle"]),
 review:Object.freeze(["select_profile","select_man","check_duplicate_and_daily_limit","write_review",
 "save_draft","review_text","moderation","owner_confirm","reserve_credit_and_lock",
 "submit_once","verify_result","save_original_proof","archive_and_settle"])
});
// readinessById MUST originate from authenticated private server state, never Mini App input.
// This is a pure catalog projection, not a credential or ADMIN approval endpoint.
// No secondary account is enabled by default; no caller currently provides this map.
export function clientMenAvailability(readinessById=null){
 return MAN_ACCOUNTS.map(x=>{
  const legacy=x.id==="yan_first";
  const state=!legacy&&readinessById instanceof Map?readinessById.get(x.id):null;
  let activated=false;
  if(state?.executorConnected===true&&state?.callbackConnected===true&&
      state?.proofAndLedgerConnected===true&&state?.ownerApproved===true){
   try{requireServerActivation(x.id,state.activation);activated=true;}catch{}
  }
  return {
   id:x.id,number:x.number,name:x.name,
   enabled:legacy||activated,
   route:legacy?"legacy_yan_first":activated?"isolated_man_v1":"not_connected",
   readiness:legacy?"legacy":activated?"ready":"awaiting_isolated_executor",
   verification:legacy?"legacy_unreported":activated?"server_verified":"unverified",
   ratingRoute:[...LEGACY_CLIENT_ROUTE.rating],
   reviewRoute:[...LEGACY_CLIENT_ROUTE.review]
  };
 });
}
// Preserve the original legacy publication guard. An enabled catalog entry
// is NOT a publication capability or a substitute for per-operation grants.
export function requireClientPublicationRoute(accountId){
 if(accountId!=="yan_first")throw Error("New male account publication route not connected");
 return {accountId,route:"legacy_yan_first"};
}

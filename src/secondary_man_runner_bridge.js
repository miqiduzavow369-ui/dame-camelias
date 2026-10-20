// Server-only bridge from the existing isolated publication gate to a trusted
// Chromium dispatch adapter. No endpoint, form click, or legacy fallback here.
// The dispatcher MUST obtain per-man secrets through its own authenticated grant.
import {readSecondaryDispatchPreflight} from "./secondary_man_dispatch_contract.js";
import {claimSecondaryPublication,markSecondaryPublicationUncertain} from "./secondary_man_publication_gate.js";
import {issueSecondaryCallbackTicket} from "./secondary_man_callback_ticket.js";
import {createAccountOperation} from "./man_account_isolation.js";

/**
 * A durable one-shot attempt is recorded BEFORE dispatch.
 * On *any* failure after claiming, do not retry automatically; the external
 * action may have happened. Reconciliation is required.
 */
export async function dispatchApprovedSecondaryPublication(storage,{
 identity,ownerOperationConfirmed,independentAuthorConfirmed,
 trustedDispatch,at
}={}){
 if(typeof trustedDispatch!=="function"||!Number.isSafeInteger(at)||at<0||
    typeof storage?.transaction!=="function")
  throw Error("Trusted runner dispatcher and atomic storage required");
 const i=createAccountOperation(identity);
 const verified=await readSecondaryDispatchPreflight(storage,{
  identity:i,ownerOperationConfirmed,independentAuthorConfirmed});
 if(verified.maySubmit!==false||verified.dispatchRoute!=="isolated_secondary_only")
  throw Error("Unexpected publication dispatch contract");
 // Claim in durable storage before any outbound calls.
 await claimSecondaryPublication(storage,{original:i,callback:i});
 try{
  const ticket=await issueSecondaryCallbackTicket(storage,{
   identity:i,proxyVersion:verified.proxyVersion,siteVersion:verified.siteVersion,at
  });
  const outcome=await trustedDispatch(Object.freeze({
   accountId:i.accountId,userId:i.userId,profileId:i.profileId,
   kind:i.kind,nonce:i.nonce,siteHost:verified.siteHost,
   proxyVersion:verified.proxyVersion,siteVersion:verified.siteVersion,
   callbackTicket:ticket.token
  }));
  if(outcome?.accepted!==true)
   throw Error("Runner did not acknowledge dispatch");
  return Object.freeze({ok:true,accountId:i.accountId,status:"attempted",
   dispatchAccepted:true,sitePublished:false});
 }catch{
  // The dispatcher may have delivered the job before raising an error.
  // Never claim it can safely be submitted again.
  try{await markSecondaryPublicationUncertain(storage,{original:i,callback:i});}
  catch{ /* preserve the original durable attempted state for reconciliation */ }
  return Object.freeze({ok:false,accountId:i.accountId,
   status:"reconciliation_required",dispatchAccepted:false,sitePublished:false});
 }
}

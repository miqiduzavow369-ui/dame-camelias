// Read-only publication diagnostics for ADMIN. Never returns secrets, proof
// file IDs, draft contents, callback token, or raw ledger identifiers.
import {requirePublicationIdentity,manStorageKey,verifyAccountCallback} from "./man_account_isolation.js";
import {secondaryVerifiedResultStatus} from "./secondary_man_result_settlement.js";
import {secondaryCallbackTicketStatus} from "./secondary_man_callback_ticket.js";

const STATES=new Set(["prepared","attempted","uncertain","completed"]);
export async function readSecondaryOperationDiagnostics(storage,source){
 const i=requirePublicationIdentity(source);
 if(i.accountId==="yan_first")throw Error("Legacy account immutable");
 const pubKey=manStorageKey({userId:i.userId,accountId:i.accountId,
  profileId:i.profileId,scope:"publication"})+":"+i.kind;
 const creditKey=manStorageKey({userId:i.userId,accountId:i.accountId,
  profileId:i.profileId,scope:"operation"})+":"+i.kind+":"+i.nonce+":ledger";
 const [publication,credit,ticket,result]=await Promise.all([
  storage.get(pubKey),storage.get(creditKey),
  secondaryCallbackTicketStatus(storage,i),
  secondaryVerifiedResultStatus(storage,i)
 ]);
 // Never report another nonce's per-profile claim as this operation.
 const ownPublication=publication&&verifyAccountCallback(publication.identity,i);
 const ownCredit=credit?.userId===i.userId&&credit?.accountId===i.accountId&&
  credit?.profileId===i.profileId&&credit?.kind===i.kind&&credit?.nonce===i.nonce;
 const publicationStatus=ownPublication&&STATES.has(publication.status)?publication.status:
  publication?"identity_mismatch":"not_started";
 const creditStatus=ownCredit?String(credit.status):credit?"identity_mismatch":"not_started";
 const ticketStatus=ownPublication?ticket.status:"not_issued";
 const resultStatus=ownPublication?result.status:"not_started";
 const proofPresent=ownPublication&&result.proofPresent===true;
 const completed=publicationStatus==="completed"&&resultStatus==="completed"&&
  creditStatus==="completed"&&proofPresent;
 const needsReview=publicationStatus==="uncertain"||
  publicationStatus==="identity_mismatch"||creditStatus==="identity_mismatch"||
  resultStatus==="reconciliation_required"||creditStatus==="reconciliation_required"||
  resultStatus==="proof_pending"||
  (publicationStatus==="completed"&&!completed)||
  (resultStatus==="completed"&&!completed)||
  (creditStatus==="completed"&&!completed)||
  creditStatus==="reserving"||
  creditStatus==="settling"||resultStatus==="settling"||
  ticketStatus==="consumed"&&!proofPresent||
  publicationStatus==="attempted"&&ticketStatus==="issued"&&!proofPresent;
 return Object.freeze({
  ok:true,accountId:i.accountId,profileId:i.profileId,kind:i.kind,
  publicationStatus,creditStatus,ticketStatus,resultStatus,proofPresent,
  completed,needsReview,canRetrySitePost:false,
  publicationEnabled:false
 });
}

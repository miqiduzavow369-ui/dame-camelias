// Read-only, client-safe status projection for a secondary publication.
// Never infer a successful site post from GitHub dispatch acceptance.
// Production route wiring must call this using a trusted client-bound identity.
import {createAccountOperation,manStorageKey,verifyAccountCallback} from "./man_account_isolation.js";
import {secondaryVerifiedResultStatus} from "./secondary_man_result_settlement.js";

export async function secondaryPublicationOperationalStatus(storage,source){
 const i=createAccountOperation(source);
 if(i.accountId==="yan_first")throw Error("Legacy publication status immutable");
 if(!storage||typeof storage.get!=="function")throw Error("Trusted storage required");
 const base=manStorageKey({userId:i.userId,accountId:i.accountId,
  profileId:i.profileId,scope:"publication"})+":"+i.kind;
 const publication=await storage.get(base);
 if(!publication)return Object.freeze({accountId:i.accountId,profileId:i.profileId,
  kind:i.kind,status:"not_started",published:false,proofPresent:false,creditCompleted:false});
 if(!verifyAccountCallback(publication.identity,i))
  throw Error("Publication status identity mismatch");
 if(!["prepared","attempted","uncertain","completed"].includes(publication.status))
  throw Error("Unsupported publication status");
 const proof=await secondaryVerifiedResultStatus(storage,i);
 // Completion is only true with all three durable assertions, never inferred
 // from a runner response, claimed callback ticket, or dispatch acknowledgement.
 const verified=publication.status==="completed"&&publication.attempted===true&&
   proof.status==="completed"&&proof.proofPresent===true&&proof.creditStatus==="completed";
 const needsAttention=publication.status==="uncertain"||
   proof.status==="reconciliation_required"||
   (publication.status==="completed"&&!verified);
 return Object.freeze({accountId:i.accountId,profileId:i.profileId,kind:i.kind,
  status:verified?"published":needsAttention?"reconciliation_required":publication.status,
  published:verified,proofPresent:proof.proofPresent===true,
  creditCompleted:verified,requiresManualReconciliation:needsAttention,
  // Expose status only, never tokens, screenshots, URLs or site credentials.
  });
}

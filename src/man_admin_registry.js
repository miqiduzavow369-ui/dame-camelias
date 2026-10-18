// Owner-only, read-only inventory for the staged 30-account rollout.
// This module must never receive or serialize passwords, cookies or proxy credentials.
import {MAN_ACCOUNTS} from "./man_accounts.js";

export function ownerManRegistry(actorId, cabinetUserId, ownerId) {
  if (typeof actorId !== "string" || typeof cabinetUserId !== "string" ||
      typeof ownerId !== "string" || actorId !== ownerId || cabinetUserId !== ownerId) {
    return {ok:false,status:403};
  }
  return {
    ok:true,
    status:200,
    readOnly:true,
    accounts:MAN_ACCOUNTS.map(({id,number,name,enabledByDefault})=>({
      id,number,name,
      // This is NOT a production health check. Existing account 1 is labeled legacy.
      connection:enabledByDefault?"legacy_active":"not_configured",
      configurable:false,
      credentialStatus:"not_exposed",
      proxyStatus:"not_exposed"
    }))
  };
}

// Shared identities for future multi-client cabinet integration.
// Global per-profile guard keys must stay global; private client data must not.
const ID=/^\d{5,16}$/;
const PROFILE=/^\d{1,9}$/;
const NAMESPACE="cabinet_v2";
export function validClientId(value){return ID.test(String(value));}
export function validProfileId(value){return PROFILE.test(String(value));}
export function clientKey(userId,kind,profileId=""){
 const uid=String(userId),profile=String(profileId);
 if(!validClientId(uid)||!/^(session|flow|library|saved|proof|navigation|selected|pending)$/.test(kind))
   throw Error("Invalid client storage key");
 if(profile&&!validProfileId(profile))throw Error("Invalid profile key");
 if(kind==="saved"&&!profile)throw Error("Saved profile key needs an ID");
 if(kind!=="saved"&&profile)throw Error("Unexpected profile key");
 return NAMESPACE+":"+uid+":"+kind+(profile?":"+profile:"");
}
export function guardKey(profileId,kind){
 if(!validProfileId(profileId)||!["rating","review"].includes(kind))throw Error("Invalid guard");
 return "publication-guard:"+profileId+":"+kind;
}
export function privateMessageTarget(actorId,chatId,chatType,authorizedId){
 const uid=String(authorizedId);
 return validClientId(uid)&&String(actorId)===uid&&String(chatId)===uid&&chatType==="private";
}

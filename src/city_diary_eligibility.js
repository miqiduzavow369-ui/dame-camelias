// Read-only City diary eligibility: reuse manual City's own archives and status.
// This is a planning guard, not authorization to publish. The live City submit
// guard must run again at confirmation and execution without any manual-code changes.
const CONFLICT_STATES=new Set(["published","publishing","needs_verification","checking",
  "moderation","prepared","reconciliation_required","draft_saved","approving","approved",
  "pending","submitted","uncertain","verifying"]);
export function kindsForDiaryAction(action){
  if(action==="review")return ["review"];
  if(action==="rating")return ["rating"];
  if(action==="rating_review")return ["rating","review"];
  return [];
}
export function checkDiaryManualHistory({accountId,profileId,action,archive=[],statuses={},
  existingPlans=[],excludeEventId=null}={}){
  if(!accountId||!profileId||typeof action!=="string")
    return {ok:false,reason:"eligibility_unavailable"};
  const kinds=kindsForDiaryAction(action);
  if(!kinds.length)return {ok:false,reason:"invalid_publication"};
  if(!Array.isArray(archive)||!Array.isArray(existingPlans))
    return {ok:false,reason:"eligibility_unavailable"};
  for(const kind of kinds){
    if(archive.some(x=>x.account===accountId&&String(x.profileId)===String(profileId)&&x.kind===kind))
      return {ok:false,reason:"already_published",kind};
    const stage=statuses[kind];
    if(stage&&CONFLICT_STATES.has(stage))
      return {ok:false,reason:stage==="published"?"already_published":"action_in_progress",kind};
    if(existingPlans.some(e=>e.id!==excludeEventId&&e.mode==="publication"&&
       e.status!=="cancelled"&&e.status!=="failed"&&String(e.profileId)===String(profileId)&&
       e.accountId===accountId&&kindsForDiaryAction(e.action).includes(kind)))
      return {ok:false,reason:"already_planned",kind};
  }
  return {ok:true,reason:"planning_only"};
}

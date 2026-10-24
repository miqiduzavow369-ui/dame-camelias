// Planning-only adapter. Call exclusively inside an authenticated per-user cabinet Durable Object.
// Deliberately has no publication, moderation or credit operations.
import {CityDiaryStore} from "./city_diary_store.js";
import {DiaryError} from "./city_diary_model.js";
import {isKnownManAccount} from "./man_accounts.js";
import {checkDiaryManualHistory} from "./city_diary_eligibility.js";
import {assessDiaryConnection} from "./city_diary_preflight.js";

const ACTIONS=new Set(["list","list_archive","archive_page","get","create","batch","edit","cancel","recheck","archive_cancelled_reminders","get_form_draft","save_form_draft","clear_form_draft"]);
const PROFILE=/^\d{1,9}$/;
export async function cityDiaryRequest(storage,request,{profileOwned,manualStatus}={}) {
  if(!request||!ACTIONS.has(request.action))
    return {ok:false,status:400,reason:"invalid_action"};
  if(typeof profileOwned!=="function")
    return {ok:false,status:403,reason:"ownership_unavailable"};
  const store=new CityDiaryStore(storage);
  try{
    if(request.action==="get_form_draft")
      return {ok:true,draft:await store.readFormDraft()};
    if(request.action==="save_form_draft")
      return {ok:true,...await store.saveFormDraft(request.form,{expectedRevision:request.expectedRevision})};
    if(request.action==="clear_form_draft")
      return {ok:true,...await store.clearFormDraft({expectedRevision:request.expectedRevision})};
    if(request.action==="list")
      return {ok:true,events:await store.list(request.filters||{})};
    if(request.action==="archive_page")
      return {ok:true,...await store.archivePage(request.filters||{})};
    if(request.action==="list_archive")
      return {ok:true,events:await store.listArchive(request.filters||{})};
    if(request.action==="archive_cancelled_reminders"){
      if(!Array.isArray(request.items)||request.items.length<1||request.items.length>120)
        return {ok:false,status:400,reason:"invalid_archive_request"};
      const records=await Promise.all(request.items.map(x=>store.get(x?.id)));
      if(records.some((x,i)=>!x||x.id!==request.items[i].id||x.mode!=="reminder"||
        x.status!=="cancelled"||x.revision!==request.items[i].revision))
        return {ok:false,status:409,reason:"archive_not_safe"};
      const result=await store.archiveTerminal({operation:request.operation,
        expectedRevisions:request.items});
      return {ok:true,...result};
    }
    if(request.action==="get"){
      const event=await store.get(request.id);
      return event?{ok:true,event}:{ok:false,status:404,reason:"not_found"};
    }
    if(request.action==="create"){
      const plan=request.plan;
      if(plan?.accountId!=null&&!isKnownManAccount(plan.accountId))return {ok:false,status:400,reason:"invalid_account"};
      if(plan?.profileId!=null){
        const profileId=String(plan.profileId);
        if(!PROFILE.test(profileId)||!await profileOwned(profileId))
          return {ok:false,status:403,reason:"profile_not_saved"};
      }
      if(plan?.mode==="publication"){
        if(!isKnownManAccount(plan.accountId)||!manualStatus)
          return {ok:false,status:409,reason:"eligibility_unavailable"};
        const status=await manualStatus(plan.accountId,plan.profileId);
        const eligibility=checkDiaryManualHistory({
          accountId:plan.accountId,profileId:plan.profileId,action:plan.action,
          archive:status?.archive,statuses:status?.statuses,
          existingPlans:await store.list()
        });
        if(!eligibility.ok)return {ok:false,status:409,reason:eligibility.reason,kind:eligibility.kind};
      }
      const event=await store.create(plan,{
        id:request.id,operation:request.operation
      });
      return {ok:true,event};
    }
    if(request.action==="batch"){
      if(!Array.isArray(request.items)||request.items.length<1||request.items.length>31)
        return {ok:false,status:400,reason:"invalid_batch"};
      for(const item of request.items){
        if(item?.plan?.accountId!=null&&!isKnownManAccount(item.plan.accountId))return {ok:false,status:400,reason:"invalid_account"};
        const profileId=item?.plan?.profileId;
        if(profileId!==null&&profileId!==undefined){
          if(!PROFILE.test(String(profileId))||!await profileOwned(String(profileId)))
            return {ok:false,status:403,reason:"profile_not_saved"};
        }
      }
      const saved=await store.createBatch(request.items,{operation:request.operation});
      return {ok:true,events:saved};
    }
    const previous=await store.get(request.id);
    if(!previous)return {ok:false,status:404,reason:"not_found"};
    if(request.action==="recheck"){
      // Read-only pre-confirmation check. Even an apparently free action
      // CANNOT be submitted without the original City's atomic execution guard.
      if(previous.mode!=="publication")
        return {ok:false,status:400,reason:"not_publication"};
      if(!isKnownManAccount(previous.accountId)||!manualStatus)
        return {ok:false,status:409,reason:"eligibility_unavailable"};
      if(previous.status!=="scheduled"&&previous.status!=="awaiting_confirmation")
        return {ok:false,status:409,reason:"event_not_pending"};
      if(request.expectedRevision!==undefined&&request.expectedRevision!==previous.revision)
        return {ok:false,status:409,reason:"revision_conflict"};
      if(!previous.profileId||!await profileOwned(String(previous.profileId)))
        return {ok:false,status:403,reason:"profile_not_saved"};
      const manual=await manualStatus(previous.accountId,previous.profileId);
      const verdict=checkDiaryManualHistory({
        accountId:previous.accountId,profileId:previous.profileId,
        action:previous.action,archive:manual?.archive,
        statuses:manual?.statuses,existingPlans:await store.list(),
        excludeEventId:previous.id
      });
      // Read-only site diagnostics never authorize execution.
      const site=assessDiaryConnection();
      return {ok:true,eventId:previous.id,revision:previous.revision,
        siteReady:site.ready,siteReason:site.reason,
        eligibleForPlanning:verdict.ok,
        reason:verdict.reason,kind:verdict.kind||null,
        publicationAuthorized:false,siteCheckRequired:true,
        requiresClientConfirmation:true,requiresExistingCityGuard:true};
    }
    if(request.action==="edit"){
      if(request.patch?.accountId!=null&&!isKnownManAccount(request.patch.accountId))return {ok:false,status:400,reason:"invalid_account"};
      const proposed=request.patch?.profileId===undefined?previous.profileId:request.patch.profileId;
      if(proposed!=null){
        const profileId=String(proposed);
        if(!PROFILE.test(profileId)||!await profileOwned(profileId))
          return {ok:false,status:403,reason:"profile_not_saved"};
      }
      const revised={...previous,...request.patch};
      if(revised.mode==="publication"){
        if(!isKnownManAccount(revised.accountId)||!manualStatus)
          return {ok:false,status:409,reason:"eligibility_unavailable"};
        const status=await manualStatus(revised.accountId,revised.profileId);
        const eligibility=checkDiaryManualHistory({
          accountId:revised.accountId,profileId:revised.profileId,action:revised.action,
          archive:status?.archive,statuses:status?.statuses,
          existingPlans:await store.list(),excludeEventId:request.id
        });
        if(!eligibility.ok)return {ok:false,status:409,reason:eligibility.reason,kind:eligibility.kind};
      }
      const event=await store.edit(request.id,request.patch,{
        operation:request.operation,expectedRevision:request.expectedRevision
      });
      return {ok:true,event};
    }
    // Only an unsubmitted plan can be cancelled through the diary planning API.
    // Actual credit release and Telegram deletion require a separate verified workflow.
    if(request.action==="cancel"){
      const event=await store.transition(request.id,"cancelled",{
        operation:request.operation,expectedRevision:request.expectedRevision
      });
      return {ok:true,event};
    }
  }catch(error){
    if(error instanceof DiaryError){
      const conflict=["operation_conflict","revision_conflict","event_locked","invalid_transition",
        "duplicate_event","duplicate_schedule","diary_full","archive_not_terminal","archive_not_safe","archive_conflict","draft_revision_conflict"].includes(error.code);
      return {ok:false,status:conflict?409:400,reason:error.code};
    }
    return {ok:false,status:503,reason:"diary_unavailable"};
  }
}

// City diary domain model. Pure functions; no Telegram, credit, ADMIN or site effects.
// The caller must authenticate the user and serialize updates in that user's Durable Object.
const ACTIONS = new Set(["profile","rating","review","rating_review"]);
const MODES = new Set(["reminder","publication"]);
const STATUSES = new Set(["scheduled","awaiting_confirmation","submitted","completed","cancelled","failed"]);
const ISO_INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const MAX_EVENTS = 120;
const MAX_TEXT = 4000;
export class DiaryError extends Error {
  constructor(code) { super(code); this.name = "DiaryError"; this.code = code; }
}
const fail = code => { throw new DiaryError(code); };
function instant(value) {
  if (typeof value !== "string" || !ISO_INSTANT.test(value) || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) fail("invalid_time");
  return Date.parse(value);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function checkPlan(plan, now) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan) ||
      !MODES.has(plan.mode) || !ACTIONS.has(plan.action)) fail("invalid_plan");
  const at = instant(plan.at);
  if (at <= now || at > now + 366 * 86400000) fail("time_out_of_range");
  const profileId = plan.profileId == null ? null : String(plan.profileId);
  if (profileId !== null && !/^\d{1,9}$/.test(profileId)) fail("invalid_profile");
  if (plan.mode === "publication" && (profileId === null || plan.action === "profile")) fail("invalid_publication");
  const reviewText = plan.reviewText == null ? "" : String(plan.reviewText).trim();
  if (reviewText.length > MAX_TEXT) fail("text_too_long");
  if (plan.mode === "publication" && ["review","rating_review"].includes(plan.action) && !reviewText) fail("review_text_required");
  // Rating values must be collected by the existing City ratings workflow;
  // a scheduled event must never be interpreted as publication authorization.
  const result = {mode:plan.mode,action:plan.action,at:plan.at,profileId,reviewText};
  // Identity of the existing City male account; never save login/proxy/site URL.
  if(plan.accountId!==undefined&&plan.accountId!==null){
    if(typeof plan.accountId!=="string"||!/^yan_(?:first|second|\\d{2})$/.test(plan.accountId))
      fail("invalid_account");
    result.accountId=plan.accountId;
  }
  // Keep the original calendar day and IANA timezone: UTC alone cannot express
  // the intended wall-clock day if the client later travels or changes devices.
  if(plan.timezone!==undefined || plan.localDate!==undefined){
    if(typeof plan.timezone!=="string"||plan.timezone.length>64||
       typeof plan.localDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(plan.localDate))
      fail("invalid_timezone");
    try{
      const fmt=new Intl.DateTimeFormat("en-CA",{timeZone:plan.timezone,
        year:"numeric",month:"2-digit",day:"2-digit"});
      const parts=Object.fromEntries(fmt.formatToParts(new Date(at))
        .filter(p=>["year","month","day"].includes(p.type)).map(p=>[p.type,p.value]));
      if([parts.year,parts.month,parts.day].join("-")!==plan.localDate)fail("local_date_mismatch");
    }catch(e){if(e instanceof DiaryError)throw e;fail("invalid_timezone");}
    result.timezone=plan.timezone;
    result.localDate=plan.localDate;
  }
  if (plan.note != null) {
    if (typeof plan.note !== "string" || plan.note.length > 500) fail("invalid_note");
    result.note = plan.note;
  }
  return result;
}
export function createDiaryEvent(plan, {id, now=Date.now()}={}) {
  if (typeof id !== "string" || !/^[a-f0-9]{16,32}$/.test(id)) fail("invalid_id");
  if (!Number.isSafeInteger(now)) fail("invalid_now");
  return {id,...checkPlan(plan,now),status:"scheduled",revision:1,createdAt:now,updatedAt:now};
}
export function addDiaryEvent(events,event) {
  if (!Array.isArray(events) || events.length >= MAX_EVENTS) fail("diary_full");
  if (events.some(e=>e.id===event.id)) fail("duplicate_event");
  return [...events,clone(event)];
}
export function editDiaryEvent(event,patch,{expectedRevision,now=Date.now()}={}) {
  if (!event || event.revision !== expectedRevision) fail("revision_conflict");
  if (event.status !== "scheduled") fail("event_locked");
  if (!patch || typeof patch !== "object" || Array.isArray(patch) ||
      Object.keys(patch).some(k=>!["mode","action","at","profileId","reviewText","note","localDate","timezone","accountId"].includes(k))) fail("invalid_patch");
  const updated=checkPlan({...event,...patch},now);
  return {...event,...updated,revision:event.revision+1,updatedAt:now};
}
export function transitionDiaryEvent(event,next,{expectedRevision,now=Date.now()}={}) {
  if (!event || event.revision!==expectedRevision) fail("revision_conflict");
  if (!STATUSES.has(next)) fail("invalid_status");
  const allowed={
    scheduled:["awaiting_confirmation","cancelled","failed"],
    awaiting_confirmation:["submitted","cancelled","failed"],
    submitted:["completed","failed"],
    completed:[],cancelled:[],failed:[]
  };
  if (!allowed[event.status]?.includes(next)) fail("invalid_transition");
  if (next==="awaiting_confirmation" && event.mode!=="publication") fail("invalid_transition");
  return {...event,status:next,revision:event.revision+1,updatedAt:now};
}
export function dueDiaryEvents(events,now=Date.now()) {
  if (!Number.isSafeInteger(now)) fail("invalid_now");
  return events.filter(e=>e.status==="scheduled" && instant(e.at)<=now)
    .sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id)).map(clone);
}
export function listDiaryEvents(events,{from,to,status}={}) {
  if (!Array.isArray(events)) fail("invalid_events");
  if (from!==undefined) instant(from);
  if (to!==undefined) instant(to);
  if (status!==undefined&&!STATUSES.has(status)) fail("invalid_status");
  return events.filter(e=>(!from||e.at>=from)&&(!to||e.at<to)&&(!status||e.status===status))
    .sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id)).map(clone);
}

// Private diary repository for one authenticated client's serialized Durable Object.
// NEVER call this from a public request without verified Telegram identity.
// This module only stores plans; it has no Telegram, ADMIN, publication, or credit effects.
import {DiaryError, createDiaryEvent, addDiaryEvent, editDiaryEvent,
        transitionDiaryEvent, listDiaryEvents} from "./city_diary_model.js";

const KEY="city_diary_events_v1";
const RECEIPTS="city_diary_operation_receipts_v1";
const ARCHIVE="city_diary_archive_v1";
const TERMINAL=new Set(["completed","cancelled","failed"]);
const ID=/^[a-f0-9]{16,32}$/;
const MAX_RECEIPTS=256;
const fail=code=>{throw new DiaryError(code);};
const snapshot=value=>JSON.parse(JSON.stringify(value));
const assertId=(id)=>{if(typeof id!=="string"||!ID.test(id))fail("invalid_id");};

export class CityDiaryStore {
  constructor(storage) {
    if(!storage||typeof storage.get!=="function"||typeof storage.put!=="function"||typeof storage.transaction!=="function")
      fail("invalid_storage");
    this.storage=storage;
  }
  async list(filters={}) {
    return listDiaryEvents(await this.#events(),filters);
  }
  async listArchive(filters={}) {
    return listDiaryEvents(await this.#archive(),filters);
  }
  async #archive() {
    const entries=await this.storage.get(ARCHIVE);
    if(entries==null)return [];
    if(!Array.isArray(entries))fail("corrupt_diary");
    return entries;
  }
  async archiveTerminal({operation,expectedRevisions,now=Date.now()}={}) {
    assertId(operation);
    if(!Array.isArray(expectedRevisions)||expectedRevisions.length<1||expectedRevisions.length>120||
       expectedRevisions.some(x=>!x||typeof x!=="object"||
         typeof x.id!=="string"||!ID.test(x.id)||
         !Number.isSafeInteger(x.revision)||x.revision<1)||
       new Set(expectedRevisions.map(x=>x.id)).size!==expectedRevisions.length)
      fail("invalid_archive_request");
    if(!Number.isSafeInteger(now))fail("invalid_now");
    const signature=JSON.stringify(["archive",expectedRevisions]);
    return this.storage.transaction(async tx=>{
      const receipts=(await tx.get(RECEIPTS))||{};
      if(Object.hasOwn(receipts,operation)){
        const old=receipts[operation];
        if(old.signature!==signature)fail("operation_conflict");
        return snapshot(old.result);
      }
      const events=(await tx.get(KEY))||[];
      const archive=(await tx.get(ARCHIVE))||[];
      if(!Array.isArray(events)||!Array.isArray(archive))fail("corrupt_diary");
      const selected=new Set(expectedRevisions.map(x=>x.id));
      const retained=[],moving=[];
      for(const event of events){
        if(!selected.has(event.id)){retained.push(event);continue;}
        const expected=expectedRevisions.find(x=>x.id===event.id);
        if(event.revision!==expected.revision)fail("revision_conflict");
        if(!TERMINAL.has(event.status))fail("archive_not_terminal");
        if(event.mode==="publication"&&!["cancelled"].includes(event.status))
          fail("archive_requires_verified_result");
        if(archive.some(x=>x.id===event.id))fail("archive_conflict");
        moving.push({...event,archivedAt:now});
      }
      if(moving.length!==selected.size)fail("event_missing");
      const nextArchive=[...archive,...moving];
      const result={archived:moving.map(x=>({id:x.id,status:x.status,archivedAt:now})),count:moving.length};
      const nextReceipts=Object.fromEntries(Object.entries(receipts).slice(-(MAX_RECEIPTS-1)));
      nextReceipts[operation]={signature,result};
      await tx.put(ARCHIVE,nextArchive);
      await tx.put(KEY,retained);
      await tx.put(RECEIPTS,nextReceipts);
      return snapshot(result);
    });
  }
  async #events() {
    const events=await this.storage.get(KEY);
    if(events==null)return [];
    if(!Array.isArray(events))fail("corrupt_diary");
    return events;
  }
  async #receipts() {
    const receipts=await this.storage.get(RECEIPTS);
    if(receipts==null)return {};
    if(typeof receipts!=="object"||Array.isArray(receipts))fail("corrupt_diary");
    return receipts;
  }
  // A read-only detail does not require an idempotency token.
  async get(id) {
    assertId(id);
    const event=(await this.#events()).find(x=>x.id===id)||(await this.#archive()).find(x=>x.id===id);
    return event?snapshot(event):null;
  }
  async #mutate(operation,signature,work) {
    assertId(operation);
    // One Durable Object transaction commits event data and replay receipt together.
    // Never silently swallow a failed receipt write: it must roll back the event.
    return this.storage.transaction(async tx => {
      const receipts=(await tx.get(RECEIPTS))||{};
      if(typeof receipts!=="object"||Array.isArray(receipts))fail("corrupt_diary");
      if(Object.hasOwn(receipts,operation)) {
        const old=receipts[operation];
        if(old.signature!==signature)fail("operation_conflict");
        return snapshot(old.result);
      }
      const events=(await tx.get(KEY))||[];
      if(!Array.isArray(events))fail("corrupt_diary");
      const archive=(await tx.get(ARCHIVE))||[];
      if(!Array.isArray(archive))fail("corrupt_diary");
      const result=await work(events);
      if(result.events.some(x=>archive.some(a=>a.id===x.id)))fail("duplicate_event");
      const next=Object.fromEntries(Object.entries(receipts).slice(-(MAX_RECEIPTS-1)));
      next[operation]={signature,result:result.event};
      await tx.put(KEY,result.events);
      await tx.put(RECEIPTS,next);
      return snapshot(result.event);
    });
  }
  async create(plan,{id,operation,now=Date.now()}={}) {
    assertId(id);
    // A unique operation token cannot be reused for a different event.
    const signature=JSON.stringify(["create",id,plan]);
    return this.#mutate(operation,signature,events=>{
      const event=createDiaryEvent(plan,{id,now});
      return {events:addDiaryEvent(events,event),event};
    });
  }
  async createBatch(items,{operation,now=Date.now()}={}) {
    if(!Array.isArray(items)||items.length<1||items.length>31)fail("invalid_batch");
    if(items.some(item=>!item||typeof item!=="object"))fail("invalid_batch");
    for(const item of items){
      assertId(item.id);
      // Bulk publication must not clone one review text/ratings across dates.
      // Enable it only after per-event payloads, credit holds and preflight are implemented.
      if(item.plan?.mode!=="reminder")fail("batch_publication_unavailable");
    }
    if(new Set(items.map(item=>item.id)).size!==items.length)fail("duplicate_event");
    const signature=JSON.stringify(["batch",items]);
    return this.#mutate(operation,signature,events=>{
      let next=events;
      const saved=[];
      for(const item of items){
        const event=createDiaryEvent(item.plan,{id:item.id,now});
        next=addDiaryEvent(next,event);
        saved.push(event);
      }
      return {events:next,event:saved};
    });
  }
  async edit(id,patch,{operation,expectedRevision,now=Date.now()}={}) {
    assertId(id);
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)fail("invalid_revision");
    const signature=JSON.stringify(["edit",id,expectedRevision,patch]);
    return this.#mutate(operation,signature,events=>{
      const index=events.findIndex(e=>e.id===id);
      if(index<0)fail("event_missing");
      const event=editDiaryEvent(events[index],patch,{expectedRevision,now});
      const next=events.slice();next[index]=event;
      return {events:next,event};
    });
  }
  async transition(id,nextStatus,{operation,expectedRevision,now=Date.now()}={}) {
    assertId(id);
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)fail("invalid_revision");
    const signature="transition:"+id+":"+nextStatus+":"+expectedRevision;
    return this.#mutate(operation,signature,events=>{
      const index=events.findIndex(e=>e.id===id);
      if(index<0)fail("event_missing");
      const event=transitionDiaryEvent(events[index],nextStatus,{expectedRevision,now});
      const next=events.slice();next[index]=event;
      return {events:next,event};
    });
  }
}

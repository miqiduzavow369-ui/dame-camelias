// Private diary repository for one authenticated client's serialized Durable Object.
// NEVER call this from a public request without verified Telegram identity.
// This module only stores plans; it has no Telegram, ADMIN, publication, or credit effects.
import {DiaryError, createDiaryEvent, addDiaryEvent, editDiaryEvent,
        transitionDiaryEvent, listDiaryEvents} from "./city_diary_model.js";

const KEY="city_diary_events_v1";
const RECEIPTS="city_diary_operation_receipts_v1";
const ID=/^[a-f0-9]{16,32}$/;
const MAX_RECEIPTS=256;
const fail=code=>{throw new DiaryError(code);};
const snapshot=value=>JSON.parse(JSON.stringify(value));
const assertId=(id)=>{if(typeof id!=="string"||!ID.test(id))fail("invalid_id");};

export class CityDiaryStore {
  constructor(storage) {
    if(!storage||typeof storage.get!=="function"||typeof storage.put!=="function")
      fail("invalid_storage");
    this.storage=storage;
  }
  async list(filters={}) {
    return listDiaryEvents(await this.#events(),filters);
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
    const event=(await this.#events()).find(x=>x.id===id);
    return event?snapshot(event):null;
  }
  async #mutate(operation,signature,work) {
    assertId(operation);
    const receipts=await this.#receipts();
    if(Object.hasOwn(receipts,operation)) {
      const old=receipts[operation];
      if(old.signature!==signature)fail("operation_conflict");
      return snapshot(old.result);
    }
    const events=await this.#events();
    const result=await work(events);
    // Persist plan before receipt: concurrent/mid-failure retries are fenced by
    // caller's deterministic event ID / expected revision, not by guessing success.
    await this.storage.put(KEY,result.events);
    // Receipt insertion is best-effort: an event mutation is never reversed if
    // the receipt write fails. Callers can query by event ID and revision.
    const saved=result.event;
    const next=Object.fromEntries(Object.entries(receipts).slice(-(MAX_RECEIPTS-1)));
    next[operation]={signature,result:saved};
    try { await this.storage.put(RECEIPTS,next); } catch { /* recover via read */ }
    return snapshot(saved);
  }
  async create(plan,{id,operation,now=Date.now()}={}) {
    assertId(id);
    // A unique operation token cannot be reused for a different event.
    const signature="create:"+id;
    return this.#mutate(operation,signature,events=>{
      const event=createDiaryEvent(plan,{id,now});
      return {events:addDiaryEvent(events,event),event};
    });
  }
  async edit(id,patch,{operation,expectedRevision,now=Date.now()}={}) {
    assertId(id);
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)fail("invalid_revision");
    const signature="edit:"+id+":"+expectedRevision;
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

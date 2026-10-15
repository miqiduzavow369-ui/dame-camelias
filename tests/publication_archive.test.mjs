import test from "node:test";
import assert from "node:assert/strict";
import {readPublicationArchive} from "../src/publication_archive.js";
const uid="123456789",prefix="cabinet_v3:"+uid+":";
function source(){
 const kv=new Map(),data=new Map(),reads=[];
 const storage={get:async key=>structuredClone(data.get(key)),list:async options=>new Map([...data].filter(([key])=>key.startsWith(options.prefix)&&(!options.startAfter||key>options.startAfter)).sort(([a],[b])=>a.localeCompare(b)).slice(0,options.limit))};
 const binding={get:async key=>{reads.push(...(Array.isArray(key)?key:[key]));return Array.isArray(key)?new Map(key.map(k=>[k,kv.get(k)??null])):kv.get(key)??null;},list:async({prefix,cursor})=>{
  const keys=[...kv.keys()].filter(k=>k.startsWith(prefix)).sort();const start=Number(cursor||0),page=keys.slice(start,start+2);
  return {keys:page.map(name=>({name})),list_complete:start+2>=keys.length,cursor:String(start+2)};
 }};
 const put=(key,value)=>data.set("private:"+key,{value:JSON.stringify(value),expires:0});
 return {kv,data,reads,storage,binding,put};
}
const proof=(id,at,fileId="proof_file")=>({account:"yan_first",profileId:id,fileId,savedAt:at});
test("existing KV and authoritative DO receipts group by Moscow date without exposing other clients",async()=>{
 const s=source(),id="111111";
 const rating=prefix+"owner_anketa_proof_archive_v1:yan_first:"+id;
 s.kv.set(rating,JSON.stringify(proof(id,"2026-10-14T20:59:00Z","old_file")));
 s.put(rating,proof(id,"2026-10-14T20:59:00Z","current_file"));
 s.put(prefix+"owner_anketa_review_proof_archive_v1:yan_first:"+id,proof(id,"2026-10-14T21:01:00Z","review_file"));
 s.put(prefix+"owner_anketa_publication_v1:rating:222222",{status:"publishing",at:"2026-10-16T10:00:00Z"});
 s.put("cabinet_v3:987654321:owner_anketa_proof_archive_v1:yan_first:333333",proof("333333","2026-10-17T10:00:00Z","foreign_file"));
 s.put("owner_anketa_saved:"+uid+":"+id,{host:"b.intimcity.rip",profile:{id}});
 s.kv.set("profile-thumbnails/b.intimcity.rip/"+id+".card.jpg",new Uint8Array([1,2]));
 const before=structuredClone([...s.data]);
 const result=await readPublicationArchive(s.storage,s.binding,uid);
 assert.deepEqual(result.items.map(x=>[x.date,x.kind,x.fileId]),[["20261014","rating","current_file"],["20261015","review","review_file"]]);
 assert.equal(result.firstProfile.id,id);assert.match(result.firstProfile.cardUrl,/\/card\/111111\?site=b.intimcity.rip$/);
 assert.ok(!JSON.stringify(result).includes("foreign_file"));assert.deepEqual([...s.data],before);
});
test("tombstones, malformed dates and absent files do not invent receipts",async()=>{
 const s=source(),key=prefix+"owner_anketa_proof_archive_v1:yan_first:111111";
 s.kv.set(key,JSON.stringify(proof("111111","2026-10-14T12:00:00Z")));
 s.data.set("private:"+key,{value:null,expires:0});
 s.put(prefix+"owner_anketa_proof_archive_v1:yan_first:222222",{account:"yan_first",profileId:"222222",fileId:"valid_file",date:"31.02.2026"});
 s.put(prefix+"owner_anketa_proof_archive_v1:yan_first:333333",proof("333333","2026-10-14T12:00:00Z","https://wrong.example/file"));
 s.put(prefix+"owner_anketa_publication_v1:review:444444",{status:"published",at:"2026-10-15T10:00:00Z"});
 const result=await readPublicationArchive(s.storage,s.binding,uid);
 assert.equal(result.items.length,1);assert.equal(result.items[0].profileId,"444444");assert.equal(result.items[0].fileId,null);assert.equal(result.firstProfile,null);
});
test("deleted saved profile can use its immutable operation to find the first card",async()=>{
 const s=source();
 s.put(prefix+"owner_anketa_proof_archive_v1:yan_first:111111",proof("111111","2026-10-14T12:00:00Z"));
 s.data.set("private:owner_anketa_saved:"+uid+":111111",{value:null,expires:0});
 s.put("cabinet_operation:"+uid+":aaaaaaaaaaaa",{id:"111111",host:"b.intimcity.rip"});
 s.kv.set("profile-thumbnails/b.intimcity.rip/111111.card.jpg",new Uint8Array([1,2]));
 assert.equal((await readPublicationArchive(s.storage,s.binding,uid)).firstProfile.id,"111111");
});
test("DO archive enumeration reads subsequent pages beyond 1000 entries",async()=>{
 const s=source();
 for(let i=100000;i<101001;i++)s.put(prefix+"owner_anketa_proof_archive_v1:yan_first:"+i,proof(String(i),"2026-10-15T10:00:00Z","file_"+i));
 const result=await readPublicationArchive(s.storage,s.binding,uid);assert.equal(result.items.length,1001);
});
test("empty client archive has no date entries or preview card",async()=>{
 const s=source();assert.deepEqual(await readPublicationArchive(s.storage,s.binding,uid),{items:[],firstProfile:null});
 await assert.rejects(readPublicationArchive(s.storage,s.binding,"invalid"));
});
test("legacy KV receipts use batches of at most 100 keys across list pages",async()=>{
 const s=source(),batches=[];
 for(let i=100000;i<101001;i++)s.kv.set(prefix+"owner_anketa_proof_archive_v1:yan_first:"+i,JSON.stringify(proof(String(i),"2026-10-15T10:00:00Z","file_"+i)));
 const get=s.binding.get;s.binding.get=async(key,type)=>{if(Array.isArray(key)){assert.equal(type,"text");assert.ok(key.length<=100);batches.push(key.length);}return get(key,type);};
 s.binding.list=async({prefix,cursor,limit})=>{const keys=[...s.kv.keys()].filter(k=>k.startsWith(prefix)).sort(),start=Number(cursor||0);return {keys:keys.slice(start,start+limit).map(name=>({name})),list_complete:start+limit>=keys.length,cursor:String(start+limit)};};
 assert.equal((await readPublicationArchive(s.storage,s.binding,uid)).items.length,1001);
 assert.equal(batches.length,11);
});

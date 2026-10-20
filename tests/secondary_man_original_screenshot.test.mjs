import test from "node:test";
import assert from "node:assert/strict";
import {validateSecondaryOriginalJpeg,saveSecondaryOriginalJpeg,readSecondaryOriginalJpeg} from "../src/secondary_man_original_screenshot.js";

const identity={userId:"123456789",accountId:"yan_second",profileId:"2468",
 kind:"rating",nonce:"abcdef123456"};
const jpeg=btoa(String.fromCharCode(255,216,255)+("x".repeat(200))+String.fromCharCode(255,217));
const store=()=>{
 const data=new Map();
 return {data,kv:{
   get:async(k,format)=>format==="json"?(data.has(k)?JSON.parse(data.get(k)):null):data.get(k),
   put:async(k,v)=>{data.set(k,v)}
 }};
};
test("original screenshot bytes survive archival without cropping or re-encoding",async()=>{
 const {data,kv}=store();
 const prepared=await validateSecondaryOriginalJpeg(jpeg);
 assert.match(prepared.proofFileId,/^jpeg_[a-f0-9]{40}$/);
 const saved=await saveSecondaryOriginalJpeg(kv,identity,{
   base64:jpeg,expectedProofFileId:prepared.proofFileId,at:1000});
 assert.equal(saved.proofFileId,prepared.proofFileId);
 assert.equal(data.size,1);
 const found=await readSecondaryOriginalJpeg(kv,identity,saved.proofFileId);
 assert.equal(found.base64,jpeg);
 await assert.rejects(()=>saveSecondaryOriginalJpeg(kv,identity,{
   base64:jpeg,expectedProofFileId:prepared.proofFileId,at:1001}),/already archived/);
 assert.equal(await readSecondaryOriginalJpeg(kv,{...identity,accountId:"yan_03"},saved.proofFileId),null);
 assert.equal(await readSecondaryOriginalJpeg(kv,{...identity,userId:"987654321"},saved.proofFileId),null);
});
test("screenshot hash mismatch and invalid original pixels are rejected",async()=>{
 const {kv}=store();
 await assert.rejects(()=>saveSecondaryOriginalJpeg(kv,identity,{
   base64:jpeg,expectedProofFileId:"jpeg_"+"a".repeat(40),at:1000}),/mismatch/);
 for(const broken of ["",btoa("not-an-image"),jpeg.slice(0,-4)+"AAA=",jpeg+"\n"]){
   await assert.rejects(()=>validateSecondaryOriginalJpeg(broken));
 }
 await assert.rejects(()=>saveSecondaryOriginalJpeg(kv,{...identity,accountId:"yan_first"},{
   base64:jpeg,expectedProofFileId:"jpeg_"+"a".repeat(40),at:1000}),/immutable/);
});

// Immutable original JPEG evidence vault for secondary, account-bound publications.
// Private KV is used only as binary storage. A screenshot ID is content-addressed,
// never accepted solely because a runner supplied an arbitrary ID.
import {requirePublicationIdentity,manStorageKey} from "./man_account_isolation.js";

const BASE64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_BASE64=960000;
const PREFIX="secondary-original-jpeg-v1:";
function validIdentity(source){
 const i=requirePublicationIdentity(source);
 if(i.accountId==="yan_first")throw Error("Legacy screenshot archive immutable");
 return i;
}
function storageKey(i,fileId){
 return PREFIX+manStorageKey({userId:i.userId,accountId:i.accountId,
  profileId:i.profileId,scope:"proof"})+":"+i.kind+":"+i.nonce+":"+fileId;
}
export async function validateSecondaryOriginalJpeg(encoded){
 if(typeof encoded!=="string"||encoded.length<128||encoded.length>MAX_BASE64||
    !BASE64.test(encoded))throw Error("Invalid original JPEG payload");
 let binary;
 try{binary=atob(encoded);}catch{throw Error("Invalid original JPEG base64");}
 if(btoa(binary)!==encoded||binary.length<90||binary.length>700000||
    binary.charCodeAt(0)!==0xff||binary.charCodeAt(1)!==0xd8||
    binary.charCodeAt(2)!==0xff||
    binary.charCodeAt(binary.length-2)!==0xff||
    binary.charCodeAt(binary.length-1)!==0xd9)
  throw Error("Invalid original JPEG bytes");
 const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
 const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
 const digest=Array.from(hash,b=>b.toString(16).padStart(2,"0")).join("");
 return Object.freeze({proofFileId:"jpeg_"+digest.slice(0,40),digest,
  size:bytes.length,mime:"image/jpeg"});
}
export async function saveSecondaryOriginalJpeg(kv,source,{base64,expectedProofFileId,at}){
 const i=validIdentity(source);
 if(!Number.isSafeInteger(at)||at<0||
    typeof kv?.put!=="function"||typeof kv?.get!=="function")
  throw Error("Private screenshot storage unavailable");
 const details=await validateSecondaryOriginalJpeg(base64);
 if(expectedProofFileId!==details.proofFileId)
  throw Error("Signed original screenshot ID mismatch");
 const key=storageKey(i,details.proofFileId);
 if(await kv.get(key))throw Error("Original screenshot already archived");
 // Preserve exact bytes encoded losslessly, without cropping/recompression.
 await kv.put(key,JSON.stringify({accountId:i.accountId,userId:i.userId,
  profileId:i.profileId,kind:i.kind,nonce:i.nonce,
  base64,mime:details.mime,digest:details.digest,size:details.size,at}));
 return Object.freeze({proofFileId:details.proofFileId,mime:details.mime,
  size:details.size,digest:details.digest});
}
export async function readSecondaryOriginalJpeg(kv,source,fileId){
 const i=validIdentity(source);
 if(!/^jpeg_[a-f0-9]{40}$/.test(fileId||""))throw Error("Invalid proof identifier");
 const record=await kv.get(storageKey(i,fileId),"json");
 if(!record||record.accountId!==i.accountId||record.userId!==i.userId||
    record.profileId!==i.profileId||record.kind!==i.kind||record.nonce!==i.nonce)
  return null;
 const actual=await validateSecondaryOriginalJpeg(record.base64);
 if(actual.proofFileId!==fileId||actual.digest!==record.digest||
    actual.size!==record.size)throw Error("Archived original screenshot corrupted");
 return Object.freeze({base64:record.base64,mime:"image/jpeg",size:actual.size});
}

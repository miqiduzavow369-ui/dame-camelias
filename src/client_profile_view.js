import {validProfileId} from "./client_isolation.js";

// A verified card is valid only for the exact profile link that was checked.
// If a user changes the saved link, verification must be repeated.
export function matchingVerifiedProfile(savedLink,verification){
 if(typeof savedLink!=="string"||!verification||typeof verification!=="object")
   return null;
 const id=String(verification.id??"");
 if(!validProfileId(id)||typeof verification.url!=="string"||
    verification.url!==savedLink||!Number.isFinite(verification.verifiedAt))
   return null;
 let url;
 try{url=new URL(savedLink);}catch{return null;}
 if(url.protocol!=="https:"||url.username||url.password||url.port||url.hash||
    url.search||!url.hostname.endsWith(".intimcity.rip")||
    url.pathname!=="/indi/anketa"+id+".htm")return null;
 return verification;
}

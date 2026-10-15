import test from "node:test";
import assert from "node:assert/strict";
import {matchingVerifiedProfile} from "../src/client_profile_view.js";
const url="https://b.intimcity.rip/indi/anketa698842.htm";
const profile={id:"698842",url,name:"Test",verifiedAt:Date.now()};
test("a verified profile matches the exact saved link",()=>{
 assert.deepEqual(matchingVerifiedProfile(url,profile),profile);
 assert.equal(matchingVerifiedProfile("https://a.intimcity.rip/indi/anketa698842.htm",profile),null);
 assert.equal(matchingVerifiedProfile(url,{...profile,id:"123456"}),null);
 assert.equal(matchingVerifiedProfile(url,{...profile,verifiedAt:null}),null);
 assert.equal(matchingVerifiedProfile(url,{...profile,url:"https://evil.test/"}),null);
});
test("cannot use a forged or malformed link as verified",()=>{
 for(const value of [url+"?next=1","http://b.intimcity.rip/indi/anketa698842.htm","https://fake-intimcity.rip/indi/anketa698842.htm"])
  assert.equal(matchingVerifiedProfile(value,{...profile,url:value}),null);
});

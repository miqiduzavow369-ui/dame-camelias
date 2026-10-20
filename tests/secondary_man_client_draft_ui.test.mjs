import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const html=fs.readFileSync("anketa/mini-preview.html","utf8");
test("client secondary draft editor renders without altering Yan First actions",()=>{
 for(const id of ["secondaryDraftCard","secondaryDraftInput","secondaryDraftSave","secondaryDraftAttest","secondaryRatingTab","secondaryReviewTab"])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/secondaryDraftRequest\("save"/);
 assert.match(html,/mini-secondary-draft/);
 assert.match(html,/man\.id!=="yan_first"&&man\.visible!==false/);
 assert.match(html,/if\(!availableMen\.some\(m=>m\.id===account&&m\.visible!==false\)\)return/);
 assert.match(html,/\$\("secondaryDraftCard"\)\.hidden=selectedAccount==="yan_first"/);
 assert.match(html,/if\(selectedAccount!=="yan_first"&&saved\.publicationAvailable!==true\)/);
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new vm.Script(script[1]));
});

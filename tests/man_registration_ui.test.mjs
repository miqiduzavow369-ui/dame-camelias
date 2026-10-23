import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script,createContext} from "node:vm";
import {MAN_ACCOUNTS} from "../src/man_accounts.js";
const html=readFileSync("admin/preview-v3.html","utf8");
const consoleSource=html.slice(html.indexOf("function renderManConsole(){"),html.indexOf("function renderManSiteForm(){"));
const tileHelpers=html.slice(html.indexOf('function manTileEmail('),html.indexOf('async function toggleManClientVisibility('));
function view(id,phase){
 const proxy=phase>=1,login=phase>=2,approved=phase>=3;
 const data={id,proxy:{configured:proxy,version:1,expectedIp:'8.8.8.8'},browser:{version:1,status:proxy?"verified":"not_started"},
  login:{technicalReady:login},connection:{browserVerified:proxy,siteConfigured:login,siteIdentityVerified:login,ready:approved}};
 const ctx=createContext({manAccounts:[{...MAN_ACCOUNTS.find(x=>x.id===id),technicalName:"own@example.test",displayIp:id==='yan_first'?null:'45.39.104.3',approval:{approved},readiness:{connectionReady:approved}}],selectedManId:id,wizardData:data,wizardLoading:false,wizardError:"",manApprovalBusy:false,
  esc:x=>String(x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;"),back:()=>"",output:null});
 new Script(tileHelpers+consoleSource+"\noutput=renderManConsole();").runInContext(ctx);return ctx.output;
}
test("every secondary card has the same three stages and exactly one next action",()=>{
 for(const man of MAN_ACCOUNTS.slice(1))for(let phase=0;phase<4;phase++){
  const output=view(man.id,phase);
  assert.match(output,/class="man-identity-email">own<\/p>/);
  assert.ok(output.includes(`dc_man_${String(man.number).padStart(2,'0')}.webp`),man.id);
  assert.ok(output.includes(phase>=1?'8.8.8.8':'45.39.104.3'),man.id);
  assert.doesNotMatch(output,/@example.test/);
  assert.equal((output.match(/<li class="registration-step /g)||[]).length,3,man.id);
  assert.equal((output.match(/class="primary"/g)||[]).length,phase<3?1:0,man.id);
  assert.equal(output.includes("✓ Готов к работе"),phase===3,man.id);
  for(const text of ["nonce","Билет подтверждения","Диагностика","Готовность оценок","Согласовать отзыв","Chromium"])
   assert.equal(output.includes(text),false,text);
  if(phase===0)assert.match(output,/🌐 Добавить прокси/);
  if(phase===1)assert.match(output,/🔐 Добавить кабинет/);
  if(phase===2)assert.match(output,/✅ Подтвердить подключение/);
 }
});
test("legacy card stays outside registration and keeps its established screen",()=>{
 const output=view("yan_first",3);
 assert.match(output,/Действующий аккаунт/);assert.match(output,/Техническое имя/);
 assert.match(output,/176\.56\.35\.167/);
 assert.match(output,/dc_man_01\.webp/);
 assert.doesNotMatch(output,/registration-step|Подтвердить подключение|Отозвать подключение/);
});
test("registration only reads server status, does not run diagnostics or grant approval on opening",()=>{
 const start=html.indexOf("function openManDetail("),end=html.indexOf("async function reloadManHistory",start);
 const source=html.slice(start,end);
 assert.match(source,/man_registration_status/);
 assert.doesNotMatch(source,/reloadManHistory\(id\)|reloadManChecks\(id\)|refreshSecondaryProfileProbe\(id\)|secondary_man_approval_set/);
 assert.match(source,/seq!==wizardSeq\|\|selectedManId!==id/);
 assert.match(source,/data\.connection\?\.accountId!==id/);
 assert.match(html,/if\(busy\)manRegistrationTimer=setTimeout/);
});

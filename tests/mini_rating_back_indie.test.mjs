import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";import {Script} from "node:vm";
const html=readFileSync(new URL("../anketa/mini-preview.html",import.meta.url),"utf8");
const engine=readFileSync(new URL("../src/owner_anketa.js",import.meta.url),"utf8");
test("rating screen script parses",()=>assert.doesNotThrow(()=>new Script(html.split("<script>").at(-1).split("</script>")[0])));
test("back from review removes review and navigates to choices",()=>{assert.match(html,/back.onclick=\(\)=>\{review.remove\(\)/);assert.match(html,/field.scrollIntoView/);});
test("real indie is the only allowed affirmative option in Mini App",()=>{assert.match(html,/const indie=\/реальн/);assert.match(html,/select.value=""/);assert.match(html,/choice.textContent="Да"/);assert.match(html,/draft\[i\]="Фото соответствует"/);assert.match(engine,/const isIndieField=field/);assert.match(engine,/invalid_choice/);});

test("photo correspondence is fixed once, without a duplicate dropdown",()=>{assert.match(html,/if\(fixed\)\{/);assert.match(html,/draft\[i\]="Фото соответствует";\s*return;/);assert.doesNotMatch(html,/entry.append\(fixedText\)/);});

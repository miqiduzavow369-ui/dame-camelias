import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
const page=readFileSync(new URL("../anketa/city-diary-preview.html",import.meta.url),"utf8");
test("City diary preview scripts parse",()=>{
  const scripts=[...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(x=>x.trim());
  assert.ok(scripts.length>0);
  for(const code of scripts)assert.doesNotThrow(()=>new Script(code));
});
test("preview uses existing black and gold City tokens",()=>{
  for(const token of ["#080808","#d9b46e","#ffe0a0","Мой ежедневник","Календарь"])
    assert.ok(page.includes(token),token);
  assert.ok(page.includes('classList.add("selected")'));
});
test("planning UI remains read-only for publication execution",()=>{
  assert.ok(page.includes('/api/anketa/mini-diary'));
  assert.ok(page.includes('/api/anketa/mini-preview'));
  assert.ok(page.includes('await api("cancel"'));
  assert.ok(!page.includes('api("publish"'));
  assert.ok(!page.includes('credits_complete'));
  assert.ok(!page.includes('review_publish'));
});
test("text content is inserted through DOM APIs rather than user-supplied HTML",()=>{
  assert.ok(page.includes('node.textContent=value'));
  assert.ok(!page.includes("innerHTML="));
  assert.ok(!page.includes("localStorage"));
});

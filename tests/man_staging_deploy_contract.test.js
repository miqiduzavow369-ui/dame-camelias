import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const config=readFileSync(new URL("../wrangler.man-staging.toml",import.meta.url),"utf8");
const entry=readFileSync(new URL("../src/man_staging_worker.js",import.meta.url),"utf8");
const allowedVars=new Map([
 ["MAN_STAGING_ONLY","true"],
 ["CABINET_PUBLICATIONS_ENABLED","false"],
 ["CABINET_CLIENTS_ENABLED","false"]
]);
const lines=config.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith("#"));
const sections=lines.filter(x=>/^\[/.test(x));
function fields(section){
 let inside=false;
 const rows=[];
 for(const line of lines){
  if(line.startsWith("[")){inside=line===section;continue}
  if(inside)rows.push(line);
 }
 return rows;
}
test("staging Wrangler is a distinct workers.dev entry with no routes",()=>{
 assert.match(config,/^name\s*=\s*"dame-camelias-man-staging"\s*$/m);
 assert.match(config,/^main\s*=\s*"src\/man_staging_worker\.js"\s*$/m);
 assert.match(config,/^workers_dev\s*=\s*true\s*$/m);
 assert.doesNotMatch(config,/^\s*(route|routes|zone_id|account_id|kv_namespaces|r2_buckets|d1_databases|services|queues|unsafe|assets|triggers|observability|logpush)\s*=/m);
 assert.deepEqual(sections,["[[durable_objects.bindings]]","[[migrations]]","[vars]"]);
});
test("staging Durable Object binding, class, and isolated migration remain stable",()=>{
 assert.deepEqual(fields("[[durable_objects.bindings]]"),[
  'name = "MAN_STAGING_ACCOUNTS"','class_name = "ManStagingAccounts"'
 ]);
 assert.deepEqual(fields("[[migrations]]"),[
  'tag = "man-staging-v1"','new_sqlite_classes = ["ManStagingAccounts"]'
 ]);
 assert.match(entry,/export class ManStagingAccounts\s*\{/);
 assert.match(entry,/Object\.keys\(env\)\.every\(key=>STAGING_ENV_KEYS\.has\(key\)\)/);
});
test("only the reviewed disabled staging vars can appear in configuration",()=>{
 const actual=fields("[vars]").map(line=>{
  const match=line.match(/^([A-Z_]+)\s*=\s*"([^"]*)"$/);
  assert.ok(match,"unexpected staging variable definition: "+line);
  return [match[1],match[2]];
 });
 assert.equal(actual.length,allowedVars.size);
 for(const [key,value]of actual)assert.equal(allowedVars.get(key),value,"unapproved config variable "+key);
});
test("staging config rejects production credentials and customer storage bindings",()=>{
 assert.doesNotMatch(lines.join("\n"),/BOT_TOKEN\s*=|INTIMCITY_|PROXY_|ORDER_REMINDERS|VISITORS_KV|\bsecrets\b|production|dame-camelias\.gptjjjgpt/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {validateProxyInput,saveProxy,proxyStatus,requirePinnedEgress} from '../src/man_proxy_vault.js';
globalThis.crypto ??= webcrypto;
const owner='5866034656';
const id='yan_second';
const key='ab'.repeat(32);
const settings=()=>({protocol:'socks5',host:'proxy.example.com',port:1080,username:'example',password:'secret_foo',expectedIp:'8.8.8.8'});
function store(){
 const values=new Map();
 const tx={get:async k=>values.get(k),put:async(k,v)=>values.set(k,v)};
 return {...tx,transaction:async fn=>fn(tx),values};
}
const who={actorId:owner,cabinetId:owner,ownerId:owner,accountId:id};
test('proxy validation requires pinned public IPv4 and each password',()=>{
 assert.deepEqual(validateProxyInput(settings()),settings());
 for(const ip of ['127.0.0.1','10.1.2.3','192.168.1.1','172.16.0.1','169.254.2.4','203.0.113.10']){
  assert.throws(()=>validateProxyInput({...settings(),expectedIp:ip}));
 }
 assert.doesNotThrow(()=>validateProxyInput({...settings(),expectedIp:'172.50.10.2'}));
 assert.throws(()=>validateProxyInput({...settings(),password:''}));
});
test('vault rejects Yan First, other actors, missing key, unverified egress',async()=>{
 const s=store();
 await assert.rejects(saveProxy(s,{},{...who,expectedVersion:0,settings:settings(),at:1}));
 assert.equal(s.values.size,0);
 await assert.rejects(saveProxy(s,{MAN_PROXY_ENCRYPTION_KEY:key},{...who,accountId:'yan_first',expectedVersion:0,settings:settings(),at:1}));
 await assert.rejects(saveProxy(s,{MAN_PROXY_ENCRYPTION_KEY:key},{...who,actorId:'0000000000',expectedVersion:0,settings:settings(),at:1}));
 assert.throws(()=>requirePinnedEgress('yan_second',{accountId:id,version:1,enabled:true,proxyVerified:true,ipVerified:true,siteIdentityVerified:true,expectedIp:'8.8.8.8'},'1.1.1.1',1));
});
test('each account sealed independently with no plaintext exposed, optimistic versions',async()=>{
 const s=store(),env={MAN_PROXY_ENCRYPTION_KEY:key};
 const a=await saveProxy(s,env,{...who,expectedVersion:0,settings:settings(),at:2});
 assert.equal(a.ok,true);assert.equal(a.canPublish,false);
 assert.equal(a.proxyVerified,false);assert.equal(a.expectedIp,'8.8.8.8');
 assert.equal(JSON.stringify([...s.values.values()]).includes('secret_foo'),false);
 assert.equal(JSON.stringify(a).includes('secret_foo'),false);
 await assert.rejects(saveProxy(s,env,{...who,expectedVersion:0,settings:settings(),at:3}),/Version conflict/);
 assert.equal((await proxyStatus(s,who)).version,1);
 await saveProxy(s,env,{...who,accountId:'yan_03',expectedVersion:0,settings:{...settings(),password:'other_secret'},at:3});
 assert.equal(s.values.size,2);
 assert.notDeepEqual([...s.values.values()][0].sealed,[...s.values.values()][1].sealed);
});

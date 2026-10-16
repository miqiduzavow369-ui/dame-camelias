import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const html=readFileSync(new URL('../anketa/mini-preview.html',import.meta.url),'utf8');
const source=html.split('<script>').at(-1)?.split('</script>')[0];
test('Mini App inline JavaScript parses',()=>assert.doesNotThrow(()=>new Script(source)));
test('Add profile has separate panel, clear steps and return navigation',()=>{
 for(const key of ['id="tab-add"','id="beginAddProfile"','id="addProfileCancel"','id="addProfileUrl"','id="addProfileContinue"','profile-steps'])
  assert.ok(html.includes(key),key);
});
test('Profile is only confirmed by authenticated server response',()=>{
 assert.match(html,/miniAdd\("start"/);
 assert.match(html,/miniAdd\("status"/);
 assert.match(html,/miniAdd\("confirm"/);
 assert.match(html,/Анкета сохранена/);
 assert.match(html,/Никакие данные не сохраняются без проверки/);
 assert.match(html,/result\.stage==="confirm"/);
});

test('Profile link field avoids iOS focus zoom',()=>{
 assert.match(html,/#addProfileUrl\{font-size:16px!important/);
});

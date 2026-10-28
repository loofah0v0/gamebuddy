import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {persona,productIdentity} from '../packages/runtime-dsh/persona.mjs';
import {installProductIdentity,replaceLegacyProductPersona} from '../packages/runtime-dsh/product-identity.mjs';
test('editable AGENT.md is the real product identity source',async()=>{
 const text=(await readFile(new URL('../AGENT.md',import.meta.url),'utf8')).trim();assert.equal(productIdentity,text);assert(persona.startsWith(text));assert.match(text,/GameBuddy/);assert.match(text,/游戏搭子/);assert.match(text,/独立 AI Agent/);assert(!/DSH|DeepSeek Harness|WorkBuddy/.test(text));
});
test('product identity uses natural wording without framework attribution in the default intro',()=>{
 assert(!/DSH|DeepSeek Harness|built on.*SDK/.test(persona));assert.match(productIdentity,/你是谁.*你能干什么/);assert.match(productIdentity,/底层框架.*不是默认/);assert.match(productIdentity,/明确问实现原理.*如实解释/);assert.match(productIdentity,/不假称完全自研/);
});
test('identity keeps capability, spending, privacy, evidence and memory boundaries',()=>{
 for(const word of ['以当前可用工具','未经本轮核实','密码','验证码','真实回执','持久记忆','停止请求','资源限额'])assert(productIdentity.includes(word));
 assert.match(persona,/do not use a generic shell to circumvent/);assert.match(persona,/No game binding is required/);assert.match(persona,/fix it yourself/);assert.match(persona,/full-access \+ never/);assert.match(persona,/startup=true/);
});
test('old saved product presets migrate without overwriting custom personas or tool policy',()=>{
 const legacy={name:'deployment:persona-prefix',order:0,text:'You are GameGuy (GG), an independent game-centered AI agent built on the complete DSH SDK. Old policy.'},tool={name:'tools:safety',order:500,text:'preserve permissions'},original={sections:[legacy,tool],tools:[{name:'read'}],contexts:[{name:'cwd'}]};
 const migrated=replaceLegacyProductPersona(original);assert.equal(migrated.sections[0].text,persona);assert.equal(migrated.sections[1],tool);assert.equal(migrated.tools,original.tools);assert.equal(migrated.contexts,original.contexts);assert.equal(original.sections[0],legacy);assert.match(original.sections[0].text,/SDK/);
 const custom={name:'deployment:persona-prefix',text:'My custom planning and output preferences'};assert.equal(replaceLegacyProductPersona({sections:[custom]}).sections[0],custom);
 const folded={...legacy,text:legacy.text.replace('built on the complete','built on\n the complete')};assert.equal(replaceLegacyProductPersona({sections:[folded]}).sections[0].text,persona);
});
test('identity has an independent prompt section after preset personas with normal teardown',async()=>{
 const sections=[],handlers=[],effects=[];let disposed=0;
 installProductIdentity({systemPrompt:{section:s=>{sections.push(s);return()=>disposed++;}},effect:fn=>effects.push(fn()),on:(event,fn)=>handlers.push({event,fn})});
 assert.equal(sections[0].name,'gameguy:product-identity');assert.equal(sections[0].text,productIdentity);assert.equal(sections[0].interpolate,false);assert(sections[0].order>10200);assert.equal(handlers[0].event,'system-prompt/assemble');
 const value=await handlers[0].fn({}, {}, async()=>({sections:[],tools:['preserved']}));assert.deepEqual(value.tools,['preserved']);effects[0]();assert.equal(disposed,1);
});
test('user-facing welcome copy describes GameGuy rather than its framework',async()=>{
 const source=await readFile(new URL('../packages/native-client/client.js',import.meta.url),'utf8');assert(source.includes('GameBuddy（Buddy）是你的游戏搭子'));assert(!source.includes('基于开源 DeepSeek Harness'));assert(!source.includes('built on open-source DeepSeek Harness'));
});

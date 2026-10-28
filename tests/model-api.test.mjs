import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverModels,verifyModelAPI,resolveModelKey} from '../packages/app-service/model-api.mjs';
const model={provider:'compatible',baseURL:'http://127.0.0.1:12345/custom/v1/',model:'fixture-model',vision:false};
const key='unit-test-not-a-real-secret';
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});
const completion={choices:[{message:{role:'assistant',content:'OK'}}]};

test('model directory uses canonical route and auth, no Agent messages, accepts empty model ID',async()=>{
 let calls=0;const result=await discoverModels({...model,model:''},key,{fetchImpl:async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:12345/custom/v1/models');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+key);assert.equal(options.body,undefined);return json({data:[{id:'z'},{id:'a'},{id:'z'}]});}});
 assert.equal(calls,1);assert.deepEqual(result.models,['a','z']);assert.equal(result.apiConnectionVerified,false);
});
test('official model directory uses DSH default API host',async()=>{
 await discoverModels({provider:'deepseek',model:'deepseek-flash',baseURL:'https://ignored.example/v1'},key,{fetchImpl:async url=>{assert.equal(url,'https://api.deepseek.com/models');return json({data:[]});}});
});
test('directory filters invalid IDs and refuses reflected key',async()=>{
 const result=await discoverModels(model,key,{fetchImpl:async()=>json({data:[null,{id:''},{id:3},{id:'\ninvalid'},{id:' trimmed '},{id:'x'.repeat(201)},{id:key},{id:'valid'}]})});assert.deepEqual(result.models,['valid']);
});
test('empty directory is explicit and manual model ID remains possible',async()=>{
 const result=await discoverModels(model,key,{fetchImpl:async()=>json({data:[]})});assert.equal(result.count,0);
});
test('unsupported directory and all-invalid directory fail clearly',async()=>{
 await assert.rejects(discoverModels(model,key,{fetchImpl:async()=>json({models:[]})}),/格式不兼容/);
 await assert.rejects(discoverModels(model,key,{fetchImpl:async()=>json({data:[{id:key}]})}),/没有有效/);
});
test('directory admission rejects excessive record count',async()=>{
 await assert.rejects(discoverModels(model,key,{fetchImpl:async()=>json({data:Array.from({length:1001},(_,i)=>({id:String(i)}))})}),/1000/);
});
test('API verification actually sends one minimal selected-model completion without tools',async()=>{
 let calls=0;const result=await verifyModelAPI(model,key,{fetchImpl:async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:12345/custom/v1/chat/completions');assert.equal(options.method,'POST');const body=JSON.parse(options.body);assert.equal(body.model,'fixture-model');assert.equal(body.stream,false);assert.equal(body.max_tokens,16);assert.equal(body.tools,undefined);assert.deepEqual(body.messages,[{role:'user',content:'Reply with OK only.'}]);return json(completion);}});
 assert.equal(calls,1);assert.equal(result.apiConnectionVerified,true);assert.equal(result.model,'fixture-model');assert.ok(!JSON.stringify(result).includes(key));
});
test('reasoning text counts as a valid minimal reasoning-model response',async()=>{
 const r=await verifyModelAPI(model,key,{fetchImpl:async()=>json({choices:[{message:{role:'assistant',content:null,reasoning_content:'Reasoning'}}]})});assert.equal(r.apiConnectionVerified,true);
});
test('empty, error, wrong-role and tool-only responses cannot claim validation',async()=>{
 for(const payload of [{}, {choices:[]}, {error:{message:key},...completion},{choices:[{message:{role:'user',content:'OK'}}]},{choices:[{message:{role:'assistant',content:''}}]},{choices:[{message:{role:'assistant',content:'OK',tool_calls:[{}]}}]}])await assert.rejects(verifyModelAPI(model,key,{fetchImpl:async()=>json(payload)}),/未返回有效/);
});
test('missing or malformed key cannot cause any request',async()=>{
 for(const value of ['',null,undefined,'\r\nkey'])await assert.rejects(discoverModels(model,value,{fetchImpl:async()=>{assert.fail('Must not request');}}),/Key/);
});
test('invalid endpoint cannot cause request or expose URL secrets',async()=>{
 await assert.rejects(verifyModelAPI({...model,baseURL:'https://user:secret@example.com/v1'},key,{fetchImpl:async()=>assert.fail('Must not request')}),/不能在 URL/);
});
test('HTTP auth errors never expose upstream body containing key',async()=>{
 await assert.rejects(verifyModelAPI(model,key,{fetchImpl:async()=>json({error:{message:key}},401)}),error=>error.message.includes('认证失败')&&!error.message.includes(key));
});
test('directory unsupported, rate limit and server errors have actionable safe messages',async()=>{
 for(const [status,pattern] of [[403,/权限/],[404,/手动填写/],[429,/额度/],[500,/HTTP 500/]])await assert.rejects(discoverModels(model,key,{fetchImpl:async()=>json({error:key},status)}),pattern);
});
test('HTML endpoint does not count as a valid API',async()=>{
 await assert.rejects(verifyModelAPI(model,key,{fetchImpl:async()=>new Response('<html>'+key+'</html>')}),error=>error.message.includes('有效 JSON')&&!error.message.includes(key));
});
test('response budget enforced by both content-length and streaming bytes',async()=>{
 await assert.rejects(discoverModels(model,key,{maxBytes:20,fetchImpl:async()=>json({data:[]},200,{'Content-Length':'21'})}),/响应过大/);
 await assert.rejects(discoverModels(model,key,{maxBytes:20,fetchImpl:async()=>json({data:[{id:'longer-than-budget'}]})}),/响应过大/);
});
test('timeout aborts a hanging request with a sanitized message',async()=>{
 await assert.rejects(discoverModels(model,key,{timeoutMs:20,fetchImpl:async(_url,{signal})=>new Promise((_ok,bad)=>signal.addEventListener('abort',()=>bad(Error(key))))}),error=>error.message.includes('超时')&&!error.message.includes(key));
});
test('arbitrary network/redirect exception cannot leak key even with a safe-looking prefix',async()=>{
 for(const message of [key,'认证失败 '+key])await assert.rejects(discoverModels(model,key,{fetchImpl:async(_url,o)=>{assert.equal(o.redirect,'error');throw Error(message);}}),error=>error.message.includes('不跟随重定向')&&!error.message.includes(key));
});
test('draft key lookup reads saved key only for same normalized provider and route',async()=>{
 const canonical={...model,baseURL:model.baseURL.replace(/\/$/,'')};let reads=0;const read=async()=>{reads++;return key;};
 assert.equal(await resolveModelKey(canonical,'',canonical,read),key);assert.equal(reads,1);
 assert.equal(await resolveModelKey({...canonical,model:'other'},'',canonical,read),key);assert.equal(reads,2);
 assert.equal(await resolveModelKey({...canonical,baseURL:'https://other.example/v1'},'',canonical,read),'');assert.equal(reads,2);
 assert.equal(await resolveModelKey({...canonical,provider:'deepseek',baseURL:''},'',canonical,read),'');assert.equal(reads,2);
 assert.equal(await resolveModelKey(canonical,' new-draft-key ',canonical,read),'new-draft-key');assert.equal(reads,2);
});

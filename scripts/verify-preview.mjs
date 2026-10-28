/** Browser visual/behavioral checks for previewHtml against SYNTHETIC fixtures, not a game. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {previewHtml} from '../packages/core/lib/preview.js';
import {openVerificationBrowser} from './verification-browser.mjs';
const outDir=resolve(import.meta.dirname,'../artifacts/verification');await mkdir(outDir,{recursive:true});
const report={scope:'Headless preview renderer / SYNTHETIC state, MuMu launcher and PNG ONLY; not native sidebar or game E2E',checks:[]};
const pass=(name,detail={})=>{report.checks.push({name,status:'passed',detail});console.log('PASS '+name);};
let browser,context,server;
try{
 browser=await openVerificationBrowser();report.browser=browser.version();
 context=await browser.newContext({viewport:{width:680,height:900},locale:'zh-CN'});
 const fixture=await context.newPage();
 await fixture.setContent('<html lang="zh"><meta charset="utf-8"><body style="margin:0;background:#193347;color:#e7edf5;font:24px system-ui;display:grid;place-content:center;height:100vh;text-align:center"><strong>GameGuy · LOCAL TEST FIXTURE</strong><p>这是合成画面，不是真实游戏截图</p><small>1280 × 720 · 预览链路验收</small></body></html>');
 await fixture.setViewportSize({width:1280,height:720});
 const png=await fixture.screenshot();await fixture.close();
 let imageRequests=0,stops=[],deviceRequests=[],launches=[],available=false,token,actionFailure=false;
 const instance='arknights-fixture';
 const launch={executable:'D:/fixture/mumu-cli.exe',instanceIndex:7};
 const state={catalog:[{title:'明日方舟 · MAA',enabled:true},{title:'Minecraft · Mineflayer',enabled:true},{title:'龙虾杀 · 官方 Skill',enabled:true}],preview:{revision:1},runs:[],devices:[]};
 server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  res.setHeader('cache-control','no-store');
  const json=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
  const body=async()=>{let text='';for await(const chunk of req)text+=chunk;return JSON.parse(text);};
  if(path==='/gameguy/preview'){res.setHeader('content-type','text/html; charset=utf-8');res.end(previewHtml);}
  else if(path==='/gameguy/state')json(state);
  else if(path==='/gameguy/image'){
   imageRequests++;
   if(state.preview.privacy||(state.devices[0]&&state.devices[0].status!=='ready')){res.statusCode=409;res.end('SYNTHETIC device not connected');}
   else{res.setHeader('content-type','image/png');res.end(png);}
  }
  else if(path==='/gameguy/device'&&req.method==='GET')json({instance,available:available&&!state.preview.privacy,...(token?{token,launch}:{})});
  else if(path==='/gameguy/device'&&req.method==='POST'){
   deviceRequests.push(await body());token='00000000-0000-4000-8000-000000000001';
   state.devices=[{instance,status:'confirmation-required',message:'SYNTHETIC 请确认'}];json({status:'confirmation-required'});
  }
  else if(path==='/gameguy/device/start'&&req.method==='POST'){
   const data=await body();
   if(actionFailure){res.statusCode=409;res.end('SYNTHETIC confirmation failed');}
   else if(!token||data.token!==token){res.statusCode=409;res.end('invalid synthetic token');}
   else{launches.push(data);token=undefined;state.devices=[{instance,status:'starting',message:'SYNTHETIC startup'}];json({status:'starting'});}
  }
  else if(path==='/gameguy/stop'&&req.method==='POST'){
   const data=await body();stops.push(data);token=undefined;
   for(const r of state.runs)if(r.instance===data.instance)r.status='stopped';
   for(const d of state.devices)if(d.instance===data.instance){d.status='stopped';d.message='SYNTHETIC cancelled; emulator might remain running';}
   json({status:'stopped'});
  }else{res.statusCode=404;res.end();}
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/gameguy/preview');
 await page.waitForFunction(()=>document.getElementById('info').textContent.includes('等待通过对话'));
 await page.screenshot({path:join(outDir,'preview-idle-fixture.png')});pass('Preview idle + three plugin labels');
 state.preview={revision:2,instance,game:'arknights',privacy:false};
 state.runs=[{instance,status:'running',events:[{kind:'fixture',data:'<script>window.fixtureInjection=true</script>'}]}];
 const imageReady=()=>page.waitForFunction(()=>{const i=document.getElementById('screen');return !i.hidden&&i.complete&&i.naturalWidth===1280;});
 const deviceStatus=text=>page.locator('#device-status').filter({hasText:text}).waitFor();
 const noImages=async()=>{const count=imageRequests;await page.waitForTimeout(2200);assert.equal(imageRequests,count);assert.equal(await page.locator('#screen').getAttribute('src'),null);};
 await imageReady();assert.equal(await page.evaluate(()=>window.fixtureInjection),undefined);assert((await page.locator('#events').textContent()).includes('<script>'));
 await page.screenshot({path:join(outDir,'preview-arknights-fixture.png')});pass('PNG decode / dimensions / safe event text',{width:1280,height:720,synthetic:true});
 await page.locator('#stop').click();await page.waitForFunction(()=>document.getElementById('info').textContent.includes('stopped'));
 assert.deepEqual(stops,[{instance}]);pass('Stop button POST identifies selected instance');
 state.preview.privacy=true;
 await page.locator('#notice').filter({hasText:'隐私暂停'}).waitFor();await noImages();
 await page.screenshot({path:join(outDir,'preview-privacy-fixture.png')});pass('Privacy removes image source and stops image polling');
 state.preview.privacy=false;available=true;state.runs=[];
 await page.locator('#device').waitFor();pass('Configured MuMu launcher visible in GameGuy');
 await page.locator('#device').click();await page.locator('#approval').waitFor();
 assert((await page.locator('#launch-info').textContent()).includes(launch.executable));assert((await page.locator('#launch-info').textContent()).includes('实例 7'));
 assert.deepEqual(deviceRequests,[{instance}]);assert.equal(launches.length,0);await noImages();
 await page.screenshot({path:join(outDir,'preview-mumu-confirmation-fixture.png')});pass('Request shows executable/selected index; does not launch or capture');
 await page.locator('#cancel-device').click();await deviceStatus('stopped');assert.equal(await page.locator('#approval').isVisible(),false);assert.equal(launches.length,0);await noImages();pass('Cancel consumes pending prompt with no launch');
 await page.locator('#device').click();await page.locator('#approval').waitFor();await page.locator('#confirm-device').click();await deviceStatus('starting');
 assert.equal(launches.length,1);assert.equal(launches[0].instance,instance);assert.equal(await page.locator('#device').isDisabled(),true);await noImages();
 await page.screenshot({path:join(outDir,'preview-mumu-starting-fixture.png')});pass('Confirm submits challenge; starting disables launcher and capture');
 state.devices=[{instance,status:'ready',message:'SYNTHETIC connected; not real MuMu'}];await imageReady();
 await page.screenshot({path:join(outDir,'preview-mumu-ready-fixture.png')});pass('Ready restores synthetic image preview');
 await page.locator('#device').click();await page.locator('#approval').waitFor();actionFailure=true;
 await page.locator('#confirm-device').click();await deviceStatus('SYNTHETIC confirmation failed');await page.waitForTimeout(2200);
 assert((await page.locator('#device-status').textContent()).includes('SYNTHETIC confirmation failed'));assert.equal(launches.length,1);pass('HTTP action error persists across refresh; no false launch');
 actionFailure=false;await page.locator('#cancel-device').click();
 await page.locator('#device').click();await page.locator('#approval').waitFor();await page.locator('#confirm-device').click();await deviceStatus('starting');
 await page.locator('#stop').click();await deviceStatus('stopped');await noImages();pass('Stop interrupts synthetic startup; no image or emulator shutdown request');
 await page.locator('#device').click();await page.locator('#approval').waitFor();
 state.preview.privacy=true;
 await page.locator('#notice').filter({hasText:'隐私暂停'}).waitFor();assert.equal(await page.locator('#approval').isVisible(),false);assert.equal(await page.locator('#device').isVisible(),false);await noImages();pass('Privacy hides startup approval/launcher and blocks image polling');
 state.preview={revision:3,instance:'minecraft-fixture',game:'minecraft',privacy:false};state.devices=[];
 state.runs=[{instance:'minecraft-fixture',status:'completed',events:[{kind:'minecraft-state',data:{health:20,food:20}}],result:{fixture:true}}];
 await page.locator('#notice').filter({hasText:'结构化状态'}).waitFor();assert((await page.locator('#events').textContent()).includes('"health": 20'));
 await page.screenshot({path:join(outDir,'preview-minecraft-fixture.png')});pass('Minecraft structured state; no dummy renderer');
 state.preview={revision:4,instance:'clawclaw-fixture',game:'clawclaw',privacy:false,url:'https://myclaw.163.com/game-intro/index.html#quick-start'};state.runs=[];
 await page.locator('#notice a').waitFor();assert.equal(await page.locator('#notice a').getAttribute('rel'),'noopener');
 await page.screenshot({path:join(outDir,'preview-clawclaw-fixture.png')});pass('ClawClaw fallback link renderer (no match or official site loaded)');
 assert.deepEqual(errors,[]);pass('No preview JavaScript errors');report.status='passed';console.log('PREVIEW_FIXTURES_OK (synthetic; not game E2E)');
}catch(e){report.status='failed';report.error=e.message;process.exitCode=1;console.error('Preview probe failed:',e.message);}
finally{
 await context?.close();await browser?.close();
 if(server){const closed=once(server,'close');server.close();server.closeAllConnections();await closed;}
 report.recordedAt=new Date().toISOString();await writeFile(join(outDir,'preview-fixtures.json'),JSON.stringify(report,null,2));
}

/** Optional real native DSH browser boot check. Cookie stays in memory; no model calls. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {openVerificationBrowser} from './verification-browser.mjs';
export async function verifyNativeBrowser(base,cookie,engine,workspace){
 const outDir=resolve(import.meta.dirname,'../artifacts/verification');await mkdir(outDir,{recursive:true});
 const browser=await openVerificationBrowser();const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN'});
 const errors=[];const consoles=[];let nativePage;const report={scope:'Native DSH browser boot, GameGuy branded/responsive workbench, native UNSENT draft handoff/preservation and actual preview route; native GameGuy tab auto-open and SYNTHETIC MuMu consent/start/ready/stop using isolated fixture; NO actual emulator/model/game tasks',checks:[],browser:browser.version()};
 try{
  const origin=new URL(base).origin;
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.addCookies(cookie.split('; ').map(pair=>{const split=pair.indexOf('=');return{name:pair.slice(0,split),value:pair.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'};}));
  const page=await context.newPage();nativePage=page;page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error')consoles.push(msg.text().replace(/([?&]token=)[^&\s]+/g,'$1[redacted]'));});
  const response=await page.goto(base);assert.equal(response.status(),200);
  // Wait for the original DSH client to mount, rather than merely finding server HTML.
  await page.waitForFunction(()=>document.body.innerText.includes('New Session')||document.body.innerText.includes('\u65b0\u4f1a\u8bdd'),{},{timeout:30000});
  await page.screenshot({path:join(outDir,'dsh-native-boot.png')});
  report.checks.push({name:'original DSH client mounted in real browser',status:'passed'});
  const proceed=page.getByRole('button',{name:'继续',exact:true});
  await proceed.waitFor({state:'visible',timeout:3000}).catch(()=>{});
  if(await proceed.isVisible())await proceed.click();
  // The optional provider onboarding is not part of this no-model fixture.
  const closeWelcome=page.getByRole('button',{name:'关闭',exact:true});
  await closeWelcome.waitFor({state:'visible',timeout:5000}).catch(()=>{});
  if(await closeWelcome.count()===1&&await closeWelcome.isVisible())await closeWelcome.click();
  assert(engine,'isolated native engine required for sidebar verification');
  await page.getByRole('button',{name:'游戏工作台',exact:true}).click();
  await page.locator('.gg-workbench').waitFor();
  await page.locator('.gg-enabled').first().waitFor();
  assert.equal(await page.locator('.gg-game').count(),3);
  assert.equal(await page.locator('.gg-enabled').count(),3);
  await page.screenshot({path:join(outDir,'gameguy-workbench-fixture.png')});
  report.checks.push({name:'GameGuy branded workbench, three enabled game cards and inline preview render from authenticated state',status:'passed'});
  await page.getByRole('button',{name:'游戏插件',exact:true}).click();
  await page.getByText('一个游戏，一个插件。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'打开 DSH 底层插件管理 ↗'}).click();
  await page.locator('.gg-workbench').waitFor({state:'detached'});
  await page.getByRole('button',{name:'游戏工作台',exact:true}).click();
  await page.getByRole('button',{name:'定时委托 ↗',exact:true}).click();
  await page.locator('.gg-workbench').waitFor({state:'detached'});
  report.checks.push({name:'plugin management and schedules navigate to real native DSH panels',status:'passed'});
  await page.getByRole('button',{name:'游戏工作台',exact:true}).click();
  await page.getByRole('button',{name:'运行记录',exact:true}).click();
  await page.getByText('暂无运行记录。真实执行发生后，步骤、错误和结果会保存在这里。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'工作台',exact:true}).click();
  for(const width of [1100,760,500]) {
   await page.setViewportSize({width,height:1000});
   await page.waitForTimeout(150);
   assert(await page.locator('.gg-workbench').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'workbench overflow at '+width);
  }
  await page.screenshot({path:join(outDir,'gameguy-workbench-compact-fixture.png')});
  await page.setViewportSize({width:1440,height:1000});
  report.checks.push({name:'empty history is truthful and three compact viewports have no horizontal overflow',status:'passed'});
  await page.getByRole('button',{name:'回到 Agent 对话 ↗',exact:true}).click();
  await page.locator('.gg-workbench').waitFor({state:'detached'});

  assert(workspace?.id,'temporary native workspace required for unsent draft verification');
  const row=page.locator('[data-row-key]').filter({has:page.getByText(workspace.title,{exact:true})});
  await row.waitFor();await row.hover();
  await row.getByRole('button',{name:`在“${workspace.title}”中新建会话`,exact:true}).click();
  const composer=page.locator('[data-composer-input]');
  await composer.waitFor();
  await page.getByRole('button',{name:'游戏工作台',exact:true}).click();
  await page.locator('.gg-arknights').getByRole('button',{name:'帮我收菜'}).click();
  await page.locator('.gg-workbench').waitFor({state:'detached'});
  await composer.waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-composer-input]')?.textContent.includes('明日方舟'));
  const originalDraft=await composer.innerText();
  assert(originalDraft.includes('源石'));
  // No submit: a second request must not erase the existing native draft.
  await page.getByRole('button',{name:'游戏工作台',exact:true}).click();
  await page.locator('.gg-minecraft').getByRole('button',{name:'进入我的世界'}).click();
  await page.waitForTimeout(300);
  if(await page.locator('.gg-workbench').isVisible())await page.getByRole('button',{name:'回到 Agent 对话 ↗',exact:true}).click();
  await composer.waitFor();
  assert.equal(await composer.innerText(),originalDraft,'native existing draft must not be overwritten');
  // Remove ONLY the test-owned unsent draft, never dispatch a model task.
  await composer.fill('');
  report.checks.push({name:'workbench game request opens actual native unsent draft and preserves it against a second request; no Send/model/game',status:'passed'});

  await engine.configure('minecraft','native-preview-fixture',{});
  await engine.preview('native-preview-fixture');
  const frame=page.frameLocator('iframe[src*="/gameguy/preview"]');
  await frame.locator('#events').filter({hasText:'Minecraft'}).waitFor({timeout:30000});
  await page.screenshot({path:join(outDir,'dsh-native-sidebar-fixture.png')});
  report.checks.push({name:'native DSH GameGuy extension tab auto-opens selected Minecraft fixture without model/game calls',status:'passed'});
  assert.equal(await page.locator('iframe[src*="/gameguy/preview"]').count(),1,'page tab deduplicates across revisions');
  assert.equal(await page.getByText('不能在嵌入浏览器中打开 DSH 应用自身。',{exact:true}).count(),0);
  await engine.preview('native-preview-fixture',undefined,true);
  await frame.locator('#notice').filter({hasText:'隐私暂停'}).waitFor({timeout:15000});
  assert.equal(await frame.locator('#screen').getAttribute('src'),null);
  await page.screenshot({path:join(outDir,'dsh-native-privacy-fixture.png')});
  await engine.preview('native-preview-fixture',undefined,false);
  await frame.locator('#notice').filter({hasText:'Mineflayer 结构化状态'}).waitFor({timeout:15000});
  assert.equal(await page.locator('iframe[src*="/gameguy/preview"]').count(),1);
  report.checks.push({name:'privacy pause/resume reaches native tab; no retained image src; page tab remains deduplicated',status:'passed'});
  // Exercise launcher UI through the actual native sidebar with NO external process.
  const adapter=engine.adapter('arknights'),realStart=adapter.startDevice,realScreenshot=adapter.screenshot;
  let starts=0,release;
  try{
   const fixture=await context.newPage();await fixture.setViewportSize({width:1280,height:720});
   await fixture.setContent('<meta charset="utf-8"><body style="margin:0;background:#193347;color:white;font:28px system-ui;display:grid;place-content:center;height:100vh;text-align:center"><strong>GameGuy · LOCAL TEST FIXTURE</strong><p>这是合成画面，不是真实游戏截图</p><small>原生 DSH · MuMu 启动入口验收</small></body>');
   const png=await fixture.screenshot();await fixture.close();
   adapter.screenshot=async()=>png;
   adapter.startDevice=(config,signal,progress)=>new Promise((resolve,reject)=>{
    starts++;progress('SYNTHETIC waiting for Android; no real emulator launched');
    const abort=()=>reject(Error('SYNTHETIC startup cancelled; no shutdown operation'));
    signal.addEventListener('abort',abort,{once:true});
    release=()=>{signal.removeEventListener('abort',abort);resolve({config:{...config,address:'127.0.0.1:19998'},detail:{synthetic:true}});};
   });
   await engine.configure('arknights','native-mumu-fixture',{emulator:{type:'mumu',cliPath:'D:/fixture/mumu-cli.exe',instanceIndex:7}});
   await engine.requestDevice('native-mumu-fixture');
   await frame.locator('#approval').waitFor({timeout:15000});
   assert((await frame.locator('#launch-info').textContent()).includes('D:/fixture/mumu-cli.exe'));
   assert((await frame.locator('#launch-info').textContent()).includes('实例 7'));
   assert.equal(starts,0);assert.equal(await frame.locator('#screen').getAttribute('src'),null);
   await page.screenshot({path:join(outDir,'dsh-native-mumu-confirmation-fixture.png')});
   report.checks.push({name:'native sidebar shows selected executable/index confirmation without launching or capturing',status:'passed'});
   await frame.locator('#confirm-device').click();
   await frame.locator('#device-status').filter({hasText:'starting'}).waitFor({timeout:15000});
   assert.equal(starts,1);assert.equal(await frame.locator('#screen').getAttribute('src'),null);
   assert.equal(await frame.locator('#device').isDisabled(),true);
   await page.screenshot({path:join(outDir,'dsh-native-mumu-starting-fixture.png')});
   release();
   await frame.locator('#screen').evaluate(el=>new Promise((resolve,reject)=>{const timer=setInterval(()=>{if(!el.hidden&&el.complete&&el.naturalWidth===1280){clearInterval(timer);clearTimeout(deadline);resolve();}},100);const deadline=setTimeout(()=>{clearInterval(timer);reject(Error('synthetic PNG not ready'));},15000);}));
   assert.equal(engine.config('native-mumu-fixture').value.address,'127.0.0.1:19998');
   await page.screenshot({path:join(outDir,'dsh-native-mumu-ready-fixture.png')});
   report.checks.push({name:'native UI confirmation starts synthetic adapter; ready persists endpoint and renders labeled PNG',status:'passed'});
   await frame.locator('#device').click();await frame.locator('#approval').waitFor();await frame.locator('#confirm-device').click();
   await frame.locator('#device-status').filter({hasText:'starting'}).waitFor();
   await frame.locator('#stop').click();await frame.locator('#device-status').filter({hasText:'stopped'}).waitFor();
   assert.equal(starts,2);assert.equal(await frame.locator('#screen').getAttribute('src'),null);
   report.checks.push({name:'native sidebar stop cancels synthetic startup and clears picture without shutting down emulator',status:'passed'});
  }finally{
   try{await engine.stop('native-mumu-fixture');await engine.preview('native-preview-fixture');await frame.locator('#notice').filter({hasText:'Mineflayer 结构化状态'}).waitFor({timeout:15000});}
   finally{adapter.startDevice=realStart;adapter.screenshot=realScreenshot;}
  }
  const preview=await context.newPage();preview.on('pageerror',e=>errors.push(e.message));
  assert.equal((await preview.goto(new URL('/gameguy/preview',base).href)).status(),200);
  await preview.waitForFunction(()=>document.getElementById('events').textContent.includes('Minecraft'));
  assert(!await preview.locator('#notice').evaluate(el=>el.classList.contains('error')));
  await preview.screenshot({path:join(outDir,'dsh-native-preview-idle.png')});
  assert.deepEqual(errors,[]);report.checks.push({name:'actual authenticated GameGuy preview rendered; no JS errors',status:'passed'});
  report.status='passed';console.log('PASS real browser native DSH client + sidebar + synthetic MuMu lifecycle + authenticated preview (no actual emulator/model/game)');
 }catch(e){report.status='failed';report.error=e.message;report.pageErrors=errors;report.consoleErrors=consoles;if(nativePage){await nativePage.screenshot({path:join(outDir,'dsh-native-failed.png')}).catch(()=>{});report.visibleText=(await nativePage.locator('body').innerText().catch(()=>'' )).slice(0,5000).replace(/([?&]token=)[^&\s]+/g,'$1[redacted]');}throw e;}
 finally{await context.close();await browser.close();report.recordedAt=new Date().toISOString();await writeFile(join(outDir,'native-browser.json'),JSON.stringify(report,null,2));}
}

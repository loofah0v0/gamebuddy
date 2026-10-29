import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function runNativeMarketSmoke(win,service,root){
 const out=join(root,'artifacts/verification/native-game-market');await mkdir(out,{recursive:true});const checks=[],errors=[],startedAt=new Date().toISOString();
 const evaluate=s=>win.webContents.executeJavaScript(s,true),wait=async s=>{for(let i=0;i<150;i++){if(await evaluate(s))return;await new Promise(r=>setTimeout(r,100));}throw Error('Native market timeout: '+s);};
 const check=(label,value)=>{assert(value,label);checks.push(label);},capture=async name=>{await new Promise(r=>setTimeout(r,300));await writeFile(join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());await writeFile(join(out,name+'.txt'),await evaluate('document.body.innerText'));};
 win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
 const click=async(label,game)=>evaluate(`(()=>{const scope=${game?`document.querySelector('[data-game-package="${game}"]')`:'document'};const n=[...scope.querySelectorAll('button')].find(n=>n.getClientRects().length&&!n.disabled&&(n.getAttribute('aria-label')===${JSON.stringify(label)}||n.innerText.trim()===${JSON.stringify(label)}));if(!n)throw Error('Button missing: '+${JSON.stringify(label)});n.click();})()`);
 const {dialog,BrowserWindow}=await import('electron');const original=dialog.showMessageBox;let dialogs=0;
 const openMarket=async()=>evaluate("document.querySelector('button[aria-label=游戏市场]').click()");
 try{
  await wait("!!document.querySelector('button[aria-label=游戏市场]')");
  check('Original sidebar plugin entry is replaced, not duplicated',!await evaluate("!!document.querySelector('button[aria-label=插件]')"));
  await openMarket();await wait("document.querySelectorAll('.gg-market-card').length===3");check('Real native panel shows three trusted game packages',true);check('Opening market does not create a second window',BrowserWindow.getAllWindows().length===1);check('Removed game-center IPC is rejected',await evaluate('window.gameguy.invoke("game-center").then(()=>false,()=>true)'));check('Raw JSON is not displayed on entry',!await evaluate("!!document.querySelector('.gg-market pre')"));await capture('market-native');
  await click('游戏与设备');await wait("document.body.innerText.includes('还没有游戏任务')");check('Device management remains in the main window with honest empty state',BrowserWindow.getAllWindows().length===1);
  await click('定时计划');await wait("document.body.innerText.includes('还没有应用内定时计划')");check('Schedule management remains in the main window with honest empty state',BrowserWindow.getAllWindows().length===1);
  await click('API 验证');await wait("!!document.querySelector('[aria-label=\"验证提供商\"]')");check('Temporary API verification remains available in the main window',BrowserWindow.getAllWindows().length===1);
  await evaluate("[...document.querySelectorAll('.gg-market-pages button')].find(b=>b.innerText.trim()==='游戏市场').click()");await wait("document.querySelectorAll('.gg-market-card').length===3");
  // Installation confirmations are accepted only in this isolated QA window. No game execution follows.
  dialog.showMessageBox=async(owner,options)=>{assert.equal(owner,win);assert(options.message.startsWith('安装并启用 '));dialogs++;return {response:1};};
  for(const game of ['minecraft','clawclaw','arknights']){await click('安装并启用',game);await wait(`document.querySelector('[data-game-package="${game}"]').innerText.includes('已启用')`);assert(service.plugins.modules.has(game));}
  check('Three UI buttons install verified real files through trusted Electron IPC',dialogs===3&&service.plugins.list().every(p=>p.enabled&&p.installed));await capture('installed-native');
  await click('停用','clawclaw');await wait("document.querySelector('[data-game-package=clawclaw]').innerText.includes('已停用')");check('Disable unregisters official Skill package but keeps files',!service.plugins.modules.has('clawclaw')&&service.plugins.list().find(p=>p.id==='clawclaw').installed);
  await click('启用','clawclaw');await wait("document.querySelector('[data-game-package=clawclaw]').innerText.includes('已启用')");check('Re-enable restores package without separate gameplay wrapper',service.plugins.modules.has('clawclaw'));
  await click('通用 Agent 扩展 ↗');await wait("document.body.innerText.includes('添加插件')");check('DSH general plugin management stays functional behind advanced entry',!await evaluate("document.body.innerText.includes('本部署没有可管理的 profile')"));await capture('advanced-native');
  await openMarket();await wait("!!document.querySelector('.gg-market')");await click('交给 Buddy','arknights');await wait("document.querySelector('[data-composer-input]')?.innerText.includes('配置明日方舟')");
  check('Use action returns to full native composer with a game-specific draft',true);await capture('conversation-native');
  await openMarket();await wait("document.querySelectorAll('.gg-feature-card').length===3");await evaluate("document.querySelector('[data-feature-game=arknights] button').click()");await wait("document.querySelector('[data-composer-input]')?.innerText.includes('帮我完成明日方舟收菜')");check('Featured action fills an editable native draft without sending',true);
  check('No inference, game backend or schedule was submitted',service.snapshot().runs.length===0&&service.scheduler.list().schedules.length===0);check('No renderer errors',errors.length===0);
  await writeFile(join(out,'report.json'),JSON.stringify({status:'passed',startedAt,completedAt:new Date().toISOString(),checks,errors,isolatedUserData:true,fixtureDialogs:true,realIPC:true,realPackageInstall:true,realDSHClient:true,realGameActions:0,realModelRequests:0,remoteDownloads:0},null,2));console.log('NATIVE MARKET PASSED',checks);
 }catch(e){await capture('failure');await writeFile(join(out,'report.json'),JSON.stringify({status:'failed',checks,error:e.stack,errors,isolatedUserData:true},null,2));throw e;}finally{dialog.showMessageBox=original;}
}

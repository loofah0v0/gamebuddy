import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute,resolve} from 'node:path';
export async function runNativeSmoke(win,service,root,dataDir,vault,openGameCenter){
 const out=join(root,'artifacts/verification/native-desktop');await mkdir(out,{recursive:true});
 const startedAt=new Date().toISOString();
 const errors=[],checks=[];win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
 const check=(label,value)=>{assert.ok(value,label);checks.push(label);};
 const capture=async name=>{await writeFile(join(out,name+'.txt'),await evaluate('document.body.innerText'));await writeFile(join(out,name+'.html'),await evaluate('document.documentElement.outerHTML'));await writeFile(join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());};
 const click=async label=>{const target=`[...document.querySelectorAll('button,[role=option],[role=menuitem],[role=menuitemradio],[role=tab]')].sort((a,b)=>Number(b.getAttribute('role')?.startsWith('menuitem')??false)-Number(a.getAttribute('role')?.startsWith('menuitem')??false)).find(e=>e.getClientRects().length>0&&!e.disabled&&(e.getAttribute('aria-label')===${JSON.stringify(label)}||e.innerText.split(String.fromCharCode(10))[0].trim()===${JSON.stringify(label)}))`;await wait(`!!(${target})`);await evaluate(`(${target}).click()`);await new Promise(r=>setTimeout(r,100));};
 const evaluate=code=>win.webContents.executeJavaScript(code,true);
 const wait=async(code)=>{for(let i=0;i<100;i++){if(await evaluate(code))return;await new Promise(r=>setTimeout(r,200));}throw Error('UI timeout: '+code);};
 await writeFile(join(out,'report.json'),JSON.stringify({status:'running',startedAt,checks:[]},null,2));
 const fill=async(label,value)=>{const selector='input[aria-label='+JSON.stringify(label)+']';const target=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.getClientRects().length>0&&!n.disabled)`;await evaluate(`(()=>{const n=${target};if(!n)throw Error('Visible input missing: '+${JSON.stringify(label)});n.focus();n.select();if(document.activeElement!==n)throw Error('Cannot focus: '+${JSON.stringify(label)});})()`);win.webContents.insertText(value);await wait(`(${target})?.value===${JSON.stringify(value)}`);};
 const clearComposer=async()=>{await evaluate("document.querySelector('[data-composer-input]').focus()");win.webContents.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['control']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['control']});win.webContents.sendInputEvent({type:'keyDown',keyCode:'BACKSPACE'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'BACKSPACE'});await wait("document.querySelector('[data-composer-input]').innerText.trim()===''");};
 const escape=async()=>{win.webContents.sendInputEvent({type:'keyDown',keyCode:'ESC'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'ESC'});await new Promise(r=>setTimeout(r,200));};
 try{
 await new Promise(r=>setTimeout(r,1500));
 await writeFile(join(out,'boot.txt'),await evaluate('document.body.innerText'));
 await writeFile(join(out,'boot.html'),await evaluate('document.documentElement.outerHTML'));
 await writeFile(join(out,'boot.png'),(await win.webContents.capturePage()).toPNG());
 await wait("document.body.innerText.includes('GameBuddy') && !!document.querySelector('[contenteditable=true],textarea')");
 await writeFile(join(out,'initial.txt'),await evaluate('document.body.innerText'));
 await writeFile(join(out,'initial.png'),(await win.webContents.capturePage()).toPNG());
 console.log('NATIVE UI READY',await evaluate("[...document.querySelectorAll('button')].map(e=>({text:e.innerText,title:e.title,aria:e.getAttribute('aria-label')}))"));
 assert.equal(service.nativeClient,true);assert.ok(service.runtimeBoot.nativeURL);
 assert.equal(await evaluate('!!window.gameguy'),true);
 await vault.request('set',{ref:'GAMEGUY_MODEL_KEY',value:'local-native-not-real'});
 await service.saveModel({provider:'compatible',model:'fixture-a',baseURL:process.env.GAMEGUY_MODEL_FIXTURE_URL,vision:false},'local-native-not-real',['fixture-a','fixture-b']);
 console.log('QA CATALOG',JSON.stringify(await service.runtime.call('native-api',{method:'modelCatalog'})));
 await wait("document.body.innerText.includes('fixture-a')");
 check('Full native composer uses GameBuddy copy',await evaluate("document.body.innerText.includes('陪你玩，帮你干')"));
 // Exercise the real workspace/create gateway with a picker fixture only in isolated QA.
 const {ipcMain}=await import('electron');
 const picked=join(dataDir,'native-open-folder-fixture');await mkdir(picked,{recursive:true});
 ipcMain.removeHandler('gameguy:directory-pick');
 ipcMain.handle('gameguy:directory-pick',e=>{assert.equal(e.sender,win.webContents);return picked;});
 await click('添加工作区');
 await wait("[...document.querySelectorAll('[data-row-key^=workspace]')].some(n=>n.innerText.includes('native-open-folder-fixture'))");
 check('Native folder picker creates workspace through live gateway',true);
 const workspaceCount=await evaluate("document.querySelectorAll('[data-row-key^=workspace]').length");
 await click('添加工作区');await new Promise(r=>setTimeout(r,600));
 check('Reopening the same folder does not duplicate workspace',await evaluate("document.querySelectorAll('[data-row-key^=workspace]').length")===workspaceCount);
 check('Workspace services never report service-unavailable',!await evaluate("document.body.innerText.includes('service-unavailable')"));
 await capture('workspace-open');
 const send=async text=>{await evaluate("document.querySelector('[data-composer-input]').focus()");win.webContents.insertText(text);await wait("!document.querySelector('button[aria-label=\"发送消息\"]').disabled");await click('发送消息');};
 await send('NATIVEQA:first No tools or game actions.');
 await wait("document.body.innerText.includes('NATIVE_FIXTURE')");
 check('SSE text is visible before response completion',service.snapshot().tasks.some(t=>t.status==='thinking'));
 await wait("document.body.innerText.includes('fixture-a complete')");
 await capture('conversation');
 const id=service.snapshot().tasks.find(t=>t.messages.some(m=>m.text.includes('NATIVEQA:first')))?.sessionId;assert.ok(id);
 const chosenCwd=(await service.runtime.call('native-api',{method:'inspect',input:id})).meta.cwd;console.log('QA WORKSPACE CWD',chosenCwd,picked);
 check('New session uses the chosen workspace folder',(await realpath(chosenCwd)).toLowerCase()===(await realpath(picked)).toLowerCase());
 check('Synthetic context does not bind general chat to a game',!service.snapshot().tasks.find(t=>t.sessionId===id).game);
 check('Synthetic context is not shown as user messages',service.snapshot().tasks.find(t=>t.sessionId===id).messages.filter(m=>m.role==='user').length===1);
 check('Native composer creates adopted GameBuddy session',!!id);
 check('Native Markdown has rendered code block',await evaluate("!!document.querySelector('pre code')"));
 const permissionTask=service.snapshot().tasks.find(t=>t.sessionId===id);
 for(let i=0;service.task(permissionTask.id).status==='thinking'&&i<100;i++)await new Promise(r=>setTimeout(r,50));
 await service.ensure(service.task(permissionTask.id));
 const stateOf=()=>service.runtime.call('permission-state',{taskId:permissionTask.id,sessionId:id});
 check('Native game permission query reads this exact workspace-write session',(await stateOf()).sandboxMode==='workspace-write');
 await assert.rejects(service.runtime.call('permission-state',{taskId:permissionTask.id,sessionId:'wrong-session'}));
 check('Native game permission query rejects another session identity',true);
 await service.setPermission(permissionTask.id,'danger-full-access');
 const fullGamePermission=await stateOf();
 check('Native game permission reports effective full-access and never',fullGamePermission.sandboxMode==='danger-full-access'&&fullGamePermission.approvalPolicy==='never');
 const autoFixture=await service.authorized(permissionTask.id,'run',{fixture:true},async()=>({fixtureAuthorized:true}));
 check('Native full-access managed game authorization returns without an approval card',autoFixture.fixtureAuthorized&&service.approvals.size===0);
 await service.setPermission(permissionTask.id,'workspace-write');
 let forbiddenFixture=0;const manualFixture=service.authorized(permissionTask.id,'run',{fixture:true},async()=>{forbiddenFixture++;return {};});
 for(let i=0;!service.approvals.size&&i<100;i++)await new Promise(r=>setTimeout(r,50));
 check('Native workspace-write still displays a managed game confirmation',service.approvals.size===1);
 await service.resolveApproval([...service.approvals.keys()][0],false);await manualFixture;
 check('Native denied managed authorization has no effects',forbiddenFixture===0&&service.engine.snapshot().runs.length===0);

 await click('fixture-a');await evaluate("document.querySelector('[role=menu] [role=menuitem]').click()");await wait("document.body.innerText.includes('fixture-b')");await capture('models');
 await click('fixture-b');await wait("!document.querySelector('[role=listbox]')");
 await send('NATIVEQA:second No tools or game actions.');await wait("document.body.innerText.includes('fixture-b complete')");
 check('Composer switch routes next request to B in same session',service.snapshot().tasks.some(t=>t.sessionId===id&&t.messages.filter(m=>m.role==='assistant').length>=2));
 await click('🎮 游戏');await wait("document.body.innerText.includes('游戏现场')");check('Game dock shares native session',await evaluate(`!!document.querySelector('[data-gameguy-session="${id}"]')`));await capture('game-dock');
 check('Game dock observes native tab visibility',await evaluate(`document.querySelector('[data-gameguy-session="${id}"]').dataset.gameguyVisible==='true'`));

 // Presentation-only fixture: never register a game, connect ADB, or execute a backend.
 const originalSnapshot=service.snapshot.bind(service),fixtureTask=service.snapshot().tasks.find(t=>t.sessionId===id),uiRunId='dock-ui-fixture-run';let dockScenario='running';
 const uiPlan={startup:true,base:true,baseCollect:true,friends:true,daily:true,mail:true,shopping:false};
 const uiEvents=[{kind:'plan',at:'2026-10-27T02:00:00Z',data:[{type:'StartUp',params:{}},{type:'Custom',params:{task_names:['InfrastBegin']}},{type:'Mall',params:{shopping:false}},{type:'Award',params:{}}]},{kind:'maa',at:'2026-10-27T02:00:10Z',data:{taskchain:'StartUp',msg:10002}},{kind:'maa',at:'2026-10-27T02:00:11Z',data:{taskchain:'Custom',msg:10001}},{type:'tool-status',name:'pwsh',phase:'completed',at:'2026-10-27T02:00:12Z',debug:'UI_SECRET_DEBUG_MARKER'}];
 service.snapshot=()=>{const view=originalSnapshot(),t=view.tasks.find(t=>t.id===fixtureTask.id);t.title='明日方舟收菜 · UI 验收示例';t.game='arknights';t.status=dockScenario==='approval'?'approval':dockScenario==='result'?'completed':'running';t.gameApprovalMode=dockScenario==='approval'?'confirm':'auto';t.events=uiEvents;t.runIds=dockScenario==='approval'?[]:[uiRunId];
  if(dockScenario==='approval')view.approvals.push({id:'dock-ui-fixture-approval',taskId:t.id,kind:'run',details:{game:'arknights',plan:uiPlan,maxSeconds:420,resourceLimits:{medicineLimit:0}}});
  else view.runs.push({id:uiRunId,game:'arknights',instance:'presentation-only',status:dockScenario==='result'?'completed':'running',startedAt:'2026-10-27T02:00:00Z',...(dockScenario==='result'?{endedAt:'2026-10-27T02:02:04Z',result:{status:'backend-completed',rewardsIndependentlyVerified:false}}:{}),events:uiEvents.filter(e=>e.kind)});
  return view;
 };
 try{
  service.emit('changed');await wait("document.querySelector('.gg-dock').innerText.includes('UI 验收示例')");
  check('Game dock defaults to human-readable status and progress',await evaluate("document.querySelector('.gg-dock').innerText.includes('明日方舟') && document.querySelector('.gg-dock').innerText.includes('运行中') && document.querySelectorAll('.gg-steps li').length===4"));
  check('All game JSON details are collapsed and lazy by default',await evaluate("document.querySelectorAll('.gg-dock details').length>=2 && !document.querySelector('.gg-dock details[open]') && !document.querySelector('.gg-dock pre') && !document.querySelector('.gg-dock').innerText.includes('UI_SECRET_DEBUG_MARKER')"));
  await capture('game-dock-redesign-running');
  await evaluate("[...document.querySelectorAll('.gg-dock details')].find(d=>d.dataset.ggDetail.endsWith(':events')).querySelector('summary').click()");await wait("!!document.querySelector('.gg-dock details[open] pre')");
  check('Execution history expands on demand with original JSON preserved',await evaluate("document.querySelector('.gg-dock details[open] pre').textContent.includes('UI_SECRET_DEBUG_MARKER')"));
  service.emit('changed');await new Promise(r=>setTimeout(r,200));
  check('A live refresh preserves user-expanded details',await evaluate("!!document.querySelector('.gg-dock details[open] pre')"));await capture('game-dock-redesign-expanded');
  await evaluate("[...document.querySelectorAll('.gg-dock details')].find(d=>d.dataset.ggDetail.endsWith(':events')).querySelector('summary').click()");await wait("!document.querySelector('.gg-dock details[open]') && !document.querySelector('.gg-dock pre')");
  const width=await evaluate("document.querySelector('.gg-dock').style.width");await evaluate("document.querySelector('.gg-dock').style.width='320px'");
  check('Compact game dock has no horizontal content overflow',await evaluate("document.querySelector('.gg-dock').scrollWidth<=document.querySelector('.gg-dock').clientWidth+1"));await capture('game-dock-redesign-compact');await evaluate("document.querySelector('.gg-dock').style.width="+JSON.stringify(width));
  dockScenario='approval';service.emit('changed');await wait("document.querySelector('.gg-dock').innerText.includes('确认执行游戏任务')");
  check('Human approval keeps spending constraints visible but parameter JSON folded',await evaluate("document.querySelector('.gg-approval').innerText.includes('不吃药') && document.querySelector('.gg-approval').innerText.includes('不购物') && !document.querySelector('.gg-approval pre') && !document.querySelector('.gg-approval details[open]')"));await capture('game-dock-redesign-approval');
  dockScenario='result';service.emit('changed');await wait("document.querySelector('.gg-dock').innerText.includes('后端已结束')");
  check('Run result stays explicit that backend completion is not reward proof',await evaluate("document.querySelector('.gg-dock').innerText.includes('奖励是否到账仍需核验') && !document.querySelector('.gg-dock details[open]')"));await capture('game-dock-redesign-result');
 }finally{service.snapshot=originalSnapshot;service.emit('changed');await wait("!document.querySelector('.gg-dock').innerText.includes('UI 验收示例')");}

 await click('隐私暂停');await wait("document.body.innerText.includes('隐私暂停：不读取游戏截图。') && [...document.querySelectorAll('button')].some(n=>n.innerText==='恢复预览'&&!n.disabled)");
 const paused=service.snapshot().tasks.find(t=>t.sessionId===id);
 check('Native privacy button pauses an unbound general session',paused.privacy&&paused.cancelled&&paused.status==='stopped');
 check('Private dock prevents manual capture',await evaluate("[...document.querySelectorAll('button')].find(n=>n.innerText==='刷新游戏画面').disabled && !document.querySelector('.gg-dock img')"));
 await capture('privacy-paused');
 await click('恢复预览');await wait("[...document.querySelectorAll('button')].some(n=>n.innerText==='隐私暂停'&&!n.disabled)");
 const resumed=service.snapshot().tasks.find(t=>t.sessionId===id);
 check('Resuming preview never revives the stopped task',!resumed.privacy&&resumed.cancelled&&resumed.status==='stopped');
 await click('搜索会话');await wait("document.activeElement?.getAttribute('placeholder')==='搜索会话名称'");win.webContents.insertText('NATIVEQA');await wait("document.body.innerText.includes('NATIVEQA:first')");await capture('search');check('Session search filters native persisted history',await evaluate("document.querySelector('input[placeholder=\"搜索会话名称\"]').value==='NATIVEQA'"));win.webContents.sendInputEvent({type:'keyDown',keyCode:'ESC'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'ESC'});
 await click('设置');await wait("!!document.querySelector('[data-shortcut-modal=settings]')");await capture('settings');
 console.log('NATIVE SETTINGS',await evaluate('document.body.innerText'));
 const labels=await evaluate("[...document.querySelectorAll('[data-shortcut-modal=settings] nav button')].map(e=>e.innerText)");console.log('NATIVE SETTINGS NAV',labels);
 for(const label of labels){await click(label);if(label==='内置插件')await wait("!document.querySelector('[data-shortcut-modal=settings]').innerText.includes('正在读取插件')");if(label==='模型')await wait("document.querySelector('[data-shortcut-modal=settings]').innerText.includes('添加模型提供商')");if(label==='Agent 预设')await wait("!!document.querySelector('[data-agent-preset-id=standard]')");await capture('settings-'+labels.indexOf(label));console.log('NATIVE SETTINGS PAGE',label,await evaluate("document.querySelector('[data-shortcut-modal=settings]').innerText"));}
 check('All four native Agent presets are available',await evaluate("['standard','ptc','minimal','cordis'].every(id=>!!document.querySelector('[data-agent-preset-id='+id+']'))"));
 await click('内置插件');await wait("!!document.querySelector('[data-plugin-entry]')");
 check('Native plugin inventory is backed by running host',await evaluate("document.querySelectorAll('[data-plugin-entry]').length>20"));
 await click('通用设置');await click('深色');await capture('theme-dark');await click('浅色');
 check('Theme controls and global permission defaults are reachable',await evaluate("document.querySelector('[data-shortcut-modal=settings]').innerText.includes('选择新会话的默认权限模式')"));
 await click('编辑快捷键');await wait("document.body.innerText.includes('快捷键')");await capture('shortcuts');await escape();
 // Native provider settings are a separate surface from the game-center shortcut.
 await click('模型');await wait("document.querySelector('[data-shortcut-modal=settings]').innerText.includes('添加模型提供商')");
 await click('添加模型提供商');await click('自定义模型 API');await wait("!!document.querySelector('input[aria-label=\"Provider ID\"]')");
 await fill('Provider ID','qa-provider');await fill('显示名称','QA Provider');await fill('API 地址',process.env.GAMEGUY_MODEL_FIXTURE_URL);await fill('API 密钥','local-native-provider-not-real');
 await click('获取可用模型');await wait("[...document.querySelectorAll('button')].some(e=>e.getClientRects().length>0&&['全选','取消全选'].includes(e.innerText))");if(await evaluate("[...document.querySelectorAll('button')].some(e=>e.getClientRects().length>0&&e.innerText==='全选')"))await click('全选');await click('添加所选');
 await wait("!!document.querySelector('input[aria-label=\"模型 ID 1\"]')");await capture('provider-create');
 await click('创建提供商');await wait("!!document.querySelector('button[aria-label=\"编辑 QA Provider (qa-provider)\"]')");
 check('Native settings create a second provider without restarting',service.runtime.status==='ready');
 const catalog=await service.runtime.call('native-api',{method:'modelCatalog'});await writeFile(join(out,'provider-catalog.json'),JSON.stringify(catalog,null,2));
 check('Multiple providers coexist in native catalog',JSON.stringify(catalog).includes('qa-provider')&&JSON.stringify(catalog).includes('gameguy'));
 const encrypted=await readFile(vault.path);check('Native settings key is encrypted on disk',!encrypted.includes(Buffer.from('local-native-provider-not-real')));
 await click('编辑 QA Provider (qa-provider)');await wait("document.querySelector('[data-shortcut-modal=settings]').innerText.includes('保存')");await capture('provider-edit');await click('保存');await wait("!!document.querySelector('button[aria-label=\"编辑 QA Provider (qa-provider)\"]')");
 check('Native provider edit saves against the same live host',service.runtime.status==='ready');
 await evaluate("(()=>{const n=[...document.querySelectorAll('[data-shortcut-modal=settings] button')].find(e=>e.innerText==='关闭'||e.getAttribute('aria-label')==='关闭');if(n)n.click();})()");

 // Session management uses the real native sidebar, not GameBuddy's task cards.
 const sessionMenu=async(targetId)=>{await evaluate(`(()=>{const row=${targetId?`document.querySelector('[data-row-key="session:${targetId}"]')`: "document.querySelector('[data-row-key^=session][aria-selected=true]')??document.querySelector('[data-row-key^=session]')"};const n=[...row.querySelectorAll('button')].find(e=>(e.getAttribute('aria-label')??'').startsWith('会话“'));if(!n)throw Error('Session menu missing');n.click();})()`);await wait("!!document.querySelector('[role=menu] [role=menuitem]')");};
 await sessionMenu();await click('重命名');await fill('会话名称','QA renamed session');await click('重命名');await wait("document.body.innerText.includes('QA renamed session')");
 check('Rename preserves native session identity',service.snapshot().tasks.some(t=>t.sessionId===id));
 await sessionMenu();await click('置顶会话');await sessionMenu();await wait("document.body.innerText.includes('取消置顶')");await click('取消置顶');check('Session pin and unpin are operable',true);
 await sessionMenu();await click('分叉会话');await wait("document.querySelectorAll('[data-composer-input]').length>0");await new Promise(r=>setTimeout(r,600));
 await capture('session-fork');
 const sessions=await service.runtime.call('native-api',{method:'list',input:{}});await writeFile(join(out,'session-list.json'),JSON.stringify(sessions,null,2));
 const forkId=sessions.items.find(s=>s.parentSessionId===id)?.sessionId;
 check('Fork creates a second native session without inference',!!forkId&&sessions.items.some(s=>s.sessionId===id));
 await sessionMenu(forkId);await click('归档会话');await wait(`!document.querySelector('[data-row-key="session:${forkId}"]')`);await click('视图选项');await click('全部对话（显示已归档）');await wait(`!!document.querySelector('[data-row-key="session:${forkId}"]')`);await sessionMenu(forkId);await click('取消归档');await sessionMenu(forkId);await wait("!![...document.querySelectorAll('[role=menuitem]')].find(e=>e.innerText.split(String.fromCharCode(10))[0].trim()==='归档会话')");await escape();check('Archive and unarchive are operable',true);
 await evaluate(`document.querySelector('[data-row-key="session:${id}"]').click()`);await wait("!!document.querySelector('[data-composer-input]')");
 // Native composer commands/references are no longer missing custom UI features.
 await evaluate("document.querySelector('[data-composer-input]').focus()");win.webContents.insertText('/');await wait("!!document.querySelector('[role=listbox]')");await capture('commands');check('Slash command picker is available',true);await escape();
 await clearComposer();
 await evaluate("document.querySelector('[data-composer-input]').focus()");win.webContents.insertText('@');await wait("!!document.querySelector('[role=listbox]')");await capture('references');check('File/Skill/session reference picker is available',true);await escape();
 await clearComposer();
 check('Native upload attachment control is mounted',await evaluate("!!document.querySelector('input[type=file]')"));
 // Right sidebar runs isolated webview guests, not iframes or external browsers.
 await click('🎮 游戏');await click('新标签页');await wait("!!document.querySelector('[data-sidebar-right-guide]')");
 await evaluate("(()=>{const n=document.querySelector('[data-sidebar-right-guide-entry=browser]');(n.matches('button')?n:n.querySelector('button')).click();})()");await wait("!!document.querySelector('input[placeholder=\"输入 HTTP(S) 地址\"]')");
 const pageURL=new URL('/page',process.env.GAMEGUY_MODEL_FIXTURE_URL).href;
 await evaluate(`(()=>{const n=document.querySelector('input[placeholder=\"输入 HTTP(S) 地址\"]');n.focus();})()`);win.webContents.insertText(pageURL);await click('前往');
 await wait("!!document.querySelector('webview[data-sidebar-browser-frame]') && document.querySelector('webview[data-sidebar-browser-frame]').getURL().includes('/page')");
 const guest=await evaluate("document.querySelector('webview[data-sidebar-browser-frame]').getWebContentsId()"),{webContents}=await import('electron');const guestWC=webContents.fromId(guest);
 for(let i=0;i<50 && guestWC.isLoading();i++)await new Promise(r=>setTimeout(r,100));
 check('Browser embeds X-Frame-Options DENY page inside native guest',await guestWC.executeJavaScript("document.body.innerText.includes('GameBuddy guest fixture')"));
 check('Browser guest has no Node or GameBuddy bridge',await guestWC.executeJavaScript("typeof require==='undefined' && typeof window.gameguy==='undefined' && typeof window.dshDesktop==='undefined'"));
 await capture('browser');
 await evaluate("(()=>{const n=document.querySelector('input[placeholder=\"输入 HTTP(S) 地址\"]');n.focus();n.select();})()");win.webContents.insertText(service.runtimeBoot.nativeURL);await click('前往');await wait("document.body.innerText.includes('不能在嵌入浏览器中打开')");check('Browser refuses the application host origin',true);
 // Seed only this QA session's real workspace, never a user/project directory.
 const qaRoot=await realpath(dataDir),qaCwd=await realpath(sessions.items.find(s=>s.sessionId===id).cwd),rel=relative(qaRoot,qaCwd);
 assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'QA workspace must be inside isolated userdata');
 await writeFile(join(qaCwd,'native-qa.txt'),'GAMEGUY_NATIVE_FILE_PREVIEW_OK\n','utf8');
 await click('新标签页');await wait("!!document.querySelector('[data-sidebar-right-guide-entry=files]')");await evaluate("(()=>{const n=document.querySelector('[data-sidebar-right-guide-entry=files]');(n.matches('button')?n:n.querySelector('button')).click();})()");await wait("!document.body.innerText.includes('正在读取…')");await wait("!![...document.querySelectorAll('[data-files-entry=file]')].find(n=>n.innerText==='native-qa.txt')");await capture('files');check('Native workspace file tree lists a real fixture file',true);
 await evaluate("[...document.querySelectorAll('[data-files-entry=file]')].find(n=>n.innerText==='native-qa.txt').querySelector('button').click()");
 await wait("document.body.innerText.includes('GAMEGUY_NATIVE_FILE_PREVIEW_OK')");await capture('file-preview');check('File tree opens real file content in native preview',true);
 await click('新标签页');await wait("!!document.querySelector('[data-sidebar-right-guide-entry=terminal]')");await evaluate("(()=>{const n=document.querySelector('[data-sidebar-right-guide-entry=terminal]');(n.matches('button')?n:n.querySelector('button')).click();})()");await wait("!!document.querySelector('[data-sidebar-terminal] .xterm-helper-textarea')");await capture('terminal');await evaluate("document.querySelector('[data-sidebar-terminal] .xterm-helper-textarea').focus()");win.webContents.insertText("echo GG_NATIVE_TERMINAL_%OS%");win.webContents.sendInputEvent({type:'keyDown',keyCode:'ENTER'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'ENTER'});await wait("document.querySelector('[data-sidebar-terminal]').innerText.includes('GG_NATIVE_TERMINAL_Windows_NT')");await capture('terminal-output');check('Native terminal executes harmless command and renders output',true);
 await click('游戏市场');await wait("!!document.querySelector('.gg-market')");await click('通用 Agent 扩展 ↗');await wait("document.body.innerText.includes('添加插件')");await capture('plugins');check('Native general plugin manager is available',!await evaluate("document.body.innerText.includes('本部署没有可管理的 profile')"));
 const center=await openGameCenter();assert.notEqual(center.webContents.id,win.webContents.id);assert.equal(await center.webContents.executeJavaScript('window.gameguy.invoke("state").then(s=>s.nativeClient)'),true);center.close();
 check('No games or schedules executed',service.snapshot().runs.length===0&&service.snapshot().schedules.schedules.length===0);check('No renderer errors',errors.length===0);await writeFile(join(out,'report.json'),JSON.stringify({status:'passed',startedAt,completedAt:new Date().toISOString(),checks,isolatedUserData:true,realModelRequests:0,realGameActions:0},null,2));for(const name of ['failure.png','failure.txt','failure.html'])await rm(join(out,name),{force:true});console.log('NATIVE SMOKE PASSED',checks);
 }catch(e){await writeFile(join(out,'report.json'),JSON.stringify({status:'failed',startedAt,completedAt:new Date().toISOString(),checks,error:e.stack,isolatedUserData:true},null,2));await capture('failure');throw e;}finally{await writeFile(join(out,'errors.json'),JSON.stringify(errors,null,2));}
}


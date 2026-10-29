import {app,BrowserWindow,WebContentsView,ipcMain,dialog,safeStorage,Tray,Menu,nativeImage,shell,nativeTheme} from 'electron';
import {join,resolve,basename,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {GameGuyService,spectatorURL} from '../app-service/index.mjs';
import {installGameGuyShortcuts} from './keyboard.mjs';
import {GameGuyBrowserGuests} from './browser-guests.mjs';
import {commitModelCredential} from './model-credential-commit.mjs';
import {CredentialVault} from './credential-vault.mjs';
import {externalBrowserURL} from './external-links.mjs';
import {normalizeModel} from '../app-service/model.mjs';
import {discoverModels,verifyModelAPI,resolveModelKey} from '../app-service/model-api.mjs';
const root=resolve(import.meta.dirname,'../..');
const modelSmokeMode=process.argv.includes('--smoke-model');
const sessionModelSmokeMode=process.argv.includes('--smoke-session-model');
const homeSmokeMode=process.argv.includes('--smoke-home');
const marketSmokeMode=process.argv.includes('--smoke-market');
const nativeSmokeMode=process.argv.includes('--smoke-native');
const smokeMode=homeSmokeMode||marketSmokeMode||nativeSmokeMode||process.argv.includes('--smoke-product')||modelSmokeMode||sessionModelSmokeMode;
if(smokeMode&&(!process.env.GAMEGUY_TEST_DATA||resolve(dirname(process.env.GAMEGUY_TEST_DATA))!==resolve(tmpdir())||!basename(process.env.GAMEGUY_TEST_DATA).startsWith('gameguy-desktop-smoke-')))throw Error('Desktop smoke requires isolated temporary user data');
app.setName('GameBuddy');
app.setPath('userData',process.env.GAMEGUY_TEST_DATA||join(app.getPath('appData'),'GameGuy-v03'));
const dataDir=app.getPath('userData'),keyFile=join(dataDir,'credentials.bin');
const uiURL=new URL('../ui/index.html',import.meta.url).href;
const nativeClient=!smokeMode||nativeSmokeMode||marketSmokeMode||homeSmokeMode;
let nativeOrigin,vault,spectatorOwner,shortcuts;
const browserGuests=new GameGuyBrowserGuests(()=>nativeOrigin);
let modelSaveTail=Promise.resolve();
let initialization,win,service,ready=false,initError='',quitting=false,quitPending=false,tray,spectator,spectatorTask,spectatorAddress;
async function boot(){
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('before-quit',e=>{if(!quitting){e.preventDefault();void requestQuit();}});
 app.on('second-instance',()=>{win?.show();win?.focus();});
 if(smokeMode)console.log('[desktop-smoke] waiting for Electron');
 await app.whenReady();
 if(smokeMode)console.log('[desktop-smoke] Electron ready');
 win=new BrowserWindow({width:1450,height:930,minWidth:1080,minHeight:720,title:'GameBuddy',icon:join(root,'assets/gameguy.png'),backgroundColor:'#f8f7f3',show:false,webPreferences:{preload:join(import.meta.dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,webviewTag:nativeClient}});
 win.webContents.on('page-title-updated',e=>{e.preventDefault();win.setTitle('GameBuddy');});
 if(nativeClient){
  const updateMenu=()=>Menu.setApplicationMenu(Menu.buildFromTemplate([
   shortcuts?.fileMenu({fileMenu:'文件',closePage:'关闭当前页面'})??{label:'文件',submenu:[]},
   {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
   {label:'视图',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]},
   {label:'GameBuddy',submenu:[{label:'退出',click:()=>void requestQuit()}]}
  ]));
  shortcuts=installGameGuyShortcuts(()=>win,dataDir,process.platform==='win32'?'windows':process.platform==='darwin'?'macos':'linux',updateMenu,()=>({revision:0,blocked:false}),trustedURL);
  shortcuts.attach(win);updateMenu();
 }
 browserGuests.bind(win,shortcuts ? (guest,id)=>shortcuts.attachGuest(win,guest,id) : ()=>()=>{});
 if(nativeSmokeMode)win.webContents.on('console-message',e=>console.log('[native-renderer]',e.level,e.message));
 installExternalLinks(win);
 for(const event of ['will-navigate','will-redirect'])win.webContents.on(event,(e,url)=>{if(!trustedURL(url))e.preventDefault();});
 win.webContents.session.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));
 win.webContents.session.setPermissionCheckHandler(()=>false);
 win.on('close',e=>{if(!quitting){e.preventDefault();win.hide();}});
 win.on('resize',()=>{hideSpectator();win.webContents.send('gameguy:refresh');});
 win.once('ready-to-show',()=>win.show());
 const icon=nativeImage.createFromPath(join(root,'assets/gameguy.png'));
 tray=new Tray(icon);tray.setToolTip('GameBuddy · 本地服务');tray.setContextMenu(Menu.buildFromTemplate([{label:'打开 GameBuddy',click:()=>{win.show();win.focus();}},{label:'退出 GameBuddy',click:()=>void requestQuit()}]));tray.on('double-click',()=>{win.show();win.focus();});
 const notify=()=>{if(win&&!win.isDestroyed())win.webContents.send('gameguy:refresh');};
 const assertSender=e=>{if(!win||win.isDestroyed()||e.sender!==win.webContents||e.senderFrame!==e.sender.mainFrame||!trustedURL(e.senderFrame.url))throw Error('Untrusted IPC sender');};
 ipcMain.on('gameguy:theme-source',(e,value)=>{try{assertSender(e);if(e.sender===win.webContents&&['system','light','dark'].includes(value))nativeTheme.themeSource=value;}catch{}});
 const fullscreen=()=>win.webContents.send('gameguy:fullscreen',win.isFullScreen());
 win.on('enter-full-screen',fullscreen);win.on('leave-full-screen',fullscreen);win.webContents.on('did-finish-load',fullscreen);
 ipcMain.handle('gameguy:directory-pick',async e=>{assertSender(e);if(e.sender!==win.webContents||!nativeClient)throw Error('Native primary window required');const result=await dialog.showOpenDialog(win,{properties:['openDirectory','createDirectory']});return result.canceled?null:result.filePaths[0]??null;});
 ipcMain.handle('gameguy:browser-acquire',(e,workspace)=>{assertSender(e);if(e.sender!==win.webContents||!nativeClient||!nativeOrigin)throw Error('Native primary window required');return browserGuests.acquire(e.sender,workspace);});
 ipcMain.handle('gameguy:browser-release',(e,lease)=>{assertSender(e);return browserGuests.release(e.sender,lease);});
 // Native session exports use Blob downloads. Never give guest pages a download path.
 win.webContents.session.on('will-download',(event,item,contents)=>{if(contents!==win.webContents||!trustedURL(contents.getURL())){event.preventDefault();return;}const file=dialog.showSaveDialogSync(win,{title:'GameBuddy · 保存文件',defaultPath:basename(item.getFilename())});if(!file){event.preventDefault();return;}item.setSavePath(file);});
 ipcMain.handle('gameguy:invoke',async(e,action,a={})=>{try{assertSender(e);if(action==='state')return ready?{ok:true,value:{...service.snapshot(),...(initError?{startupError:initError}:{})}}:{ok:true,value:{brand:'GameBuddy',loading:!initError,startupError:initError}};
 if(action==='restart'){if(!initError)throw Error('仅初始化失败时允许重启；内核重试请保存模型配置');await requestQuit(true);return {ok:true,value:{status:quitting?'restart-requested':'cancelled'}};}
 if(action==='retry-native'){if(!ready||!nativeClient)throw Error('请等待服务初始化或重新启动应用');await loadNative();return {ok:true,value:{status:'ready'}};}
 if(action==='quit'){void requestQuit();return {ok:true,value:{status:'requested'}};}
 if(!ready)throw Error('应用服务仍在初始化，请稍后重试');
 const owner=BrowserWindow.fromWebContents(e.sender);let value;
 switch(action){
 case 'session-focus':if(!nativeClient)throw Error('Native client unavailable');win.show();win.focus();win.webContents.send('gameguy:navigate',{sessionId:a.sessionId,prompt:typeof a.prompt==='string'?a.prompt.slice(0,20000):undefined});value={status:'focused'};break;
 case 'create':value=await service.create(a);break;
 case 'message':value=await service.message(a.taskId,a.text);break;
 case 'session-models':value=await service.sessionModels(a.taskId,{refresh:a.refresh===true});break;
 case 'session-model':value=await service.selectSessionModel(a.taskId,a.selection);break;
 case 'permission':value=await service.setPermission(a.taskId,a.preset);break;
 case 'stop':value=await service.stop(a.taskId);break;
 case 'question-answer':value=await service.resolveQuestion(a.id,a.answer);break;
 case 'approval':value=await service.resolveApproval(a.id,a.allow===true);break;
 case 'capture':value=await service.capture(a.taskId);break;
 case 'privacy':if(a.enabled===true&&spectatorTask===a.taskId)hideSpectator();value=await service.privacy(a.taskId,a.enabled===true);break;
 case 'plugin-install':{const item=service.plugins.list().find(p=>p.id===a.game);if(!item)throw Error('未知插件');const choice=await dialog.showMessageBox(owner,{type:'question',buttons:['取消','校验并启用'],defaultId:0,cancelId:0,message:'安装并启用 '+(item.title??a.game)+' 游戏包',detail:'来源：GameBuddy 内置离线市场（本次不进行网络下载）\n权限：'+item.permissions.join('、')+'\n插件是可信本机代码，不是隔离沙箱。'});if(choice.response!==1)value={status:'denied'};else value=await service.installFromUI(a.game);break;}
 case 'plugin-disable':value=await service.disableFromUI(a.game);break;
 case 'schedule':value=await service.scheduleFromUI(a);notify();break;
 case 'tool':if(!['gameguy_setup','gameguy_configure','gameguy_diagnose','gameguy_device_start'].includes(a.name))throw Error('Unsupported UI operation');value=await service.tool(a.taskId,a.name,a.input);break;
 case 'model-discover':
 case 'model-verify':{
  const model=normalizeModel(action==='model-discover'?{...a.model,model:a.model?.model?.trim()||'catalog-probe'}:a.model);
  const key=await resolveModelKey(model,a.key,service.modelStore.data,loadKey);
  value=await (action==='model-discover'?discoverModels:verifyModelAPI)(model,key);break;
 }
 case 'model':{
  const save=async()=>{
   if(typeof a.key!=='string'||a.key.length>16000)throw Error('Invalid API Key');
   const model=normalizeModel(a.model),old=structuredClone(service.modelStore.data);
   const key=await resolveModelKey(model,a.key,old,loadKey),previousKey=await loadKey();
   value=await commitModelCredential({path:keyFile,crypto:safeStorage,key,
    save:()=>service.saveModel(model,key,a.models),
    restore:()=>service.saveModel(old,previousKey)});
   if(nativeClient){initError='';await loadNative();}
   return value;
  };
  const job=modelSaveTail.catch(()=>{}).then(save);modelSaveTail=job;value=await job;break;
 }
 case 'spectator-external':{const t=service.task(a.taskId);if(t.privacy||service.privacyChanges.has(t.id))throw Error('隐私暂停：禁止打开观战预览');if(t.game!=='clawclaw'||!t.preview?.url)throw Error('任务尚无官方观战地址');await shell.openExternal(spectatorURL(t.preview.url));value={status:'opened-in-browser'};break;}
 case 'spectator':{
  const t=service.task(a.taskId);if(t.privacy||service.privacyChanges.has(t.id))throw Error('隐私暂停：禁止打开观战预览');if(t.game!=='clawclaw'||!t.preview?.url)throw Error('此任务尚无官方观战地址');
  const url=spectatorURL(t.preview.url);const b=a.bounds;
  if(!b||![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.x<0||b.y<0||b.width<100||b.height<100)throw Error('Invalid preview bounds');
  const [width,height]=owner.getContentSize();if(b.x+b.width>width+2||b.y+b.height>height+2)throw Error('Preview outside content');
  if(spectatorTask!==t.id||spectatorAddress!==url||spectatorOwner!==owner){hideSpectator();spectator=new WebContentsView({webPreferences:{partition:'gameguy-spectator',contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true}});spectatorTask=t.id;spectatorAddress=url;
   const wc=spectator.webContents;wc.setWindowOpenHandler(()=>({action:'deny'}));wc.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));wc.session.setPermissionCheckHandler(()=>false);
   for(const event of ['will-navigate','will-redirect'])wc.on(event,(ev,target)=>{try{spectatorURL(target);}catch{ev.preventDefault();notifyPreview('预览阻止了非官方导航');}});
   wc.on('did-fail-load',(_e,code)=>{if(code!==-3)notifyPreview('官方观战页加载失败；可以重试，游戏执行未因此停止');});spectatorOwner=owner;owner.contentView.addChildView(spectator);void wc.loadURL(url).catch(()=>notifyPreview('官方观战页加载失败'));
  }
  spectator.setBounds(Object.fromEntries(Object.entries(b).map(([k,v])=>[k,Math.round(v)])));value={status:'human-only'};break;
 }
 case 'spectator-hide':hideSpectator();value={status:'hidden'};break;
 default:throw Error('Unsupported GameBuddy action');
 }
 return {ok:true,value};
 }catch(err){return {ok:false,error:err.message};}});
 initialization=(async()=>{if(smokeMode)console.log('[desktop-smoke] loading UI');await win.loadURL(uiURL);if(smokeMode)console.log('[desktop-smoke] initializing service');if(quitting)return;vault=new CredentialVault(dataDir,safeStorage);service=new GameGuyService({root,dataDir,nativeClient,onCredential:(action,input)=>vault.request(action,input)});service.on('changed',notify);try{const legacyKey=await loadKey();if(nativeClient&&legacyKey){const config=JSON.parse(await readFile(join(dataDir,'model.json'),'utf8').catch(()=>'{"provider":"deepseek"}'));const ref=config.provider==='compatible'?'GAMEGUY_MODEL_KEY':'DEEPSEEK_API_KEY';if(!await vault.request('get',{ref}))await vault.request('set',{ref,value:legacyKey});}await service.init(legacyKey);if(initError)service.startupError=initError;ready=true;if(nativeClient){await loadNative();}}catch(e){initError=e.message;}notify();})();
 await initialization;
 if(smokeMode){
  console.log('[desktop-smoke] service initialized',ready,initError);
  let code=0;
  try{if(!ready||initError)throw Error(initError||'GameBuddy service not ready');if(homeSmokeMode){const {runHomeSmoke}=await import('./home-smoke.mjs');await runHomeSmoke(win,service,root,dataDir,vault);}else if(marketSmokeMode){const {runNativeMarketSmoke}=await import('./market-smoke.mjs');await runNativeMarketSmoke(win,service,root);}else if(nativeSmokeMode){const {runNativeSmoke}=await import('./native-smoke.mjs');await runNativeSmoke(win,service,root,dataDir,vault);}else if(sessionModelSmokeMode){const {runSessionModelSmoke}=await import('./session-model-smoke.mjs');await runSessionModelSmoke(win,service,root);}else if(modelSmokeMode){const {runModelSmoke}=await import('./model-smoke.mjs');await runModelSmoke(win,service,root,dataDir,loadKey);}else{const {runDesktopSmoke}=await import('./smoke.mjs');await runDesktopSmoke(win,service,root);}}
  catch(error){console.error(error);code=1;}
  finally{quitting=true;hideSpectator();try{await service?.close();}catch(error){console.error(error);code=1;}shortcuts?.dispose();tray?.destroy();app.exit(code);}
 }
}
}
void boot().catch(error=>{console.error(error);app.exit(1);});
async function loadKey(){try{if(!safeStorage.isEncryptionAvailable())return '';return safeStorage.decryptString(await readFile(keyFile));}catch(e){if(e.code==='ENOENT')return '';initError='凭据解密失败，请重新保存模型密钥';return '';}}
function hideSpectator(){if(spectator){if(spectatorOwner&&!spectatorOwner.isDestroyed())spectatorOwner.contentView.removeChildView(spectator);spectatorOwner=null;spectator.webContents.close();spectator=null;spectatorTask=null;spectatorAddress=null;}}
function notifyPreview(error){if(win&&!win.isDestroyed())win.webContents.send('gameguy:preview-error',error);}
async function requestQuit(relaunch=false){if(quitting||quitPending)return;quitPending=true;await initialization;const active=ready&&(service.snapshot().tasks.some(t=>['thinking','approval','running','stopping','unknown'].includes(t.status))||service.monitor.active.size||service.monitor.pending.size);
 if(active){const r=await dialog.showMessageBox(win,{type:'warning',buttons:['取消','停止任务并退出'],defaultId:0,cancelId:0,message:'退出会停止 GameBuddy 自动执行',detail:'已发生的游戏动作不能撤销；停止龙虾杀进程不代表远端已退出。'});if(r.response!==1){quitPending=false;return;}}
 quitting=true;hideSpectator();try{if(service)await service.close();}catch(e){quitting=false;quitPending=false;await dialog.showMessageBox(win,{type:'error',message:'停止服务遇到错误',detail:'自动执行状态未知，请检查日志。'+e.message});return;}shortcuts?.dispose();tray?.destroy();if(relaunch)app.relaunch();app.quit();}

function trustedURL(url){if(url===uiURL)return true;if(!nativeOrigin)return false;try{const u=new URL(url);return u.origin===nativeOrigin&&u.pathname==='/';}catch{return false;}}
// Match DSH's explicit system-browser action; guests have a separate deny policy.
function installExternalLinks(owner){
 owner.webContents.setWindowOpenHandler(({url})=>{
  if(!owner.isDestroyed()&&trustedURL(owner.webContents.getURL())){
   const target=externalBrowserURL(url,nativeOrigin);
   if(target)void shell.openExternal(target).catch(()=>{});
  }
  return {action:'deny'};
 });
}
async function loadNative(){
 const url=service.runtimeBoot?.nativeURL;
 try{
  if(!url||service.runtime.status!=='ready')throw Error('完整 Agent 客户端不可用：'+(service.startupError??'内核离线，请保存模型配置重试'));
  nativeOrigin=new URL(url).origin;
  if(win.webContents.getURL()!==url)await win.loadURL(url);
 }catch(e){initError=e.message;await win.loadURL(uiURL).catch(()=>{});throw e;}
}

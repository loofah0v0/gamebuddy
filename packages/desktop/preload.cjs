const {contextBridge,ipcRenderer,webUtils}=require('electron');
const actions=new Set(['session-focus','session-models','session-model','state','create','message','permission','stop','question-answer','approval','capture','privacy','plugin-install','plugin-disable','schedule','tool','model','model-discover','model-verify','spectator','spectator-hide','spectator-external','restart','retry-native','quit']);
contextBridge.exposeInMainWorld('gameguy',Object.freeze({
 invoke:async(action,input={})=>{if(!actions.has(action))throw Error('Unsupported action');const result=await ipcRenderer.invoke('gameguy:invoke',action,input);if(!result.ok)throw Error(result.error);return result.value;},
 onNavigate:fn=>{const listener=(_e,value)=>fn(value);ipcRenderer.on('gameguy:navigate',listener);return()=>ipcRenderer.removeListener('gameguy:navigate',listener);},
 onRefresh:fn=>{const listener=()=>fn();ipcRenderer.on('gameguy:refresh',listener);return()=>ipcRenderer.removeListener('gameguy:refresh',listener);},
 onPreviewError:fn=>{const listener=(_e,error)=>fn(error);ipcRenderer.on('gameguy:preview-error',listener);return()=>ipcRenderer.removeListener('gameguy:preview-error',listener);}
}));

// DSH's desktop host contract, restricted again by main-frame/window IPC admission.
if(process.isMainFrame){
 const listeners=new Map();
 ipcRenderer.on('gameguy:browser-open-requested',(_e,request)=>{
  if(!request||typeof request.lease!=='string'||typeof request.url!=='string')return;
  for(const fn of [...(listeners.get(request.lease)??[])]){try{fn(request.url);}catch{}}
 });
 contextBridge.exposeInMainWorld('__DSH_DIRECTORY_PICKER__',{pick:()=>ipcRenderer.invoke('gameguy:directory-pick')});
 contextBridge.exposeInMainWorld('__DSH_HOST_PATHS__',{pathFor:file=>webUtils.getPathForFile(file)});
 contextBridge.exposeInMainWorld('dshDesktop',{protocolVersion:1,
 keyboard:{
  closeWindow:revision=>ipcRenderer.invoke('gameguy:shortcutsCloseWindow',revision),
  subscribe:fn=>{if(typeof fn!=='function')throw Error('Listener required');const listener=(_e,input)=>{
   const el=document.activeElement;
   if(input.kind==='iframe'&&(!(el instanceof HTMLIFrameElement)||!el.isConnected||!el.matches('iframe[data-sidebar-browser-frame],iframe[data-html-preview]')||!input.frameName||el.name!==input.frameName))return;
   if(input.kind==='webview'&&(!el?.isConnected||!el.matches('webview[data-sidebar-browser-frame]')||!input.frameName||el.getAttribute('name')!==input.frameName))return;
   fn(input);
  };ipcRenderer.on('gameguy:shortcutsInput',listener);return()=>ipcRenderer.removeListener('gameguy:shortcutsInput',listener);}
 },
 shortcuts:{
  get:definitions=>ipcRenderer.invoke('gameguy:shortcutsGet',definitions),
  edit:(edit,revision)=>ipcRenderer.invoke('gameguy:shortcutsEdit',edit,revision),
  recording:active=>ipcRenderer.invoke('gameguy:shortcutsRecording',active),
  subscribe:fn=>{if(typeof fn!=='function')throw Error('Listener required');const listener=(_e,value)=>fn(value);ipcRenderer.on('gameguy:shortcutsChanged',listener);return()=>ipcRenderer.removeListener('gameguy:shortcutsChanged',listener);}
 },browser:{
  acquire:workspace=>ipcRenderer.invoke('gameguy:browser-acquire',workspace),
  release:lease=>ipcRenderer.invoke('gameguy:browser-release',lease),
  onOpenRequested:(lease,fn)=>{if(typeof fn!=='function')throw Error('Listener required');let set=listeners.get(lease);if(!set){set=new Set();listeners.set(lease,set);}set.add(fn);return()=>{set.delete(fn);if(!set.size)listeners.delete(lease);};}
 }});
 ipcRenderer.on('gameguy:fullscreen',(_e,value)=>{if(!document.documentElement)return;if(value===true)document.documentElement.dataset.fullscreen='true';else delete document.documentElement.dataset.fullscreen;});
 document.addEventListener('DOMContentLoaded',()=>{
  document.documentElement.dataset.platform=process.platform;
  let sent;const sync=()=>{const value=document.documentElement.getAttribute('data-ds-theme-source');if(['system','light','dark'].includes(value)&&value!==sent){sent=value;ipcRenderer.send('gameguy:theme-source',value);}};
  new MutationObserver(sync).observe(document.documentElement,{attributeFilter:['data-ds-theme-source']});sync();
 });
}

/** Same-origin, authenticated actual-image preview; no dummy game video or embedded native window. */
export const previewHtml = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GameGuy · 游戏现场</title>
<style>
:root{color-scheme:dark;font:12px/1.65 'Segoe UI','Microsoft YaHei',sans-serif;color:#d9e8e3;background:#141e21}*{box-sizing:border-box}body{margin:0}button,a{font:inherit;color:inherit}button{cursor:pointer;border:1px solid #35524a;border-radius:7px;padding:8px 10px;background:#23352e;color:#83e7c3}button:hover{background:#30473c;border-color:#6a9b86}button:disabled{opacity:.4;cursor:not-allowed}:focus-visible{outline:2px solid #6ce8be;outline-offset:3px}
header{padding:18px 18px 13px;border-bottom:1px solid #2a3639}header .eyebrow{font:9px ui-monospace,monospace;letter-spacing:1.6px;color:#7d9d92}.title{display:flex;align-items:center;gap:8px;margin-top:7px}h2{font-size:15px;font-weight:600;margin:0}.dot{width:6px;height:6px;background:#6ce8be;border-radius:50%}.controls{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}#stop{color:#f0bd75;border-color:#594830;background:#30291f}section{padding:16px 18px}p{margin:0 0 12px}#info{font:11px/1.7 ui-monospace,'Microsoft YaHei',monospace;color:#b7cec5;overflow-wrap:anywhere}#device-status{color:#839b95;overflow-wrap:anywhere}.frame{position:relative;min-height:210px;border:1px solid #2c3e3b;border-radius:10px;background:#0e1719;overflow:hidden;display:grid;place-items:center}img{display:block;width:100%;object-fit:contain;max-height:58vh}img[hidden]{display:none}.empty{text-align:center;padding:28px 16px;color:#6e8780}.empty svg{width:44px;height:44px;margin-bottom:10px;color:#638e7d}.empty strong{display:block;font-size:13px;font-weight:500;color:#a9c6b9}.empty span{display:block;margin-top:7px;font-size:10px;line-height:1.8}.frame[data-live="true"] .empty{display:none}.frame[data-live="true"]{min-height:0}
#notice{color:#92afa3;font-size:11px;margin-top:12px;overflow-wrap:anywhere}#notice a{color:#6ce8be;text-decoration:none}#notice a:hover{text-decoration:underline}#time{display:block;font:9px ui-monospace,monospace;color:#688d7c;margin-bottom:18px}.events-label{font-size:10px;letter-spacing:.8px;color:#829b90;padding-top:15px;border-top:1px solid #2a3639}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:10px/1.8 ui-monospace,'Microsoft YaHei',monospace;max-height:28vh;overflow:auto;color:#8caaa0;margin:10px 0 0;background:#101a1c;border-radius:7px;padding:12px}.error{color:#ffbf86!important}#approval{padding:13px;border:1px solid #41634f;background:#1c3027;border-radius:9px;margin-bottom:14px}#approval strong{color:#9ae7bf;font-size:12px}#approval p{font-size:10px;margin:8px 0}#launch-info{overflow-wrap:anywhere;color:#b4cabe}#approval button{font-size:10px;padding:6px 9px}#cancel-device{background:transparent;color:#93aa9e;border-color:#3b5147;margin-left:6px}
@media(max-width:300px){header,section{padding-inline:12px}.controls{gap:6px}button{font-size:10px;padding:7px}.frame{min-height:175px}}
</style>
<header><div class="eyebrow">GAMEGUY / LIVE SCENE</div><div class="title"><i class="dot"></i><h2>观察与接管</h2></div><div class="controls"><button id="device" hidden>启动 MuMu / 连接</button><button id="stop" disabled>停止 / 接管</button></div></header>
<section><p id="info">等待选择游戏实例</p><p id="device-status" role="status"></p><div id="approval" hidden><strong>确认启动本机 MuMu</strong><p id="launch-info"></p><p>会打开模拟器窗口；这里展示真实截图，不是内嵌 Windows 窗口。不自动启动游戏、登录或收菜。</p><button id="confirm-device">确认启动</button><button id="cancel-device">取消</button></div>
<div class="frame" id="picture" data-live="false"><img id="screen" alt="当前游戏实例的真实 ADB 截图" hidden><div class="empty"><svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="4" y="8" width="40" height="27" rx="5" stroke="currentColor" stroke-width="1.5"/><path d="M18 41h12M24 35v6m-9-20h6m-3-3v6m13-5v.1m3 4v.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><strong>等待真实游戏画面</strong><span>选择实例并连接设备后展示<br>没有连接，就没有模拟画面。</span></div></div><p id="notice" role="status"></p><small id="time"></small><div class="events-label">实例事件 / 后端结果</div><pre id="events"></pre></section>
<script>
let current,refreshing=false,challenge,actionError='';
const el=id=>document.getElementById(id);
function clearImage(){const prev=el('screen').src;el('screen').hidden=true;el('picture').dataset.live='false';el('screen').removeAttribute('src');if(prev.startsWith('blob:'))URL.revokeObjectURL(prev);el('time').textContent='';}
async function post(path,data){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw Error(await r.text());return r.json();}
async function refresh(){if(refreshing)return;refreshing=true;try{
 el('notice').className='';const r=await fetch('/gameguy/state',{cache:'no-store'});if(!r.ok)throw Error('需要登录 DSH，或 GameGuy 未启用');const s=await r.json();const previous=current;current=s.preview.instance;if(previous!==current){actionError='';challenge=undefined;clearImage();}
 el('stop').disabled=!current;
 const run=s.runs.find(x=>x.instance===current),ds=(s.devices||[]).find(x=>x.instance===current);
 el('info').textContent=current?current+' · '+s.preview.game+' · '+(run?.status||'idle'):'等待通过对话配置并选择实例';
 el('events').textContent=run?JSON.stringify({result:run.result,error:run.error,events:run.events.slice(-8)},null,2):'插件：'+s.catalog.map(x=>x.title+(x.enabled?' ✓':' · 未安装/启用')).join('\\n');
 el('device-status').textContent=actionError|| (ds?ds.status+' · '+ds.message:'');el('device-status').className=actionError||ds?.status==='failed'?'error':'';
 el('device').hidden=true;el('approval').hidden=true;challenge=undefined;
 if(current&&s.preview.game==='arknights'&&!s.preview.privacy){
  const prompt=await fetch('/gameguy/device?instance='+encodeURIComponent(current),{cache:'no-store'});
  if(prompt.ok){const p=await prompt.json();el('device').hidden=!p.available;el('device').disabled=ds?.status==='starting'||run?.status==='running';if(p.token){challenge=p;el('launch-info').textContent=p.launch.executable+' · 实例 '+p.launch.instanceIndex+' · 确认五分钟内有效';el('approval').hidden=false;}}
 }
 if(s.preview.privacy){clearImage();el('notice').textContent='隐私暂停：画面与 Agent 截图均已停止。请在模拟器内完成秘密输入，再通过对话恢复。';}
 else if(s.preview.url){clearImage();el('notice').replaceChildren();const a=document.createElement('a');a.href=s.preview.url;a.target='_blank';a.rel='noopener';a.textContent='官方观战页面（若嵌入受限，可在新窗口打开）';el('notice').append(a);}
 else if(s.preview.game==='arknights'){
  if(ds&&ds.status!=='ready'){clearImage();el('notice').textContent='设备尚未确认连接：'+ds.status+'；不使用默认端口冒充已连接';}
  else{const img=await fetch('/gameguy/image',{cache:'no-store'});if(!img.ok)throw Error(await img.text());const blob=await img.blob();const prev=el('screen').src;el('screen').src=URL.createObjectURL(blob);if(prev.startsWith('blob:'))URL.revokeObjectURL(prev);el('screen').hidden=false;el('picture').dataset.live='true';el('notice').textContent='真实 ADB 截图 · 非视频直播';el('time').textContent='更新于 '+new Date().toLocaleTimeString();}
 }else{clearImage();el('notice').textContent=s.preview.game==='minecraft'?'Mineflayer 结构化状态（本版不自研 3D 渲染器）':'';}
}catch(e){el('notice').textContent=e.message;el('notice').className='error';clearImage();}finally{refreshing=false;}}
async function act(button,path,data){button.disabled=true;try{await post(path,data);actionError='';}catch(e){actionError=e.message;el('device-status').textContent=actionError;el('device-status').className='error';}finally{button.disabled=false;await refresh();}}
el('device').onclick=()=>current&&act(el('device'),'/gameguy/device',{instance:current});
el('confirm-device').onclick=()=>challenge&&act(el('confirm-device'),'/gameguy/device/start',{instance:challenge.instance,token:challenge.token});
el('stop').onclick=()=>current&&act(el('stop'),'/gameguy/stop',{instance:current});
el('cancel-device').onclick=()=>current&&act(el('cancel-device'),'/gameguy/stop',{instance:current});
refresh();setInterval(refresh,2000);
</script></html>`;

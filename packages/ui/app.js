const api=window.gameguy,$=id=>document.getElementById(id);
const sessionDirectories=new Map(),seatLoads=new Set();let seatEpoch=0,seatBusy=false,seatRenderKey='';
let state={},page='home',selected=null,renderKey='',previewKey='',polling=false,refreshAgain=false,captureBusy=false,captureEpoch=0,lastCapture=0,previewError='';
let previewOpen=localStorage.getItem('gameguy.preview.open')!=='false',previewWidth=Number(localStorage.getItem('gameguy.preview.width'))||375,resizing=false;
const questionDrafts=new Map();
const labels={arknights:'明日方舟',minecraft:'Minecraft',clawclaw:'龙虾杀'};
const statusLabels={stopping:'正在停止',unknown:'停止未确认 · 可重试',idle:'等待指令',thinking:'Agent 执行中',running:'游戏运行中',approval:'等待你的确认',stopped:'已停止',completed:'后端已结束',failed:'出现错误',interrupted:'上次运行中断','needs-setup':'需要配置'};
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function button(text,fn,cls){const n=el('button',text,cls);n.type='button';n.onclick=()=>void action(fn);return n;}
function details(data,title='查看详情'){const d=el('details');d.append(el('summary',title),el('pre',JSON.stringify(data,null,2)));return d;}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,6000);}
async function action(fn){try{await fn();await refresh();}catch(e){toast(e.message);}}
const task=()=>state.tasks?.find(t=>t.id===selected);
async function hideSpectator(){previewKey='';try{await api.invoke('spectator-hide');}catch{}}
function navigate(next,id=null){if(state.nativeClient&&next==='task'){const t=state.tasks?.find(t=>t.id===id);if(t?.sessionId){void api.invoke('session-focus',{sessionId:t.sessionId}).catch(e=>toast(e.message));return;}}seatEpoch++;seatBusy=false;seatRenderKey='';page=next;selected=id;renderKey='';captureEpoch++;lastCapture=0;previewError='';void hideSpectator().then(refresh);}
function fillGoal(text){if(state.nativeClient){void api.invoke('session-focus',{prompt:text}).catch(e=>toast(e.message));return;}navigate('home');$('prompt').value=text;$('prompt').focus();}
function card(title,body){const c=el('div',undefined,'list-card');c.append(el('h3',title),el('p',body));return c;}
function render(){
 const t=task(),key=JSON.stringify({page,selected,loading:state.loading,error:state.startupError,runtime:state.runtime,model:state.model,permissions:state.permissionCatalog,t:page==='task'?t:null,approvals:state.approvals,questions:state.questions,plugins:state.plugins,schedules:state.schedules,devices:page==='devices'?state.devices:null});
 $('kernel').textContent=state.runtime==='ready'?'● Buddy 已就绪 · GameBuddy v0.3':state.loading?'○ 内核初始化中':'○ 内核离线 · 打开设置重试';
 $('tasks').replaceChildren(...(state.tasks??[]).slice(0,30).map(x=>button((statusLabels[x.status]??x.status)+' · '+x.title,()=>navigate('task',x.id),selected===x.id?'active':'')));
 document.querySelectorAll('#nav button').forEach(n=>n.classList.toggle('active',n.dataset.page===page));
 $('stop').hidden=!t||!['thinking','running','approval','stopping','unknown'].includes(t.status);
 $('stop').disabled=t?.status==='stopping';$('stop').textContent=t?.status==='unknown'?'重试停止':t?.status==='stopping'?'正在停止…':'停止任务';
 $('composer').hidden=!!state.nativeClient||!['home','task'].includes(page);$('send').disabled=!!state.loading||!state.tasks;
 $('banner').hidden=!!state.tasks&&!state.startupError&&!!state.model?.hasKey;
 $('banner').textContent=state.startupError||(state.loading?'正在启动 GameBuddy…':!state.model?.hasKey?'尚未配置模型密钥。先打开「模型与应用设置」；未配置时仍可管理插件、查看任务和诊断设备。':'服务初始化失败');
 $('recovery').hidden=$('banner').hidden;$('recovery').replaceChildren();if(!$('banner').hidden){if(state.nativeClient&&state.runtime==='ready')$('recovery').append(button('重试完整工作台',()=>api.invoke('retry-native')));$('recovery').append(state.tasks?button('打开模型设置 / 重试内核',showModel):state.startupError?button('重新启动 GameBuddy',()=>api.invoke('restart')):el('span',''));}
 renderSessionModel();
 if(key===renderKey)return;renderKey=key;const content=$('content'),oldScroll=content.scrollTop,nearBottom=content.scrollHeight-oldScroll-content.clientHeight<130;content.replaceChildren();
 $('crumb').textContent=page==='task'?'GAMEBUDDY / '+(labels[t?.game]??'AI AGENT'):'GAMEBUDDY / WORKSPACE';
 if(page==='home'&&state.nativeClient){$('title').textContent='GameBuddy · 游戏中心';content.append(card('对话和游戏共用一个 Agent','模型切换、附件、工作区、终端和文件预览均在主窗口。这里管理游戏插件、设备、消费授权与每日计划。'),button('回到完整 Agent 对话',()=>api.invoke('session-focus',{})));return;}
 if(page==='home'){
  $('title').textContent='把重复交给 Agent，把乐趣留给你。';const w=el('div',undefined,'welcome');w.append(el('div','PLAY LESS REPETITION. MORE POSSIBILITY.','eyebrow'));
  const h=el('h1','今天，想让 ');h.append(el('span','GameBuddy'),document.createTextNode(' 做什么？'));w.append(h,el('p','以玩游戏为核心的 AI Agent。告诉 Buddy 你的游戏目标，它会理解玩法、配置环境、执行任务；遇到问题时查资料、写脚本、测试并修复。'));
  const general=el('div',undefined,'agent-shortcuts');general.append(button('排查游戏环境',()=>fillGoal('帮我只读检查明日方舟的游戏环境和依赖，先读取插件 Skill，再说明发现的问题；不要启动设备或游戏。')),button('让 Buddy 补写并测试脚本',()=>fillGoal('为明日方舟任务写一个本地日志检查脚本并用虚构回调测试，遇到错误自行修改并重测。先读官方参考和已有源码，不要连接设备或操作真实游戏。')));
  const cs=el('div',undefined,'cards');for(const g of [
   ['arknights','◈','明日方舟','说出目标，Buddy 帮你配置 MAA','MAA Skill · 游戏插件','帮我完成明日方舟收菜，加普通自动换班，1-7 最多三次，不吃药、不用源石、不购物。先检查环境并说明方案，确认后执行。'],
   ['minecraft','▧','Minecraft','连接测试服，观察、移动、采集','Mineflayer · 游戏插件','帮我连接我授权的 Minecraft 测试服务器，先询问地址，再观察状态，不挖掘。'],
   ['clawclaw','♧','龙虾杀','读官方 Skill，用人设进入对局','游戏插件 · 官方 Skill / ccl','用谨慎但爱交流的人设玩一局龙虾杀，结束后先停下来。按官方 Skill 操作并在右侧展示观战。']]){
   const c=button('',()=>fillGoal(g[5]),'game-card');c.append(el('div',g[1],'game-icon'),el('strong',g[2]),el('p',g[3]),el('span',g[4],'tag'));cs.append(c);
  }w.append(cs);const support=el('details',undefined,'agent-capabilities');support.append(el('summary','辅助能力 · 环境排障、资料检索、写脚本与测试'),el('p','保留 DSH 通用 Agent 能力，为游戏任务服务；也可以直接提出文件、代码等非游戏需求。'),general);w.append(support);const o=el('div','第一次使用？配置模型后，直接告诉 Agent 你要做什么。','onboarding');o.append(button('连接模型',showModel));w.append(o);content.append(w);
 }else if(page==='task'&&t){
  $('title').textContent=t.title;content.append(el('div',(statusLabels[t.status]??t.status)+' · '+(t.instance??(t.game?'尚未绑定游戏实例':'通用 Agent · 不需要游戏实例')),'progress'));
  if(state.permissionCatalog){
   const row=el('div',undefined,'permission-control');row.append(el('strong','DSH 权限'));
   const select=el('select');select.setAttribute('aria-label','当前任务 DSH 权限');select.id='task-permission';
   const descriptions={'read-only':'只读 · 修改需单次提权','workspace-write':'工作区写入 · 工作区外修改需单次提权','danger-full-access':'完全访问 · 通用与游戏操作无需审批'};
   for(const item of state.permissionCatalog.options){const opt=el('option',descriptions[item.value]??item.name);opt.value=item.value;select.append(opt);}select.value=t.permission??state.permissionCatalog.defaultPreset;
   select.disabled=['thinking','running','approval','stopping','unknown'].includes(t.status);
   select.addEventListener('change',async()=>{const before=t.permission??state.permissionCatalog.defaultPreset,preset=select.value;
    if(preset==='danger-full-access'&&!window.confirm('完全访问允许通用工具直接修改工作区外文件和执行命令。仅在信任当前任务时启用。游戏操作不再逐次弹审批卡，但插件资源上限、隐私暂停和停止机制仍有效。')){select.value=before;return;}
    select.disabled=true;try{await api.invoke('permission',{taskId:t.id,preset});await refresh();}catch(error){select.value=before;toast(error.message);}finally{select.disabled=['thinking','running','approval','stopping','unknown'].includes(task()?.status);}
   });row.append(select,el('small','复用 DSH 原生沙箱与审批；停止后可切换。游戏授权独立保留。'));content.append(row);
  }
  if(t.capabilities){
   const caps=t.capabilities,c=el('details',undefined,'agent-capabilities');c.append(el('summary','DSH Agent 内核 · '+caps.tools.length+' 个当前工具 · '+(caps.planMode?.active?'计划模式':'执行模式')));
   c.append(el('p','通用文件/代码/命令能力不需要绑定游戏。实际可用工具由当前权限与提供商配置决定。'));
   const commands=el('div',undefined,'agent-shortcuts');for(const cmd of caps.commands){const line='/'+cmd.name+(cmd.name==='plan'?(caps.planMode?.active?' off':''):'');const b=button(line,()=>{$('prompt').value=line+((cmd.input&&cmd.name!=='plan')?' ':'');$('prompt').focus();});b.title=cmd.description+(cmd.input?' · '+cmd.input.hint:'');commands.append(b);}c.append(commands,el('pre',caps.tools.join(' · ')),el('p',caps.limitations.join('\n')));content.append(c);
  }
  const recentTools=t.events.filter(e=>e.type==='tool-status'||e.type==='child-status').slice(-8);
  if(recentTools.length){const trace=el('details',undefined,'agent-trace');trace.append(el('summary','Agent 工具与子任务进度'),el('pre',recentTools.map(e=>(e.type==='tool-status'?e.name+' · '+e.phase:'子 Agent · '+e.status)+' · '+e.agentId).join('\n')));content.append(trace);}
  for(const m of t.messages){const c=el('article',undefined,'message '+m.role);c.append(el('div',(m.role==='user'?'你':m.role==='assistant'?'GameBuddy':'任务服务')+' · '+new Date(m.at).toLocaleTimeString(),'message-label'),el('div',m.text,'message-body'));if(m.details)c.append(details(m.details));content.append(c);}
  for(const q of state.questions??[]){if(q.taskId===t.id)content.append(questionCard(q));}
  for(const a of state.approvals??[]){if(a.taskId!==t.id)continue;const c=el('div',undefined,'approval');c.append(el('h3','需要确认 · '+a.kind),el('p','仅此任务有效，5 分钟后自动失效。停止任务会撤销尚未执行的授权。'),details(a.details,'计划、配置与风险参数'),button('确认并继续',()=>api.invoke('approval',{id:a.id,allow:true}),'approve'),button('拒绝',()=>api.invoke('approval',{id:a.id,allow:false})));content.append(c);}
  if(t.events.length)content.append(details(t.events.slice(-12),'最近后端事件（外部数据）'));
 }else if(page==='plugins'){
  $('title').textContent='游戏市场';content.append(el('p','3 个独立游戏包。当前为内置离线市场，安装时校验完整性；主窗口的「游戏市场」支持搜索、分类和对话配置。','progress'));
  for(const p of state.plugins??[]){const c=card((labels[p.id]??p.id)+' · '+p.version,(p.enabled?'已启用':'尚未启用')+' / 本地可信包 · SHA-256 清单校验');c.append(details({permissions:p.permissions,manifestSha256:p.manifestSha256},'权限与完整性'),button(p.enabled?'禁用':'校验并启用',()=>api.invoke(p.enabled?'plugin-disable':'plugin-install',{game:p.id})));content.append(c);}
  content.append(card('龙虾杀 · 官方 Skill','随应用固定版本提供原始 gameplay Skill 与 ccl CLI。由 DSH Agent 读取 Skill，通用 Monitor 接收事件；通过龙虾杀游戏包统一安装、启用和停用；不另造 clawclaw.* gameplay 接口。'));
 }else if(page==='devices'){
  $('title').textContent='游戏与设备';content.append(card('对话优先，设备按任务绑定','在首页输入“帮我配置明日方舟收菜”，Agent 会读取 schema、检查依赖，询问缺失配置。模拟器运行在独立进程，右侧显示 ADB 真实画面，不是把 MuMu 原生窗口嵌入应用。登录与验证码只在游戏客户端输入。'));
  const ts=(state.tasks??[]).filter(x=>x.game&&x.game!=='clawclaw');if(!ts.length)content.append(card('还没有游戏任务','创建一个明日方舟或 Minecraft 任务后，就能在这里诊断、选择实例和配置。'));
  for(const x of ts){const c=card(labels[x.game]+' · '+x.title,'实例：'+(x.instance??'尚未配置'));c.append(button('继续对话配置',()=>navigate('task',x.id)),button('自动发现与建议配置',async()=>{const r=await api.invoke('tool',{taskId:x.id,name:'gameguy_setup',input:{game:x.game}});showData(c,r); }));if(state.plugins?.some(p=>p.id===x.game&&p.enabled))c.append(button('诊断连接',async()=>showData(c,await api.invoke('tool',{taskId:x.id,name:'gameguy_diagnose',input:{}}))));content.append(c);}
 }else if(page==='schedules'){
  $('title').textContent='定时计划';content.append(card('按已确认模板执行，不偷偷补跑','仅支持 MAA 日常模板。在任务对话中指定每天 HH:mm 和 IANA 时区，确认设备、计划、资源策略和下次运行。服务须常驻；离线漏跑和设备冲突跳过，配置变化不继续执行。'));
  const ss=state.schedules?.schedules??[];if(!ss.length)content.append(card('还没有定时计划','例：“以后每天早上 8 点，按这套已确认配置收菜，时区 Asia/Shanghai。” 不会在首次启动时自动创建。'));
  for(const s of ss){const c=card(s.time+' · '+s.timeZone,(s.enabled?'已启用':'已暂停')+' / '+s.instance+' / 下次：'+new Date(s.nextRun).toLocaleString());c.append(details({template:s.plan,maxSeconds:s.maxSeconds,last:s.last},'模板与最近结果'),button(s.enabled?'暂停':'恢复',()=>manageSchedule(s,s.enabled?'pause':'resume')),button('删除',()=>manageSchedule(s,'delete')));content.append(c);}
 }
 if(page==='task'&&nearBottom)content.scrollTop=content.scrollHeight;else content.scrollTop=oldScroll;
}
// Same per-session directory for the composer and /model. No changes to default connection.
const choiceKey=s=>s?JSON.stringify([s.provider,s.model]):'';
const routeKey=()=>JSON.stringify([state.model?.provider,state.model?.baseURL,state.model?.model]);
function renderSessionModel(){
 const t=page==='task'?task():null,entry=t?sessionDirectories.get(t.id):null;
 if(entry&&entry.route!==routeKey()){sessionDirectories.delete(t.id);seatEpoch++;seatBusy=false;}
 const directory=t?sessionDirectories.get(t.id):null;
 const current=t?.sessionModel??directory?.sessionModel,models=directory?.models??[];
 const key=JSON.stringify([t?.id,routeKey(),current,models,directory?.loading,directory?.error,seatBusy,state.runtime,$("model-dialog").open,modelBusy]);
 if(key===seatRenderKey)return;seatRenderKey=key;
 const select=$('session-model');select.replaceChildren();
 if(!t){select.append(el('option',state.model?.model??'未配置默认模型'));select.disabled=true;$('session-effort').hidden=true;$('session-model-status').textContent='新会话使用全局默认模型';}
 else{
  const placeholder=el('option',current?.unavailable?'原模型连接不可用，请重新选择':'选择会话模型');placeholder.value='';select.append(placeholder);
  const groups=new Map();for(const m of models){let group=groups.get(m.provider);if(!group){group=el('optgroup');group.label=m.providerName;groups.set(m.provider,group);select.append(group);}const opt=el('option',m.name);opt.value=choiceKey(m);group.append(opt);}
  const available=!current?.unavailable&&models.find(m=>choiceKey(m)===choiceKey(current?.next));select.value=available?choiceKey(available):'';
  select.disabled=seatBusy||directory?.loading||!models.length||state.runtime!=='ready';
  const effort=$('session-effort'),efforts=available?.reasoning?.efforts??[];effort.hidden=!efforts.length;effort.disabled=select.disabled;effort.replaceChildren();
  const def=el('option','默认推理强度');def.value='';effort.append(def);for(const e of efforts){const opt=el('option',e.name);opt.value=e.id;effort.append(opt);}effort.value=current?.next?.reasoningEffort??'';
  const last=current?.lastUsed;
  $('session-model-status').textContent=seatBusy?'正在保存会话选择…':directory?.loading?'正在读取模型目录…':directory?.error??(current?.unavailable?'连接已变化：原选择保留，不会自动替换':current?.pending?'已选择 '+(current.next?.model??'默认模型')+' · 下一次请求生效'+(last?'；上次使用 '+last.model:''):'当前会话模型 · 切换保留历史，下一次请求生效');
  if(!directory&&state.runtime==='ready'&&!$('model-dialog').open&&!modelBusy)void loadSessionModels(false);
 }
 $('refresh-session-models').disabled=!t||seatBusy||directory?.loading||state.runtime!=='ready';
}
async function loadSessionModels(remote=false){
 const t=page==='task'?task():null;if(!t||seatBusy||modelBusy||$('model-dialog').open)return;
 const id=t.id,epoch=seatEpoch,route=routeKey(),old=sessionDirectories.get(id);if(old?.loading)return;
 const loading={...old,route,loading:true,error:null};sessionDirectories.set(id,loading);seatRenderKey='';renderSessionModel();
 const operation=api.invoke('session-models',{taskId:id,refresh:remote});seatLoads.add(operation);
 try{const result=await operation;if(sessionDirectories.get(id)!==loading)return;
  if(route!==routeKey()){sessionDirectories.delete(id);return;}
  sessionDirectories.set(id,{...result,route,loading:false});if(epoch===seatEpoch&&selected===id&&result.sessionModel)task().sessionModel=result.sessionModel;
 }catch(error){if(sessionDirectories.get(id)===loading){if(route===routeKey())sessionDirectories.set(id,{...old,route,loading:false,error:error.message});else sessionDirectories.delete(id);}}
 finally{seatLoads.delete(operation);if(epoch===seatEpoch){seatRenderKey='';renderSessionModel();}}
}
async function changeSessionModel(){
 const t=task(),dir=t&&sessionDirectories.get(t.id);if(page!=='task'||!dir||seatBusy)return;
 const selectedModel=dir.models.find(m=>choiceKey(m)===$('session-model').value);if(!selectedModel)return;
 const effort=$('session-effort').value,selection={provider:selectedModel.provider,model:selectedModel.model};
 if(!$('session-effort').hidden&&effort)selection.reasoningEffort=effort;
 const id=t.id,epoch=seatEpoch;seatBusy=true;seatRenderKey='';renderSessionModel();
 try{const result=await api.invoke('session-model',{taskId:id,selection});if(epoch===seatEpoch&&selected===id){t.sessionModel=result;dir.sessionModel=result;}}
 catch(error){if(epoch===seatEpoch)toast(error.message);}
 finally{if(epoch===seatEpoch){seatBusy=false;seatRenderKey='';renderSessionModel();await refresh();}}
}
$('session-model').onchange=()=>{
 // Model change applies its adapter default; do not carry effort across models.
 $('session-effort').value='';$('session-effort').hidden=true;void changeSessionModel();
};
$('session-effort').onchange=()=>void changeSessionModel();
$('refresh-session-models').onclick=()=>void loadSessionModels(true);
$('session-connection').onclick=()=>void action(showModel);
function questionCard(batch){
 const c=el('div',undefined,'approval question-card'),form=el('form');c.append(el('h3',batch.questions.some(q=>q.intent?.kind==='plan-review')?'计划审阅':'Buddy 需要你的选择'),el('p','选择或直接填写答案；跳过不会批准计划。5 分钟后失效。'));
 const draft=questionDrafts.get(batch.id)??new Map();questionDrafts.set(batch.id,draft);
 for(const q of batch.questions){const value=draft.get(q.id)??{selected:[],custom:''};draft.set(q.id,value);
  const field=el('fieldset');field.append(el('legend',q.header??q.question));if(q.header)field.append(el('p',q.question));if(q.detail)field.append(el('pre',q.detail,'question-detail'));
  const controls=[];for(const option of q.options??[]){const label=el('label',undefined,'question-option'),input=el('input');input.type=q.multiSelect?'checkbox':'radio';input.name=batch.id+'-'+q.id;input.value=option.label;input.checked=value.selected.includes(option.label);controls.push(input);
   input.onchange=()=>{value.selected=controls.filter(i=>i.checked).map(i=>i.value);if(!q.multiSelect){value.custom='';custom.value='';}};label.append(input,el('span',option.label+(option.description?' — '+option.description:'')));field.append(label);
  }
  const custom=el('textarea');custom.placeholder='也可以直接填写你的答案';custom.setAttribute('aria-label',q.question+'：自定义答案');custom.maxLength=20000;custom.value=value.custom;
  custom.oninput=()=>{value.custom=custom.value;if(!q.multiSelect&&value.custom.trim()){value.selected=[];controls.forEach(i=>i.checked=false);}};field.append(custom);form.append(field);
 }
 const submit=el('button','提交选择','primary');submit.type='submit';form.append(submit,button('跳过（不批准）',async()=>{await api.invoke('question-answer',{id:batch.id,answer:{answers:[]}});questionDrafts.delete(batch.id);}));
 form.onsubmit=event=>{event.preventDefault();void action(async()=>{const answers=batch.questions.map(q=>({id:q.id,...draft.get(q.id)})).filter(a=>a.selected.length||a.custom.trim());if(!answers.length)throw Error('请选择或填写答案，也可以明确跳过');submit.disabled=true;try{await api.invoke('question-answer',{id:batch.id,answer:{answers}});questionDrafts.delete(batch.id);}finally{submit.disabled=false;}});};c.append(form);return c;
}
function showData(c,r){c.querySelector('.diagnostic')?.remove();const p=el('pre',JSON.stringify(r,null,2),'diagnostic');c.append(p);}
async function manageSchedule(s,action){navigate('task',s.taskId);return api.invoke('schedule',{id:s.id,action});}
async function renderPreview(){
 if(!previewOpen||resizing){await hideSpectator();return;}
 const t=page==='task'?task():null,k=JSON.stringify({id:t?.id,game:t?.game,instance:t?.instance,privacy:t?.privacy,url:t?.preview?.url,page,error:previewError});
 if(k!==previewKey){previewKey=k;captureEpoch++;lastCapture=0;$('screen').replaceChildren();$('preview-actions').replaceChildren();$('preview-meta').textContent='';$('preview-info').textContent=t?(labels[t.game]??'待识别游戏')+' / '+(t.instance??'未绑定实例'):'尚未选择游戏任务';
  if(!t){const e=el('div',undefined,'empty-preview');e.append(el('div','◎','radar'),el('h3','等待连接游戏'),el('p','选择任务后展示真实画面或结构化状态。'));$('screen').append(e);}
  else if(t.game==='arknights'){
   $('screen').append(el('div',t.privacy?'隐私模式：画面采集已关闭。':t.instance?'正在尝试采集真实设备画面…':'配置游戏实例后才会采集画面。','empty-preview'));
   if(t.instance){$('preview-actions').append(button('刷新真实画面',()=>capture(true)),button(t.privacy?'恢复画面':'隐私模式',()=>api.invoke('privacy',{taskId:t.id,enabled:!t.privacy})));}
  }else if(t.game==='minecraft'){$('screen').append(el('pre','等待服务器状态。'));$('preview-meta').textContent='Mineflayer 无内置渲染器；这里不是视频直播。';}
  else if(t.game==='clawclaw'){
   $('screen').append(el('div',previewError||(t.preview?.url?'官方观战页 · 仅供你观看':'Agent 获取官方观战地址后自动在此展示。'),'empty-preview'));
   if(t.preview?.url){$('preview-actions').append(button('重试观战页',async()=>{previewError='';await hideSpectator();}),button('在浏览器打开',()=>api.invoke('spectator-external',{taskId:t.id})));}
  }else $('screen').append(el('div','识别游戏后加载预览。','empty-preview'));
 }
 if(!t)return;
 if(t.game==='arknights'&&t.instance&&!t.privacy&&Date.now()-lastCapture>7000)void capture();
 if(t.game==='minecraft'){const r=(state.runs??[]).find(r=>t.runIds.includes(r.id));$('screen').firstChild.textContent=JSON.stringify({status:statusLabels[t.status]??t.status,instance:t.instance??null,latestEvent:t.events.at(-1)??null,result:r?.result??null},null,2);}
 if(t.game==='clawclaw'&&t.preview?.url&&!previewError&&!$('model-dialog').open){const r=$('screen').getBoundingClientRect();try{await api.invoke('spectator',{taskId:t.id,bounds:{x:r.x+1,y:r.y+1,width:r.width-2,height:r.height-2}});}catch(e){previewError=e.message;}}
}
async function capture(force=false){const t=task();if(!previewOpen||resizing||captureBusy||page!=='task'||t?.game!=='arknights'||!t.instance||t.privacy)return;captureBusy=true;lastCapture=Date.now();const epoch=captureEpoch,id=t.id;try{const r=await api.invoke('capture',{taskId:id});if(epoch!==captureEpoch||task()?.id!==id||task()?.privacy)return;const img=el('img');img.alt='真实设备画面';img.src=r.dataURL;$('screen').replaceChildren(img);$('preview-meta').textContent='采集时间：'+new Date(r.at).toLocaleString()+' / '+r.instance;}catch(e){if(epoch===captureEpoch){$('screen').replaceChildren(el('div','画面暂不可用：'+e.message+'。这不表示已连接或已收菜。','empty-preview'));$('preview-meta').textContent='最近尝试：'+new Date().toLocaleTimeString();}}finally{captureBusy=false;}}
async function refresh(){if(polling){refreshAgain=true;return;}polling=true;try{state=await api.invoke('state');render();await renderPreview();}catch(e){toast(e.message);}finally{polling=false;if(refreshAgain){refreshAgain=false;queueMicrotask(()=>void refresh());}}}
let modelEpoch=0,modelBusy=false,modelSaving=false,verifiedDraft=null,draftModels=[];
function modelDraft(){return {model:{provider:$('provider').value,model:$('model-id').value.trim(),baseURL:$('base-url').value.trim(),vision:false},key:$('api-key').value.trim()};}
function feedback(id,text,status='idle'){const n=$(id);n.textContent=text;n.dataset.status=status;}
function clearCatalog(){draftModels=[];const option=el('option','先获取目录，或在下面手动填写');option.value='';$('model-select').replaceChildren(option);$('model-select').disabled=true;feedback('catalog-result','服务商不支持模型目录时，可直接手动填写模型 ID。');}
function updateModelControls(){const official=$('provider').value==='deepseek';document.querySelectorAll('#model-form input,#model-form select').forEach(n=>n.disabled=modelSaving);$('model-select').disabled=modelSaving||$('model-select').options.length<=1;$('base-url').disabled=modelSaving||official;$('base-url').placeholder=official?'https://api.deepseek.com（官方默认地址）':'https://your-endpoint.example/v1';for(const id of ['discover-models','verify-model'])$(id).disabled=modelBusy;document.querySelector('#model-form button[type="submit"]').disabled=modelBusy;}
function invalidateModel(routeChanged=false){modelEpoch++;verifiedDraft=null;feedback('api-result','尚未验证 API。获取目录不代表所选模型可推理。');feedback('model-result','');if(routeChanged)clearCatalog();updateModelControls();}
async function probeModel(kind){if(modelBusy)return;const epoch=modelEpoch,draft=modelDraft(),id=kind==='model-discover'?'catalog-result':'api-result';modelBusy=true;if(kind==='model-verify')verifiedDraft=null;updateModelControls();feedback(id,kind==='model-discover'?'正在获取可用模型…':'正在验证 API 与选定模型…','loading');
 try{const r=await api.invoke(kind,draft);if(epoch!==modelEpoch||!$('model-dialog').open)return;
  if(kind==='model-discover'){clearCatalog();draftModels=r.models;const placeholder=$('model-select').firstChild;placeholder.textContent=r.count?'请选择模型，或手动填写 ID':'目录为空，请手动填写模型 ID';for(const name of r.models){const option=el('option',name);option.value=name;$('model-select').append(option);}$('model-select').disabled=!r.count;if(r.models.includes($('model-id').value.trim()))$('model-select').value=$('model-id').value.trim();feedback(id,r.count?'已获取 '+r.count+' 个模型（'+r.latencyMs+' ms）；请选择后验证 API。':'目录为空；仍可手动填写并验证 API。',r.count?'success':'idle');}
  else{verifiedDraft=JSON.stringify(draft);feedback(id,'API 验证通过 · '+r.model+' · '+r.latencyMs+' ms（一次文本推理；尚未保存）','success');}
 }catch(error){if(epoch===modelEpoch&&$('model-dialog').open){if(kind==='model-discover')clearCatalog();feedback(id,error.message,'error');}}
 finally{modelBusy=false;if(epoch!==modelEpoch){if($(id).dataset.status==='loading')feedback(id,'配置已变化，旧请求结果已忽略；请重新检查。');}updateModelControls();}
}
async function showModel(){await hideSpectator();modelEpoch++;verifiedDraft=null;const m=state.model??{};$('provider').value=m.provider??'deepseek';$('model-id').value=m.model??'deepseek-flash';$('base-url').value=m.baseURL??'';$('api-key').value='';clearCatalog();feedback('api-result','尚未验证 API。获取目录不代表所选模型可推理。');feedback('model-result','');updateModelControls();$('model-dialog').showModal();}
function closeModel(){modelEpoch++;verifiedDraft=null;$('api-key').value='';$('model-dialog').close();void refresh();}
$('new-task').onclick=()=>navigate('home');$('nav').onclick=e=>{const n=e.target.closest('button[data-page]');if(n)navigate(n.dataset.page);};$('settings').onclick=()=>void action(showModel);$('close-model').onclick=closeModel;$('model-dialog').addEventListener('cancel',()=>{modelEpoch++;verifiedDraft=null;$('api-key').value='';void refresh();});
$('provider').addEventListener('change',()=>invalidateModel(true));for(const id of ['base-url','api-key'])$(id).addEventListener('input',()=>invalidateModel(true));$('model-id').addEventListener('input',()=>{invalidateModel();$('model-select').value=$('model-id').value.trim();});$('model-select').addEventListener('change',()=>{if($('model-select').value){$('model-id').value=$('model-select').value;invalidateModel();}});
$('discover-models').onclick=()=>void probeModel('model-discover');$('verify-model').onclick=()=>void probeModel('model-verify');
$('stop').onclick=()=>void action(()=>api.invoke('stop',{taskId:selected}));$('quit').onclick=()=>void action(()=>api.invoke('quit'));
$('composer').onsubmit=async e=>{e.preventDefault();const text=$('prompt').value.trim();if(!text)return;if(/^\/model\s*$/.test(text)){ $('prompt').value='';if(page==='task'&&task()){await loadSessionModels(false);$('session-model').focus();}else await showModel();return;}$('send').disabled=true;try{if(page==='task'&&task())await api.invoke('message',{taskId:selected,text});else{const r=await api.invoke('create',{text});navigate('task',r.taskId);}$('prompt').value='';}catch(err){toast(err.message);}finally{await refresh();$('send').disabled=false;}};
$('prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('composer').requestSubmit();}});
$('model-form').onsubmit=async e=>{e.preventDefault();if(modelBusy)return;const epoch=modelEpoch,draft=modelDraft(),wasVerified=verifiedDraft===JSON.stringify(draft);modelBusy=true;modelSaving=true;updateModelControls();
 try{
   // Let our already-admitted catalog reads finish; never bypass host admission guards.
   // The settings dialog suppresses new lazy reads while a connection is being edited.
   await Promise.allSettled([...seatLoads]);
   const r=await api.invoke('model',{...draft,models:draftModels});if(epoch===modelEpoch&&$('model-dialog').open){$('api-key').value='';verifiedDraft=wasVerified?JSON.stringify(modelDraft()):null;if(wasVerified)feedback('api-result','API 验证通过 · '+draft.model.model+'（当前配置已保存；一次文本推理，不代表所有工具能力）','success');feedback('model-result',r.configured?'密钥已加密保存，内核已就绪；'+(wasVerified?'当前配置已通过本次 API 验证。':'尚未验证 API 连通性。'):'内核已就绪，仍需配置密钥后才能执行 Agent。','success');}await refresh();}
 catch(error){if(epoch===modelEpoch&&$('model-dialog').open)feedback('model-result',error.message,'error');}
 finally{modelSaving=false;modelBusy=false;updateModelControls();}
};
function applyPreviewLayout(){previewWidth=Math.round(Math.max(300,Math.min(previewWidth,650,window.innerWidth-228-440-6)));document.body.style.setProperty('--preview-width',previewWidth+'px');document.body.classList.toggle('preview-collapsed',!previewOpen);$('toggle-preview').textContent=previewOpen?'收起预览':'展开预览';$('toggle-preview').setAttribute('aria-expanded',String(previewOpen));$('preview-resizer').setAttribute('aria-valuenow',String(previewWidth));localStorage.setItem('gameguy.preview.width',String(previewWidth));localStorage.setItem('gameguy.preview.open',String(previewOpen));}
$('toggle-preview').onclick=()=>{previewOpen=!previewOpen;captureEpoch++;applyPreviewLayout();void hideSpectator().then(refresh);};
$('preview-resizer').addEventListener('pointerdown',e=>{resizing=true;document.body.classList.add('resizing');$('preview-resizer').setPointerCapture(e.pointerId);void hideSpectator();});
$('preview-resizer').addEventListener('pointermove',e=>{if(resizing){previewWidth=window.innerWidth-e.clientX;applyPreviewLayout();}});
function endResize(){if(!resizing)return;resizing=false;document.body.classList.remove('resizing');previewKey='';void refresh();}
$('preview-resizer').addEventListener('pointerup',endResize);$('preview-resizer').addEventListener('pointercancel',endResize);$('preview-resizer').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();previewWidth=e.key==='Home'?300:e.key==='End'?650:previewWidth+(e.key==='ArrowLeft'?20:-20);applyPreviewLayout();void hideSpectator().then(refresh);}});
applyPreviewLayout();
api.onNavigate(({sessionId})=>{const t=state.tasks?.find(t=>t.sessionId===sessionId);selected=t?.id??null;renderKey='';void refresh();});
api.onRefresh(()=>void refresh());api.onPreviewError(error=>{previewError=error;void refresh();});window.addEventListener('resize',()=>{applyPreviewLayout();previewKey='';void refresh();});setInterval(()=>void refresh(),2000);void refresh();

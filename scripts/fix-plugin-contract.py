from pathlib import Path
root=Path('D:/Gameguy')
def edit(p,old,new):
 f=root/p;s=f.read_text(encoding='utf-8');assert old in s,(p,old[:100]);f.write_text(s.replace(old,new),encoding='utf-8')
edit('packages/core/src/contracts.ts','  parseConfig: (input: unknown) => Json;', '''  parseConfig: (input: unknown) => Json;
  /** Public serialized schemas and policy belong to the installed game package. */
  configSchema: Json;
  planSchema: Json;
  validatePlan: (config: Json, plan: Json) => Json;
  capabilities: { schedule: boolean };
  setup?: (config: Json, context: { root: string; signal: AbortSignal; configured: boolean }) => Promise<Json>;''')
edit('packages/plugin-arknights/src/index.ts',"import { configSchema,compileTasks,type ArknightsConfig }", "import { configSchema,planSchema,compileTasks,type ArknightsConfig }")
edit('packages/plugin-arknights/src/index.ts',"import { startMuMu } from './emulator.js';", "import { startMuMu } from './emulator.js';\nimport { discoverEnvironment } from './discovery.js';")
edit('packages/plugin-arknights/src/index.ts',' questions:()=>[],', ''' configSchema:z.toJSONSchema(configSchema) as Json,planSchema:z.toJSONSchema(planSchema) as Json,
 capabilities:{schedule:true},
 validatePlan:(config,plan)=>{const p=planSchema.parse(plan);compileTasks(get(config),p);return p;},
 setup:discoverEnvironment,
 questions:()=>[],''')
edit('packages/plugin-minecraft/src/index.ts',"import { configSchema,validatePlan } from './plan.js';", "import { configSchema,planSchema,validatePlan } from './plan.js';\nimport { z } from 'zod';")
edit('packages/plugin-minecraft/src/index.ts',' diagnose:async config=>', ''' configSchema:z.toJSONSchema(configSchema) as Json,planSchema:z.toJSONSchema(planSchema) as Json,
 capabilities:{schedule:false},validatePlan:(config,plan)=>validatePlan(config,plan).p,
 setup:async config=>({suggestedConfig:configSchema.parse(config),questions:configSchema.parse(config).host?[]:['已授权的 Minecraft Java offline-mode 服务器地址、端口及版本？'],ready:false,next:'确认服务器授权后 configure；连接配置不要求先选择挖掘任务。'}),
 diagnose:async config=>''')
# address privacy fallback must work even after a plugin is disabled.
edit('packages/core/src/engine.ts',"config.game==='arknights'?'adb:'+String(value.address):config.game", "typeof value.address==='string'&&/^(?:localhost|127\\.0\\.0\\.1):\\d{1,5}$/.test(value.address)?'adb:'+value.address:config.game")
edit('packages/core/src/engine.ts'," private keys(c:"," private keys(c:")
edit('packages/core/src/engine.ts'," private privateDevice(c:{game:string;value:Json}):boolean", " assertReadable(game:string,value:Json):void{if(this.closing)throw Error('host is closing');if(this.privateDevice({game,value}))throw Error('privacy pause active; device inspection blocked');}\n private privateDevice(c:{game:string;value:Json}):boolean")
edit('packages/core/src/engine.ts'," async diagnose(game:string,instance?:string):Promise<Json>{const p=this.adapter(game);return p.diagnose(instance?this.config(instance,game).value:p.defaults);}", " async diagnose(game:string,instance?:string):Promise<Json>{const p=this.adapter(game),value=instance?this.config(instance,game).value:p.defaults;this.assertReadable(game,value);const result=await p.diagnose(value);this.assertReadable(game,value);return result;}")
f=root/'packages/app-service/index.mjs';s=f.read_text(encoding='utf-8');s='\n'.join(l for l in s.split('\n') if not ('../plugin-arknights/lib/plan.js' in l or '../plugin-minecraft/lib/plan.js' in l));s=s.replace('this.closing=false;','this.setupJobs=new Map();this.closing=false;',1)
start=s.index(" if(name==='gameguy_setup')");end=s.index(" if(name==='gameguy_configure')",start)
s=s[:start]+''' if(name==='gameguy_setup'){
  const game=await bind(a.game);if(game==='clawclaw')return {game,skill:'clawclaw',config:'Read official Skill and ccl help. No MAA/emulator required.',shellPolicy:'Native DSH permissions govern general shell/file tools; Monitor owns start/join stream with separate game confirmation.'};
  const plugin=this.engine.adapter(game),instance=t.instance??'game-'+t.id.replaceAll('-','').slice(0,24);
  // A model cannot use setup to inspect another task's device/configuration.
  if(a.instance&&a.instance!==instance)throw Error('setup 实例必须属于当前任务');
  const value=t.instance?this.engine.config(t.instance,game).value:plugin.defaults;
  this.engine.assertReadable(game,value);if(t.privacy)throw Error('privacy pause active');
  if(this.setupJobs.has(taskId))throw Error('插件环境发现正在进行');
  const epoch=this.cancelEpoch.get(taskId)??0,abort=new AbortController();
  const job={abort,game,done:undefined};this.setupJobs.set(taskId,job);
  job.done=(async()=>{
   const discovery=plugin.setup?await plugin.setup(value,{root:this.root,signal:abort.signal,configured:!!t.instance}):{suggestedConfig:value,questions:plugin.questions(value),ready:false};
   abort.signal.throwIfAborted();if(!this.current(t,epoch)||this.engine.adapter(game)!==plugin)throw Error('任务/插件已停止，发现结果已丢弃');
   if(t.instance&&fingerprint(this.engine.config(t.instance,game).value)!==fingerprint(value))throw Error('发现期间配置变化，请重试');
   this.engine.assertReadable(game,value);if(t.privacy)throw Error('privacy pause active');
   if(discovery.suggestedConfig)this.engine.assertReadable(game,plugin.parseConfig(discovery.suggestedConfig));
   return {...discovery,instance,defaults:plugin.defaults,config:t.instance?value:undefined,configSchema:plugin.configSchema,planSchema:plugin.planSchema,capabilities:plugin.capabilities};
  })();try{return await job.done;}finally{if(this.setupJobs.get(taskId)===job)this.setupJobs.delete(taskId);}
 }
''' +s[end:]
s=s.replace("if(t.game!=='arknights')throw Error('MVP 定时计划仅支持已确认的 MAA 模板');", "if(!this.engine.adapter(t.game).capabilities.schedule)throw Error('此插件不支持定时计划');")
s=s.replace("this.engine.config(instance,'arknights')", "this.engine.config(instance,t.game)")
s=s.replace("this.validatePlan('arknights',this.engine.config(old.instance,'arknights').value,patch.plan)", "this.validatePlan(t.game,this.engine.config(old.instance,t.game).value,patch.plan)")
s=s.replace("t.game!=='arknights'||t.instance!==old.instance", "!this.engine.adapter(t.game).capabilities.schedule||t.instance!==old.instance")
s=s.replace("this.engine.config(old.instance,'arknights')", "this.engine.config(old.instance,t.game)")
start=s.index(' validatePlan(game,c,p){');end=s.index(' async execute(',start);s=s[:start]+" validatePlan(game,c,p){return this.engine.adapter(game).validatePlan(c,p);}\n"+s[end:]
s=s.replace("const work=[['Agent'", "const setup=this.setupJobs.get(id);setup?.abort.abort(Error('任务已停止'));\n const work=[['插件发现',()=>setup?.done?.catch(()=>{})],['Agent'")
s=s.replace("t.game!=='arknights'||fingerprint(this.engine.config(s.instance,'arknights'))", "!this.engine.adapter(t.game).capabilities.schedule||fingerprint(this.engine.config(s.instance,t.game))")
s=s.replace("if(t.game!=='arknights'||!t.instance)throw Error('尚未连接明日方舟实例');", "if(!t.instance||!this.engine.adapter(t.game).screenshot)throw Error('当前游戏实例不支持截图预览');")
s=s.replace("if(this.engine.snapshot().runs.some(r=>r.game===game&&r.status==='running'))", "if([...this.setupJobs.values()].some(j=>j.game===game))throw Error('请先停止该游戏的环境发现');if(this.engine.snapshot().runs.some(r=>r.game===game&&r.status==='running'))")
s=s.replace(" async close(){this.closing=true;", " async close(){this.closing=true;for(const job of this.setupJobs.values())job.abort.abort(Error('应用正在退出'));await Promise.allSettled([...this.setupJobs.values()].map(j=>j.done));")
f.write_text(s,encoding='utf-8')
# Plugin contract validated after package integrity, before enabling.
edit('packages/app-service/plugins.mjs',"if(mod.adapter?.id!==id)throw Error('Plugin identity mismatch');", "if(mod.adapter?.id!==id)throw Error('Plugin identity mismatch');if(!mod.adapter.configSchema||!mod.adapter.planSchema||typeof mod.adapter.validatePlan!=='function'||typeof mod.adapter.capabilities?.schedule!=='boolean'||(mod.adapter.setup!==undefined&&typeof mod.adapter.setup!=='function'))throw Error('Plugin public configuration contract missing');")
edit('scripts/build-product.mjs',"version:'0.3.0'", "version:'0.3.1'")
edit('tests/product.test.mjs',"questions:()=>[],diagnose:", "configSchema:{type:'object'},planSchema:{type:'object'},capabilities:{schedule:true},validatePlan:(c,p)=>{const plan=planSchema.parse(p);compileTasks(configSchema.parse(c),plan);return plan;},questions:()=>[],diagnose:")
edit('tests/engine.test.ts',"questions:()=>[],diagnose:", "configSchema:{type:'object'},planSchema:{type:'object'},capabilities:{schedule:false},validatePlan:(_c,p)=>p,questions:()=>[],diagnose:")
# Registry UTF8 and order: registered MAA paths are checked as well.
f=root/'packages/plugin-arknights/src/discovery.ts';s=f.read_text(encoding='utf-8');s=s.replace("$ErrorActionPreference='SilentlyContinue';", "$ErrorActionPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);")
start=s.index(' const maaCandidates:string[]=[];');end=s.index(' let registered:string[]=[];',start);block=s[start:end];s=s[:start]+s[end:];at=s.index(' // Fixed candidates');block=block.replace("c.maaDir,join(context.root,'external/maa'),join(context.root,'MAA')", "c.maaDir,join(context.root,'external/maa'),join(context.root,'MAA'),...registered")
s=s[:at]+block+s[at:];s=s.replace(" else if(instances.length>1)", " else if(c.emulator)questions.push('已配置 MuMu 实例未通过发现校验，请从有效 instances 中重新选择或修复安装。');\n else if(instances.length>1)")
s=s.replace(" if(context.configured&&adbFound.length)", " if(context.configured&&adbFound.length&&(!c.emulator||!!selected))")
f.write_text(s,encoding='utf-8')
edit('packages/plugin-arknights/skills/arknights/SKILL.md','gameguy_setup {game:"arknights"} 返回任务实例、默认值、已有配置、完整 configSchema 和 planSchema。优先复用有效配置，只询问缺失项。', 'gameguy_setup {game:"arknights"} 调用本插件只读环境发现：有限安装注册表/常见位置、MuMu 官方 info、MAA/ADB 文件与 Python 自检；返回 suggestedConfig、instances、evidence、questions、依赖状态及本插件 schema。先调用它，不让用户手找路径；优先合并 suggestedConfig，只询问 questions 中无法确定的实例/渠道/依赖。发现不会启动模拟器、ADB connect、登录、执行游戏或写入配置；ready:false 不能宣称已连接。')
edit('packages/plugin-arknights/skills/arknights/SKILL.md','只问必要问题：本机设备与官服/B服、代理关卡与次数、是否采用已有基建方案、资源上限。', '连接委托只问未确定的实例/官服或 B服；不把关卡、换班方案和资源消费问题当作连接前置条件。只有用户要求收菜/刷关时才确认相应任务与资源上限。')
# Update tool description in worker after inspect as needed.

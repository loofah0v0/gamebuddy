import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('../packages/native-client/client.js',import.meta.url),'utf8');
let registration,open=false,toggled;
const React={createElement:(type,props,...children)=>({type,props:props??{},children}),useState:()=>[open,value=>{toggled=value;}],Fragment:'fragment'};
runInNewContext(source,{window:{__ModuleLoader__:{load:value=>{registration=value;}}},console});
const {ui}=registration.factory(name=>{assert.equal(name,'react');return React;});
const plain=value=>JSON.parse(JSON.stringify(value));
const run=(overrides={})=>({id:'fixture',status:'running',startedAt:'2026-10-27T02:00:00Z',events:[{kind:'plan',data:[{type:'StartUp',params:{}},{type:'Custom',params:{task_names:['InfrastBegin']}},{type:'Mall',params:{shopping:false}},{type:'Award',params:{}}]}],...overrides});
test('dock translates status and event metadata instead of exposing technical IDs',()=>{
 assert.deepEqual(plain(ui.statusInfo('running')),{label:'运行中',tone:'working'});
 assert.equal(ui.statusInfo('completed').label,'后端已结束');assert.equal(ui.statusInfo('unknown').label,'停止未确认');
 const e=ui.eventView({type:'tool-status',name:'pwsh',phase:'completed',at:'2026-10-27T00:00:00Z',taskId:'hidden-task-id',agentId:'hidden-agent-id'});
 assert.equal(e.title,'执行辅助命令');assert.equal(e.time,'08:00:00');assert(!JSON.stringify(e).includes('hidden-'));
});
test('raw JSON is initially collapsed, lazy-rendered and reachable through native summary',()=>{
 open=false;const node=ui.RawDetails({label:'执行记录',data:{toJSON:()=>assert.fail('closed detail must not stringify data')},id:'fixture'});
 assert.equal(node.type,'details');assert(!Object.hasOwn(node.props,'open'));assert.equal(node.children[0].type,'summary');assert.equal(node.children[1],false);
 node.props.onToggle({currentTarget:{open:true}});assert.equal(toggled,true);
 open=true;const expanded=ui.RawDetails({label:'运行详情',data:{status:'running'},id:'fixture'});assert.equal(expanded.children[1].type,'pre');assert.match(expanded.children[1].children[0],/"status": "running"/);open=false;
});
test('activities merge adjacent start/end and show at most six readable rows, newest first',()=>{
 const rows=ui.activityRows([{type:'tool-status',name:'gameguy_setup',phase:'started',at:'2026-10-27T00:00:00Z'},{type:'tool-status',name:'gameguy_setup',phase:'completed',at:'2026-10-27T00:00:01Z'}]);
 assert.equal(rows.length,1);assert.equal(rows[0].title,'检查游戏环境');assert.equal(rows[0].label,'已完成');
 const many=ui.activityRows(Array.from({length:20},(_,i)=>({kind:'backend',at:'2026-10-27T00:00:'+String(i).padStart(2,'0')+'Z'})));assert.equal(many.length,6);assert.equal(many[0].time,'08:00:19');
 const concurrent=ui.activityRows([{type:'tool-status',name:'read',phase:'started',callId:'a'},{type:'tool-status',name:'write',phase:'started',callId:'b'},{type:'tool-status',name:'read',phase:'completed',callId:'a'}]);assert.equal(new Set(concurrent.map(x=>x.key)).size,concurrent.length);
});
test('MAA subtask callbacks cannot reset a live chain to waiting or imply completion',()=>{
 const r=run();r.events.push({kind:'maa',data:{taskchain:'StartUp',msg:10002}},{kind:'maa',data:{taskchain:'Custom',msg:10001}},{kind:'maa',data:{taskchain:'Custom',msg:20002}});
 assert.deepEqual(plain(ui.stepRows(r)).map(x=>x.state),['done','active','waiting','waiting']);
 r.events.push({kind:'maa',data:{taskchain:'Custom',msg:10000}});assert.equal(ui.stepRows(r)[1].state,'failed');
});
test('backend receipt can close steps but never claims rewards independently verified',()=>{
 const r=run({status:'completed',result:{status:'backend-completed',rewardsIndependentlyVerified:false},endedAt:'2026-10-27T02:02:04Z'}),view=ui.runView(r);
 assert(view.steps.every(x=>x.state==='done'));assert.equal(view.duration,'2 分 4 秒');assert.match(view.note,/奖励.*核验/);assert(!view.note.includes('奖励已到账'));
 const noReceipt=ui.runView(run({status:'completed',result:{}}));assert(noReceipt.steps.every(x=>x.state==='waiting'));
 assert.match(ui.runView(run({status:'failed'})).note,/部分操作可能已生效/);
});
test('human approval summary preserves visible spending limits while JSON is collapsed',()=>{
 const view=ui.approvalView({kind:'run',details:{game:'arknights',plan:{startup:true,base:true,baseCollect:true,friends:true,daily:true,mail:true,shopping:false},maxSeconds:420,resourceLimits:{medicineLimit:5}}});
 assert.equal(view.title,'确认执行游戏任务');assert(view.items.includes('仅收基建产出'));assert(view.risks.includes('不吃药'));assert(view.risks.includes('不购物'));assert.equal(view.limit,'最多 7 分');
 const spending=ui.approvalView({kind:'configure',details:{game:'arknights',config:{medicineLimit:3,creditShopping:true}}});assert(spending.risks.includes('普通药上限 3 瓶'));assert(spending.risks.includes('允许信用购物'));
});
test('only explicit tasks appear in the approval summary; collect is not described as shifting',()=>{
 assert.deepEqual(plain(ui.planItems({startup:true,base:true,baseCollect:true})),['初始化游戏','仅收基建产出']);
 assert(!ui.planItems({startup:true,base:true,baseCollect:true}).includes('信用购物'));
 assert.equal(ui.timeLabel(null),'—');assert.equal(ui.timeLabel('invalid'),'—');assert.equal(ui.durationLabel(-1),'—');
});

test('unknown prototype-like status/tool names do not crash the human-readable projection',()=>{assert.equal(ui.statusInfo('__proto__').label,'状态待确认');assert.equal(ui.eventView({type:'tool-status',name:'constructor',phase:'__proto__'}).title,'调用辅助工具');assert.equal(ui.eventView({type:'tool-status',name:'constructor',phase:'__proto__'}).label,'已记录');});

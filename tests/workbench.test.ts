import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSnapshot, gamePrompt, games, statusLabels, displayTime } from '../packages/core/src/workbench-model.js';
const snapshot = () => ({catalog:games.map(g=>({id:g.id,title:g.name,enabled:true})),configs:[{id:'main',game:'arknights',value:{password:'never-render'}}],runs:[],devices:[],preview:{revision:0,privacy:false}});
test('workbench projects only display fields, not raw configuration or credentials',()=>{
 const parsed=parseSnapshot(snapshot());assert.deepEqual(parsed.configs,[{id:'main',game:'arknights'}]);assert(!JSON.stringify(parsed).includes('never-render'));
});
test('workbench malformed snapshots fail closed instead of showing success',()=>{
 for(const value of [null,{}, {...snapshot(),catalog:[{id:'unknown',title:'x',enabled:true}]}, {...snapshot(),preview:{revision:-1,privacy:false}}, {...snapshot(),runs:[{id:'1',game:'arknights',instance:'main',startedAt:'x',status:'success',events:[]}]}])assert.throws(()=>parseSnapshot(value));
});
test('workbench retains real errors and distinguishes backend completion from reward verification',()=>{
 const value={...snapshot(),runs:[{id:'1',game:'arknights',instance:'main',startedAt:'invalid',status:'failed',events:[{at:'x',kind:'error',data:{detail:'connection refused'}}],error:'failed connection'}]};
 assert.equal(parseSnapshot(value).runs[0].error,'failed connection');assert.equal(statusLabels.completed,'后端已结束');assert.equal(displayTime('invalid'),'时间未知');
});
test('Arknights draft asks for configuration and keeps resource and login defaults conservative',()=>{
 const prompt=gamePrompt('arknights','play');for(const phrase of ['可信本地目录','询问配置','不吃药','不花源石','不信用购物','基建方案','最长运行时间','暂停自动化与截图'])assert(prompt.includes(phrase));
});
test('game drafts reuse official ClawClaw skill and authorized Minecraft worlds',()=>{
 assert(gamePrompt('clawclaw','play').includes('官方 Skill 操作'));assert(gamePrompt('clawclaw','play').includes('不把链接当作默认交付'));
 assert(gamePrompt('minecraft','play').includes('只操作获授权的世界'));assert(gamePrompt('minecraft','play').includes('不未经确认破坏或挖掘'));
});
test('configuration, install, preview and schedule are explicit native handoffs',()=>{
 assert(gamePrompt('arknights','configure').includes('不运行游戏任务'));assert(gamePrompt('arknights','install').includes('不启动游戏'));
 assert(gamePrompt('arknights','preview','main').includes('不自动开始收菜'));
 const prompt=gamePrompt('arknights','schedule','main\"\n');for(const phrase of ['时间','时区','资源策略','最长时长','经我确认','真实 schedule','不能只口头承诺',JSON.stringify('main\"\n')])assert(prompt.includes(phrase));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {configSchema as maaConfig,compileTasks,planSchema as maaPlan} from '../packages/plugin-arknights/src/plan.js';
import {configSchema as mcConfig,validatePlan} from '../packages/plugin-minecraft/src/plan.js';
import {adapter as claw} from '../packages/plugin-clawclaw/src/index.js';
import {previewHtml} from '../packages/core/src/preview.js';
import {Script} from 'node:vm';

test('all game configs reject unknown fields and secrets',()=>{
 for(const parse of [(v:unknown)=>maaConfig.parse(v),(v:unknown)=>mcConfig.parse(v),claw.parseConfig]){
  assert.throws(()=>parse({password:'never-store'}));assert.throws(()=>parse({otp:'123456'}));assert.throws(()=>parse({unexpected:true}));
 }
});
test('MAA accepts only local ADB addresses and valid ports',()=>{
 for(const address of ['127.0.0.1:1','localhost:65535','127.0.0.1:16384'])assert.equal(maaConfig.parse({address}).address,address);
 for(const address of ['8.8.8.8:5555','localhost:0','localhost:65536','localhost:999999','host:5555','localhost:'])assert.throws(()=>maaConfig.parse({address}));
});
test('MAA conservative defaults and explicit task whitelist',()=>{
 const c=maaConfig.parse({});const tasks=compileTasks(c,{});
 assert.deepEqual(tasks.map(t=>t.type),['StartUp','Mall','Award']);
 assert.equal(tasks[1].params.shopping,false);assert.equal(tasks[1].params.credit_fight,false);
 assert.equal(tasks[2].params.recruit,false);assert.equal(c.medicineLimit,0);assert.equal(c.creditShopping,false);
 assert.throws(()=>compileTasks(c,{type:'Fight',params:{stone:100}}));
 assert.throws(()=>compileTasks(c,{startup:false,daily:false,friends:false}));
});
test('MAA fight spending ceilings and source stone invariant',()=>{
 const c=maaConfig.parse({medicineLimit:2,expiringMedicineLimit:1,maxFightTimes:4});
 const f=compileTasks(c,{fight:{stage:'1-7',times:4,medicine:2,expiringMedicine:1}}).find(t=>t.type==='Fight')!;
 assert.equal(f.params.stone,0);assert.equal(f.params.report_to_penguin,false);
 for(const fight of [{stage:'1-7',times:5},{stage:'1-7',times:1,medicine:3},{stage:'1-7',times:1,expiringMedicine:2},{stage:'1-7',times:1,stone:1},{stage:'../bad',times:1}])assert.throws(()=>compileTasks(c,{fight}));
});
test('MAA base requires existing plan and shopping separate from friends',()=>{
 assert.throws(()=>compileTasks(maaConfig.parse({}),{base:true}),/basePlan/);
 const tasks=compileTasks(maaConfig.parse({basePlan:'D:/plan.json'}),{base:true});
 const base=tasks.find(t=>t.type==='Infrast')!;assert.equal(base.params.mode,10000);assert.equal(base.params.drones,'_NotUse');assert.equal(base.params.replenish,false);
 assert.throws(()=>compileTasks(maaConfig.parse({}),{shopping:true}),/授权/);
 assert.equal(compileTasks(maaConfig.parse({creditShopping:true}),{friends:false,shopping:true}).find(t=>t.type==='Mall')!.params.shopping,true);
});
test('Roguelike delegation is finite, no investment or supports',()=>{
 const rogue=compileTasks(maaConfig.parse({}),{roguelike:{theme:'Sami',runs:3,difficulty:18}}).find(t=>t.type==='Roguelike')!;
 assert.equal(rogue.params.investment_enabled,false);assert.equal(rogue.params.use_support,false);
 for(const roguelike of [{theme:'unknown'},{theme:'Sami',runs:4},{theme:'Sami',difficulty:19}])assert.throws(()=>maaPlan.parse({roguelike}));
});
test('Minecraft offline-only, coordinates and dig authorization bounded',()=>{
 assert.throws(()=>mcConfig.parse({auth:'microsoft'}));
 assert.throws(()=>validatePlan({}, {action:'observe'}));
 assert.equal(validatePlan({host:'localhost'},{action:'observe'}).p.action,'observe');
 assert.throws(()=>validatePlan({host:'localhost'},{action:'dig',block:'stone'}));
 assert.throws(()=>validatePlan({host:'localhost',allowDig:true,maxDigBlocks:2},{action:'dig',block:'stone',count:3}));
 assert.equal(validatePlan({host:'localhost',allowDig:true},{action:'dig',block:'stone'}).p.action,'dig');
 assert.throws(()=>validatePlan({host:'localhost'},{action:'goto',x:30000001,y:64,z:0}));
 assert.throws(()=>validatePlan({host:'localhost'},{action:'observe',command:'/op GameGuy'}));
});
test('preview script parses, renders data as text, does not inject game HTML',()=>{
 const script=previewHtml.match(/<script>([\s\S]*?)<\/script>/)![1];assert.doesNotThrow(()=>new Script(script));
 assert(!script.includes('innerHTML'));assert(script.includes('textContent'));assert(script.includes("method:'POST'"));
});

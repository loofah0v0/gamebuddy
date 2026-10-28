import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePlan,requestSchema} from '../packages/plugin-arknights/src/prepare.js';
import {configSchema,compileTasks} from '../packages/plugin-arknights/src/plan.js';
const defaults=configSchema.parse({});
const task=(p:ReturnType<typeof preparePlan>,type:string)=>p.tasks.find(t=>t.type===type)!;
test('daily intent is conservative, independent of stored spending caps',()=>{
 const p=preparePlan({...defaults,medicineLimit:5,creditShopping:true},{intent:'daily'});
 assert.equal(p.ready,true);assert.deepEqual(p.tasks.map(t=>t.type),['StartUp','Mall','Award']);
 assert.deepEqual(p.resourcePolicy,{medicine:0,expiringMedicine:0,stone:0,shopping:false,drones:false,replenish:false,freeRecruit:false});
 assert.equal(task(p,'Mall').params.shopping,false);assert.equal(task(p,'Award').params.mail,true);
});
test('mail-only and daily-only do not widen award selection',()=>{
 const mail=preparePlan(defaults,{intent:'rewards',daily:false,mail:true});
 assert.equal(task(mail,'Award').params.award,false);assert.equal(task(mail,'Award').params.mail,true);
 const daily=preparePlan(defaults,{intent:'rewards',mail:false});assert.equal(task(daily,'Award').params.mail,false);
 assert.equal(task(daily,'Award').params.recruit,false);
});
test('normal base shifting requires no invented custom file',()=>{
 const p=preparePlan(defaults,{intent:'base',base:{mode:'normal',threshold:0.4,dormTrust:true}});
 assert.equal(p.ready,true);assert.equal(p.proposedConfig.baseMode,'normal');assert.equal(p.needsConfigApproval,true);
 const b=task(p,'Infrast').params;assert.equal(b.mode,0);assert.equal(b.drones,'_NotUse');assert.equal(b.replenish,false);
 assert.equal(b.threshold,0.4);assert.equal(b.dorm_trust_enabled,true);assert.equal(b.continue_training,false);
 assert.equal('filename' in b,false);assert.throws(()=>preparePlan(defaults,{intent:'base',base:{mode:'normal',filename:'x'}}));
 assert.throws(()=>preparePlan(defaults,{intent:'base',base:{mode:'normal',planIndex:1}}));
});
test('custom base asks for missing file, or preserves the player chosen plan',()=>{
 const missing=preparePlan(defaults,{intent:'daily',base:{mode:'custom'}});
 assert.equal(missing.ready,false);assert.equal(missing.plan,null);assert.deepEqual(missing.tasks,[]);
 const p=preparePlan({...defaults,basePlan:'D:/fixture/plan.json',basePlanIndex:2},{intent:'base',base:{mode:'custom'}});
 assert.equal(p.ready,true);assert.equal(task(p,'Infrast').params.filename,'D:/fixture/plan.json');assert.equal(task(p,'Infrast').params.plan_index,2);
});
test('incomplete requested farm prevents execution of the partial daily plan',()=>{
 for(const fight of [undefined,{stage:'1-7'},{times:2}]){
  const p=preparePlan(defaults,{intent: fight===undefined?'farm':'daily',...(fight?{fight}:{})});
  assert.equal(p.ready,false);assert.ok(p.questions.length);assert.equal(p.plan,null);assert.deepEqual(p.tasks,[]);
 }
});
test('explicit farm limits are proposed without mutating current policy',()=>{
 const c=structuredClone(defaults),before=structuredClone(c),request={intent:'farm',fight:{stage:'1-7',times:8,medicine:2}};
 const p=preparePlan(c,request);assert.deepEqual(c,before);assert.equal(p.ready,true);
 assert.equal(p.proposedConfig.maxFightTimes,8);assert.equal(p.proposedConfig.medicineLimit,2);assert.equal(p.needsConfigApproval,true);
 assert.equal(task(p,'Fight').params.medicine,2);assert.equal(task(p,'Fight').params.stone,0);
 assert.throws(()=>compileTasks(c,p.plan));
 assert.equal(task(preparePlan({...c,medicineLimit:5}, {intent:'farm',fight:{stage:'1-7',times:1}}),'Fight').params.medicine,0);
});
test('expiring medicine fails closed rather than treating MAA days as a bottle cap',()=>{
 const p=preparePlan({...defaults,expiringMedicineLimit:10},{intent:'daily',fight:{stage:'1-7',times:1,expiringMedicine:1}});
 assert.equal(p.ready,false);assert.equal(p.plan,null);assert.ok(p.unsupported.length);assert.deepEqual(p.tasks,[]);
 assert.throws(()=>compileTasks({...defaults,expiringMedicineLimit:10},{fight:{stage:'1-7',times:1,expiringMedicine:1}}),/临期药/);
 const f=task(preparePlan(defaults,{intent:'farm',fight:{stage:'1-7',times:1}}),'Fight').params;
 assert.equal(f.medicine_expire_days,0);assert.equal('expiring_medicine' in f,false);
});
test('credit intent collects only, shopping requires explicit opt-in',()=>{
 assert.equal(task(preparePlan(defaults,{intent:'credit'}),'Mall').params.shopping,false);
 const p=preparePlan(defaults,{intent:'credit',shopping:true,creditPolicy:{blacklist:['碳'],onlyDiscount:false}});
 assert.equal(p.ready,true);assert.equal(p.proposedConfig.creditShopping,true);assert.equal(p.needsConfigApproval,true);
 const m=task(p,'Mall').params;assert.deepEqual(m.blacklist,['碳']);assert.equal(m.force_shopping_if_credit_full,false);assert.equal(m.credit_fight,false);
 assert.ok(p.warnings.length);assert.throws(()=>preparePlan(defaults,{intent:'credit',creditPolicy:{onlyDiscount:true}}));
});
test('strict-discount requirement cannot silently execute a broader plan',()=>{
 const p=preparePlan(defaults,{intent:'daily',shopping:true,creditPolicy:{strictDiscountOnly:true}});
 assert.equal(p.ready,false);assert.equal(p.plan,null);assert.deepEqual(p.tasks,[]);assert.equal(p.proposedConfig.creditShopping,false);
});
test('roguelike theme must be supplied and run count is bounded',()=>{
 assert.equal(preparePlan(defaults,{intent:'roguelike'}).ready,false);
 const p=preparePlan(defaults,{intent:'roguelike',roguelike:{theme:'Sami',runs:2,difficulty:1}});
 assert.equal(p.ready,true);assert.equal(task(p,'Roguelike').params.starts_count,2);assert.equal(task(p,'Roguelike').params.investment_enabled,false);
 assert.throws(()=>preparePlan(defaults,{intent:'roguelike',roguelike:{theme:'Sami',runs:4}}));
});
test('connect proposal performs no game task and rejects attached operations',()=>{
 const p=preparePlan(defaults,{intent:'connect'});assert.equal(p.scope,'configuration-only');assert.equal(p.plan,null);assert.deepEqual(p.tasks,[]);
 assert.deepEqual(p.proposedConfig,defaults);assert.throws(()=>preparePlan(defaults,{intent:'connect',daily:true}));
});
test('player requests reject arbitrary scripts, unknown fields and unsafe bounds',()=>{
 for(const r of [{intent:'daily',stone:1},{intent:'daily',tasks:[]},{intent:'daily',fight:{stage:'../x',times:1}},{intent:'farm',fight:{stage:'1-7',times:51}},{intent:'farm',fight:{stage:'1-7',times:1,medicine:11}},{intent:'base',base:{mode:'normal',threshold:2}},{intent:'daily',shopping:true,creditPolicy:{budget:1}}])assert.throws(()=>requestSchema.parse(r));
});
test('combined proposal preserves device config and compiles the full requested chain',()=>{
 const c=configSchema.parse({clientType:'Bilibili',address:'127.0.0.1:16385',emulator:{type:'mumu',cliPath:'D:/fixture/mumu-cli.exe',instanceIndex:2}});
 const p=preparePlan(c,{intent:'daily',base:{mode:'normal'},fight:{stage:'1-7',times:3},shopping:false});
 assert.equal(p.ready,true);assert.deepEqual(p.tasks.map(t=>t.type),['StartUp','Infrast','Fight','Mall','Award']);assert.deepEqual(p.proposedConfig.emulator,c.emulator);
 assert.equal(p.proposedConfig.address,c.address);assert.equal(task(p,'StartUp').params.client_type,'Bilibili');
});
test('empty reward request is not promoted to a meaningful gameplay proposal',()=>{
 const p=preparePlan(defaults,{intent:'rewards',daily:false,mail:false});assert.equal(p.ready,false);assert.equal(p.plan,null);
});

test('base collection defaults to a fixed task, never shifts or inherits spending',()=>{
 const c=configSchema.parse({...defaults,baseMode:'normal',baseThreshold:0.9,medicineLimit:10,creditShopping:true});
 for(const request of [{intent:'base'},{intent:'base',base:{mode:'collect'}}]){
  const p=preparePlan(c,request);assert.equal(p.ready,true);assert.equal(p.plan!.baseCollect,true);
  assert.deepEqual(p.tasks,[{type:'StartUp',params:{client_type:'Official',start_game_enabled:true}},{type:'Custom',params:{task_names:['InfrastBegin']}}]);
  assert.deepEqual(p.proposedConfig,c);assert.equal(p.needsConfigApproval,false);assert.equal(p.resourcePolicy.shopping,false);assert.equal(p.resourcePolicy.medicine,0);
 }
});
test('collection rejects rotation-specific options and arbitrary Custom entries',()=>{
 for(const field of [{threshold:0},{filename:'x'},{planIndex:0},{dormTrust:false},{dormNotStationed:true}])assert.throws(()=>preparePlan(defaults,{intent:'base',base:{mode:'collect',...field}}),/仅收取/);
 assert.throws(()=>compileTasks(defaults,{baseCollect:true}),/base:true/);
 assert.throws(()=>compileTasks(defaults,{base:true,task_names:['InfrastEnterRotation']}));
 assert.equal(preparePlan(defaults,{intent:'base',base:{mode:'normal'}}).tasks.some(t=>t.type==='Custom'),false);
});
test('collection can be explicitly combined with daily but never shifts',()=>{
 const p=preparePlan(defaults,{intent:'daily',base:{mode:'collect'}});
 assert.deepEqual(p.tasks.map(t=>t.type),['StartUp','Custom','Mall','Award']);
 assert.equal(p.tasks.some(t=>t.type==='Infrast'),false);
});

test('complete conservative base/daily collection keeps StartUp enabled and first in the MaaCore chain',()=>{
 const p=preparePlan(defaults,{intent:'daily',base:{mode:'collect'},shopping:false});
 assert.equal(p.ready,true);assert.equal(p.plan!.startup,true);assert.equal(p.tasks[0].type,'StartUp');
 assert.deepEqual(p.tasks.map(t=>t.type),['StartUp','Custom','Mall','Award']);assert.equal(p.plan!.baseCollect,true);
 assert.equal(p.plan!.shopping,false);assert.equal(p.resourcePolicy.stone,0);assert.equal(p.resourcePolicy.medicine,0);
});

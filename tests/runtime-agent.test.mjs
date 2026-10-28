import test from 'node:test';
import assert from 'node:assert/strict';
import {taskOwner} from '../packages/runtime-dsh/capabilities.mjs';
import {persona} from '../packages/runtime-dsh/persona.mjs';
import {questionBatch,questionAnswer} from '../packages/app-service/questions.mjs';
const questions=()=>questionBatch({questions:[{id:'plan-review',question:'Review plan',detail:'# Offline plan',options:[{label:'Approve'},{label:'Keep planning'}],intent:{kind:'plan-review',approve:'Approve'}}]});
test('game-centered persona retains full general capabilities as supporting abilities',()=>{
 assert.match(persona,/Playing games and fulfilling player goals are your core/);
 assert.match(persona,/write\/edit code and scripts/);assert.match(persona,/fix it yourself/);
 assert.match(persona,/No game binding is required/);assert.match(persona,/do not use a generic shell to circumvent/);
});
test('ownership uses exact live identities, traverses descendants and isolates unrelated roots',()=>{
 const a={id:'a'},b={id:'b'},c={id:'c'},other={id:'other'},orphan={id:'orphan',parentSession:'a'};
 const live=[a,b,c,other,orphan],parents=new Map([['b',a],['c',b]]),roots=new Map([['a','task-a'],['other','task-other']]);
 const registry={get:id=>live.find(x=>x.id===id),list:()=>live,isOwnedBy:(id,parent)=>parents.get(id)===parent};
 assert.equal(taskOwner(registry,roots,a),'task-a');assert.equal(taskOwner(registry,roots,c),'task-a');
 assert.equal(taskOwner(registry,roots,other),'task-other');assert.equal(taskOwner(registry,roots,orphan),undefined);
 assert.equal(taskOwner(registry,roots,{id:'a'}),undefined);live.splice(live.indexOf(a),1);assert.equal(taskOwner(registry,roots,c),undefined);
});
test('ownership cycles terminate without inventing a task',()=>{
 const a={id:'a'},b={id:'b'},live=[a,b];const registry={get:id=>live.find(x=>x.id===id),list:()=>live,isOwnedBy:(id,parent)=>id==='a'?parent===b:parent===a};assert.equal(taskOwner(registry,new Map(),a),undefined);
});
test('question schemas reject ambiguous IDs, options and invalid approval labels',()=>{
 assert.throws(()=>questionBatch({questions:[{id:'q',question:'Q'},{id:'q',question:'Q'}]}));
 assert.throws(()=>questionBatch({questions:[{id:'q',question:'Q',options:[{label:'A'},{label:'A'}]}]}));
 assert.throws(()=>questionBatch({questions:[{id:'q',question:'Q',intent:{kind:'plan-review',approve:'Missing'}}]}));
 assert.throws(()=>questionBatch({questions:[],secret:'unrelated'}));
});
test('skipped questions never select approval; answers use valid unique labels',()=>{
 const qs=questions();assert.deepEqual(questionAnswer(qs,{answers:[]}),{answers:[]});
 assert.deepEqual(questionAnswer(qs,{answers:[{id:'plan-review',selected:['Approve']}]}).answers[0].selected,['Approve']);
 for(const a of [ {id:'unknown',selected:[]},{id:'plan-review',selected:['Bogus']},{id:'plan-review',selected:['Approve','Approve']},{id:'plan-review',selected:['Approve','Keep planning']},{id:'plan-review',selected:['Approve'],custom:'Other'}])assert.throws(()=>questionAnswer(qs,{answers:[a]}));
 assert.throws(()=>questionAnswer(qs,{answers:[{id:'plan-review',selected:[]},{id:'plan-review',selected:[]}]}));
});

test('game permission snapshot reads exact live session services, not saved task cache',async()=>{
 const {gamePermissionSnapshot}=await import('../packages/runtime-dsh/game-permission.mjs');const session={id:'live-session'};
 const ctx={permissionPresets:{current:s=>{assert.equal(s,session);return 'danger-full-access';}},sandboxPolicy:{resolve:({session:s})=>{assert.equal(s,session);return {mode:'danger-full-access'};}},approval:{effectivePolicy:s=>{assert.equal(s,session);return 'never';}}};
 assert.deepEqual(gamePermissionSnapshot(ctx,{session}),{sessionId:'live-session',preset:'danger-full-access',sandboxMode:'danger-full-access',approvalPolicy:'never'});
 assert.throws(()=>gamePermissionSnapshot(ctx,{}),/unavailable/);
});

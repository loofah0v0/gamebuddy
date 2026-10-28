import test from 'node:test';
import assert from 'node:assert/strict';
import { GameGuyBody, previewNavigation, GAMEGUY_TAB_KIND } from '../packages/core/src/client.js';
const state = (extra = {}) => ({ preview: { instance: 'test', revision: 3, ...extra } });
test('local game preview uses native GameGuy tab, never the guarded browser', () => {
  assert.deepEqual(previewNavigation(state()), { revision: 3, kind: GAMEGUY_TAB_KIND });
});
test('first-party tab iframe is fixed to the authenticated dashboard', () => {
  const element = GameGuyBody();
  assert.equal(element.type, 'iframe');
  assert.equal(element.props.src, '/gameguy/preview');
  assert.equal(element.props.title, 'GameGuy · 游戏现场');
});
test('official ClawClaw spectators still use native DSH browser', () => {
  for (const url of ['https://myclaw.163.com/watch/test', 'https://game.myclaw.163.com/watch/test']) {
    assert.deepEqual(previewNavigation(state({ url })), { revision: 3, kind: 'browser', url });
  }
});
test('untrusted spectator URLs and malformed preview states fail closed', () => {
  for (const url of ['http://myclaw.163.com', 'https://myclaw.163.com.evil.test/',
    'https://evilmyclaw.163.com/', 'https://user:secret@myclaw.163.com/',
    'javascript:alert(1)', '/gameguy/preview', 'http://127.0.0.1:18765/gameguy/preview', '', null, 4]) {
    assert.equal(previewNavigation(state({ url })), undefined);
  }
  for (const input of [null, {}, { preview: null }, state({ instance: '' }), state({ revision: -1 }),
    state({ revision: NaN }), state({ revision: 1.1 }), state({ revision: '3' })]) {
    assert.equal(previewNavigation(input), undefined);
  }
});

test('workbench dispatches to native services without sending a model task or overwriting drafts', async () => {
  const {workbenchActions}=await import('../packages/core/src/client.js');
  const calls: unknown[]=[];
  const ctx={workspaces:{list:{getSnapshot:()=>({phase:'ready',state:'idle',items:[{workspaceId:'existing',sessionIds:['session']}]})}},uiWorkspace:{startSession:(...args:unknown[])=>calls.push(['draft',...args])},layout:{selectPanel:(id:unknown)=>calls.push(['panel',id])},sidebarRight:{openTab:(id:unknown)=>calls.push(['tab',id])}};
  const actions=workbenchActions(ctx as never);actions.draft('帮我收菜');actions.conversation();actions.schedules();actions.plugins();actions.preview();
  assert.deepEqual(calls,[['draft',undefined,{prompt:'帮我收菜'}],['panel',null],['panel','schedules'],['panel','plugins'],['tab',GAMEGUY_TAB_KIND]]);
});


test('first-use single workspace gets an explicit native draft target', async () => {
  const {workbenchActions}=await import('../packages/core/src/client.js');
  const calls: unknown[]=[];
  const ctx={workspaces:{list:{getSnapshot:()=>({phase:'ready',state:'idle',items:[{workspaceId:'first',sessionIds:[]}]})}},uiWorkspace:{startSession:(...args:unknown[])=>calls.push(args)}};
  workbenchActions(ctx as never).draft('帮我收菜');
  assert.deepEqual(calls,[['first',{prompt:'帮我收菜'}]]);
});

test('pending, failed, absent or ambiguous first-use workspace never silently accepts a draft', async () => {
  const {workbenchActions}=await import('../packages/core/src/client.js');
  const states=[{phase:'pending',state:'loading',items:[]},{phase:'ready',state:'error',items:[]},{phase:'ready',state:'idle',items:[]},{phase:'ready',state:'idle',items:[{workspaceId:'a',sessionIds:[]},{workspaceId:'b',sessionIds:[]}]}];
  for(const state of states){
    const ctx={workspaces:{list:{getSnapshot:()=>state}},uiWorkspace:{startSession:()=>assert.fail('must not open native draft')}};
    assert.throws(()=>workbenchActions(ctx as never).draft('帮我收菜'),/工作区/);
  }
});

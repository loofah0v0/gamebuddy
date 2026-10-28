/** First-party GameGuy uses the native tab extension; external spectators use DSH browser. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-browser/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client';
import { createElement } from 'react';
import { GameGuyMark, GameGuyWorkbench, type WorkbenchActions } from './workbench.js';

export const GAMEGUY_TAB_ID = '@gameguy/core';
export const GAMEGUY_TAB_KIND = 'gameguy-preview';
export const GAMEGUY_PREVIEW_PATH = '/gameguy/preview';
export const GAMEGUY_PANEL_ID = 'gameguy-workbench' as MainPanelId;
export const inject = ['slots', 'layout', 'uiWorkspace', 'workspaces', 'sidebarRight', 'sidebarRightTabs'];

type PreviewNavigation = { revision: number; kind: typeof GAMEGUY_TAB_KIND | 'browser'; url?: string };
/** Never turn the first-party tab into an arbitrary URL browser. */
export function previewNavigation(state: unknown): PreviewNavigation | undefined {
  if (!state || typeof state !== 'object' || !('preview' in state)) return;
  const p = state.preview;
  if (!p || typeof p !== 'object' || !('revision' in p) || typeof p.revision !== 'number'
      || !Number.isSafeInteger(p.revision) || p.revision < 0 || !('instance' in p)
      || typeof p.instance !== 'string' || !p.instance) return;
  const url = 'url' in p ? p.url : undefined;
  if (url === undefined) return { revision: p.revision, kind: GAMEGUY_TAB_KIND };
  if (typeof url !== 'string') return;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password
        || !(u.hostname === 'myclaw.163.com' || u.hostname.endsWith('.myclaw.163.com'))) return;
    return { revision: p.revision, kind: 'browser', url };
  } catch { return; }
}

export function GameGuyBody() {
  // Trusted bundled UI only. Auth, privacy, and image access remain server-enforced.
  return createElement('iframe', {
    src: GAMEGUY_PREVIEW_PATH, title: 'GameGuy · 游戏现场',
    style: { width: '100%', height: '100%', minHeight: 320, border: 0, display: 'block' },
  });
}

/** Commands hand off to native DSH capabilities, preserving drafts and confirmation controls. */
export function workbenchActions(ctx: Context): WorkbenchActions {
  return {
    draft: prompt => {
      const state = ctx.workspaces.list.getSnapshot();
      if (state.phase !== 'ready' || state.state === 'error') throw Error('工作区尚未就绪，请稍后重试或回到 Agent 对话检查连接。');
      if (!state.items.length) throw Error('请先在 Agent 对话中添加工作区，再提交游戏委托。');
      const hasSessions = state.items.some(item => item.sessionIds.length > 0);
      if (!hasSessions && state.items.length > 1) throw Error('请先在 Agent 对话中选择工作区并创建会话，再提交游戏委托。');
      // Native recent-workspace selection needs a Session; the sole first-use
      // Workspace has none. Otherwise defer to native current/recent selection.
      const target = hasSessions ? undefined : state.items[0].workspaceId;
      ctx.uiWorkspace.startSession(target, { prompt });
    },
    conversation: () => ctx.layout.selectPanel(null),
    schedules: () => ctx.layout.selectPanel('schedules' as MainPanelId),
    plugins: () => ctx.layout.selectPanel('plugins' as MainPanelId),
    preview: () => ctx.sidebarRight.openTab(GAMEGUY_TAB_KIND),
  };
}

export function apply(ctx: Context): void {
  const actions = workbenchActions(ctx);
  ctx.effect(() => ctx.slots.inject('main', () => {
    const dispose = ctx.slots.register({ name: 'main', key: GAMEGUY_PANEL_ID, inject: () => ({ actions }) }, GameGuyWorkbench);
    // Only choose the default landing page once; never hijack a later native navigation.
    if (ctx.layout.panelInfo.getSnapshot().activePanelId === null) ctx.layout.selectPanel(GAMEGUY_PANEL_ID);
    return dispose;
  }));
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: GAMEGUY_PANEL_ID, order: -100, label: () => '游戏工作台',
  }, GameGuyMark)));
  ctx.effect(() => ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({
    name: 'sidebar.brand.mark', priority: -100,
  }, GameGuyMark)));
  ctx.effect(() => ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name', priority: -100,
  }, () => createElement('strong', { style: { letterSpacing: '-.5px' } }, 'GameGuy'))));
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: GAMEGUY_TAB_ID, kind: GAMEGUY_TAB_KIND, keepMounted: false,
    title: () => 'GameGuy · 游戏现场',
  }));
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: GAMEGUY_TAB_ID,
  }, GameGuyBody)));
  let revision = -1, running = false, disposed = false;
  const abort = new AbortController();
  const poll = async (): Promise<void> => {
    if (running || disposed) return;
    running = true;
    try {
      const res = await fetch('/gameguy/state', { cache: 'no-store', signal: abort.signal });
      if (!res.ok || disposed) return;
      const navigation = previewNavigation(await res.json());
      if (!navigation || navigation.revision === revision || disposed) return;
      if (navigation.kind === 'browser') ctx.sidebarRight.openTab('browser', { params: { url: navigation.url } });
      else ctx.sidebarRight.openTab(GAMEGUY_TAB_KIND);
      revision = navigation.revision;
    } catch { /* Not mounted or transport unavailable: retry, without fake success. */ }
    finally { running = false; }
  };
  ctx.effect(() => {
    const timer = setInterval(() => { void poll(); }, 2000);
    void poll();
    return () => { disposed = true; abort.abort(); clearInterval(timer); };
  });
}


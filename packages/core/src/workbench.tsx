import { useEffect, useState } from 'react';
import { games, gamePrompt, parseSnapshot, statusLabels, displayTime, type GameGuySnapshot, type GameId, type GameIntent } from './workbench-model.js';
import { workbenchCss } from './workbench-style.js';

export interface WorkbenchActions { draft: (prompt: string) => void; schedules: () => void; plugins: () => void; preview: () => void; conversation: () => void; }
export function GameGuyMark({ size = 28 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect x="1" y="1" width="38" height="38" rx="12" fill="#6ce8be"/><path d="M12 14h16l4 13c.5 3-3 4-5 1l-2-3H15l-2 3c-2 3-5.5 2-5-1l4-13Z" fill="#112923"/><path d="M14 18v6m-3-3h6" stroke="#6ce8be" strokeWidth="2"/><circle cx="25" cy="19" r="1.5" fill="#6ce8be"/><circle cx="28" cy="22" r="1.5" fill="#6ce8be"/></svg>;
}
export function GameArt({ game }: { game: GameId }) {
  return <svg className="gg-art" viewBox="0 0 260 145" fill="none" aria-hidden="true">
    <path d="M0 116H260M0 88H260M0 60H260M30 0V145M72 0V145M114 0V145M156 0V145M198 0V145M240 0V145" stroke="currentColor" opacity=".08"/>
    {game === 'arknights' ? <><path d="m130 18 67 109H63L130 18Z" fill="currentColor" opacity=".08"/><path d="m130 25 59 96H71L130 25Z" stroke="currentColor" strokeWidth="2"/><path d="M107 97v-34l23-14 23 14v34M95 97h70M117 97V72h26v25" stroke="currentColor" strokeWidth="3"/><path d="M20 20h35m-35 6h19M205 114h35m-19 6h19" stroke="currentColor"/></> : game === 'minecraft' ? <><path d="m130 23 51 29-51 30-51-30 51-29Z" fill="currentColor" opacity=".75"/><path d="M79 52v58l51 30V82L79 52Z" fill="currentColor" opacity=".24"/><path d="m130 82 51-30v58l-51 30V82Z" fill="currentColor" opacity=".45"/><path d="m96 62 51-29M113 72l51-29M96 62v58m17-48v58m34-58v58m17-68v58M79 72l51 30 51-30M79 92l51 30 51-30" stroke="#0c2821" opacity=".25"/><path d="m51 94 14-8 14 8-14 8-14-8Zm130-69 17-10 17 10-17 10-17-10Z" stroke="currentColor"/></> : <><ellipse cx="132" cy="77" rx="21" ry="32" fill="currentColor" opacity=".28"/><path d="m112 70-21-16-14-27m77 43 21-16 14-27M121 52l-9-24m30 24 9-24" stroke="currentColor" strokeWidth="3"/><path d="m73 16-12 10 14 20 16-14-6-14m106-2 12 10-14 20-16-14 6-14M117 89l-22 16m22-3-19 15m47-28 22 16m-22-3 19 15M122 106l-8 19h36l-8-19" stroke="currentColor" strokeWidth="3"/><circle cx="124" cy="56" r="3" fill="currentColor"/><circle cx="140" cy="56" r="3" fill="currentColor"/></>}
  </svg>;
}

export function GameGuyWorkbench({ actions }: { actions: WorkbenchActions }) {
  const [state, setState] = useState<GameGuySnapshot>();
  const [error, setError] = useState('');
  const [view, setView] = useState<'home' | 'plugins' | 'history'>('home');
  const [request, setRequest] = useState('');
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    let disposed = false, pending = false;
    const abort = new AbortController();
    const update = async () => {
      if (pending || disposed) return;
      pending = true;
      try {
        const response = await fetch('/gameguy/state', { cache: 'no-store', signal: abort.signal });
        if (!response.ok) throw Error(`GameGuy 状态服务不可用（${response.status}），请检查登录和插件。`);
        const next = parseSnapshot(await response.json());
        if (!disposed) { setState(next); setError(''); }
      } catch (e) { if (!disposed) { setState(undefined); setError(e instanceof Error ? e.message : '无法读取游戏状态'); } }
      finally { pending = false; }
    };
    void update(); const timer = setInterval(() => { void update(); }, 2000);
    return () => { disposed = true; abort.abort(); clearInterval(timer); };
  }, []);
  const prepare = (prompt: string) => {
    try { actions.draft(prompt); setActionError(''); } catch (e) { setActionError(e instanceof Error ? e.message : '无法打开 Agent 对话，请检查工作区后重试。'); }
  };
  const intent = (id: GameId, type: GameIntent, instance?: string) => prepare(gamePrompt(id, type, instance));
  const running = state?.runs.filter(r => r.status === 'running') ?? [];
  const recent = view === 'history' ? state?.runs ?? [] : state?.runs.slice(0, 4) ?? [];
  return <div className="gg-workbench"><style>{workbenchCss}</style>
    <header className="gg-top"><div className="gg-wordmark"><GameGuyMark size={29}/><strong>GameGuy</strong><span>游戏 Agent 工作台</span></div><button className="gg-quiet" onClick={actions.conversation}>回到 Agent 对话 ↗</button></header>
    <div className="gg-layout"><main className="gg-main">
      <nav className="gg-tabs" aria-label="游戏工作台导航">{([['home', '工作台'], ['plugins', '游戏插件'], ['history', '运行记录']] as const).map(([id, label]) => <button key={id} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>{label}</button>)}<button onClick={actions.schedules}>定时委托 ↗</button></nav>
      {(error || actionError) && <p className="gg-alert" role="alert">{error || actionError}</p>}
      {view === 'home' && <section className="gg-hero"><div className="gg-eyebrow"><i/> YOUR NEXT PLAYER IS AN AGENT</div><h1>你来定目标。<br/><span>它来玩游戏。</span></h1><p>收菜、探索，或者认真演一局。用一句话开始，<br className="gg-wide"/>让 Agent 为你配置插件、连接游戏并执行委托。</p>
        <form className="gg-request" onSubmit={e => { e.preventDefault(); if (request.trim()) prepare(request.trim()); }}><label htmlFor="gg-request">今天想让 Agent 做什么？</label><div><input id="gg-request" value={request} onChange={e => setRequest(e.target.value)} placeholder="帮我明日方舟收菜，不吃药、不花源石…" maxLength={4000}/><button type="submit" disabled={!request.trim()}>交给 Agent <span>↗</span></button></div></form><small className="gg-hint">进入真实 Agent 对话后点击发送；不会在后台偷偷启动游戏。</small>
      </section>}
      {view !== 'history' && <section className="gg-games-section"><div className="gg-heading"><div><span className="gg-eyebrow">GAME PLUGINS</span><h2>{view === 'plugins' ? '一个游戏，一个插件。' : '从一个游戏开始'}</h2></div><span className="gg-tag">可信本地目录 · 3 个插件</span></div>
        <div className="gg-games">{games.map(game => { const installed = state?.catalog.find(p => p.id === game.id)?.enabled; const configured = state?.configs.filter(c => c.game === game.id).length ?? 0; return <article className={`gg-game gg-${game.id}`} key={game.id}><div className="gg-game-cover"><span>{game.code} / {game.backend.toUpperCase()}</span><GameArt game={game.id}/><b>{game.name}</b></div><div className="gg-game-body"><div className="gg-game-meta"><span className={`gg-badge ${installed ? 'gg-enabled' : ''}`}>{state ? installed ? '已启用' : '待启用' : '状态未知'}</span><small>{configured ? `${configured} 个实例` : '待对话配置'}</small></div><h3>{game.subtitle}</h3><p>{game.description}</p><div className="gg-tags">{game.tags.map(t => <span key={t}>{t}</span>)}</div><button className="gg-game-action" onClick={() => intent(game.id, 'play')}>{game.action}<span>↗</span></button><div className="gg-game-links"><button onClick={() => intent(game.id, 'configure')}>配置 / 诊断</button><button onClick={() => intent(game.id, 'install')}>检查插件</button></div></div></article>; })}</div>
        {view === 'plugins' && <p className="gg-footnote">当前是随项目交付的可信本地插件包，不是公网市场。<button onClick={actions.plugins}>打开 DSH 底层插件管理 ↗</button></p>}
      </section>}
      {view !== 'history' && <section className="gg-instances"><div className="gg-heading"><h2>我的游戏实例</h2><small>由 Agent 对话配置</small></div>{!state ? <p className="gg-empty">{error ? '状态不可用，未展示缓存结果。' : '正在读取真实实例…'}</p> : !state.configs.length ? <p className="gg-empty">还没有游戏实例。选择游戏，Agent 会检查环境并逐项询问你。</p> : state.configs.map(c => {const device = state.devices.find(d => d.instance === c.id); const active = running.find(r => r.instance === c.id); return <div className="gg-instance" key={c.id}><GameGuyMark size={24}/><div><strong>{c.id}</strong><small>{games.find(g => g.id === c.game)?.name} · {active ? '任务执行中' : device ? `${device.status} · ${device.message}` : '已配置 · 连接待诊断'}</small></div><button onClick={() => intent(c.game, 'preview', c.id)}>查看现场</button><button onClick={() => intent(c.game, 'schedule', c.id)}>每日委托</button></div>;})}</section>}
      <section className="gg-runs"><div className="gg-heading"><div><span className="gg-eyebrow">ACTIVITY</span><h2>运行记录</h2></div>{view !== 'history' && <button className="gg-quiet" onClick={() => setView('history')}>查看全部 →</button>}</div>{!state ? <p className="gg-empty">{error ? '无法读取运行记录。' : '正在读取运行记录…'}</p> : !recent.length ? <p className="gg-empty">暂无运行记录。真实执行发生后，步骤、错误和结果会保存在这里。</p> : recent.map(run => <details className="gg-run" key={run.id}><summary><span className={`gg-run-state gg-state-${run.status}`}>{statusLabels[run.status]}</span><strong>{run.instance}</strong><time>{displayTime(run.startedAt)}</time></summary><p className="gg-footnote">后端已结束不等于奖励已核验；以事件与结果为准。</p>{run.error && <p className="gg-alert">{run.error}</p>}<pre>{JSON.stringify({ result: run.result, events: run.events.slice(-20) }, null, 2)}</pre></details>)}</section>
      <footer className="gg-footer">GameGuy / MVP 0.1 <span>Agent runtime powered by DSH · 不另建 Agent 循环</span></footer>
    </main><aside className="gg-live"><div className="gg-live-heading"><div><i/><strong>游戏现场</strong></div><button aria-label="在原生右侧页签打开游戏现场" onClick={actions.preview}>↗</button></div><iframe title="GameGuy · 工作台游戏现场" src="/gameguy/preview"/><div className="gg-live-note"><span>你始终保有控制权。</span><p>真实画面、步骤和停止入口。登录秘密由你直接输入，设备未连接时不展示模拟画面。</p></div></aside></div>
  </div>;
}

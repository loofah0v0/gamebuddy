import { z } from 'zod';
export const gameIdSchema = z.enum(['arknights', 'minecraft', 'clawclaw']);
export type GameId = z.infer<typeof gameIdSchema>;
const runSchema = z.object({
  id: z.string(), game: gameIdSchema, instance: z.string(), startedAt: z.string(), endedAt: z.string().optional(),
  status: z.enum(['running', 'completed', 'failed', 'stopped', 'interrupted']),
  events: z.array(z.object({ at: z.string(), kind: z.string(), data: z.unknown() })).max(200),
  result: z.unknown().optional(), error: z.string().optional(),
});
const snapshotSchema = z.object({
  catalog: z.array(z.object({ id: gameIdSchema, title: z.string(), enabled: z.boolean() })).max(3),
  configs: z.array(z.object({ id: z.string(), game: gameIdSchema })),
  runs: z.array(runSchema).max(1100),
  devices: z.array(z.object({ instance: z.string(), status: z.string(), message: z.string() })),
  preview: z.object({ revision: z.number().int().nonnegative(), instance: z.string().optional(), game: gameIdSchema.optional(), privacy: z.boolean(), url: z.string().optional() }),
});
export type GameGuySnapshot = z.infer<typeof snapshotSchema>;
/** Do not render malformed wire data as successful plugin/device state. No configuration secrets are projected. */
export function parseSnapshot(value: unknown): GameGuySnapshot { return snapshotSchema.parse(value); }
export const games = [
  { id: 'arknights', name: '明日方舟', backend: 'MAA', code: '01', subtitle: '把每天的琐事交给 Agent', description: '刷理智、基建换班、好友信用与日常领取。按你确认的资源策略执行。', tags: ['日常收菜', '基建', '有限肉鸽'], action: '帮我收菜' },
  { id: 'minecraft', name: 'Minecraft', backend: 'Mineflayer', code: '02', subtitle: '让 Agent 进入你的世界', description: '连接你授权的 Java 服务器，通过协议观察、移动与有限采集。', tags: ['协议控制', '探索', '有限采集'], action: '进入我的世界' },
  { id: 'clawclaw', name: '龙虾杀', backend: 'Official Skill', code: '03', subtitle: '给它一个人设，剩下交给它', description: '复用官方 Skill 和 CLI 参与游戏，在内置网页预览里观看对局。', tags: ['官方 Skill', '社交推理', '观战'], action: '玩一局' },
] as const;
export type GameIntent = 'play' | 'configure' | 'install' | 'schedule' | 'preview';
/** Only prepare a native DSH draft: actions never secretly install, execute, or create schedules. */
export function gamePrompt(game: GameId, intent: GameIntent, instance?: string): string {
  const name = games.find(x => x.id === game)!.name;
  const target = instance ? `使用已配置的 ${name} 实例 ${JSON.stringify(instance)}。` : '';
  const preface = `${target}请使用 GameGuy 的 ${name} 插件和 Skill；缺少插件时从可信本地目录安装/启用。`;
  if (intent === 'install') return `${preface}先检查插件是否可用并说明安装结果，不启动游戏或执行任务。`;
  if (intent === 'configure') return `${preface}检查本机环境，通过对话询问缺少的配置并保存，诊断连接。不运行游戏任务。登录密码、验证码与扫码交给我直接操作。`;
  if (intent === 'preview') return `${preface}打开这个实例的 GameGuy 游戏现场；若 MuMu 未连接，先请求启动确认，不自动开始收菜。`;
  if (intent === 'schedule') return `${preface}帮我设置每天的游戏委托。先询问执行时间、时区、资源策略和最长时长，明确设备需在线及失败处理；复述并经我确认后使用 DSH 的真实 schedule 创建，不能只口头承诺。`;
  if (game === 'arknights') return `${preface}帮我明日方舟收菜。先检查环境并询问配置，连接 MuMu，在右侧显示真实游戏截图。默认不吃药、不花源石、不信用购物；基建方案和刷取关卡先向我确认，最长运行时间也先确认。涉及登录秘密时暂停自动化与截图，让我完成。`;
  if (game === 'minecraft') return `${preface}帮我进入 Minecraft。先询问我授权的服务器地址、账号方式和目标，只操作获授权的世界；先观察，不未经确认破坏或挖掘。`;
  return `${preface}帮我玩一局龙虾杀，先询问人设。通过官方 Skill 操作，开局后在 DSH 内置网页预览展示官方观战页面，不把链接当作默认交付。`;
}
export const statusLabels = { running: '执行中', completed: '后端已结束', failed: '失败', stopped: '已停止', interrupted: '已中断' } as const;
export function displayTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '时间未知';
}

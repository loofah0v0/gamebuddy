# 游戏市场（2026-10-28）

## 玩家体验

GameGuy 是以游戏为核心的通用 Agent，市场是产品页面，不是 DSH 的插件列表改一个标题。

- 原生左侧「游戏市场」打开主工作台市场：游戏卡片、关键词搜索、全部 / 已安装 / 游戏 / 游戏脚本分类。
- 三个游戏包：Minecraft（Mineflayer adapter + Skill）、明日方舟（MAA adapter + Skill）、龙虾杀（官方 Skill + ccl CLI 精确版本依赖）。
- 未安装 → 安装并启用 → 交给 GG → 回到完整原生对话框，带入该游戏的配置草稿。**不会自动发送草稿或立即操作游戏。**
- 启用/停用不仅改变卡片：同时注册/注销后端适配器和原生 DSH Skill。停用保留包文件、已有配置和历史。
- 包描述、版本和安装状态直接显示；环境准备/权限折叠；开发者 JSON 只有主动展开时才挂载。
- DSH 通用插件管理保留在市场底部「通用 Agent 扩展」高级页面；模型、终端、文件、工作区和会话能力不删除。
- 市场停用有活动运行、发现/诊断、待确认操作、龙虾杀前台 stream 的游戏会被阻止，需先停止/接管。

## 来源与明确边界

当前为**内置离线市场**，可信目录为 `D:/Gameguy/product/catalog.json`，包来自 `D:/Gameguy/product/plugins/`。安装是本地完整性验证 + 暂存复制 + 原子发布 + 启用，不是网络下载。界面不显示“下载成功”。

在线注册表、包托管、签名信任根、远程下载/更新、公开第三方上传均未部署；不能将本版当作已上线的互联网商店。后续必须实现 HTTPS 源限制、固定包/清单摘要、限流/容量、无路径逃逸的解包、失败回滚、签名/版本策略后再开放第三方。

插件代码以本机用户权限运行，声明权限是审查/审批信息，不是新的代码隔离沙箱。现有 DSH 权限、游戏审批、资源限制、隐私暂停、设备锁和停止流程保留。停用无法让 Agent 忘掉已经读入上下文的 Skill，也不承诺使任意通用 shell 编写的脚本自动纳入受管理执行。

本轮不搬迁、执行或修改 `D:/Gameguy/scripts/arknights_daily.py` 及 Windows 每日收菜计划。它们仍按现有固定需求运行。

## 统一包合同

可信 catalog 条目：`id`（小写字母开头，字母/数字/连字符，最多64字符）、`version`（固定三段数字）、`kind`、展示元数据、`permissions`、精确 `dependencies`、`manifestSha256`。

manifest API v1：`id / version / apiVersion / kind / entry / permissions / dependencies / files[{path,sha256}]`。

| kind | entry | 安装行为 | 游戏执行方式 |
|---|---|---|---|
| adapter | lib/index.js | 验证 adapter 合同，注册 Engine；同步 Skill | 原有受管理接口、资源验证、锁、取消、回执 |
| skill | skills/&lt;id&gt;/SKILL.md | 只注册 Skill，检查固定依赖；不 import 执行代码 | 原始 CLI / DSH 通用能力；龙虾杀前台 stream 沿用 Monitor |
| script | skills/&lt;id&gt;/SKILL.md | Skill + scripts/ 文件；安装不运行脚本、不运行 npm lifecycle | 按 Skill 经 DSH 工具执行；**没有自动继承 adapter 的资源/停止/日程保障** |

旧 adapter manifest 没有 kind 时仍按 adapter 读取，现有两包版本、配置与数据路径不改变。安装后文件清单、哈希、权限和依赖必须与受信 catalog 一致；拒绝多余文件、路径逃逸和符号链接。依赖不匹配不会偷偷安装任意代码。

启用状态保存在原有 `tasks.json.enabled`；已安装状态在启动时校验磁盘目录，不靠卡片或模型猜测。Skills 通过 `plugins-sync` 注册到 DSH，生命周期同步串行化，失败不报告启用成功。

## 新增游戏脚本包（受信离线目录）

准备源目录，仅含 `skills/<id>/SKILL.md` 与 `scripts/`，以及放在源目录外的描述 JSON：

```json
{
  "id": "my-game-daily",
  "kind": "script",
  "version": "1.0.0",
  "title": "我的日常脚本",
  "description": "用 Skill 说明参数、风险、测试和执行方式。",
  "permissions": ["process:python"],
  "dependencies": {},
  "tags": ["日常"],
  "requirements": ["明确授权的游戏环境"]
}
```

```powershell
cd D:\Gameguy
npm run package:game -- D:\path\descriptor.json D:\path\source D:\path\absent-output
```

生成完整包和旁边的 `.catalog.json` 作者回执。输出目录必须不存在；不执行包内脚本。**代码审查后**将包和条目加入受信发布目录，再由市场安装。不是用户输入任意地址即可执行的上传接口。市场页面、Skill/script 安装层和发现/读取接口不需要为每个脚本写一个分支；adapter 新游戏仍需实现正确的执行合同并审查工具作用域。

打包分发：`npm run pack:plugins` 产生 `D:/Gameguy/artifacts/product-plugins/*.tgz` 和摘要；这些文件尚未上传到在线市场。

## DSH 原生页面适配

`D:/Gameguy/packages/native-client/client.js` 通过正式 `main` 和 `sidebar.panellist` Slot 注册游戏市场，不用 DOM 改字或隐藏按钮。原始 plugin-manager 客户端停用，原有 Host 通用管理能力保留。

`D:/Gameguy/packages/agent-extensions` 是固定 DSH 0.2.1-rc.2 原生管理页的产品级展示适配：构建时在自有输出内改 panel id 并移除它的旧导航注册。上游和 node_modules 文件不写入；旧管理页所有配置/工具继续保留。构建锚点或版本变化即失败，需要重新审查，不能静默套用到新 DSH。

## 验证命令与证据

- `npm run build`：类型与三包清单构建。
- `npm test`：原有回归 + 市场安装/依赖/完整性/启停/失败回滚/脚本包测试。
- `npm run pack:plugins`：真实三包 tgz 与清单/digest核验，无上传。
- `npm run verify:market-ui`：真实 React 组件、隔离假桥，搜索/三包按钮/失败和拒绝/折叠/窄屏等15项；不是实际游戏回执。
- `npm run verify:native-market`：独立临时 userdata 的真实 DSH/Electron 页面与 IPC、真实文件安装/启停、原生对话草稿、高级通用页；对话不发送，真实游戏操作0、外部模型请求0。
- `npm run verify:dock-ui`：原有游戏现场 UI 回归10项。

本轮实际结果以 `D:/Gameguy/artifacts/verification/game-market-ui/report.json` 和 `D:/Gameguy/artifacts/verification/native-game-market/report.json` 为准。完整旧桌面回归与市场专项不是同一个验收；不能用局部通过代替所有基础功能或真人收菜闭环。

### 本轮已取得的证据

构建通过；235项单测（223 JS/TS + 12 Python）通过；真实三包 tgz 校验通过；实际 React 市场15项、原生 DSH/Electron 市场10项、游戏现场回归10项通过。原生市场测试的真实安装发生在隔离临时 userdata，不改变用户启用状态、账号、游戏或每日计划。完整原生回归单独记录，不由市场专项结论覆盖。汇总：`D:/Gameguy/artifacts/verification/game-market-summary.json`。

补充：本轮完整原生桌面回归最终 53 项通过（工作区、同会话切模型、权限、消息、引用、浏览器隔离、文件、终端、通用插件页等；2次请求只发到本地模型夹具）。之前一次超时和脚本选择器问题不作为最终成功证据。市场专题与全量回归两份报告均独立保留。

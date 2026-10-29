> **当前架构入口（2026-10-28）：[GameBuddy README](../README.md)。** 本文保留 2026-10-26 起的历史架构记录；两插件、独立游戏审批、早期测试数量等段落可能过时。当前三包体系、实时权限行为、进程边界、调度和数据目录以 README 及源码为准。

> 2026-10-28 更新：游戏市场统一管理 Minecraft、龙虾杀、明日方舟三个游戏包；龙虾杀仍沿用官方 Skill/ccl，但需要安装启用。每个游戏/游戏脚本版本化；通用 DSH 插件管理保留在高级入口。当前是内置离线市场，在线下载未部署。以 `D:/Gameguy/docs/game-market.md` 为最新设计，早期“两插件/龙虾杀不作为插件”的描述已被本决策覆盖。

# GameGuy v0.3 架构与实现边界

更新时间：2026-10-26。本文描述源码接入，真实游戏与外部生态验收独立记账。

## 1. 独立产品，复用完整 DSH 工作台

```text
GameGuy Electron + native-client 产品适配
 ├─ 主窗口：DSH 原生 web-profile/client/slots 工作台
 │   ├─ 原生会话/模型/权限/问答/计划/文件/终端/插件/轨迹 UI
 │   ├─ GameGuy 品牌、persona、入口和同会话游戏现场
 │   └─ authenticated loopback Host/API → DSH Agent/tools/session
 ├─ 受限 preload / IPC → GameGuy 应用服务
 │   ├─ 原生 session adoption → 游戏中立任务；明确业务工具才绑定游戏
 │   ├─ 插件/配置/实例锁/资源/执行/取消/结果/自有 scheduler
 │   ├─ MAA 插件 → Python MaaCore worker → ADB / 外部 MuMu
 │   ├─ Mineflayer 插件 → 当前进程内执行（独立 worker 待实现）
 │   └─ 官方 Claw Skill / ccl → 原生权限 + 长进程 Monitor
 └─ 主窗口游戏市场内：可信游戏包、设备、日程、临时 API 验证
```

`Start-GameGuy.cmd` / `npm start` 经 `scripts/launch-product.mjs` 启动自有 `packages/desktop/main.mjs`。主 UI 复用原生客户端模块，不是启动原版 Desktop，不要求另开浏览器，也不是把 GameGuy 作为上游插件产品交付。自有 native-client 模块是内部组合方式。

### 1.1 桌面安全与启动

保留 contextIsolation/sandbox/webSecurity，禁用 Node integration。原生 sidebar-browser 使用 MIT 适配的 guest leases、workspace partition；只允许租约内 guest，不附 preload/应用桥，阻止访问应用 Host。可信 IPC 限定主窗口的可信主 frame。原生导出经用户保存对话框；guest 不获应用写入桥。系统浏览器打开过滤 HTTP(S)、控制字符、凭据与应用自身来源。

目录选择、拖入文件路径、fullscreen、theme 和 keyboard/keybindings 与原生客户端协议对接。改写范围见第三方声明，上游源码不修改。

Windows `0x80000003` 修复保留：原源码目录 Low Mandatory Label 导致 Chromium alternate window station ACCESS_DENIED。启动器对 npm Electron 39.2.7 全文件 SHA-256 inventory 校验，在 `%LOCALAPPDATA%/GameGuy/runtimes` 原子创建同字节副本，每次复用再验证；不复制源 ACL、不改系统权限、不升级版本、不用 `--no-sandbox`。开发/QA 不关闭用户应用。

## 2. 原生运行适配与配置所有权

固定 DSH 0.2.1-rc.2。生产主窗口运行 `prepareProfile('web')` / `runProfile(web)`，外部 Node 24 启动私有 authenticated loopback Host；`native-profile.mjs` 只在首次 bootstrap 添加 GameGuy persona、四种原生 Agent 预设及初始模型。随后原生 settings 拥有可编辑 profile，重启不覆盖。部署 overlay 禁用官方账号、session/product telemetry、官方启动器等运营模块，注入 GameGuy 客户端和桌面凭据服务。

原生 workspace-controller 的 documentsDirectory 指向 userdata/workspaces；上游在下方维护默认工作区，用户可创建或选其他路径。游戏和一般任务共用同一个原生会话、工具、loop、权限与上下文，不重新实现一套聊天循环。

native API 转发 create/list/inspect/rename/search/fork/selectModel/modelCatalog/prompt/cancel/page 白名单；实际原生创建/消息被 GameGuyService 收养。合成系统上下文不作为用户消息、不触发游戏绑定。游戏 scope 只约束业务工具；Host 对实例、资源、审批再校验。

### 2.1 主工作台与辅助 SDK 支路

原生客户端完整装配 conversation、model-selection、sidebar/history/workspaces、uploads/references、plan/goal/todo、工具/子 Agent/jobs/trajectory、文件/文档/diff/产物/terminal、plugin-manager/settings/presets、theme/locale/shortcuts 和 question/permission UI。`@gameguy/native-client` 注册品牌、游戏现场及游戏中心入口，不手写替代上述工作台控件。

旧自有聊天/SDK 路径保留供 secondary/回归兼容，不再是生产主工作台。SDK 的维护、切权限、pending/lastUsed 与重启测试保留原合同，不能以其“保存重启”描述 native 设置热更新。已有 SDK 自主 read/write/pwsh/edit 修复、问答/计划/子 Agent 回归证明原生服务链，不替代 native UI 验收或模型智能质量评估。

### 2.2 模型与凭据

原生设置是多 provider/default/catalog 权威；原生选择 API 持久化会话选择，在途请求不变，下一次 assembly 生效。只有 adapter 宣布 reasoning metadata 才提供相应值。原生 settings 在线保存不重启 Host。

原生 credentials 通过主进程 safeStorage vault，串行/原子写、拒绝不合法引用/原型键/过大输入，无明文 fallback。兼容 Key 与 DeepSeek Key 分离，未配置搜索 provider 时准确失败。官方账号/遥测不是通用能力依赖，故意不接。

主窗口游戏市场的临时 API 验证支持目录及小型推理探测，不保存 provider 或修改会话模型；保存请用原生设置。旧恢复界面仍保留兼容快捷路由；其 saveModel 有活动任务 admission、native 默认模型保存与配置更新，快捷 key/profile 两阶段提交及失败回滚。探测独立 POST completions，目录 GET models，不发历史/工具；草稿变化使旧结果失效。原生其它协议未被这份本地 completions QA 自动证明。

### 2.3 权限、游戏画面与边界

原生三档、Windows shell 围栏、单次授权、全局默认与会话 UI 保留。GameGuy 游戏配置/执行/消费/日程 approvals 独立，不因完全访问跳过。文件读取不是秘密隔离，宿主插件/Monitor 不在工具沙箱，自写 shell 无法仅由游戏 schema 保证资源/取消约束。

同 session 游戏现场使用原生 `useTabInfo().tab.visible`，隐藏/收起的已挂载 tab 不采集也不展示观战覆盖层。MAA 截图仅可见、非隐私且已绑定时尝试，间隔至少约 7 秒。异步采集的成功、错误与 finally 都检查 session/task，避免结果污染新会话。这不是视频/原生 MuMu 嵌入或自动视觉控制。Claw 官方网页用隔离容器，按 tab、viewport 与 dock 裁剪；隐藏、隐私或原生模态对话框出现时隐藏覆盖层。Minecraft 为结构化状态。游戏市场发送目标只填原生草稿，不自动调用模型。

隐私暂停先在客户端锁定、清除画面并同步隐藏宿主观战容器，再等待服务停止；应用服务先置私密并递增 capture epoch，串行化隐私变更。采集前后检查 epoch、实例绑定、私密/过渡状态，即使暂停后立即恢复也不接受旧帧；暂停过渡期间新执行（含 schedule）被阻断。无实例通用/Claw 任务同样支持暂停。失败暂停保持私密；恢复失败保持私密，后端已恢复但持久化失败则回滚，回滚不确定报告两项错误且任务仍保持阻断。恢复预览不会重新启动已停止任务。上述仅约束受管理路径，不回收历史资料或封锁其他通用截图工具。

原生模块装配、UI 实际操作和外部实机闭环分别报告，见 [对照](dsh-parity.md) 与 [验证](verification.md)。复杂附件/文档/diff/子 Agent UI、外部 MCP/协议与真实游戏仍需专项。DSH 是 developer preview，锁定版本并回归，不宣称未来自动兼容。

## 3. GameGuy 应用与领域状态

- `packages/app-service/index.mjs`：任务路由、会话/实例绑定、审批、结果、通知、事件唤醒、模型与 schedule 集成。
- `packages/core/src/engine.ts`：游戏适配器注册、配置校验、设备锁、有限 run、取消/清理、隐私与后端事件。
- 数据默认在 `%APPDATA%\GameGuy-v03`，QA 使用独立 `GAMEGUY_TEST_DATA`。DSH 会话和应用状态分开保存，通过 ID 映射关联。
- Store 采用临时文件 + rename、串行写入与失败回滚。执行前状态保存失败不得启动后端；重启将未完成运行标记中断，不自动重放消费。
- 任务绑定控制权；执行、停止、诊断等不接受 Agent 任意指定另一个任务实例。实例/设备锁阻止并发操作，配置指纹与停止 epoch 使旧审批失效。
- 审批默认 5 分钟有效，只绑定当前请求；拒绝、过期、配置变化、停止后不得延迟执行。
- app task 与 backend run 使用不同状态，不用一个状态字段代表 Agent、设备和奖励。后端完成不等于已独立核验所有游戏收益。
- 窗口关闭进入托盘；明确退出会停止 scheduler、模型、Monitor 与后端，并显示未确认的停止结果。停止本地进程不等于官方服务端参与已退出。

游戏工具/审批与资源锁是逻辑约束，不是 OS 沙箱。原生 PowerShell 沙箱只约束其原生执行路径；可信插件、Monitor 和 full-access shell 仍有当前用户权限，不得用于绕过隐私、拒绝授权或游戏资源限制。

## 4. 两个插件 + 一个现成 Skill

`packages/app-service/plugins.mjs` 管理两个可信的 GameGuy 插件：MAA 与 Minecraft。龙虾杀直接引用 `@myclaw163/clawclaw-cli@0.9.1` 附带的官方 Skill（v4.8.116），不复制改造成第三个插件。

构建生成 `product/catalog.json` 和 `product/plugins/<game>/`。安装时检查目录 ID、版本、权限、manifest SHA-256、apiVersion、入口及全部文件 SHA-256；拒绝多余/缺失文件、symlink、路径逃逸和不兼容内容。暂存目录验证后原子迁移；同一安装合并并发请求，既有安装再次校验。

已打包 `@gameguy/plugin-arknights@0.3.4`、`@gameguy/plugin-minecraft@0.3.1`，输出在 `artifacts/product-plugins/`。tarball 是本地交付/完整性检查，不代表 npm 公网发布或远程安装已经完成。

适配器公开 configSchema、planSchema、parseConfig、validatePlan、capabilities.schedule、questions、diagnose、execute 与可选 requestSchema/prepare、setup/设备/预览生命周期；插件管理器验证合同后注册。应用服务不再直接导入 MAA/MC 业务 schema，配置建议、消费校验、诊断、schedule 能力与截图均委托插件。新版目录为 MAA 0.3.4、Minecraft 0.3.1，已有启用标记在下次服务初始化按新目录校验/安装；旧版本目录不覆盖、不删除。当前仍有已知游戏 ID/工具路由，**尚非任意第三方插件 SDK/热升级生态**。远程市场、依赖治理、签名/回滚与公共 PluginDescriptor 版本合同仍需实现。

## 5. Agent 工具范围

GameGuy 业务工具使用严格外层 `{"input":{...}}`，inner schema 由应用服务校验；不是现成 DSH API。**原生工具保持 DSH 原始参数 schema**，例如 pwsh 的 command，而非强套 input。

所有游戏和未绑定任务保留完整 SDK 的原生工具目录，任务页显示实际工具和命令。基础文件/命令工具包括：`pwsh`、`read`、`read_image`、`write`、`edit`、`glob`、`grep`、`working_directory`、`job_list`、`job_output`、`job_kill`、`skill`、`web_fetch`、`web_search`。可见不等于无条件可执行，仍受原生权限/provider/环境约束。read_image 是一般文件图像工具，不是 MAA 设备截图/点击接口；隐私暂停不会自动封锁所有通用文件/截图路径。

| 业务范围（另加以上通用工具） | 工具 |
| --- | --- |
| 基础 5 项 | `gameguy_catalog`、`gameguy_skill`、`gameguy_setup`、`gameguy_status`、`gameguy_stop` |
| 两插件增加 5 项 | `gameguy_install`、`gameguy_prepare`、`gameguy_configure`、`gameguy_diagnose`、`gameguy_run` |
| MAA 再增加 3 项 | `gameguy_device_start`、`gameguy_schedule`、`gameguy_schedule_manage` |
| 龙虾杀增加 2 项 | `gameguy_preview`、`Monitor`（pwsh 属原生通用工具，不再重复计数） |

MAA 13、Minecraft 10、龙虾杀 7、未绑定 5 项业务工具；本轮模型请求捕获到 26 项原生工具，模型总可见数分别 39、36、33、31。另 12 项原生工具为 `ask_user_question/create_goal/exit_plan_mode/get_goal/interrupt_agent/list_agents/send_message/subagent/subagent_fork/todo_write/update_goal/workflow`；数量随实际 SDK/provider 目录变化，以运行时展示和报告为准，不硬编码为产品权限清单。龙虾杀没有包装发言/投票/开局的 gameplay 工具。`run/diagnose/status/stop/device_start` 只用任务已绑定实例。`setup` 调用插件返回完整 schema/默认值/发现证据/建议配置/剩余问题；MAA 用有限注册表/安装根及官方只读 info 自动发现，不扫描所有磁盘。建议不自动写配置，保存仍需审批；默认端口不当连接证据。`prepare` 是可选插件合同：由 Agent/Skill 理解玩家原话，插件纯编译 typed request，返回 proposedConfig/plan/tasks/summary/questions，不保存、不运行。宿主只负责通用调用及任务边界，MAA 语义在明日方舟插件内。Minecraft 当前未实现 prepare，调用明确报不支持。

`status` 仅返回当前任务实例的 devices，包含 confirmation-required/starting/ready/failed/stopped，不含确认 token 或其他任务设备；ready 不表示游戏已登录。

## 6. 后端与预览

### MAA

`packages/plugin-arknights/src/discovery.ts` 是发现实现：25 秒总 deadline/可取消，检查 MAA DLL/resource、ADB、64 位 Python，并用 MuMu `info --vmindex all` 验证实例；唯一实例自动建议，多实例让用户选择。首次未配置时不请求 ADB connect/get-state；已配置时仅检查绑定地址的在线状态/已安装客户端渠道，不启动、不登录。连接配置不以刷关/基建方案为前置。宿主用 setupJobs、停止 epoch、配置指纹、插件身份及隐私检查丢弃过期结果，停止/退出等待后端清理。诊断另持设备控制锁，禁用插件的定时计划跳过。

插件自带 `skills/arknights/SKILL.md` 和 tasks/connection/schedule/official-scripts 渐进式资料，以 MAA v6.20.1 官方集成、CLI 脚本与基建协议为依据。当前插件受管理的执行器不安装 maa-cli，也没有任意脚本导入/执行合同；不宣称全任务脚本导入/variants 条件解释或复杂阵容生成。这不限制 GG 使用原生文件/命令工具自主写脚本、离线测试与修复；自写脚本不会自动继承插件资源/停止/定时边界，真实效果不能借此绕过审批。

Python ctypes worker 调用 MaaCore，通过有界 NDJSON 回报任务/错误；没有确认回执、异常、输出不完整不能报成功。取消先请求 stop，超时终止 worker。普通自动换班使用 Infrast mode=0，无需文件；自定义 mode=10000 使用已有授权文件，worker 在加载 MaaCore/连接前校验所选方案无人机策略，复制精确字节到临时文件，正常/异常退出清理，强杀不保证清理。普通药/刷取次数受保存的上限限制；临期药关闭（medicine_expire_days=0，旧 expiringMedicineLimit 仅兼容，不授权执行），源石固定 0；付费、抽卡、任意 Custom/SingleStep 未开放。

MuMu 启动仅接受本机绝对 `mumu-cli.exe` 路径及实例索引。审批后官方 info → 必要时 launch → 官方 ADB connect → 选定实际端点 → 项目 ADB 验证；120 秒 deadline，不猜端口，不用其他在线设备代替。地址保存后才 ready；ready 不证明游戏登录。停止不自动关闭 MuMu。日程当前要求设备已在线，不支持无人值守代确认启动。

右侧使用 ADB PNG，状态轮询约 2 秒，截图采集尝试至少间隔约 7 秒；异步返回再次检查隐私/任务绑定，失败与陈旧画面有提示。没有原生窗口嵌入、视频推流或 MAA 专用 Agent 设备看图/点击接口；通用 read_image 不等于已接设备控制。登录秘密输入前停止并开启隐私暂停，结束后由用户确认恢复。

### Minecraft

授权私人 Java offline-mode 服务器；观察、goto、限量 dig。默认禁止挖掘；pathfinder 自动挖掘/搭桥/跑酷关闭。每次运行创建并清理 bot，结构化状态供用户观看。TCP 诊断不是游戏登录成功；合成、装备、石镐目标以及独立 worker 待实现。

### 龙虾杀

原始 Skill + ccl。Monitor 管理原始 start/join 前台长进程，直接参数启动、限时、单账号流、拒绝 shell 拼接与 `--force`。事件标准化后先持久化再 steer，重复与终局唤醒受控；游戏聊天/网页/事件是非可信数据。

观战仅允许 HTTPS `myclaw.163.com` 或其子域，不允许用户凭据/显式端口。Electron 独立 WebContentsView 加载官方页，不授予本机 IPC、Node 或设备权限；阻止非官方导航。观战内容仅供人观看，不进入 Agent 视野。真实对局、截止时序、断线/退出确认尚待验收。

## 7. 自有持久化 scheduler

`packages/scheduler/index.mjs` 保存每日 HH:mm + IANA 时区、任务/实例、计划、配置指纹、maxSeconds、启用状态、nextRun 与执行记录。创建/更新/恢复需审批；无需每次到点启动模型理解同一个模板。

- 1 秒 tick，触发槽由调度器生成，不靠模型生成日期；以计划 ID + 时区 + 本地日期分钟去重。
- 每次先持久化 claim 再执行，保存最多 2000 条触发历史。重启后的 claimed/started 标记 interrupted，不重试已可能消费的流程。
- 超过 60 秒迟到跳过；重启漏跑默认 skipped-offline，排下一次；忙碌/配置变化跳过，不积压。
- 时区/DST 与重复小时有测试；不承诺无限期 exactly-once、系统唤醒或云端代跑。
- 服务、电脑、设备、游戏登录必须可用；关闭预览/窗口不停止服务，退出应用停止。

## 8. 发布前缺口

安装器与托管运行时、远程可信市场/升级、任意第三方插件协议、MAA 安装治理/基建生成、MC 合成与 worker、真实 Claw/MAA/MC 联调与结果证据、漏洞处理及许可证审查。PRD P0 验收要求不因当前原型实现而降低。

# GameGuy v0.3 验证记录与实机验收

更新时间：2026-10-26。当前对象是 **GameGuy 自有 Electron + DSH 原生 web/base 工作台 + 自有游戏服务**，不是原版 DSH Desktop 插件模式。自动化报告、合成夹具与真实游戏验收分开记账；下列通过项不代表全量 MVP 已验收。

## 1. 本轮复验

主工作台现使用原生客户端。`verify:native-desktop` 的最新状态、已通过检查点与失败详情以 `artifacts/verification/native-desktop/report.json` 为准，不把模块接入等同全量外部生态验收。此前 SDK/辅助 UI 报告保留合同回归，不用它们替代新主窗口验收。


| 命令/检查 | 结果 | 证据与边界 |
| --- | --- | --- |
| `npm.cmd run verify:native-desktop` | 36 项通过，退出码 0 | 隔离 Electron 原生 UI、两次本地 A/B 流式请求、会话/设置/插件/右栏、真实文件预览/终端输出与隐私按钮操作；零真实模型与游戏动作。报告与截图见下文 |
| `npm.cmd run build` | 通过 | TypeScript 与独立产品/两个插件构建；不是游戏成功 |
| `npm.cmd run typecheck` | 通过 | TypeScript 项目类型检查 |
| `npm.cmd test` | 174 JS/TS + 12 Python 通过，0 失败/跳过/取消 | prepare、engine、emulator、discovery、process、product、runtime-agent、model-api、model-selection 与文件型 worker 测试；没有真实账号参与 |
| `npm.cmd run verify:session-model` | runtime 20 + desktop 21 项通过 | `artifacts/verification/session-model-runtime-v03.json`、`session-model-desktop-v03.json`；真实原生会话/HTTP 与隔离 Electron，零真实模型/游戏操作 |
| `npm.cmd run verify:agent` | 45 项通过 | `artifacts/verification/product-agent-v03.json`：完整 SDK + 24 次确定性本地模型请求，实际脚本写入/失败测试/编辑修复/重测、原生问答/计划/子 Agent/取消/恢复；无真实游戏效果 |
| `npm.cmd run verify:permissions` | 37 项通过 | `artifacts/verification/product-permissions-v03.json`：实际原生工具与 Windows restricted-token/ACL runner；37 个本地模型请求、4 次显式提权请求 |
| `npm.cmd run verify:product` | 通过 | `artifacts/verification/product-runtime-v03.json`：实际 DSH 0.2.1-rc.2 对本地 SSE 模型夹具，8 个模型请求、1 次宿主工具调用，真实游戏动作 0 |
| `npm.cmd run verify:desktop` | 24 项通过，退出码 0 | `product-desktop-v03.json` 与 `product-desktop-latest-attempt.json`：实际 Electron UI/preload/IPC，包含 8 项权限点击检查 |
| `npm.cmd run verify:model` | 53 个检查点通过，退出码 0 | `product-model-url-v03.json` 与 latest-attempt：initial + restart，19 次 loopback 请求；不使用真实模型 Key |
| `npm.cmd run pack:plugins` | 两包重新打包、核验通过 | `artifacts/product-plugins/manifest.json` 与 `checksums.json`；MAA 0.3.4、Minecraft 0.3.1，无第三个龙虾杀插件 |
| `npm.cmd run verify:discovery` | 本机只读发现通过 | `product-discovery-v03.json`：已验证包中的 MAA 插件找到依赖与 MuMu 实例；未启动设备/连接/写配置 |
| `npm.cmd run verify:onboarding` | 对话配置链路通过 | `product-onboarding-v03.json`：实际 DSH + 已验证 MAA 插件包 + 本地模型/环境夹具，6 次请求、5 次工具调用；不是外部模型推理或真实收菜 |
| `npm.cmd run verify:maa-skill` | 官方 Skill/需求配置链路通过 | `product-maa-skill-v03.json`：实际 DSH + 打包插件编译器，9 次本地模型请求、8 次工具调用；组合任务提案、审批保存且无游戏/设备/日程副作用 |
| 根工作区 npm 安全审计记录 | 13 moderate、192 high、0 critical，共 205 项 | `artifacts/verification/npm-audit-v03.json`；发行阻塞项，不执行强制升级或将零 critical 等同安全 |

报告的 `date/status/scope` 为具体检查依据；本轮重新运行成功后，当前主报告及 latest-attempt 均记录新通过结果，不沿用历史通过记录代替复验。先前 `0x80000003` 的 crash dump 与诊断材料保留。

启动崩溃已定位：项目目录及其中 Electron 可执行文件继承了 Windows Low Mandatory Label，Chromium 创建沙箱隔离 window station 时返回 ACCESS_DENIED（result 12）并触发 int3。正式启动器与桌面 QA 现在将 npm 已安装的 Electron 39.2.7 原始文件按完整 SHA-256 inventory 验证后，原子复制到 `%LOCALAPPDATA%/GameGuy/runtimes/`，每次启动再次校验；不复制原目录的 ACL/mandatory label。没有禁用 sandbox、变更系统 ACL、升级 Electron 或关闭现有应用。新增权限 UI 已通过实际 Electron 自动化操作与截图生成检查（不是本轮人工点击或视觉验收）；现有用户进程不热重启，下次正常启动加载修改。

没有创建真实每日收菜计划，没有登录游戏，没有消耗理智、药品或信用。



### DSH 链路

独立应用的运行适配层通过 `runProfile(sdk)` 启动真实 DSH，验证会话创建、模型 → 工具 → 自有宿主 → 模型 → UI 事件，以及重启/恢复后的模型请求。不是仅检查 mock adapter，也不是另写 Agent loop 后声称基于 DSH。

捕获实际模型请求中的工具清单：每种游戏和未绑定任务都保留 **26 项原生工具**：`pwsh/read/read_image/write/edit/glob/grep/working_directory/job_list/job_output/job_kill/skill/web_fetch/web_search/ask_user_question/create_goal/exit_plan_mode/get_goal/interrupt_agent/list_agents/send_message/subagent/subagent_fork/todo_write/update_goal/workflow`。业务工具分别为 MAA 13 项、Minecraft 10 项、龙虾杀 7 项、未绑定任务 5 项，总数 **39/36/33/31**；数量为本轮捕获，不作为固定版本外的永久清单。龙虾杀业务项是宿主生命周期/预览等，不包装 speak/vote 玩法。绑定/重绑定和恢复只 deny 其他游戏业务工具，不隐藏原生能力。此本地协议夹具不证明真实提供商认证、推理质量或游戏截止延迟。

### 完整 Agent 与自主修复链路（45 项通过）

`verify:agent` 启动真实完整 DSH SDK，并检查 agents/tools/sessions/fs/shell/jobs/skills/commands/subagents/userQuestions/planMode/goals/sessionPersistence 服务。使用随机隔离目录，模型侧是本地确定性 OpenAI SSE 夹具。

- 原生 read/write/pwsh 生成并运行离线合成 MAA callback parser，真实 Node assert 首次失败；原生 edit 修正累加错误，再次运行输出 `GG_AGENT_REPAIR_OK:6`，实际文件与 todo 完成状态同时核验。
- `/goal` 查询和未知 slash 不发送给模型；bare `/plan` 进入原生计划模式，审阅 skip 保持计划模式、approve 退出，`/plan off` 正确退出。计划批准不替代业务审批。
- 原生 ask_user_question 往返、取消时 abort；真实子 Agent 的文件读写成功，子 Agent 游戏业务调用在进入宿主前拒绝，工具/child 生命周期正确归属。
- 运行时关闭后会话恢复成功；24 次本地夹具请求，未请求额外原生提权，也未调用真实游戏宿主。

此测试证明真实工具/反馈/修复执行链、交互桥与完整内核接通。它不证明真实模型能自主决定这些步骤、真实收基建成功、任意生成代码已接入受管理游戏执行器，或全部 DSH Desktop/provider 功能已适配。

### 原生 DSH 权限实测（本轮通过）

真实 DSH 原生三档为 `read-only`（ask）、`workspace-write`（ask，默认）和 `danger-full-access`（never）；不是另写一个审批/文件系统实现。37 项检查覆盖：

- 原生 catalog 与默认值，实际 read/write/edit/glob/grep；read-only 普通写拒绝，workspace 内写成功、外部写拒绝。
- 实际原生 PowerShell Windows restricted-token/ACL runner：read-only 阻止修改；workspace 内写成功、外部写被围栏阻止。没有将沙箱替换为模拟实现或关闭 OS 限制。
- 四次显式提权请求，包括单次 full/workspace 批准、拒绝与取消；批准仅执行该次，常驻档位不变，之后普通越界写仍拒绝。
- full 模式外部文件写与固定 `Write-Output` 成功，无逐命令提权审批；invalid 档位不改变已有设置。
- `agent.runMaintenance` 在运行中拒绝切档；重绑定、独立 runtime 重启和会话恢复保留原生权限。
- compatible 模型路由无搜索 provider 时 `web_search` 准确失败，不把兼容服务 Key 交给 DeepSeek 搜索。

夹具只写随机测试目录并在 finally 校验绝对路径后清理；37 个模型请求全部发往本地 SSE 服务，零真实模型/游戏动作。独立宿主游戏审批与资源策略不是这三档的替代项；只读也不会自动禁止宿主游戏任务。文件读取不受工作区写围栏限定，这不是凭据隔离。

### 独立桌面（本轮 24 项通过）

本轮重新执行的 16 项基础检查覆盖自有标题、sandbox/contextIsolation/noNode、受限 preload、三栏 UI 与三个目标入口、两个插件 + 官方 Skill、设备页的外部 MuMu/ADB 说明、自有模型设置和 password 字段、无默认 schedule、卡片只填草稿、无 Key 任务持久化/提示配置且不运行游戏、预览收起/恢复/键盘调整、1080×720 无横向溢出、无 renderer 控制台错误。

截图在 `artifacts/verification/desktop-v03/`：`home.png`、`plugins.png`、`schedules.png`、`model-settings.png`、`task-without-model.png`、`home-1080.png`。截图是本轮隔离测试状态，不是用户账号或实机游戏画面。另含 `permissions-read-only.png` 和 `permissions-full-access.png`。本轮实际运行 Electron renderer/preload/IPC 自动化操作，不是人工 computer-use 点击或视觉验收；历史视觉检查不计入本轮。

本轮另执行并通过 8 项权限检查（共 24 项）：三档控件/默认工作区、切只读、full 风险确认取消与批准、界面/宿主一致、无效及运行中切档拒绝、停止后的切档不复活任务。真实 preload 文件的 `node:vm` 测试与实际 Electron renderer/preload/IPC 自动化检查分开覆盖。

### URL 添加模型（本轮 53 个检查点通过）

本轮专用 `verify:model` 经过真实桌面表单 → preload/IPC → 加密存储 → DSH SDK → loopback HTTP/SSE 服务 → 聊天回复，而不是只测保存按钮。两个独立 Electron 进程共享自建隔离 userdata，检查 46 + 7 个阶段检查点（无游戏副作用检查在两阶段各一次）。

- 未填 Key 在本地失败，不发请求；空模型 ID 可以获取目录；下拉去重、过滤服务端反射的 fixture Key，选择后同步 ID。
- “验证 API”执行一次真实非流式文本请求；成功仅标记当前草稿。两类探测均不落盘、不重启 DSH、不创建任务；同路由可用已存加密 Key，而表单仍为空。
- 修改模型/地址使旧验证失效；重复验证同一草稿再次 401 不沿用旧成功；之后显式成功才恢复通过状态。空目录、404、重定向有手填回退，慢返回不能污染变更后的地址。
- 验证通过与未验证的保存提示明确区分；1080×720 无横向溢出、滚动可达保存、关闭入口保持可见。
- 规范化 URL/model ID，保存提示“尚未验证 API”，保存后清空 password 字段；model.json 与加密文件无明文 fixture Key。
- 拒绝无效地址、远程 HTTP、URL 凭据、query/hash、完整 chat/completions 与 models 地址，配置与凭据文件不变；单测同时覆盖空 query/hash 和内部控制字符。
- 等价规范 URL 的空 Key 保存保留旧值；改 API 路由不复用原值，显式重新填入才可请求。
- 实际 `POST /v1/chat/completions` 及自定义前缀 `/custom/v1/chat/completions`，校验模型 ID、Bearer 认证和 stream；故意 401 必须标记任务失败并隐藏错误体中的 Key。
- 退出自建进程后独立重启，恢复 URL/model ID、解密 Key，但表单不显示密钥；再次实际请求并获得回复。

19 次 loopback 请求分为：7 次模型目录、7 次非流式推理探测（含两次预期认证失败）、5 次真实 DSH 流式请求；后者标签为 first、retained、unauthorized、custom、restart。截图在 `artifacts/verification/model-url-v03/`：draft-api-validated.png、model-settings-1080.png、initial.png、restart.png；本轮重新生成；先前视觉检查记录不计作本轮人工验收。测试 Key 是固定无效测试串，自建服务不联网转发；用户真实配置未读写，零真实模型请求、游戏操作与每日计划。此证据不证明任一外部服务商的网络/认证/模型兼容性；目录和一次文本验证不证明工具调用、视觉或全部 API 协议。

### 会话内切模型与 DSH 设计复核（本轮通过）

以固定上游 commit `687f282e8625c6b8d11ff58211a90524be2e4317` 的客户端、session-controller、model-selection 与架构文档为依据。服务、Host、客户端三层分开记账；对照表见 [dsh-parity.md](dsh-parity.md)，该文档明确列出未完成项，不是“所有 DSH 功能通过”的报告。

`verify:session-model` 的 runtime 20 项 / 6 次本地请求验证：并发 ensure 唯一会话、原生目录、未知模型/未公布 effort 拒绝、A→B 保留内核历史与切换归因、其他会话默认值不变、在途 B 与新 pending A 分离、重启恢复 pending、端点变更保留选择且阻断静默重路由、明确重选保留历史。

实际 Electron 21 项（initial 15 + restart 6）/ 3 次本地请求验证：composer/provider 分组、刷新、`/model` 同入口且不发聊天回合、A→B→重启 A 的真实请求 payload、停止任务不复活、新草稿默认值不变、异步导航/返回与失败刷新/恢复、1080×720、无 renderer 控制台错误。截图 `artifacts/verification/session-model-desktop-v03/initial.png` 与 `restart.png`。仅测试夹具模型，不声称人工点击、全部上游 popup 交互或真实模型兼容性。

本轮 URL 回归同时验证快速更改端点、清空旧 Key、重新保存新 Key 后实际请求：设置页抑制新的后台目录读取，并等待本 UI 已发出的读取完成；Host 并发/活动任务保护不放宽。旧测试还增加了有效地址保存失败的即时断言，避免把未保存错误掩盖成聊天超时。

### 启动与恢复页面

`npm run verify:startup` 在隔离用户目录中验证：启动先显示简洁状态页而非旧界面；主工作台加载失败时显示错误、重试和模型连接恢复；初始化失败时可安全退出且不覆盖损坏的数据。工作台重试和模型配置恢复使用本地夹具，不访问真实模型、游戏或计划任务。旧 UI 仅由显式兼容测试调用。

### 原生主工作台（本轮 36 项通过）

2026-10-26 17:17:38–17:18:02（北京时间；报告以 UTC 记录）的 `verify:native-desktop` 使用隔离 userdata 与 QA 自有 Electron。报告为 `artifacts/verification/native-desktop/report.json`，退出码 0；精确两次 loopback 推理请求，分别使用 fixture-a / fixture-b，renderer 错误 0。没有读取真实 Key、调用外部模型、登录游戏、执行游戏任务或创建日程；没有关闭用户已有应用。

- 原生流式文本在完成前出现，Markdown 代码块实际渲染；同会话 composer A→B 的第二次请求 payload 为 B，不清历史。通用会话不被合成上下文绑到游戏，合成上下文不显示为用户消息；游戏现场使用同一原生 session。
- 原生会话搜索、重命名、置顶/取消、fork、归档/撤销归档实际操作与状态核验；fork 不产生推理。四种 Agent 预设、运行 Host 的原生插件库存、主题/权限默认设置与快捷键编辑入口均检查。
- 同 Host 上创建第二 provider、取模型目录、与原 provider 并存、编辑保存及磁盘加密 Key 检查通过。此轮仅验证 completions，不证明外部认证、responses/Anthropic 或主工作台重启后的全部配置恢复。
- `/` 命令和 `@` 文件/Skill/会话 picker 可打开，附件控件存在；**没有把控件存在当成真实附件上传/拖放验收**。
- 原生浏览器实际加载本地 X-Frame-Options:DENY 页；guest 无 Node/GameGuy/DSH 桥，拒绝应用 Host 来源。外部网站登录、下载和复杂导航仍属专项。
- QA 在已核验隔离 workspace 内写入 `native-qa.txt`，文件树列出该文件，点击后原生预览实际显示 `GAMEGUY_NATIVE_FILE_PREVIEW_OK`；终端实际执行无害 cmd 命令并显示展开后的 `GG_NATIVE_TERMINAL_Windows_NT`，不是只匹配输入回显。
- 游戏现场读取原生 tab 可见性；实际点击无游戏实例会话的「隐私暂停」，任务停止/私密、手动采集禁用且无图片；「恢复预览」不会复活停止任务。隐藏页/官方观战覆盖层与在途截图的失效逻辑另由代码/单测覆盖，不冒充真实游戏隐私实测。

截图位于 `artifacts/verification/native-desktop/`：`game-dock.png`、`privacy-paused.png`、`files.png`、`file-preview.png`、`terminal-output.png` 等。本轮已视觉检查游戏现场、隐私暂停和真实文件预览截图；自动化点击不是人工操作真实游戏。复杂文档/diff、附件二进制、外部 MCP、jobs/子 Agent 的完整 UI 和三游戏真实任务仍需专项验收。

### 插件包

重新打包的 MAA 0.3.4 包 27 个条目；Minecraft 0.3.1 包 9 个条目。核验可信 manifest、全部文件 inventory、版本/权限/入口、SHA-1/SHA-512/SHA-256 和包文件白名单。当前是本地可信包安装及 tarball 检查，不是公网发布、下载、升级或依赖安装闭环。包不含 MAA 二进制、模拟器、node_modules、账号、设备截图或运行凭据。

### MAA 插件自动发现与对话配置

`verify:discovery` 通过已校验的 MAA 插件包在本机只读发现：MAA `D:/Gameguy/external/maa`、ADB `D:/Gameguy/external/platform-tools/adb.exe`、Python 3.12 的实际可执行文件、MuMu `D:/MuMuPlayer/nx_main/mumu-cli.exe` 和唯一实例 0（MuMu安卓设备）。本次观察时实例未启动，`dependenciesReady=true`，但 `deviceOnline/addressVerified/ready=false`，需要审批启动；默认端口不是已连接证据。当前只需询问官服还是 B服，不要求用户寻找 CLI 路径，也不以刷关/基建计划作为连接前提。该报告是带时间戳的观察，不是永久在线状态。

`verify:onboarding` 验证实际 DSH → 安装审批 → 原插件 Skill → 插件 setup/schema → 配置审批 → 保存并绑定 → Agent status 的信息流。6 次模型请求、5 次工具调用全部来自本地可控模型/环境夹具；没有配置审批前写入、设备启动、登录、游戏动作或 schedule。模型响应是确定性夹具，不证明外部模型的自主决策质量。

应用服务不再直接导入游戏业务 schema，配置/任务校验、资源策略、setup、诊断和 schedule 能力由已注册插件提供。MAA 插件负责有界安装发现与官方 MuMu 信息查询，支持取消、配置/隐私变化隔离；宿主保留可信包安装、审批、任务和设备生命周期。仍有已知插件 ID/工具路由，不宣称任意第三方插件生态已经完成。异步设备启动后，Agent status 只返回本任务绑定实例的 starting/ready/failed/stopped 状态，不泄露其他任务设备或确认 token；ready 不证明游戏登录或 MAA 就绪。

## 2. 174 项 JS/TS + 12 项 Python 自动测试覆盖

- 实例 ID/快照隔离、设备互斥、停止等待清理、历史不可变、重启中断、不自动重放消费；持久化失败不执行。
- 配置过渡锁/回滚、隐私暂停、在途截图丢弃、地址别名与旧隐私键归一化。新增 8 项隐私回归覆盖无实例暂停/恢复、stop 未完成即阻断采集与执行（含 schedule）、重叠恢复拒绝、失败暂停保持私密、跨暂停/恢复和实例重绑的陈旧帧丢弃、后端恢复失败、持久化失败的后端回滚及回滚不确定时保持阻断。
- MuMu 指定程序/实例校验、官方结构化响应、实际端点解析、启动/取消/deadline、旧/新设备归属、地址保存失败回滚；使用模拟适配器，不启动真实 MuMu。
- 子进程无 shell 参数执行、非零退出/缺程序/deadline/取消/输出预算。
- 独立应用无密钥安全启动、游戏业务工具范围/绑定（通用工具保留）、严格 schema、拒绝审批不执行、事件先持久化再通知、配置变化/停止撤销旧审批。
- 原生三档装配与 fail-closed 服务检查；权限切档 admission/并发锁、运行与审批中拒绝、停止任务不复活、保存失败反映真实原生状态、取消及晚批准无效；实际 preload 文件通过 VM 验证 permission 转发、冻结 bridge、错误传播和未知 action 拒绝。
- URL/model ID 规范化、不安全与方法地址拒绝、无效 URL 不变更内核/配置、保存与连通验证区分、持久化失败回滚；模型更新失败回滚且不写明文 Key；通知脱敏、官方观战 URL 校验、Monitor 审批/取消与命令约束。
- 7 项新增会话模型测试：schema/route/请求 projection、原生选择不重启不复活、全局更新/权限互斥、序列化失败释放、全局更新不能修改并发用户历史。
- 18 项 model-api 单测：目录解析/去重/预算/反射凭据过滤、最小推理 payload/有效文本、无 Key/不安全 URL 拒绝、HTTP/网络错误脱敏、响应/超时限制与同路由 Key 隔离。
- 两个插件原子安装/并发合并、manifest/文件/权限/版本校验、Skill 路径逃逸、卸载失败不能假报启用。
- 插件专有 schema/策略委托、有界自动发现、单实例自动选择/多实例询问、取消与 deadline、资源策略保留；setup 配置审批前不写入，停止等待清理，隐私/配置变化丢弃旧结果，待配置期间阻止模型/权限/插件变更。
- 诊断持有设备控制锁且可取消，禁用插件的计划跳过；Agent status 覆盖本任务设备就绪、失败与停止，不包含其他实例或确认 token。
- 新增 14 项纯需求编译测试、4 项服务/包合同测试、8 项 Python 文件测试：普通/自定义换班、邮件独立领取、组合需求、缺失字段阻断部分执行、当前请求不继承用药授权、资源上限变更提案、临期药/严格折扣拒绝、custom 无人机验证与快照/清理/大小/BOM/重复键。
- 原生 Agent persona、活跃子 Agent ownership/cycle、问题与 plan-review 校验；问答生命周期/skip/晚回答/取消，slash raw dispatch、idle 能力刷新与 child 状态隔离。
- MAA 消耗/购物/源石/肉鸽上限策略；scheduler 时区/DST、触发前 claim、重复小时/并发 tick 去重、错过/离线/冲突跳过、重启中断和保存失败回滚。

不覆盖完整真实游戏回调/奖励独立核验、完整 MC 世界采集/合成、Claw 真实对局、远端退出与长期无人值守可靠性。

## 3. 历史资料（不作为 v0.3 产品验收）

- v0.2 的 71 项测试、原生 DSH smoke、`native-browser.json`、`preview-fixtures.json` 及 `dsh-native-*.png` 是**旧插件模式**检查；保留历史，不计入当前独立桌面通过项。
- `runtime-fixtures.json` 曾记录 MaaCore 6.20.1 实际 DLL/ABI/资源初始化（没有设备连接/任务），Mineflayer 登录本机 Java 1.8.9 协议测试服并观察/停止/断连；不是用户真实 Minecraft 世界，不证明移动/挖掘/合成路线。
- `mumu-installation-status.json` 记录 2026-10-22 用户卸载 F 盘旧安装、重装至 `D:\MuMuPlayer`、版本 6.8.7.0/Android 15 实例 0。**当时**实例未启动/ADB 列表为空，不是当前实时状态。官方 CLI help/info 已只读核验；本轮未启动真实模拟器。
- 旧模式归档位于 `legacy/dsh-plugin-v0.2/`；`legacy:*` 命令只用于历史诊断，不是当前启动/配置必经路径。不要启动或停止用户已有的原版 DSH 服务来做本轮验证。

## 4. 复现

首次安装按 README 用 `npm.cmd ci`，不要禁用 Electron 安装脚本。已有环境：

```powershell
Set-Location D:\Gameguy
npm.cmd run build
npm.cmd run typecheck
npm.cmd test
npm.cmd run pack:plugins
npm.cmd run verify:native-desktop
npm.cmd run verify:permissions
npm.cmd run verify:agent
npm.cmd run verify:product
npm.cmd run verify:desktop
npm.cmd run verify:model
npm.cmd run verify:session-model
npm.cmd run verify:discovery
npm.cmd run verify:onboarding
npm.cmd run verify:maa-skill
```

需要外部 Node 24+；MAA worker 需要 Python 3.12+。正式启动与 Desktop QA 均使用项目 Electron 的已验证用户本地运行时副本，版本/文件字节不变，不依赖原版 DSH Desktop、18765 服务、外部 Edge/Playwright 或用户浏览器登录态。QA 只管理自建进程、隔离目录和本地模型夹具。真实模型配置/账号/游戏资源验收另行进行。

## 5. PRD P0 对照与未完成项

| 能力 | 当前实现/自动验证 | 仍需完成 |
| --- | --- | --- |
| 独立产品入口 | 自有 Electron/品牌/桌面桥、原生主工作台与主窗口游戏市场；启动修复与隔离原生 UI 检查 | 安装器/托管运行时/异常与升级支持矩阵的发布级验收 |
| DSH 客户端基础 | 固定版原生客户端整体接入：流式/Markdown、模型、多 provider、会话、工作区/文件/终端/产物、附件/引用、子 Agent/jobs、通用 Skill/插件/MCP 与四预设；已实测范围见原生报告 | 外部协议/认证、二进制附件/拖放、复杂产物/diff、跨工作区与 jobs/MCP 专项；详见 dsh-parity.md |
| 原生权限与通用工具 | 完整 sdk、当前 26 项原生工具、DSH 三档、Windows shell 围栏/单次授权，以及自主修复/问答/计划/子 Agent 实测通过，桌面切档经实际 Electron 自动化检查 | 主窗口已有原生全局默认与会话级设置；复杂审批交互继续专项回归 |
| 可信按需插件 | MAA 0.3.4 / Minecraft 0.3.1 本地包、审批、完整性/原子安装、插件业务 schema/能力委托通过 | 远程目录/下载、升级/回滚、后端依赖安装治理、任意第三方插件 SDK/生态 |
| 龙虾杀 | 原 Skill/ccl、Monitor 事件持久化/唤醒、隔离观战容器 | 真实一局、恢复/跨局、延迟、官网观战与远端正式 quit 确认 |
| Minecraft | observe/goto/有限授权 dig、结构化状态与停止 | craft/equip、采木/石镐路径、独立 worker、真实世界结果 |
| 明日方舟 | 插件专用自动发现、插件业务 schema/策略与宿主解耦、对话配置链路及任务设备状态通过；官方脚本 Skill、纯需求编译、普通/自定义换班、五类 schema、Python worker、审批启动与 ADB 预览路径 | 实机画面/客户端登录、五类真实冒烟/奖励核验、基建方案生成 |
| 每日计划 | 自有持久化 scheduler、时区/DST/去重/漏跑/互斥/配置指纹通过 | 授权实机定时验证、维护/登录失效/长期稳定性；当前设备必须已在线 |

上述缺口没有从 PRD 中删除。当前不宣称完整 MVP、一次真实收菜成功或生产可用。

## 6. 首次明日方舟安全实机验收

1. 在 GameGuy 模型设置中配置实际模型，Key 不进聊天。对话“帮我连接明日方舟”触发可信插件安装/启用与自动发现；检查现有 MuMu，不再下载或重装，不要求手填 CLI 路径。确认插件发现的实例及渠道，多实例时才询问选择。
2. 通过对话保存设备配置，审批 `gameguy_device_start`。等待官方 CLI 实际 connect 与项目 ADB 核验，禁止把默认 `127.0.0.1:16384` 当连接证据。ready 不代表游戏登录或 MAA 就绪。
3. 用户安装匹配渠道的官方客户端。先停止自动任务并隐私暂停，用户自行输入密码/验证码/扫码/实名信息；确认结束后再恢复。当前无 MAA 专用 Agent 设备看图/点按接口，通用 `read_image` 读取文件不等于已接设备控制，不宣称自动登录。
4. 连接诊断并在右侧核验真实非敏感游戏画面；这是外部 MuMu + ADB 截图，不是 Windows 窗口嵌入。状态约 2 秒轮询；主工作台仅可见且非隐私时尝试截图，至少间隔约 7 秒，实际时间受设备耗时影响。
5. 对话确认渠道、实例、任务、换班模式和资源上限。先审批低风险计划，不吃药、不购物、不启用基建、不含刷关：

```json
{"input":{"plan":{"startup":true,"daily":true,"friends":true,"base":false,"shopping":false},"maxSeconds":1800}}
```

`run` 操作当前任务绑定实例，不再传任意 `instance`。started 不等于完成；核对回调、停止状态和游戏实际结果，不把缺回执/断连/部分消费自动全量重试。

6. 逐项验收有限刷关、停止/断连、普通/已有方案基建换班、信用领取及一个有限肉鸽主题。信用购物单独授权，严格只买折扣无法保证时关闭购物。源石/付费/抽卡仍禁止。
7. 最后按用户实际指定时间/时区，审批创建 **GameGuy 自有 scheduler** 的每日模板，核对下次执行、设备在线、错过跳过、实例冲突和每次结果；不是 Codex 自动化或 DSH 原版 schedule。

## 7. 发布门槛

补齐以上 P0 实机与分发缺口，评估 2026-10-26 npm 审计的 192 high / 13 moderate（205 项，0 critical）、MAA AGPL、官方 Skill/CLI 再分发、专有模拟器和游戏条款。DSH 原生 PowerShell 使用 Windows restricted-token/ACL 沙箱，文件工具有写围栏；游戏审批/工具范围、可信宿主与 worker 不等于操作系统安全沙箱，宿主/Monitor 仍有用户权限。完全访问的任意 shell 无法仅靠业务 schema 保证不绕过游戏限制；只读/工作区写也不是凭据读取隔离。本地停止 CLI 不等于远端退出，后端 complete 不等于独立核验奖励，持久去重不等于无限期 exactly-once。

## 2026-10-26：游戏审批与无需审批模式接通
此前 GameGuy 无条件创建游戏审批卡，与 DSH 完全权限/never 不一致。现通过宿主 IPC 查询准确的 live session sandboxMode 和 approvalPolicy，仅 danger-full-access + never 自动授权已通过插件校验的请求；只读、工作区写、未知/离线/身份不符保持确认。缓存 task.permission 不作为授权来源。自动授权先持久化审计，重检实时权限、取消/关闭/停止状态，再派发；资源 schema、隐私、设备锁和所属实例仍生效。工具取消信号已传递到宿主游戏审批，取消即清卡，不再残留等五分钟。普通收菜 prepare 的 startup=true 原本正确，回归锁定 StartUp → Custom/InfrastBegin → Mall → Award；不因模型无法看图关闭初始化。此修复不声称真人账号收菜已完成，需应用重启加载。

## 2026-10-27：Electron 缓存完整性启动恢复
启动器只将 root/debug.log 这个 Chromium 生成的普通日志文件排除出不可变程序 inventory；仍验证程序、DLL、PAK、资源、完整 manifest，拒绝未知文件和链接。缓存异常从 node_modules/electron/dist 重建并验证新 generation，保留损坏/可能仍在运行的旧 generation，不删除/移动用户数据或关闭旧进程；后续启动重新验证并复用 recovery pointer，不能通过 pointer 路径逃逸。并发发布、安全临时目录清理、metadata 缺失/损坏均有回归覆盖。
当前 agent 执行环境下旧缓存和 source 相符，未复现用户原报错中的具体差异；因此不声称已确定原缓存哪一文件损坏。验证了日志变化及真实文件损坏两类故障能恢复。12 项专项测试通过，npm test 共 203 个 JS/TS + 12 个 Python 测试通过。真实 Electron 39.2.7 的新缓存连续两次解析成功并复用（75 个不可变文件），启动进程与 GameGuy 窗口出现。桌面点击验收受到 GetCursorPos 拒绝访问限制，未将空白截图判成应用成功或崩溃。

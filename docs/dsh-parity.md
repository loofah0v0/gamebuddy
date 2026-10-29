# GameGuy × DSH 基础能力接入与验收

更新时间：2026-10-26。产品是游戏能力为核心的通用 Agent，不是简化 SDK 聊天页加游戏入口。

## 1. 设计与对照

固定 npm `@deepseek-ai/dsh@0.2.1-rc.2`；只读上游 `D:/Gameguy/dsh`，commit `687f282e8625c6b8d11ff58211a90524be2e4317`。参考架构文档、client/session-controller/model-selection、web-app profile 与 Desktop host 实现。只保证该固定版本的接入，不承诺未来自动一致。

之前完整 SDK 只接通内核和部分 Host，缺少客户端层。本次主窗口使用完整原生 **web profile + 原生客户端模块**，GameGuy Electron 补齐桌面桥，`@gameguy/native-client` 注入产品品牌和同会话游戏现场。游戏领域仍由自有插件/应用服务管理。旧自有 UI 保留为初始化失败恢复界面，不再作为游戏中心或主聊天工作台。

三层分别验收：原生 Agent/工具/会话 → Host/API/桌面桥 → 真实客户端操作。模块存在、入口可见、实际交互成功、外部实机闭环是不同证据级别。

## 2. 基础能力矩阵

“原生接入”指固定版模块已在运行 profile 中装配；不是所有选项全量 E2E。本轮 36 项原生 UI 检查通过；检查点与状态见 `D:/Gameguy/artifacts/verification/native-desktop/report.json`。

| 能力 | 接入方式 | 验收范围 / 边界 |
| --- | --- | --- |
| Agent loop、通用工具、持久会话 | 原生 web/base 服务，与游戏共用 session | SDK 工具执行/修复回归保留；主窗口原生创建、请求和 GameGuy adoption 实测 |
| 流式对话、Markdown、代码、消息渲染 | 原生 conversation/stream/renderers | 本地 SSE 完成前输出、代码块与持久回复实测；丰富图片/文件/断流专项仍需扩展 |
| 模型选择、搜索、分组与 reasoning | 原生 model selection/composer | 同一会话 A→B 实际请求；effort 按 adapter 公布；外部模型能力不猜测 |
| 多提供商、默认值、热更新 | 原生设置/API/controller + 加密凭据服务 | UI 创建第二 provider、取目录、并存、编辑保存、同 Host 实测；responses/Anthropic/外部认证待专项 |
| 会话搜索、重命名、置顶、fork、归档 | 原生 sidebar/session-controller | UI 操作与原生状态分别核验；导出文件/复杂迁移为专项 |
| 工作区创建/切换/选择 | 原生 workspace + directory-picker 桌面桥 | 默认 userdata/workspaces；文件选择与跨工作区恢复为专项，不默认源码目录 |
| 文件树、终端、文件/文档/产物/diff | 原生 right-sidebar 各模块 | 真实隔离文件树列出文件、点击打开并核验文本；终端实际执行命令并核验展开后的输出。复杂格式预览、diff 和产物往返为专项 |
| 附件、拖入、@ 文件/Skill/会话 | 原生 composer/reference/upload + file-path 桌面桥 | picker 与上传入口按报告；实际二进制上传/拖入/图片推理为专项 |
| 命令、计划、goal、todo | 原生 commands 与对应视图 | slash picker；已有原生计划/问答/goal 回归；复杂长计划交互为专项 |
| 工具记录、轨迹、用量、子 Agent、jobs | 原生客户端与服务 | 不再只有自有名字/phase 列表；SDK 子 Agent/取消/恢复实测，复杂导航与 jobs UI 专项 |
| 权限、审批、追问、计划审阅 | 原生 permission/question/plan UI | 全局默认与会话入口；SDK Windows 写围栏/单次授权回归。游戏审批仍单独 |
| 通用插件、Skill、MCP、Agent 预设 | 原生 plugin-manager/settings/presets | 运行宿主插件库存、四预设、通用管理入口；第三方安装/MCP 认证/运行为专项 |
| 隔离内嵌浏览器 | 原生 sidebar-browser + MIT-adapted guest leases/partitions | 本地 X-Frame-Options:DENY 页面、无 Node/桥、拒绝应用来源；外部站点登录/复杂页面待专项 |
| 主题、语言、快捷键、窗口行为 | 原生设置 + GameGuy keyboard/theme/fullscreen 桥 | 浅/深色、全局设置、快捷键编辑入口；各平台组合键/输入法为专项 |
| 游戏现场、插件和日程 | GameGuy 自有模块，同一个原生 session | 主会话 game-neutral adoption 与同 session dock 实测；实际暂停无实例会话并禁用采集，恢复不复活任务。真实游戏/观战暂停、长期日程另验 |

## 3. 模型和配置所有权

- **设置 → 模型**是多 provider / 默认值 / 会话目录的权威来源。初次 bootstrap 之后可编辑原生 profile 不在重启时重写。
- 主窗口游戏市场的 URL/Key/目录/API 验证仅测试临时草稿，不保存模型；目录获取与推理验证分开。模型保存仍在原生设置，旧恢复界面保留快捷路由。
- 原生设置在线更新、不重启 Host；快捷配置保存有活动任务防护。旧 SDK 支路保留其重启合同，不能套到主原生工作台。
- 当前会话选择用原生 API；在途请求不变，下次 assembly 生效。API Key 通过 safeStorage vault，原生 profile 仅保存引用，不以明文降级。
- 本地测试只覆盖 completions；表单提供其它协议不意味着这些已认证/推理/视觉验收。

## 4. 独立产品适配与安全

GameGuy 使用品牌文案、游戏 hero/sidebar、自有 persona、游戏中心和右侧游戏现场。原生工具/模型/会话 UI 是产品内部基础模块，不是要求用户安装 GameGuy 到原版 Desktop。

Desktop host 的 browser guests、keyboard/keybindings 依据 MIT 上游适配；preload 提供目录选择、文件路径、全屏、主题、快捷键等受限桥。只接受可信主文档的主 frame；guest 无应用桥，无 Node，保留 sandbox/contextIsolation/webSecurity。系统浏览器打开只允许有效 HTTP(S)，拒绝凭据/控制字符/应用自身来源。导出通过用户保存对话框，guest 不能借宿主写文件。

Windows Electron 校验副本启动修复保留，不禁用 Chromium sandbox，不改系统 ACL。凭据原子写入串行化；更新失败回滚，解密失败不读空串冒充成功。

**有意不接入**：DeepSeek 官方账号/登录、官方 session telemetry、产品遥测与官方 updater。这些是上游运营服务，不是 GameGuy 通用 Agent 功能。兼容模型 Key 不发送给 DeepSeek；未配置搜索 provider 时准确提示不可用。

## 5. 完成口径

基础工作台不再逐个重新造简化替代控件，固定版原生模块整体接入。不能把它写成“所有 DSH 外部生态及全部交互均验收”。新增本地 UI 回归、构建/单测与 SDK 自修复测试分别保留；实际账号、真实三游戏、长期 schedule、远程市场、安装器和安全/许可证是独立发行门槛。

尚需专项测试不是故意删除能力；对每个复杂功能补充操作、状态、取消/恢复/失败证据后再升级验收结论。

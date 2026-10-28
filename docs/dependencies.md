# GameGuy v0.3 依赖、来源、下载与分发边界

更新时间：2026-10-26。GameGuy 是独立桌面产品，实际使用 DSH web/base 原生 Agent 与客户端模块。npm 精确解析见根 `package-lock.json`，首次安装用 `npm.cmd ci`；**不要用 `--ignore-scripts` 初装 Electron**。本地 tarball 打包才使用 ignore-scripts。校验记录是本机观察，不把本地哈希误称为发布方签名。

## 1. 核心依赖

| 组件 | 固定/观察版本 | 来源与用途 | 授权/边界 |
| --- | --- | --- | --- |
| DeepSeek Harness | npm 0.2.1-rc.2；参考 commit 687f282e8625c6b8d11ff58211a90524be2e4317 | [DSH](https://github.com/deepseek-ai/deepseek-harness)；独立产品的真实 SDK/profile/会话/工具/Agent loop | MIT；不启动原版 DSH Desktop |
| Electron | 39.2.7 | GameGuy 自有窗口、preload、托盘、safeStorage、隔离观战容器 | 桌面 QA 通过；安装器/托管运行时待交付 |
| Cordis | 4.0.5 | @deepseek-ai/cordis；DSH 模块生命周期 | 不是用户安装 GameGuy DSH 插件的产品入口 |
| Mineflayer | 4.39.0 | [Mineflayer](https://github.com/PrismarineJS/mineflayer)；Minecraft 插件 | MIT；首期授权私人 Java offline-mode 服 |
| mineflayer-pathfinder | 2.4.5 | [pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder)；有限移动 | 按当前包/上游许可审查 |
| 官方 ClawClaw CLI/Skill | CLI 0.9.1 / Skill 4.8.116 | @myclaw163/clawclaw-cli；[官方快速开始](https://myclaw.163.com/game-intro/index.html#quick-start) | 直接读取原包资源，无第三个 GameGuy 插件；根 LICENSE/明确 license 字段缺失，不假定可再分发 |
| MAA | 6.20.1 win-x64 | [MAA](https://github.com/MaaAssistantArknights/MaaAssistantArknights)；Python ctypes worker | AGPL-3.0；独立进程不是自动豁免 |
| Android platform-tools | 37.0.1-15733141 / ADB 1.0.41 | [platform-tools](https://developer.android.com/tools/releases/platform-tools) | SDK NOTICE/条款需审查；本机外部依赖 |
| MuMu | 6.8.7.0 | [官网](https://mumu.163.com/)；用户安装于 D:\MuMuPlayer | 专有软件，不并入插件包；历史安装位置核验不等于实机游戏兼容 |
| 开发/外部运行时 | Node 24.18.0 / Python 3.12.10 | 外部 Node 运行 DSH / Python MaaCore worker | 不假定 Electron 内置 Node 可替代 DSH 的 Node 24 |
| 构建与校验 | TS 5.9.3 / tsx 4.20.6 / esbuild 0.25.11 / zod 4.3.6 | TypeScript、测试、bundle、严格 schema | 锁文件固定解析；发布前完整许可证/漏洞审查 |

GameGuy 根包为 private，尚未选定自身公开许可证，不做公开发布。主窗口使用固定版 DSH 原生 web profile、renderer/Slot 模块与 `@gameguy/native-client` 产品扩展；GameGuy 自有 Electron 负责桌面桥、安全与产品入口。旧自有 UI 保留为辅助游戏中心，SDK 支路保留回归。复用基础客户端不等于要求用户安装到原版 DSH Desktop。

### Windows Electron 运行路径

仍使用 npm Electron 39.2.7，不下载其他版本。启动器逐文件 SHA-256 校验后，将同字节 dist 原子复制到 `%LOCALAPPDATA%\GameGuy\runtimes\electron-39.2.7-<inventory摘要>\dist`；每次启动再核验。此路径正常继承用户本地目录权限，避免源码目录 Low Mandatory Label 造成 Chromium alternate window station 启动 ACCESS_DENIED / `0x80000003`。不复制源 ACL、不更改系统 ACL、不禁用沙箱。正式启动与 desktop/model QA 使用同一逻辑；这是开发启动修复，仍不是正式安装器或全部依赖托管。

## 2. 本机下载校验

### MAA

- 文件：downloads/MAA-v6.20.1-win-x64.zip，297879254 字节。
- 下载：https://github.com/MaaAssistantArknights/MaaAssistantArknights/releases/download/v6.20.1/MAA-v6.20.1-win-x64.zip
- SHA-256：28A6C812C184F4BD6E8A7E7448B2FFA6312D711DE7D39595DEAC771E3E784EA8。
- 已解压至 external/maa。版本对应的上游 LICENSE 保存于 docs/third-party/MAA-6.20.1-LICENSE.txt。
- LICENSE 原文：https://raw.githubusercontent.com/MaaAssistantArknights/MaaAssistantArknights/v6.20.1/LICENSE
- LICENSE SHA-256：8486a10c4393cee1c25392769ddd3b2d6c242d6ec7928e1414efff7dfb2f07ef。

### Android platform-tools

- 文件：downloads/platform-tools.zip，8044989 字节；解压至 external/platform-tools。
- 来源：https://dl.google.com/android/repository/platform-tools-latest-windows.zip（滚动 URL，以本机版本和哈希为准）。
- SHA-256：45F4D63113E895EBDE0C90F194099A4676B6AC653BD28D54314A9E022BBC1A99。
- 历史记录（2026-10-22）：adb version 已执行成功，当时 devices 列表为空；不是当前实时设备状态。

### MuMu

- 文件：downloads/MuMuInstaller.exe，6350344 字节。
- SHA-256：77BB55E018AB3016F8524CD635E29D7525A9AC248FA02BC2308805CFC3B96987。
- Windows Authenticode：Valid；签名方 NetEase (Hangzhou) Network Co., Ltd。
- 用户即时确认后已运行安装器，下载界面完成并自动关闭，期间未出现路径选择页。Windows 卸载注册项报告 MuMu 6.8.7.0，InstallLocation 为 F:\Program Files\Netease\MuMu；目录与服务进程路径一致（目录创建时间 2026-10-22 18:51，本机时区）。不能据此宣称已安装至 D 盘。
- 用户于 2026-10-22 确认手动卸载完成；只读复查未发现 MuMu 卸载注册项、F 盘原目录或运行进程。安装器哈希不变，网易 Authenticode 签名仍为 Valid；证据见 artifacts/verification/mumu-installation-status.json。未通过命令行、静默卸载、改注册表或删目录绕过先前的操作阻止。
- 用户随后于 2026-10-22 完成重装；只读复查确认卸载注册项版本 6.8.7.0、InstallLocation 为 D:\MuMuPlayer，相关服务进程路径一致。官方 CLI info --vmindex all 报告 Android 15 实例索引 0，is_android_started=false、is_process_started=false；ADB 设备仍为空。安装位置已验证，模拟器实机启动与游戏连接尚未验证。证据见 artifacts/verification/mumu-installation-status.json。
- 已只读核验官方 CLI 路径 D:\MuMuPlayer\nx_main\mumu-cli.exe，help 支持 info --vmindex、control --vmindex 0 launch、adb --vmindex 0 --cmd connect。GameGuy 自有桌面启动入口已通过模拟适配器/桌面 QA；尚未观察真实 connect 响应，未进行真实启动/游戏连接，失败不得猜端口。
- 官方路径选择说明：https://mumu.163.com/help/20211022/35050_981114.html 。当前无需再次重装；程序/实例启动须在 GameGuy 审批或由用户手动打开。
- 在线安装器下载的模拟器与游戏是独立下载，不能用安装器哈希证明其版本/完整性；注册版本不等于 MaaCore 兼容性已验证。
- 安装时须用户即时确认；不代改 BIOS/Hyper-V/安全设置、不自动重启。

## 3. npm 安全审计

2026-10-26 已重新联网审计，记录 `artifacts/verification/npm-audit-v03.json`：**205 项 = 13 moderate + 192 high，0 critical**，统计依赖 994。旧的 20 项及 `npm-audit.json` 是历史，不能代替本次结果。新增客户端依赖也进入审计范围；这是发布阻断项，不宣称可安全分发。`js-yaml` 固定 4.3.2，不代表全链安全。

不执行 `npm audit fix --force`；逐项评估可达性、兼容升级/替换，再用独立产品 build/test/DSH/Desktop QA 和实机回归验证。审计会随时间变化，正式发布前必须重跑与处置。

## 4. QA 依赖与历史测试

当前主窗口由 `verify:native-desktop` 经与正式入口相同的运行时解析器启动校验后的同版本 Electron，使用隔离 userdata、本地 SSE 和 HTTP 页面夹具。`verify:desktop`、`verify:model`、`verify:session-model` 的桌面段保留辅助游戏中心/SDK 支路合同；`verify:product` 使用实际 DSH + 本地 SSE 模型夹具。不需要外部 Playwright/Edge，不使用用户浏览器/游戏登录态，不调用付费模型。

旧 `legacy:*` UI 测试曾使用外部 Playwright、Edge 155.0.4283.62；不作为当前产品运行/安装要求。原生 renderer/slots 则是当前主工作台的实际运行模块。

## 5. 插件包与分发

仅打包 **`@gameguy/plugin-arknights@0.3.4`**、**`@gameguy/plugin-minecraft@0.3.1`**，文件在 `artifacts/product-plugins/`，包摘要/权限/版本见 `checksums.json`。MAA 包已重验 27 条目，Minecraft 9 条目。包包含 lib（包括插件发现实现）、manifest、Skill、schema 资源和必要 Python worker，不含 node_modules、MAA 二进制、MuMu、客户端、账号或截图。

本地可信目录 `product/catalog.json` 绑定 manifest SHA-256/权限/版本，安装验证全部文件并原子启用；当前未公布远程市场、未测试远程下载/升级。后端依赖自动下载治理、托管运行时、安装器与授权仍待交付。龙虾杀直接引用原官方包，不复制后冒充自研第三个插件。

**不要将整个 D:/Gameguy 或用户数据目录压缩上传。** `.runtime`/历史配置及 `%APPDATA%/GameGuy-v03` 可能有凭据、DSH 会话、参与记录、设备信息或图像。密钥加密不表示会话/其他文件都已脱敏。在线 MuMu 安装器不应作为插件市场资源再分发。

许可原文保留于 `docs/third-party/DSH-LICENSE.txt`、`Mineflayer-LICENSE.txt`、`MAA-6.20.1-LICENSE.txt`；正式分发前另做全部直接/传递依赖、AGPL、Skill/CLI、专有模拟器及游戏条款审查。

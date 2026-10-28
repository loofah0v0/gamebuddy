# 环境、首次接入与故障
## 自动配置而不是让玩家找路径
`gameguy_setup {game:"arknights"}` 委托本插件：有限安装注册表/常见目录、MuMu 官方 info、MAA/ADB 文件、Python 位数自检。返回 suggestedConfig、instances、evidence、questions、依赖状态与各 schema。发现不会启动设备/ADB connect/保存/登录/执行游戏。
单实例采用发现建议；多实例只问名称/索引。未确定渠道问官服/B服。设备已在线且配置有效时可从安装包名识别；不等于已登录。只连接不问关卡、换班表或药物消费。
默认值是建议，不是环境实测；不猜 ADB 端口。依赖缺失说明缺什么再征求安装，不擅自下载运行安装器/重装现有 MuMu。特殊安装位置可使用 DSH 通用工具在当前权限下查非敏感安装事实，执行仍回插件。

## 运行状态不能混淆
MuMu 的运行状态以本插件 setup 返回的 instances[].androidStarted / emulatorRunning（官方 CLI info）为依据。gameguy_status.devices 只是本宿主保存的启动任务记录；空列表不证明模拟器未启动。DSH 通用 pwsh 在工作区沙箱中可能看不到真实进程，其空列表不能推翻官方 CLI 与玩家现场。
requiresDeviceStart 只表示 Android 未启动；requiresDeviceConnection 表示需要恢复 ADB。MuMu 已运行但 ADB 不通时，经审批调用 device_start 会跳过 launch、复用所选实例，连接其官方端点；不要让用户重装/重启/再次启动游戏。diagnose 失败只报告具体连接/依赖失败，不宣称游戏已关闭。
插件的 ADB、MuMu CLI 与 MaaCore worker 使用应用专属临时目录，避免继承共享 adb.log 的权限/锁冲突。不得为修复该错误删除他人的 adb.log、kill-server 或修改权限/安全设置。

## 配置与启动
合并建议和回答 → prepare（connect 或所需任务）→ configure 完整 proposedConfig。instance 使用 setup 返回/当前任务实例，不绑定他人任务。首次即使 changes=[] 也要 configure 才有已保存实例。
配置含 maaDir/python/adbPath/address/connection/clientType；可选 emulator {type:"mumu",cliPath:发现的绝对路径,instanceIndex}；基建/资源策略见 tasks.md/schema。不要用错误缩写、猜 DSH 专用参数或手工 confirmed/token。
`gameguy_device_start {}` 显示可执行文件与实例审批；最多等待120秒，官方实测地址+ADB验证后保存。status.ready 确认设备就绪，再 diagnose。用户也可自行启动模拟器，插件检查实际本机端点。停止等待不关闭已启动 MuMu。

## 登录和人类预览
游戏安装、账号密码/验证码/扫码/实名在模拟器由玩家完成，先停自动任务、在 GameGuy 隐私暂停，结束后玩家自行恢复。不要让玩家把密码发聊天，不截图绕暂停。
右侧约7秒刷新的 ADB 图像给玩家观看，不是 MuMu 原生窗口嵌入/实时视频，更不是模型自动接收的视觉工具。当前不要调用不存在的 gameguy_screenshot/control/device 或声称已代点登录。diagnose 检查库/资源/ADB/Python/get-state，不证明玩家登录或奖励到账。

## 故障处理
| 观察到的结果 | 下一步 |
| --- | --- |
| 没发现实例/多实例 | 根据 setup questions 修复安装/选择实例；不要全盘读个人文件 |
| 设备 offline/启动失败 | 检查所选实例与官方 info，再经审批启动；不猜端口或悄悄换号 |
| MAA/资源/Python 缺失 | 解释具体诊断项，可信安装另行授权，不把准备成功当执行成功 |
| 基建自定义文件拒绝 | 检查所选 plan_index 与 drones；玩家同意后改普通换班/修正文件，不自动扩大资源使用 |
| 战斗失败/断连/缺完成回执 | 可能已花理智，报告部分结果；先停并诊断，不全量盲重试 |
| 超时/停止 unknown | 等清理或说明未知，禁止宣称最后动作撤销/奖励核验完成 |

GameGuy 原生 DSH read/pwsh/glob/Web 工具按权限可用；公开官方文档优先已知URL web_fetch。搜索 provider 不可用时明确说明，不声称检索成功，不用 shell 绕游戏审批。

## 会话授权说明
完全权限 + never 时，宿主在插件校验后直接授权受管理游戏请求，不再等待右侧审批卡；其他模式保留确认。资源策略、登录接管、隐私暂停、停止和所属实例范围不变。普通收菜保持 startup=true，以 MAA 初始化和返回主页，不能因模型无法看图而自动关闭。

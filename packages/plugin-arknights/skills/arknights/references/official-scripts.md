# 官方脚本说明与 GameGuy 实现边界
技术依据优先 MAA 官方文档。当前参数核对基准为 MaaCore **v6.20.1**，不是直接照搬第三方 prompt。动态的在线文档可能晚于本机库；不确认兼容时不要新增参数或擅自更新库。

## 两种不同的“脚本”
1. **maa-cli 自定义任务**：`tasks` 文件可用 JSON/TOML/YAML，包含 type/params，可有 variants 条件、输入选项、startup/closedown；`maa run <task>` 执行。CLI 负责条件/相对配置目录的解析；它的文档明确提醒参数并不逐项验证。
2. **MaaCore 任务接口**：`AsstAppendTask(handle,type,params)` 添加任务、`AsstStart` 执行、回调给进度。本插件已经直接使用 Python ctypes worker 调库，不需要另装 maa-cli 或向玩家展示命令。

GG 读取玩家意图 → gameguy_prepare → 插件严格 request/config/plan schema → compileTasks 返回 type/params → 审批后 worker 调 MaaCore。这复用了官方任务语义，并增加参数与资源校验；不是执行玩家给出的任意代码。
玩家提供 `maa run` 脚本时，只提取当前包装支持的任务和限制，重新 prepare。不能把 CLI 的 variants/strategy/inputs 直接当 MaaCore 参数，也不能在 shell 自动执行未审核脚本。暂未实现脚本导入器、JSON/TOML/YAML 全自动迁移或所有官方任务。

## 基建文件不是任务文件
自定义换班用官方基建 JSON，顶层 `plans`，每项可含 rooms/operators/groups/drones。不能凭需求凭空编造玩家拥有的干员。无需文件时用 Infrast mode=0；已确认文件用 mode=10000、filename、plan_index。core 不处理基建 period，GameGuy 当前也不实现按 period 自动切班。
MAA 自定义模式忽略顶层任务 drones；文件内 drones 可能开资源消费，故插件执行前检查选定方案并快照，不仅检查文件存在。省略 drones 或明确 enable=false 才符合当前无人机关闭策略。

## 来源
- [官方集成文档（任务、参数、ABI）](https://github.com/MaaAssistantArknights/MaaAssistantArknights/blob/v6.20.1/docs/zh-cn/protocol/integration.md)
- [官方 CLI 配置：自定义任务脚本](https://github.com/MaaAssistantArknights/MaaAssistantArknights/blob/v6.20.1/docs/zh-cn/manual/cli/config.md)
- [官方 CLI 运行说明](https://github.com/MaaAssistantArknights/MaaAssistantArknights/blob/v6.20.1/docs/zh-cn/manual/cli/usage.md)
- [官方基建排班协议](https://github.com/MaaAssistantArknights/MaaAssistantArknights/blob/v6.20.1/docs/zh-cn/protocol/base-scheduling-schema.md)
- [FightTask.cpp](https://github.com/MaaAssistantArknights/MaaAssistantArknights/blob/v6.20.1/src/MaaCore/Task/Interface/FightTask.cpp)：临期药参数不是限瓶数。
- [InfrastTask.cpp](https://github.com/MaaAssistantArknights/MaaAssistantArknights/blob/v6.20.1/src/MaaCore/Task/Interface/InfrastTask.cpp)：mode 与自定义无人机策略。
- [maa-prompt-generator](https://github.com/billma007/maa-prompt-generator)：仅参考“玩家选项→任务描述”的交互思路，无代码/文案移植；该项目 README 声明 AGPL-3.0。GameGuy 当前不继承其所有任务和消费默认值。

## 只收取，不换班
官方 [Custom 任务参数](https://github.com/MaaAssistantArknights/MaaAssistantArknights/blob/v6.20.1/docs/zh-cn/protocol/integration.md) 允许 task_names。插件只内置一个固定任务 `Custom {task_names:["InfrastBegin"]}`；[官方任务资源](https://github.com/MaaAssistantArknights/MaaAssistantArknights/blob/v6.20.1/resource/tasks/tasks.json) 中该链进入基建，点击通知收取后 Stop，不进入 InfrastTask 的干员选择流程。
不能用 mode=20000 替代：该模式仍会执行一键轮换。不能用 threshold=0 声称严格不换班。worker 在连接前核验 MaaCore 版本与本机已审查任务资源树指纹，改变资源/新增 overlays 后需重新评审，当前不会自动更新。

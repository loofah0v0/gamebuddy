# 每日自动收菜
用户明确要求每天运行时，把同一份 prepare→确认后的 plan 固化到 GameGuy 自有 scheduler，不是模型每次重新猜任务，也不是 DSH/Codex schedule。
1. 确定任务范围/资源上限/绑定实例，prepare.ready=true，完成必要配置审批。不要把未解决问题的 plan=null 创建日程。
2. 确认 HH:mm、IANA 时区（中国玩家通常 Asia/Shanghai，但应说明）、maxSeconds 10..7200。缺时间问“每天几点”；不要私自创建。
3. `gameguy_schedule {plan:准备的有限计划,time:"08:00",timeZone:"Asia/Shanghai",maxSeconds:1800}` 独立审批；list 返回下次运行信息。不要实际运行来“测试”有消费的日程，除非玩家单独授权一次运行。
4. `gameguy_schedule_manage {action:"list"}`；pause/resume/delete/update 带 id，update.patch 可含 time/timeZone/plan/maxSeconds，编辑/恢复走审批。配置变更可能令原日程指纹失效，说明需确认更新。

电脑、GameGuy 服务、模拟器必须在线，游戏登录有效。关窗到托盘服务继续，彻底退出不执行。当前没有系统唤醒、云挂或 schedule 自动启动 MuMu。错过/离线/忙碌/配置变化跳过，不补跑消费动作。掉登录停止报告，不扩大授权重试。
此版本仅固定每日计划，不执行官方 CLI Weekday/DayMod/Time variants，不自动按基建文件 period 选索引，不轮换早晚班。多个时点需分别明确授权固定计划；复杂条件脚本先说明未支持，不假装完整移植官方编排。

## 会话授权说明
完全权限 + never 时，宿主在插件校验后直接授权受管理游戏请求，不再等待右侧审批卡；其他模式保留确认。资源策略、登录接管、隐私暂停、停止和所属实例范围不变。普通收菜保持 startup=true，以 MAA 初始化和返回主页，不能因模型无法看图而自动关闭。

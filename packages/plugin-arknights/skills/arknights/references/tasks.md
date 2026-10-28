# 玩家需求与 MAA 任务
以插件返回的严格 schema 为准。此 Skill 使用官方 MaaCore 任务接口，不是让玩家学习 CLI。

## 先理解玩家说什么
| 玩家需求 | prepare request | 生成的操作与必要信息 |
| --- | --- | --- |
| 帮我连接明日方舟 | `{intent:"connect"}` | 只准备连接，plan=null；设备信息来自 setup |
| 帮我收菜，不购物不吃药 | `{intent:"daily"}` | StartUp → Mall（访问好友、不购物）→ Award（日常/周常、邮件）；不默认基建或战斗 |
| 只领奖、不收邮件 | `{intent:"rewards",mail:false}` | StartUp → Award（award=true、mail=false） |
| 只收邮件 | `{intent:"rewards",daily:false,mail:true}` | Award 仅 mail，不领取其他奖励 |
| 收基建/只收取，不换班 | `{intent:"base",base:{mode:"collect"}}` | StartUp → 固定 Custom/InfrastBegin；只收通知面板订单、材料、信赖，不改变进驻、不一键轮换、不处理线索 |
| 自动基建换班 | `{intent:"base",base:{mode:"normal"}}` | Infrast mode=0；不用文件，MAA 自选人，可能改变当前阵容 |
| 使用已有早班方案 | `{intent:"base",base:{mode:"custom",filename:已授权文件,planIndex:0}}` | mode=10000；文件/索引不明才问，勿编造干员表 |
| 刷 1-7 三次，不吃药 | `{intent:"farm",fight:{stage:"1-7",times:3,medicine:0}}` | Fight：最多3次，源石0、临期药0；缺关卡/次数则提问，plan=null |
| 收信用不购物 | `{intent:"credit",shopping:false}` | Mall 访问好友，不买商品、不打信用战 |
| 信用购物，别买家具 | `{intent:"credit",shopping:true,creditPolicy:{blacklist:["家具"]}}` | 开启购物提案并提示无本次信用金额上限，配置与运行仍要确认 |
| 萨米肉鸽一局 | `{intent:"roguelike",roguelike:{theme:"Sami",runs:1,difficulty:0}}` | 有限开始1局，不投资、不使用支援；不保证打完/通关 |

“领日常”不会自动完成全部日常任务。关卡须已解锁、有代理记录；材料名称不能直接当关卡号，不编造最优掉落表。活动关卡开放、剩余理智、干员阵容等插件目前无查询接口，应询问必要事实/说明前置条件，不宣称已看画面。

## 组合需求与参数
request `intent` 必填；daily/mail/friends/shopping 可显式 true/false。base/fight/roguelike 是可选附加操作，可以组合。不给 fight 或 roguelike 就不插入。没有 `base:false` 字段：daily 不附带 base 就不开换班。
- base：mode collect/normal/custom；collect 是基建意图默认值，只收取且不能附带换班字段；normal/custom 才能使用 threshold=0..1（心情阈值），dormNotStationed、dormTrust；custom 才有 filename、planIndex 0..50。
- fight：stage 字母/数字/横线，times 1..50，medicine 0..10 默认0，expiringMedicine 只能0用于执行。缺 stage/times 会返回玩家语言的问题。
- creditPolicy：blacklist、onlyDiscount、strictDiscountOnly。仅 shopping=true 时传；不购物不用购物策略。
- roguelike：theme Phantom=傀影、Mizuki=水月、Sami=萨米、Sarkaz=萨卡兹、JieGarden=界园；runs 1..3 默认1；difficulty 0..18 默认0。必须当前后端/游戏支持；原有存档可能受影响，先说明，不自动加入日常。

玩家：“收菜，加普通换班，1-7 三次，不吃药不购物”。在已合并 setup 配置后：
```json
{"game":"arknights","request":{"intent":"daily","base":{"mode":"normal"},"fight":{"stage":"1-7","times":3,"medicine":0},"shopping":false}}
```
首次调用时还要传 `config:合并发现和玩家回答后的完整配置`。返回 proposedConfig、changes、needsConfigApproval、summary、questions、warnings、plan 和实际 MaaCore tasks 预览。向玩家说：“会自动换班、最多代理1-7三次、访问好友收信用、领取日常周常和邮件，不用药/源石、不购物。普通换班会改变当前进驻阵容。确认后执行。”

## 不把已保存上限当本次委托
已有 medicineLimit=5 不代表每次自动吃5瓶；request 未说吃药则本次 medicine=0。次数超旧 maxFightTimes、普通药超旧 medicineLimit 或新启用购物时，proposedConfig 提议增加上限，只有 configure 审批才保存。run 审批另外进行。环境信息和其他已保存策略不会被 prepare 重置。

## 真实资源语义
- MAA 6.8+ 已弃用 expiring_medicine；非零旧值不是限瓶数，而转成临期天数开关。GameGuy 使用 medicine_expire_days=0，暂不自动使用临期药。返回未支持问题后必须等玩家改成不用，不能把“用1瓶”悄悄变成无限用。
- only_buy_discount 只约束 MAA 第二轮购买，不能保证严格只买折扣。请求 strictDiscountOnly 时返回问题且 plan=null；经玩家同意后改成 shopping=false，再 prepare，不是直接执行剩余部分。
- 购物没有信用金额上限/只买白名单包装。指定“只买招聘许可/花100信用”不转换成普通购物；解释未支持，提供只领取方案并等玩家选择。
- 普通基建用 drones="_NotUse"、replenish=false、continue_training=false。自定义模式忽略 drones 参数，worker 会校验所选 JSON 的 drones 必须缺省或 enable=false，并使用相同字节的临时快照执行；不修改玩家文件。未知/启用无人机的文件运行前拒绝。
- 仅插件内置的固定 Custom/InfrastBegin 用于不换班收取；不支持任意 MaaCore task JSON、任意 Custom/SingleStep、抄作业、保全、公招、抽卡、付费、自动更新/安装 MAA。官方支持不等于当前插件支持；不要拼接 shell 执行未包装任务。

## 仅收基建：独立于换班
`intent:base` 默认 collect；只有玩家明确要求换班才选择 normal/custom。返回 plan.base=true、baseCollect=true，不改已有换班方案。固定入口 InfrastBegin → 基建通知面板 → 收取产出/订单/信赖 → Stop，不调用 Infrast 干员选人任务或一键轮换。订单交付会使用正常订单货物，不补原料。不能保证当前一定有可收奖励，不处理线索交换。
当前仅支持已验证的 MaaCore v6.20.1 与任务资源指纹；资源更新、新增热更新或版本不符时在连接前拒绝执行，不降级到换班。玩家无需知道 Custom/task_names，Agent 只传 collect 意图。

## 会话授权说明
完全权限 + never 时，宿主在插件校验后直接授权受管理游戏请求，不再等待右侧审批卡；其他模式保留确认。资源策略、登录接管、隐私暂停、停止和所属实例范围不变。普通收菜保持 startup=true，以 MAA 初始化和返回主页，不能因模型无法看图而自动关闭。

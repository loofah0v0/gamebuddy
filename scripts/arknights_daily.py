#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""明日方舟「每日收菜」工作流 —— 一条命令跑完，顺序固定：

    1. 收基建（含无人机不使用、不补源石碎片）+ 2. 一键换班（游戏内排班方案，MAA 不挑人）
    3. 剿灭作战：龙门市区（LungmenDowntown@Annihilation）
    4. 自动公开招募（刷新 Tags，不用加急许可）
    5. 收好友信用（访问好友，不购物）
    6. 信用商店消费（默认只买打折）
    7. 领每日/每周任务奖励 + 邮件

资源红线（写死在脚本里，配置改不动）：
    源石 / 抽卡 / 充值 一律不碰；理智药、源石碎片补货、无人机、加急许可全部关闭。
    只用自然恢复的理智去打剿灭，理智不够就停在原地，不会碎石。

用法：
    python scripts/arknights_daily.py --dry-run            # 只打印计划
    python scripts/arknights_daily.py                      # 正式跑全套（会先确保模拟器和游戏在线）
    python scripts/arknights_daily.py --skip-infrast       # 跳过基建那两步
    python scripts/arknights_daily.py --shop-all           # 信用商店不限于打折
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import sys
from pathlib import Path

import maa_driver as drv

SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = SCRIPT_DIR / "arknights_daily.json"
OUT_DIR = SCRIPT_DIR / "out"

# 工作流默认值：也可以被 arknights_daily.json 覆盖。
DEFAULTS: dict = {
    "order": ["infrast", "fight", "recruit", "mall_visit", "mall_shop", "award"],
    "enabled": {k: True for k in
                ["infrast", "fight", "recruit", "mall_visit", "mall_shop", "award"]},
    "infrast": {
        "mode": 20000,                      # 20000 = 一键换班，用游戏内保存的方案
        "facility": ["Mfg", "Trade", "Power", "Control", "Reception", "Office", "Dorm"],
        "drones": "_NotUse",
        "replenish": False,
        "threshold": 0.3,
        "dorm_notstationed_enabled": True,
        "dorm_trust_enabled": False,
        "reception_message_board": True,
        "reception_clue_exchange": False,
        "reception_send_clue": False,
        "continue_training": False,
    },
    "fight": {
        "stage": "LungmenDowntown@Annihilation",   # 龙门市区 剿灭
        "times": 1,                               # 用户要求：每天只打 1 次
        "medicine": 0,
        "expiring_medicine": 0,
        "stone": 0,
        "client_type": "Official",
        "report_to_penguin": False,
        "report_to_yituliu": False,
    },
    "recruit": {
        "times": 4,
        "refresh": True,
        "force_refresh": False,
        "select": [3, 4, 5, 6],
        "confirm": [3, 4, 5, 6],
        "level3_recruitment_permit_reserve": 0,
        "set_time": True,
        "expedite": False,
        "extra_tags_mode": 0,
        "first_tags": [],
        "preserve_tags": [],
        "report_to_penguin": False,
        "report_to_yituliu": False,
    },
    "mall_visit": {
        "visit_friends": True,
        "shopping": False,
        "only_buy_discount": False,
        "force_shopping_if_credit_full": False,
        "buy_first": [],
        "blacklist": [],
        "credit_fight": False,
    },
    "mall_shop": {
        "visit_friends": False,
        "shopping": True,
        "only_buy_discount": True,
        "force_shopping_if_credit_full": False,
        "buy_first": [],
        "blacklist": [],
        "credit_fight": False,
    },
    "award": {
        "award": True,          # 每日/每周任务奖励
        "mail": True,           # 邮件
        "recruit": False,       # 每日免费单抽 = 抽卡，红线，永远 false
        "orundum": False,
        "mining": False,
        "specialaccess": False,
        "signinevent": False,
    },
}

NAMES = {
    "infrast": "收基建 + 一键换班",
    "fight": "剿灭作战 龙门市区",
    "recruit": "自动公开招募",
    "mall_visit": "收好友信用",
    "mall_shop": "信用商店消费",
    "award": "领每日/每周奖励",
}

TASK_TYPE = {
    "infrast": "Infrast",
    "fight": "Fight",
    "recruit": "Recruit",
    "mall_visit": "Mall",
    "mall_shop": "Mall",
    "award": "Award",
}


def deep_merge(base: dict, patch: dict) -> dict:
    out = dict(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_config(path: Path) -> dict:
    cfg = json.loads(json.dumps(DEFAULTS))  # deep copy
    if path.is_file():
        user = json.loads(path.read_text(encoding="utf-8"))
        user.pop("_comment", None)
        cfg = deep_merge(cfg, user)
    return cfg


def enforce_red_lines(cfg: dict, notes: list[str]) -> dict:
    """把花钱/花石头的开关强制压回去，并记录被改动的项。"""
    def clamp(path: str, value) -> None:
        node = cfg
        keys = path.split(".")
        for k in keys[:-1]:
            node = node[k]
        if node.get(keys[-1]) != value:
            notes.append(f"红线覆盖：{path} {node.get(keys[-1])} -> {value}")
            node[keys[-1]] = value

    clamp("fight.medicine", 0)
    clamp("fight.expiring_medicine", 0)
    clamp("fight.stone", 0)
    clamp("infrast.drones", "_NotUse")
    clamp("infrast.replenish", False)
    clamp("recruit.expedite", False)
    clamp("award.recruit", False)   # 每日免费单抽，属于抽卡
    return cfg


def build_tasks(cfg: dict) -> list[dict]:
    tasks: list[dict] = []
    for step in cfg["order"]:
        if not cfg["enabled"].get(step, True):
            continue
        tasks.append({"name": NAMES.get(step, step),
                      "step": step,
                      "type": TASK_TYPE[step],
                      "params": dict(cfg[step])})
    return tasks


def main() -> int:
    ap = argparse.ArgumentParser(description="明日方舟每日收菜工作流（MAA 驱动）")
    ap.add_argument("--config", default=str(CONFIG_PATH), help="工作流配置 JSON")
    ap.add_argument("--maa-dir", default=drv.DEFAULT_MAA_DIR)
    ap.add_argument("--adb", default=drv.DEFAULT_ADB)
    ap.add_argument("--address", default=drv.DEFAULT_ADDRESS)
    ap.add_argument("--connection", default="General")
    ap.add_argument("--max-seconds", type=int, default=2400, help="整体超时，默认 2400 秒")
    ap.add_argument("--dry-run", action="store_true", help="只打印计划，不连模拟器")
    ap.add_argument("--no-ensure", action="store_true", help="不自动拉起模拟器/游戏")
    ap.add_argument("--no-startup", action="store_true", help="跳过 StartUp 唤醒")
    ap.add_argument("--annihilation-times", type=int, help="剿灭打几把（默认读配置）")
    ap.add_argument("--recruit-times", type=int, help="公开招募跑几轮（默认读配置）")
    ap.add_argument("--shop-all", action="store_true", help="信用商店不再只买打折")
    ap.add_argument("--shop-off", action="store_true", help="今天不花信用")
    ap.add_argument("--visit-off", action="store_true", help="今天不收好友信用")
    ap.add_argument("--skip-infrast", action="store_true", help="跳过收基建+换班")
    ap.add_argument("--skip-fight", action="store_true", help="跳过剿灭")
    ap.add_argument("--skip-recruit", action="store_true", help="跳过公开招募")
    ap.add_argument("--quiet", action="store_true", help="只写日志，不刷屏（计划任务用）")
    args = ap.parse_args()

    cfg = load_config(Path(args.config))
    if args.annihilation_times is not None:
        cfg["fight"]["times"] = max(0, args.annihilation_times)
    if args.recruit_times is not None:
        cfg["recruit"]["times"] = max(0, args.recruit_times)
    if args.shop_all:
        cfg["mall_shop"]["only_buy_discount"] = False
    if args.shop_off:
        cfg["enabled"]["mall_shop"] = False
    if args.visit_off:
        cfg["enabled"]["mall_visit"] = False
    if args.skip_infrast:
        cfg["enabled"]["infrast"] = False
    if args.skip_fight:
        cfg["enabled"]["fight"] = False
    if args.skip_recruit:
        cfg["enabled"]["recruit"] = False

    notes: list[str] = []
    cfg = enforce_red_lines(cfg, notes)

    tasks = build_tasks(cfg)
    startup = [] if args.no_startup else [{
        "name": "唤醒游戏", "step": "startup", "type": "StartUp",
        "params": {"client_type": "Official", "start_game_enabled": True}}]
    queue = startup + tasks

    stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    log_path = OUT_DIR / f"daily-{stamp}.jsonl"

    print(f"=== 明日方舟每日工作流  {stamp} ===")
    for n in notes:
        print("  !", n)
    for t in queue:
        extra = ""
        if t["step"] == "fight":
            extra = f"  stage={t['params'].get('stage')} times={t['params'].get('times')}"
        elif t["step"] == "infrast":
            extra = f"  mode={t['params'].get('mode')}"
        elif t["step"] == "recruit":
            extra = f"  times={t['params'].get('times')}"
        elif t["step"] == "mall_shop":
            extra = f"  只买打折={t['params'].get('only_buy_discount')}"
        print(f"  - {t['name']}（{t['type']}）{extra}")

    if not args.no_ensure and not args.dry_run:
        info = drv.ensure_ready(adb=args.adb, address=args.address,
                                log=(lambda *_a, **_k: None) if args.quiet else print)
        print(f"  环境：模拟器在线={info['emulator_online']} 游戏前台={info['game_foreground']}"
              + ("（本次拉起）" if info["launched_game"] or info["launched_emulator"] else ""))

    report = drv.run_tasks(queue, maa_dir=args.maa_dir, adb=args.adb,
                           address=args.address, connection=args.connection,
                           log_path=log_path, max_seconds=args.max_seconds,
                           dry_run=args.dry_run)

    code, lines = drv.summarize(queue, report)
    header = f"=== 结果 {_dt.datetime.now():%Y-%m-%d %H:%M:%S} ==="
    body = "\n".join([header, *lines, "", f"日志：{report.get('log')}"])
    print("-" * 52)
    print(body)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # 追加而不是覆盖：一天内可能分几次跑，回执要能累积
    with open(OUT_DIR / f"daily-{_dt.datetime.now():%Y%m%d}.report.txt", "a", encoding="utf-8") as fh:
        fh.write(body + "\n\n")
    return code


if __name__ == "__main__":
    sys.exit(main())

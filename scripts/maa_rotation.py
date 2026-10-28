#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MAA 基建「一键换班」单点脚本 —— 只干这一件事。

Infrast mode = 20000 (Rotation) 的语义：
    0     = 默认换班（MAA 自己算干员组合，会覆盖你的方案）
    10000 = 自定义换班（需要 base-scheduling JSON 文件）
    20000 = 一键轮换：调用游戏内保存的排班方案，不自己挑人
协议出处：docs/zh-cn/protocol/integration.md 的 `Infrast` -> `mode`。

资源红线（写死）：无人机 _NotUse / 源石碎片不补货 / 不刷理智 / 不碎石 / 不购物。

用法
    python scripts/maa_rotation.py --dry-run     # 只加载 MaaCore 与资源，不连模拟器
    python scripts/maa_rotation.py               # 进基建 -> 一键换班
    python scripts/maa_rotation.py --no-startup  # 游戏已停在主界面，跳过 StartUp
"""

from __future__ import annotations

import argparse
import datetime as _dt
import sys
from pathlib import Path

import maa_driver as drv

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_FACILITIES = "Mfg,Trade,Power,Control,Reception,Office,Dorm"

RESOURCE_POLICY = {
    "drones": "_NotUse",                # 不使用无人机
    "replenish": False,                 # 不自动补源石碎片
    "threshold": 0.3,                   # mode=20000 下无效，保留以对齐文档
    "dorm_notstationed_enabled": True,
    "dorm_trust_enabled": False,        # 不塞信赖未满干员
    "reception_message_board": True,    # 领信息板信用（免费）
    "reception_clue_exchange": False,
    "reception_send_clue": False,
    "continue_training": False,
}


def main() -> int:
    ap = argparse.ArgumentParser(description="MAA 基建一键换班（Infrast mode=20000）")
    ap.add_argument("--maa-dir", default=drv.DEFAULT_MAA_DIR)
    ap.add_argument("--adb", default=drv.DEFAULT_ADB)
    ap.add_argument("--address", default=drv.DEFAULT_ADDRESS)
    ap.add_argument("--connection", default="General")
    ap.add_argument("--client", default=drv.DEFAULT_CLIENT)
    ap.add_argument("--facilities", default=DEFAULT_FACILITIES, help="设施列表，逗号分隔")
    ap.add_argument("--no-startup", action="store_true", help="不执行 StartUp")
    ap.add_argument("--no-ensure", action="store_true", help="不自动拉起模拟器/游戏")
    ap.add_argument("--max-seconds", type=int, default=420)
    ap.add_argument("--dry-run", action="store_true", help="只加载 MaaCore 与资源")
    args = ap.parse_args()

    facilities = [f.strip() for f in args.facilities.split(",") if f.strip()]
    queue = []
    if not args.no_startup:
        queue.append({"name": "唤醒游戏", "type": "StartUp",
                      "params": {"client_type": args.client, "start_game_enabled": True}})
    queue.append({"name": "收基建 + 一键换班", "type": "Infrast",
                  "params": dict(mode=20000, facility=facilities, **RESOURCE_POLICY)})

    if not args.no_ensure and not args.dry_run:
        drv.ensure_ready(adb=args.adb, address=args.address)

    report = drv.run_tasks(queue, maa_dir=args.maa_dir, adb=args.adb,
                           address=args.address, connection=args.connection,
                           max_seconds=args.max_seconds, dry_run=args.dry_run)
    code, lines = drv.summarize(queue, report)
    print("-" * 52)
    print("\n".join(lines))
    print("日志：", report.get("log"))
    return code


if __name__ == "__main__":
    sys.exit(main())

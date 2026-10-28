#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MAA 通用驱动（MaaCore v6.20.1 官方 Python 绑定）。

给 scripts 下的各个小脚本共用：加载 MaaCore、连模拟器、按顺序跑任务队列、
把回调写成 JSONL、返回每个任务链的结果。

不提供任何“花钱”能力：源石/抽卡/充值/MAA 自更新一律不碰。
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Iterable, Sequence

DEFAULT_MAA_DIR = r"D:\Gameguy\external\maa"
DEFAULT_ADB = r"D:\Gameguy\external\platform-tools\adb.exe"
DEFAULT_ADDRESS = "127.0.0.1:16384"
DEFAULT_CLIENT = "Official"
DEFAULT_MUMU_CLI = r"D:\MuMuPlayer\nx_main\mumu-cli.exe"
DEFAULT_VMINDEX = "0"
ARKNIGHTS_PACKAGE = "com.hypergryph.arknights"

MSG_KIND = {
    0: "InternalError", 1: "InitFailed", 2: "ConnectionInfo", 3: "AllTasksCompleted",
    4: "AsyncCallInfo", 5: "Destroyed",
    10000: "TaskChainError", 10001: "TaskChainStart", 10002: "TaskChainCompleted",
    10003: "TaskChainExtraInfo", 10004: "TaskChainStopped",
    20000: "SubTaskError", 20001: "SubTaskStart", 20002: "SubTaskCompleted",
    20003: "SubTaskExtraInfo",
}

# 心跳类消息不刷控制台，但仍写日志。
QUIET = {"ConnectionInfo", "SubTaskStart", "SubTaskCompleted", "SubTaskExtraInfo",
         "AsyncCallInfo", "Destroyed"}


def now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def load_binding(maa_dir: Path):
    """加载 MAA 官方 Python 绑定；返回 (Asst, InstanceOptionType, StaticOptionType)。"""
    py_root = maa_dir / "Python"
    if not (py_root / "asst" / "asst.py").is_file():
        raise SystemExit(f"未找到 MAA Python 绑定：{py_root}\\asst\\asst.py")
    if str(py_root) not in sys.path:
        sys.path.insert(0, str(py_root))
    if os.name == "nt" and hasattr(os, "add_dll_directory"):
        os.add_dll_directory(str(maa_dir))  # MaaUtils.dll / opencv / onnxruntime
    from asst.asst import Asst
    from asst.utils import InstanceOptionType, StaticOptionType
    return Asst, InstanceOptionType, StaticOptionType


# --------------------------------------------------------------------------
# 环境准备：模拟器 / 游戏前台
# --------------------------------------------------------------------------
def _run(cmd: Sequence[str], timeout: int = 60) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, errors="replace",
                           timeout=timeout, encoding="utf-8")
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except Exception as exc:  # noqa: BLE001
        return 1, f"{type(exc).__name__}: {exc}"


def adb_online(adb: str, address: str) -> bool:
    _run([adb, "connect", address], timeout=30)
    code, out = _run([adb, "-s", address, "shell", "echo", "ok"], timeout=30)
    return code == 0 and "ok" in out


def game_foreground(adb: str, address: str, package: str = ARKNIGHTS_PACKAGE) -> bool:
    code, out = _run([adb, "-s", address, "shell",
                      "dumpsys window | grep -E 'mCurrentFocus'"], timeout=30)
    return code == 0 and package in out


def ensure_ready(*, adb: str = DEFAULT_ADB, address: str = DEFAULT_ADDRESS,
                 mumu_cli: str = DEFAULT_MUMU_CLI, vmindex: str = DEFAULT_VMINDEX,
                 package: str = ARKNIGHTS_PACKAGE, boot_timeout: int = 240,
                 game_timeout: int = 150, log=print) -> dict:
    """确保模拟器在线 + 游戏在前台。已经就绪时几乎不花时间。"""
    info = {"emulator_online": False, "launched_emulator": False,
            "launched_game": False, "game_foreground": False}

    if not adb_online(adb, address):
        if not Path(mumu_cli).is_file():
            raise SystemExit(f"模拟器未启动，且找不到 MuMu CLI：{mumu_cli}")
        log(f"模拟器未在线，尝试启动 MuMu 实例 {vmindex} ...")
        code, out = _run([mumu_cli, "control", "--vmindex", str(vmindex), "launch"], timeout=120)
        info["launched_emulator"] = True
        log(f"mumu-cli launch -> {code} {out.strip()[:200]}")
        deadline = time.time() + boot_timeout
        while time.time() < deadline:
            if adb_online(adb, address):
                break
            time.sleep(5)
        else:
            raise SystemExit(f"模拟器 {boot_timeout}s 内没有连上 {address}")
    info["emulator_online"] = True

    if not game_foreground(adb, address, package):
        log("游戏不在前台，拉起明日方舟 ...")
        code, out = _run([mumu_cli, "control", "--vmindex", str(vmindex),
                          "app", "launch", "--package", package], timeout=120)
        if code != 0 or not game_foreground(adb, address, package):
            _run([adb, "-s", address, "shell", "monkey", "-p", package,
                  "-c", "android.intent.category.LAUNCHER", "1"], timeout=60)
        info["launched_game"] = True
        deadline = time.time() + game_timeout
        while time.time() < deadline:
            if game_foreground(adb, address, package):
                break
            time.sleep(3)
        else:
            raise SystemExit("游戏启动超时，未能切到前台")
    info["game_foreground"] = True
    return info


# --------------------------------------------------------------------------
# 任务队列
# --------------------------------------------------------------------------
def run_tasks(tasks: Iterable[dict], *, maa_dir: str = DEFAULT_MAA_DIR,
              adb: str = DEFAULT_ADB, address: str = DEFAULT_ADDRESS,
              connection: str = "General", log_path: Path | None = None,
              max_seconds: int = 1800, dry_run: bool = False) -> dict:
    """按顺序执行任务队列。tasks 每项 {"name": 显示名, "type": MAA任务类型, "params": {...}}。"""
    tasks = list(tasks)
    maa_dir_p = Path(maa_dir).resolve()
    if not maa_dir_p.is_dir():
        raise SystemExit(f"MAA 目录不存在：{maa_dir_p}")
    if not Path(adb).is_file():
        raise SystemExit(f"adb 不存在：{adb}")

    Asst, InstanceOptionType, _Static = load_binding(maa_dir_p)

    log_path = Path(log_path) if log_path else Path(__file__).resolve().parent / "out" / (
        f"maa-run-{_dt.datetime.now():%Y%m%d-%H%M%S}.jsonl")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_fh = log_path.open("w", encoding="utf-8")

    state: dict[str, Any] = {"completed": [], "errors": [], "subtask_errors": [],
                             "done": False, "aborted": None}

    def record(kind: str, payload) -> None:
        if log_fh.closed:  # 退出时 MaaCore 仍可能回调
            return
        try:
            log_fh.write(json.dumps({"at": now(), "kind": kind, "data": payload},
                                    ensure_ascii=False) + "\n")
            log_fh.flush()
        except ValueError:
            pass

    @Asst.CallBackType
    def on_message(msg: int, details: bytes, arg) -> None:  # noqa: ARG001
        kind = MSG_KIND.get(msg, f"Unknown({msg})")
        try:
            data = json.loads(details.decode("utf-8")) if details else {}
        except Exception:  # noqa: BLE001
            data = {"raw": (details or b"").decode("utf-8", "replace")}
        record(kind, data)
        chain = data.get("taskchain") or ""
        if kind == "TaskChainStart":
            print(f"[{now()}] 开始：{chain}", flush=True)
        elif kind == "TaskChainCompleted":
            state["completed"].append(chain)
            print(f"[{now()}] 完成：{chain}", flush=True)
        elif kind in ("TaskChainError", "TaskChainStopped"):
            state["errors"].append({"chain": chain, "kind": kind})
            print(f"[{now()}] 失败：{chain} ({kind})", flush=True)
        elif kind == "SubTaskError":
            state["subtask_errors"].append({"chain": chain,
                                            "subtask": data.get("subtask"),
                                            "first": data.get("first")})
            print(f"[{now()}] 子任务失败：{chain} / {data.get('subtask')}", flush=True)
        elif kind == "AllTasksCompleted":
            state["done"] = True
            print(f"[{now()}] 任务队列全部结束", flush=True)
        elif kind == "InternalError":
            state["errors"].append({"chain": chain or "-", "kind": kind})
            print(f"[{now()}] 内部错误：{data}", flush=True)
        elif kind not in QUIET:
            print(f"[{now()}] {kind}: {json.dumps(data, ensure_ascii=False)[:200]}", flush=True)

    if not Asst.load(path=str(maa_dir_p)):
        log_fh.close()
        raise SystemExit("MaaCore 加载失败（AsstLoadResource 返回 false）")

    asst = Asst(callback=on_message)
    asst.set_instance_option(InstanceOptionType.touch_type, "minitouch")

    if dry_run:
        print(f"MaaCore 已加载：{maa_dir_p}")
        print("计划执行的任务队列：")
        for t in tasks:
            print(f"  - {t['type']:<10} {json.dumps(t.get('params', {}), ensure_ascii=False)}")
        print("未连接模拟器（--dry-run）。日志：", log_path)
        log_fh.close()
        return {"dry_run": True, "log": str(log_path), "state": state, "connected": False}

    print(f"[{now()}] 连接 {address} ...", flush=True)
    if not asst.connect(adb, address, connection):
        print("连接失败：确认模拟器已启动、adb 已连上该地址", file=sys.stderr)
        log_fh.close()
        return {"dry_run": False, "log": str(log_path), "state": state,
                "connected": False, "connect_failed": True}
    record("connect", {"address": address, "ok": True})

    for t in tasks:
        asst.append_task(t["type"], t.get("params", {}))

    if not asst.start():
        print("AsstStart 失败", file=sys.stderr)
        log_fh.close()
        return {"dry_run": False, "log": str(log_path), "state": state,
                "connected": True, "start_failed": True}

    deadline = time.time() + max(30, max_seconds)
    try:
        while time.time() < deadline:
            if state["done"]:
                break
            if not asst.running():
                break
            time.sleep(0.3)
        else:
            print("超时，主动停止", file=sys.stderr)
            asst.stop()
    except KeyboardInterrupt:
        print("收到中断，停止任务", file=sys.stderr)
        asst.stop()
    finally:
        time.sleep(0.5)
        try:
            asst.stop()
        except Exception:  # noqa: BLE001
            pass
        log_fh.close()

    return {"dry_run": False, "log": str(log_path), "state": state,
            "connected": True, "start_failed": False, "connect_failed": False}


def summarize(tasks: Sequence[dict], report: dict) -> tuple[int, list[str]]:
    """把 run_tasks 结果转成人话；返回 (退出码, 摘要行)。"""
    st = report.get("state") or {}
    if report.get("dry_run"):
        return 0, ["dry-run：已加载 MaaCore 与资源，未连接模拟器"]
    if report.get("connect_failed"):
        return 2, ["连接模拟器失败"]
    if report.get("start_failed"):
        return 3, ["AsstStart 失败"]

    lines: list[str] = []
    completed = st.get("completed", [])
    errors = st.get("errors", [])
    failed_chains = {e["chain"] for e in errors}
    ok_all = True
    for t in tasks:
        chain = t["type"]
        if chain in failed_chains:
            ok_all = False
            lines.append(f"  [x] {t.get('name', chain)}（{chain}）失败")
        elif chain in completed:
            lines.append(f"  [v] {t.get('name', chain)}（{chain}）完成")
        else:
            ok_all = False
            lines.append(f"  [ ] {t.get('name', chain)}（{chain}）未执行/无结果")

    for e in st.get("subtask_errors", []):
        first = e.get("first") or []
        lines.append(f"  ~ 非阻塞：{e.get('chain')} / {e.get('subtask')}"
                     + (f"（{first[-1]}）" if first else ""))
    if not st.get("done"):
        lines.append("  ! 任务队列没有跑到 AllTasksCompleted")
    return (0 if ok_all else 1), lines

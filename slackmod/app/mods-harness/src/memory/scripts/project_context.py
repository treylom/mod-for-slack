#!/usr/bin/env python3
"""DM 스레드 ↔ 프로젝트 맥락 읽기 (모델 호출 0 · 읽기 전용). stdout JSON 한 줄."""
import argparse
import json
import os
import re
import sqlite3
import sys

ROOM_RE = re.compile(r"100-project/(\d{4}-\d{2}-\d{2}-[A-Za-z0-9._-]+)")
TAIL_BYTES = 8 * 1024
LINE_CAP = 200
REL_CAP = 80
COLS = ("id", "source", "adopted", "dispatch", "evidence", "status", "owner",
        "owner_norm", "release_cond", "updated_at", "created_at", "created_by", "priority")


def open_ro(path):
    """Same rule as feedback_auto.open_ro: -wal and -shm present → mode=ro (sees rows not yet checkpointed, makes no
    file); otherwise immutable=1 (nothing outside the main file to miss)."""
    if os.path.exists(path + "-wal") and os.path.exists(path + "-shm"):
        return sqlite3.connect("file:" + path + "?mode=ro", uri=True)
    return sqlite3.connect("file:" + path + "?mode=ro&immutable=1", uri=True)


def bot_rows(conn, bot):
    cur = conn.execute("select " + ", ".join(COLS) +
                       " from directives where owner_norm = ? or owner = ?", (bot, bot))
    rows = [dict(zip(COLS, r)) for r in cur.fetchall()]
    rows.sort(key=lambda r: str(r["updated_at"] or ""), reverse=True)
    return rows


def _txt(v):
    return "" if v is None else str(v)


def find_room(rows, rooms_root, fields):
    for r in rows:
        for f in fields:
            for m in ROOM_RE.finditer(_txt(r.get(f))):
                name = m.group(1)
                for cand in (name, name.rstrip("._-")):
                    if cand and os.path.isdir(os.path.join(rooms_root, cand)):
                        return cand
    return ""


def tail_lines(rooms_root, room, n):
    if not room or n <= 0:
        return []
    try:
        with open(os.path.join(rooms_root, room, "02-progress.md"), "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - TAIL_BYTES))
            buf = fh.read()
    except OSError:
        return []
    lines = [l.strip() for l in buf.decode("utf-8", "replace").splitlines()]
    lines = [l for l in lines if l]
    return [l[:LINE_CAP] for l in lines[-n:]]


def run(args):
    if not os.path.isfile(args.ledger):
        return {"bound": False, "error": "no ledger"}
    try:
        conn = open_ro(args.ledger)
        try:
            rows = bot_rows(conn, args.bot)
        finally:
            conn.close()
    except sqlite3.Error as exc:
        return {"bound": False, "error": "ledger " + type(exc).__name__}

    text_fields = ("dispatch", "evidence", "release_cond")
    how, sel, room = "", [], ""
    if args.room or args.ledger_id:
        how = "explicit"
        if args.ledger_id:
            ids = set(args.ledger_id)
            sel = [r for r in rows if str(r["id"]) in ids]
        else:
            sel = [r for r in rows if any(args.room in _txt(r[f]) for f in text_fields)]
        if args.room:
            if os.path.isdir(os.path.join(args.rooms_root, args.room)):
                room = args.room
        else:
            room = find_room(sel, args.rooms_root, text_fields)
    elif args.root_ts:
        sel = [r for r in rows if args.root_ts in _txt(r["source"])]
        if sel:
            how = "ledger"
            room = find_room(sel, args.rooms_root, ("source", "adopted") + text_fields)
    if not sel and not room:
        return {"bound": False, "how": "", "room": "", "ledger": [], "tail": []}
    open_rows = [r for r in sel if _txt(r["status"]) != "완료"][:max(0, args.open_max)]
    ledger = [{"id": r["id"], "status": r["status"],
               "release": re.sub(r"\s+", " ", _txt(r["release_cond"])).strip()[:REL_CAP]}
              for r in open_rows]
    return {"bound": True, "how": how, "room": room, "ledger": ledger,
            "tail": tail_lines(args.rooms_root, room, args.tail)}


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--ledger", required=True)
    p.add_argument("--rooms-root", required=True)
    p.add_argument("--bot", required=True)
    p.add_argument("--root-ts")
    p.add_argument("--room")
    p.add_argument("--ledger-id", action="append", default=[])
    p.add_argument("--tail", type=int, default=3)
    p.add_argument("--open-max", type=int, default=3)
    args = p.parse_args(argv)
    sys.stdout.write(json.dumps(run(args), ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

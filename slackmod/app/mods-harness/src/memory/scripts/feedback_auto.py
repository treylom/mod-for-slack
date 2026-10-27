#!/usr/bin/env python3
"""KM 피드백 자동 노트 만들기 (형식 B · 모델 호출 0). 파일은 쓰지 않고 stdout JSON 으로 돌려준다."""
import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
WINDOW = 4 * 1024 * 1024
ORIG_CAP = 4000
PREV_CHARS = 600
THREAD_CHARS = 300
CHANNEL_RE = re.compile(r"<channel\b([^>]*)>(.*?)</channel>", re.S)
ATTR_RE = re.compile(r'([A-Za-z_]+)="([^"]*)"')


def open_ro(path):
    """Read-only without ever creating files next to a live DB. A WAL database with its -wal and -shm present is
    opened mode=ro (reads the WAL, so rows not yet checkpointed are seen; no new file is made). Without a -wal
    there is nothing outside the main file to miss, so immutable=1 (creates nothing, 10-18 lesson)."""
    if os.path.exists(path + "-wal") and os.path.exists(path + "-shm"):
        return sqlite3.connect("file:" + path + "?mode=ro", uri=True)
    return sqlite3.connect("file:" + path + "?mode=ro&immutable=1", uri=True)


# 출처: .claude/scripts/feedback_h1_judge.py 의 _assistant_text · prev_bot_line (상한만 600)
def _assistant_text(rec):
    msg = rec.get("message") or {}
    content = msg.get("content")
    if not isinstance(content, list):
        return None
    texts = [b.get("text") for b in content
             if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str)
             and b.get("text").strip()]
    if texts:
        return texts[-1]
    for b in reversed(content):
        if isinstance(b, dict) and b.get("type") == "tool_use":
            t = (b.get("input") or {}).get("text")
            if isinstance(t, str) and t.strip():
                return t
    return None


def prev_bot_line(path, roff):
    try:
        roff = int(roff)
        start = max(0, roff - WINDOW)
        with open(path, "rb") as fh:
            fh.seek(start)
            buf = fh.read(roff - start)
    except (OSError, ValueError, TypeError):
        return ""
    lines = buf.split(b"\n")
    if start > 0:
        lines = lines[1:]
    for line in reversed(lines):
        if b'"assistant"' not in line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if not isinstance(rec, dict) or rec.get("type") != "assistant":
            continue
        t = _assistant_text(rec)
        if t:
            return re.sub(r"\s+", " ", t).strip()[:PREV_CHARS]
    return ""


def prev_reply_to(path, roff, channel):
    """The bot's last reply-tool call to this same conversation (input.chat_id == channel) before rec_offset —
    what the owner was answering. Falls back to prev_bot_line (any last bot text) when none is found."""
    try:
        roff = int(roff)
        start = max(0, roff - WINDOW)
        with open(path, "rb") as fh:
            fh.seek(start)
            buf = fh.read(roff - start)
    except (OSError, ValueError, TypeError):
        return ""
    lines = buf.split(b"\n")
    if start > 0:
        lines = lines[1:]
    needle = channel.encode() if channel else b""
    for line in reversed(lines):
        if b'"assistant"' not in line or (needle and needle not in line):
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if not isinstance(rec, dict) or rec.get("type") != "assistant":
            continue
        content = (rec.get("message") or {}).get("content")
        for b in reversed(content if isinstance(content, list) else []):
            if not (isinstance(b, dict) and b.get("type") == "tool_use" and "reply" in str(b.get("name", ""))):
                continue
            inp = b.get("input") or {}
            t = inp.get("text")
            if inp.get("chat_id") == channel and isinstance(t, str) and t.strip():
                return re.sub(r"\s+", " ", t).strip()[:PREV_CHARS]
    return prev_bot_line(path, roff)


def _user_text(rec):
    content = (rec.get("message") or {}).get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text") for b in content
                         if isinstance(b, dict) and b.get("type") == "text"
                         and isinstance(b.get("text"), str))
    return ""


def original_text(path, roff, ts):
    try:
        with open(path, "rb") as fh:
            fh.seek(int(roff))
            line = fh.readline()
        rec = json.loads(line)
        body = _user_text(rec)
    except (OSError, ValueError, TypeError) as exc:
        return "(원문 못 읽음: %s)" % type(exc).__name__
    first = None
    for m in CHANNEL_RE.finditer(body):
        attrs = dict(ATTR_RE.findall(m.group(1)))
        if attrs.get("ts") == ts:
            return m.group(2).strip()[:ORIG_CAP]
        if first is None:
            first = m.group(2)
    if first is not None:
        return first.strip()[:ORIG_CAP]
    return body.strip()[:ORIG_CAP]


def thread_prev(path, roff, thread_ts, ts):
    if not thread_ts:
        return ""
    try:
        roff = int(roff)
        start = max(0, roff - WINDOW)
        with open(path, "rb") as fh:
            fh.seek(start)
            buf = fh.read(roff - start)
    except (OSError, ValueError, TypeError):
        return ""
    lines = buf.split(b"\n")
    if start > 0:
        lines = lines[1:]
    for line in reversed(lines):
        if b"<channel" not in line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if not isinstance(rec, dict) or rec.get("type") != "user":
            continue
        for m in CHANNEL_RE.finditer(_user_text(rec)):
            a = dict(ATTR_RE.findall(m.group(1)))
            if (a.get("thread_ts") == thread_ts or a.get("ts") == thread_ts) and a.get("ts") != ts:
                return re.sub(r"\s+", " ", m.group(2)).strip()[:THREAD_CHARS]
    return ""


def ledger_rows(path, ts):
    if not path:
        return []
    try:
        conn = open_ro(path)
        try:
            like = "%" + ts + "%"
            rows = conn.execute(
                "select id, status from directives where source like ? or dispatch like ? "
                "or evidence like ? limit 3", (like, like, like)).fetchall()
        finally:
            conn.close()
        return [(str(r[0]), str(r[1])) for r in rows]
    except Exception:
        return []


def room_names(root, keys):
    if not root:
        return []
    keys = [k for k in keys if k]
    out = []
    try:
        dirs = sorted((d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d))),
                      reverse=True)[:400]
    except OSError:
        return []
    for d in dirs:
        hit = False
        for fn in ("00-context.md", "02-progress.md"):
            try:
                with open(os.path.join(root, d, fn), "rb") as fh:
                    head = fh.read(64 * 1024).decode("utf-8", "replace")
            except OSError:
                continue
            if any(k in head for k in keys):
                hit = True
                break
        if hit:
            out.append(d)
            if len(out) >= 2:
                break
    return out


def guard(text):
    """줄 시작 'from:' 막기(H2 가 그 키를 본다)."""
    return "\n".join((" " + l) if l.startswith("from:") else l for l in text.split("\n"))


def build(bot, ts, channel, thread_ts, orig, prev, tprev, ledger, rooms):
    dt = datetime.fromtimestamp(float(ts), KST)
    quoted = "\n".join("> " + l for l in orig.split("\n"))
    led_fm = ", ".join('"%s"' % i for i, _ in ledger)
    room_fm = ", ".join('"%s"' % r for r in rooms)
    led_txt = ", ".join("%s(%s)" % x for x in ledger) or "(없음)"
    room_txt = ", ".join(rooms) or "(없음)"
    text = f"""---
kind: work-feedback-auto
type: work-feedback-auto
date: {dt.strftime('%Y-%m-%d')}
bot: {bot}
feedback: negative
source_ts: ["{ts}"]
channel: {channel}
thread_ts: "{thread_ts or ''}"
ledger: [{led_fm}]
room: [{room_fm}]
generated_by: mods-harness memory lane — feedback auto (format B · model calls 0)
---
# 자동 피드백 기록 — {bot} · {dt.strftime('%Y-%m-%d %H:%M:%S')}

## 주인 원문
{quoted}

## 직전 봇 답 (≤600자)
{guard(prev) if prev else '(없음)'}

## 같은 스레드 직전 글 (≤300자)
{guard(tprev) if tprev else '(없음)'}

## 연결
- 대장: {led_txt}
- 회의방: {room_txt}

> 자동 기록입니다. 반성 노트(frontmatter `from:` 에 이 ts)는 따로 써야 피드백 차단(H2)이 풀립니다.
"""
    return text, dt


SQL = ("select f.ts, f.channel, e.thread_ts, e.transcript_path, e.rec_offset "
       "from eval_final f join eval e on e.bot=f.bot and e.channel=f.channel and e.ts=f.ts "
       "where f.final_cls='correction' and f.bot=? and (? is null or cast(f.ts as real) > cast(? as real)) "
       "order by cast(f.ts as real) asc")


def run(args):
    if not os.path.isfile(args.h1):
        return {"notes": [], "error": "no h1"}
    try:
        conn = open_ro(args.h1)
        try:
            rows = conn.execute(SQL, (args.bot, args.since_ts, args.since_ts)).fetchall()
        finally:
            conn.close()
    except sqlite3.Error as exc:
        return {"notes": [], "error": "h1 " + type(exc).__name__}
    notes, considered, skipped = [], 0, 0
    for ts, channel, thread_ts, tpath, roff in rows:
        ts = str(ts)
        considered += 1
        try:
            dt = datetime.fromtimestamp(float(ts), KST)
        except ValueError:
            continue
        path = os.path.join(args.notes_dir, "_auto", "%s-%s-%s.md" % (
            dt.strftime("%Y-%m-%d"), args.bot, ts.replace(".", "-")))
        if os.path.exists(path):
            skipped += 1
            continue
        if tpath and roff is not None:
            orig = original_text(tpath, roff, ts)
            prev = prev_reply_to(tpath, roff, channel)
            tprev = thread_prev(tpath, roff, thread_ts, ts)
        else:
            orig, prev, tprev = "(원문 못 읽음: no transcript)", "", ""
        text, _ = build(args.bot, ts, channel, thread_ts, orig, prev, tprev,
                        ledger_rows(args.ledger, ts),
                        room_names(args.rooms_root, [thread_ts or ts]))
        notes.append({"path": path, "text": text, "ts": ts})
        if len(notes) >= args.max:
            break
    return {"notes": notes, "considered": considered, "skipped_existing": skipped}


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--h1", required=True)
    p.add_argument("--bot", required=True)
    p.add_argument("--notes-dir", required=True)
    p.add_argument("--ledger")
    p.add_argument("--rooms-root")
    p.add_argument("--since-ts")
    p.add_argument("--max", type=int, default=5)
    args = p.parse_args(argv)
    sys.stdout.write(json.dumps(run(args), ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""cherina-pod 唯一入口：把一期播客做成一节精听课。

  python3 scripts/lesson.py "<来源>" [--episode latest|N|关键词] [--level 水平] [--lang en-zh|zh-en]
  python3 scripts/lesson.py "<来源>" --list        # 只列出最近的单集，不处理
  python3 scripts/lesson.py --doctor               # 检查环境与密钥

<来源> 可以是：播客名（"6 Minute English"）、RSS 地址、Apple Podcasts 链接、
iTunes 节目 id，或本地音频文件路径。

最后一行永远是  RESULT {json}  ，ok=true 时包含产物路径，ok=false 时包含 stage / error / fix。
退出码：0 成功；1 处理失败；2 参数或环境问题。
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import http_json, load_env  # noqa: E402

ITUNES_SEARCH = "https://itunes.apple.com/search"
ITUNES_LOOKUP = "https://itunes.apple.com/lookup"

FIX = {
    "env": "运行 python3 scripts/lesson.py --doctor 查看缺什么，按提示修复后重试。",
    "resolve": "换一种写法：给出更完整的播客名，或直接给 RSS 地址 / Apple Podcasts 链接。",
    "episode": "先加 --list 看最近的单集，再用 --episode <编号> 指定。",
    "download": "这一集的音频链接可能失效或需要登录，换一集试试（--episode 2）。",
    "transcribe": "检查 .env 里的 DASHSCOPE_API_KEY 是否正确、阿里云百炼账户是否有余额。重跑同一条命令会续跑。",
    "translate": "翻译接口失败。检查 DASHSCOPE_API_KEY，或在 .env 配置 LLM_BASE_URL + LLM_API_KEY 换一个 OpenAI 兼容服务。重跑会续跑，已译的句子不重复花钱。",
    "align": "对齐失败，通常是翻译不完整。重跑同一条命令即可续跑。",
    "lesson": "生成精听课失败。重跑：python3 scripts/build_lesson.py <期目录>",
}


def result(ok, code=0, **kw):
    print("RESULT " + json.dumps({"ok": ok, **kw}, ensure_ascii=False), flush=True)
    sys.exit(code)


def fail(stage, error, code=1):
    result(False, code, stage=stage, error=str(error)[:600], fix=FIX.get(stage, ""))


# ---------------------------------------------------------------- 环境检查
def doctor(online=True):
    checks = []

    def add(name, ok, fix=""):
        checks.append({"check": name, "ok": bool(ok), **({} if ok else {"fix": fix})})

    add("python>=3.10", sys.version_info >= (3, 10), "安装 Python 3.10 或更高版本。")
    add("ffmpeg", shutil.which("ffmpeg"), "安装 ffmpeg：macOS 用 `brew install ffmpeg`，Ubuntu 用 `sudo apt install ffmpeg`。")
    add("ffprobe", shutil.which("ffprobe"), "ffprobe 随 ffmpeg 一起安装。")
    has_key = bool(os.environ.get("DASHSCOPE_API_KEY"))
    add("DASHSCOPE_API_KEY", has_key,
        "复制 .env.example 为 .env，填入阿里云百炼的 API Key（https://bailian.console.aliyun.com/ → API-KEY）。"
        "也可以放在 ~/.config/cherina-pod/.env。")
    if online and has_key:
        try:
            import translate

            prov = sorted(translate.available_providers(), key=lambda p: 0 if p.get("preferred") else 1)
            out = translate.chat_completion(prov[0], [{"role": "user", "content": "Reply with: ok"}], max_tokens=20, timeout=40)
            add(f"llm:{prov[0]['name']}", bool(out.strip()))
        except (RuntimeError, SystemExit) as e:
            add("llm", False, f"翻译接口不可用：{str(e)[:200]}。可在 .env 配置 LLM_BASE_URL + LLM_API_KEY。")
    ok = all(c["ok"] for c in checks)
    result(ok, 0 if ok else 2, stage="doctor", checks=checks)


# ---------------------------------------------------------------- 解析来源
def lookup(cid):
    data = http_json(f"{ITUNES_LOOKUP}?id={cid}&media=podcast")
    res = [r for r in data.get("results", []) if r.get("feedUrl")]
    if not res:
        raise ValueError(f"iTunes 找不到节目 id={cid} 的 RSS")
    return res[0]


def resolve(src):
    """返回 dict(kind, rss?, title?, apple_episode?, path?, candidates?)。"""
    p = Path(os.path.expanduser(src))
    if p.is_file():
        return {"kind": "file", "path": str(p.resolve())}
    if re.match(r"^https?://", src):
        if "podcasts.apple.com" in src:
            m = re.search(r"/id(\d+)", src)
            if not m:
                raise ValueError("Apple Podcasts 链接里没有节目 id")
            info = lookup(m.group(1))
            q = urllib.parse.parse_qs(urllib.parse.urlparse(src).query)
            ep_title = None
            if q.get("i"):
                eps = http_json(f"{ITUNES_LOOKUP}?id={m.group(1)}&entity=podcastEpisode&limit=300").get("results", [])
                for e in eps:
                    if str(e.get("trackId")) == q["i"][0]:
                        ep_title = e.get("trackName")
                        break
            return {"kind": "rss", "rss": info["feedUrl"], "title": info.get("collectionName"), "apple_episode": ep_title}
        return {"kind": "rss", "rss": src}
    if re.fullmatch(r"\d{5,}", src):
        info = lookup(src)
        return {"kind": "rss", "rss": info["feedUrl"], "title": info.get("collectionName")}
    url = f"{ITUNES_SEARCH}?term={urllib.parse.quote(src)}&media=podcast&entity=podcast&limit=5"
    res = [r for r in http_json(url).get("results", []) if r.get("feedUrl")]
    if not res:
        raise ValueError(f"没有搜到名为“{src}”的播客")
    cands = [{"title": r.get("collectionName"), "author": r.get("artistName"), "id": r.get("collectionId")} for r in res]
    return {"kind": "rss", "rss": res[0]["feedUrl"], "title": res[0].get("collectionName"), "candidates": cands}


def pick_episode(episodes, want, apple_title=None):
    """返回 1 起的编号。want: latest / 数字 / 关键词。"""
    if apple_title:
        for i, e in enumerate(episodes, 1):
            if e["title"].strip().lower() == apple_title.strip().lower():
                return i
    w = (want or "latest").strip()
    if w.lower() in ("latest", "最新", "newest", "1"):
        return 1
    if w.isdigit():
        n = int(w)
        if not 1 <= n <= len(episodes):
            raise ValueError(f"编号超出范围：这个节目共有 {len(episodes)} 集")
        return n
    for i, e in enumerate(episodes, 1):
        if w.lower() in e["title"].lower():
            return i
    raise ValueError(f"没有标题包含“{w}”的单集")


# ---------------------------------------------------------------- 主流程
def run_step(stage, script, *args):
    cmd = [sys.executable, str(HERE / script), *map(str, args)]
    print(f"\n▶ {stage}: {' '.join(cmd[1:])}", flush=True)
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    out = proc.stdout or ""
    sys.stdout.write(out.replace("\r", "\n"))
    if proc.returncode:
        tail = "\n".join(l for l in out.replace("\r", "\n").splitlines() if l.strip())[-500:]
        fail(stage, tail or f"{script} 退出码 {proc.returncode}")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", nargs="?", help="播客名 / RSS / Apple Podcasts 链接 / iTunes id / 本地音频")
    ap.add_argument("--episode", default="latest", help="latest（默认）、编号（1 = 最新）或标题关键词")
    ap.add_argument("--list", action="store_true", help="只列出最近的单集")
    ap.add_argument("--level", help="学习者水平，例如“四级”“雅思 6”")
    ap.add_argument("--lang", default="en-zh", help="原文-译文：en-zh（默认，英文播客配中文）或 zh-en")
    ap.add_argument("--no-notes", action="store_true", help="不生成难点表达")
    ap.add_argument("--doctor", action="store_true", help="检查环境与密钥")
    args = ap.parse_args()
    load_env()

    if args.doctor:
        doctor()
    if not args.source:
        ap.print_help()
        result(False, 2, stage="args", error="缺少来源参数", fix="例：python3 scripts/lesson.py \"6 Minute English\"")

    m = re.fullmatch(r"([a-z]{2,3})-([a-z]{2,3})", args.lang.strip().lower())
    if not m:
        fail("args", f"--lang 格式应为 原文-译文，例如 en-zh，收到 {args.lang}", 2)
    src_lang, tgt_lang = m.group(1), m.group(2)

    if not args.list:
        missing = [n for n in ("ffmpeg", "ffprobe") if not shutil.which(n)]
        if missing or not os.environ.get("DASHSCOPE_API_KEY"):
            fail("env", f"缺少：{', '.join(missing + ([] if os.environ.get('DASHSCOPE_API_KEY') else ['DASHSCOPE_API_KEY']))}", 2)

    t0 = time.time()
    try:
        info = resolve(args.source)
    except (ValueError, OSError) as e:
        fail("resolve", e)

    import fetch_podcast

    if info["kind"] == "file":
        if args.list:
            fail("args", "本地音频没有单集列表", 2)
        ep_dir = fetch_podcast.import_local_audio(info["path"])
    else:
        try:
            podcast = fetch_podcast.fetch_rss(info["rss"])
        except Exception as e:  # noqa: BLE001  RSS 可能是任意坏数据
            fail("resolve", f"读取 RSS 失败：{e}")
        eps = podcast["episodes"]
        if not eps:
            fail("resolve", "这个 RSS 里没有单集")
        if args.list:
            result(True, podcast=podcast["meta"]["title"], rss=info["rss"], candidates=info.get("candidates"),
                   episodes=[{"n": i, "title": e["title"], "date": e["pub_date"], "duration": e["duration"]}
                             for i, e in enumerate(eps[:15], 1)])
        try:
            idx = pick_episode(eps, args.episode, info.get("apple_episode"))
        except ValueError as e:
            fail("episode", e)
        print(f"节目：{podcast['meta']['title']}\n单集：[{idx}] {eps[idx - 1]['title']}", flush=True)
        try:
            ep_dir = fetch_podcast.download_episode(info["rss"], idx)
        except SystemExit as e:
            fail("download", e)
        except Exception as e:  # noqa: BLE001
            fail("download", e)

    ep = Path(ep_dir).resolve()
    lang = ["--source-lang", src_lang, "--target-lang", tgt_lang]
    run_step("transcribe", "transcribe.py", ep, "--source-lang", src_lang)
    run_step("translate", "translate.py", ep, *lang)
    subprocess.run([sys.executable, str(HERE / "translate_titles.py"), str(ep), "--target-lang", tgt_lang],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    run_step("align", "align.py", ep, *lang)
    lesson_args = [ep] + (["--level", args.level] if args.level else []) + (["--no-notes"] if args.no_notes else [])
    out = run_step("lesson", "build_lesson.py", *lesson_args)

    mm = re.search(r"：(\d+) 句，(\d+) 段，难点 (\d+) 条", out)
    bil = json.loads((ep / "bilingual.json").read_text(encoding="utf-8"))
    result(
        True,
        title=(bil.get("episode") or {}).get("title"),
        podcast=(bil.get("podcast") or {}).get("title"),
        dir=str(ep),
        player=str(ep / "player.html"),
        handout=str(ep / "handout.html"),
        notes=str(ep / "notes.md") if (ep / "notes.md").exists() else None,
        sentences=int(mm.group(1)) if mm else None,
        segments=int(mm.group(2)) if mm else None,
        key_phrases=int(mm.group(3)) if mm else None,
        audio_minutes=round(float(bil.get("duration") or 0) / 60, 1),
        elapsed_minutes=round((time.time() - t0) / 60, 1),
    )


if __name__ == "__main__":
    main()

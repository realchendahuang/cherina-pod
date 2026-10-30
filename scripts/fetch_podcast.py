#!/usr/bin/env python3
"""播客获取：iTunes 搜索 → RSS 解析单集列表 → 下载音频到 episodes/<slug>/。

用法：
  python3 scripts/fetch_podcast.py --search "Lex Fridman"     # 搜索播客
  python3 scripts/fetch_podcast.py --episodes <id|rss_url>     # 列单集
  python3 scripts/fetch_podcast.py --episodes <id|rss_url> --index 3   # 下载第 3 集（从 1 起）
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import UA, http_get, http_json, strip_html  # noqa: E402

ITUNES_SEARCH = "https://itunes.apple.com/search"
ITUNES_LOOKUP = "https://itunes.apple.com/lookup"
ITUNES_NS = "{http://www.itunes.com/dtds/podcast-1.0.dtd}"
EPISODES_ROOT = os.path.join(HERE, "..", "episodes")


def fmt_pub_date(rfc822):
    """RFC822 → YYYY-MM-DD，失败则原样返回。"""
    import datetime
    import email.utils

    try:
        t = email.utils.parsedate_to_datetime(rfc822)
        return t.strftime("%Y-%m-%d")
    except Exception:
        return ""


def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:50]


def episode_slug(ep):
    """单集标题 → 目录名。目录名同时是 D1 episodes 表主键，必须保证不同集不重名：
    - 非拉丁标题（中文/日文等）整句被清空 → 用 pub_date + 音频 URL hash 兜底
    - 与已有目录同名但 meta 里音频 URL 不同（不同集撞名）→ 加 hash 后缀区分
    - 目录已存在且是同一集（或无 meta 的半途目录）→ 原样返回（断点续下/重跑）
    """
    slug = slugify(ep["title"])
    if slug:
        ep_dir = os.path.join(EPISODES_ROOT, slug)
        meta_path = os.path.join(ep_dir, "meta.json")
        if not os.path.isdir(ep_dir) or not os.path.exists(meta_path):
            return slug
        try:
            with open(meta_path, encoding="utf-8") as f:
                same = json.load(f).get("episode", {}).get("audio_url") == ep["audio_url"]
        except (OSError, json.JSONDecodeError):
            same = False
        if same:
            return slug
        h = hashlib.sha1(ep["audio_url"].encode("utf-8")).hexdigest()[:8]
        return f"{slug}-{h}"
    h = hashlib.sha1(ep["audio_url"].encode("utf-8")).hexdigest()[:8]
    date = (ep.get("pub_date") or "").replace("/", "-")
    return f"{slugify(date) or 'episode'}-{h}"


def http_download_with_resume(url, dest, timeout=300):
    """带断点续传和进度条的下载。

    - 已存在文件：从已下载字节发起 Range 请求续传
    - 显示实时进度（MB + 百分比）
    - 返回 (最终文件路径, 是否重新下载)
    """
    existing = os.path.getsize(dest) if os.path.exists(dest) else 0
    resumed = existing > 0

    headers = {"User-Agent": UA}
    if resumed:
        headers["Range"] = f"bytes={existing}-"

    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        total = None
        content_range = resp.headers.get("Content-Range")
        if resp.status == 206 and content_range:
            # "bytes 100-999/1000" → total=1000
            total = int(content_range.split("/")[-1])
        else:
            total = existing + int(resp.headers.get("Content-Length", 0))

        mode = "ab" if (resumed and resp.status == 206) else "wb"
        downloaded = existing if mode == "ab" else 0
        with open(dest, mode) as f:
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                _print_progress(downloaded, total)

    if resumed and resp.status == 200:
        print(f"\n⚠️ 服务端不支持续传，已重新下载", file=sys.stderr)
    return dest


def _print_progress(done, total):
    """单行进度条：xx.x MB / xxx.x MB (xx%)"""
    mb = done / 1e6
    if total:
        pct = done * 100 / max(total, 1)
        bar_len = 24
        filled = int(bar_len * done / max(total, 1))
        bar = "█" * filled + "░" * (bar_len - filled)
        sys.stdout.write(f"\r  {bar} {mb:6.1f}/{total / 1e6:6.1f} MB ({pct:4.1f}%)")
    else:
        sys.stdout.write(f"\r  {mb:6.1f} MB")
    sys.stdout.flush()


def validate_audio(path):
    """校验下载的文件是真实音频而非 HTML 错误页。

    返回 (是否有效, 格式名或错误说明)。
    """
    try:
        with open(path, "rb") as f:
            head = f.read(16)
    except OSError as e:
        return False, f"读取失败：{e}"
    if not head:
        return False, "空文件"

    if head.startswith(b"ID3") or head[:2] == b"\xff\xfb" or head[:2] == b"\xff\xf3":
        return True, "mp3"
    if head[:4] == b"fLaC":
        return True, "flac"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return True, "wav"
    if head[4:8] == b"ftyp":
        return True, "m4a/mp4"
    if head[:4] == b"OggS":
        return True, "ogg"
    # HTML 错误页 / 防盗链页面
    if head.lstrip()[:5] in (b"<!DOC", b"<html", b"<?xml"):
        return False, "疑似 HTML 错误页（防盗链或链接失效）"
    return True, "unknown"  # 无法识别魔数但也不像 HTML，放行


# ---------- 搜索 ----------


def search_podcasts(term):
    url = f"{ITUNES_SEARCH}?term={urllib.parse.quote(term)}&media=podcast&entity=podcast&limit=10"
    data = http_json(url)
    return data.get("results", [])


# ---------- RSS 解析 ----------


def _find(channel, parent, tag):
    """在 parent（或 channel）下查找标签，itunes 命名空间优先。

    注意：RSS 2.0 的普通 <image> 块（含 <url> 子元素）与 itunes:image
    （自闭合，href 属性）语义不同；itunes 扩展字段信息更完整，故优先。
    """
    p = parent if parent is not None else channel
    el = p.find(f"{ITUNES_NS}{tag}")
    if el is None:
        el = p.find(tag)
    return el


def parse_rss(rss_bytes):
    """返回 {meta: {...}, episodes: [{...}]}"""
    root = ET.fromstring(rss_bytes)
    ch = root.find("channel")
    if ch is None:
        sys.exit("无效 RSS：找不到 channel")

    def it(tag, parent=None, default=""):
        el = _find(ch, parent, tag)
        return el.text.strip() if el is not None and el.text else default

    def it_attr(tag, attr, parent=None):
        el = _find(ch, parent, tag)
        return el.get(attr, "") if el is not None else ""

    meta = {
        "title": it("title"),
        "author": it("author") or it_attr("image", "title"),
        "description": strip_html(it("description"))[:500],
        "image": it_attr("image", "href"),
        "feed_url": it("link"),
        "link": it("link"),
    }

    episodes = []
    for item in ch.findall("item"):
        title = it("title", item)
        desc = strip_html(it("description", item))
        pub_date = fmt_pub_date(it("pubDate", item))
        duration = it("duration", item)
        enclosure = item.find("enclosure")
        audio_url = enclosure.get("url", "") if enclosure is not None else ""
        # 单集封面（无则用节目封面）
        img = item.find(f"{ITUNES_NS}image")
        ep_image = img.get("href", "") if img is not None else meta["image"]
        episodes.append(
            {
                "title": title,
                "description": desc[:800],
                "pub_date": pub_date,
                "duration": duration,
                "audio_url": audio_url,
                "image": ep_image,
            }
        )
    return {"meta": meta, "episodes": episodes}


def fetch_rss(rss_url):
    return parse_rss(http_get(rss_url))


# ---------- 音频压缩：统一转 AAC-LC 64k mono（MP4 容器，.mp4 扩展名） ----------
# 理由见 docs/音频存储方案.md：体积砍半、全浏览器可播、.mp4 扩展名让 Cloudflare 默认缓存。


def is_valid_media(path):
    """ffprobe 校验是否为可解码的音频（能读到时长）。

    上次压缩被中断会留下无 moov atom 的半截文件，仅凭"存在且非空"会误判有效。
    """
    try:
        r = subprocess.run(
            [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(path),
            ],
            capture_output=True, text=True, timeout=60,
        )
        if r.returncode != 0:
            return False
        return float((r.stdout or "").strip() or 0) > 0
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return False


def compress_audio(src_path, audio_dir, keep_original=False):
    """把下载的原始音频压成 audio/episode.mp4（AAC-LC 64kbps 单声道）。
    返回压缩后的路径。幂等：已是有效的 episode.mp4 则直接返回。"""
    compressed = os.path.join(audio_dir, "episode.mp4")
    if os.path.abspath(src_path) == os.path.abspath(compressed):
        return src_path
    if os.path.exists(compressed) and os.path.getsize(compressed) > 0:
        if is_valid_media(compressed):
            print(f"  ⏭️ 已有压缩音频（{os.path.getsize(compressed) / 1e6:.1f} MB），跳过压缩")
            return compressed
        print("  ⚠️ 已有 episode.mp4 损坏（可能上次压缩中断），重新压缩", file=sys.stderr)
        os.remove(compressed)
    print("  压缩：AAC-LC 64kbps mono → episode.mp4 …")
    r = subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-nostdin",  # 关键：batch_add.sh 的 while-read 循环把 jobs 文件当 stdin，
            # ffmpeg 会进入交互模式把下一行任务当 filter 命令吃掉（URL 被截断的根因）
            "-i", src_path,
            "-vn", "-ac", "1", "-c:a", "aac", "-b:a", "64k",
            "-movflags", "+faststart",
            compressed,
        ]
    )
    if r.returncode != 0 or not os.path.exists(compressed) or os.path.getsize(compressed) == 0:
        print("❌ ffmpeg 压缩失败（ffmpeg 是否已安装？）", file=sys.stderr)
        sys.exit(1)
    src_mb = os.path.getsize(src_path) / 1e6
    dst_mb = os.path.getsize(compressed) / 1e6
    print(f"  ✅ 压缩完成：{src_mb:.1f} MB → {dst_mb:.1f} MB")
    if not keep_original:
        os.remove(src_path)
        print("  🗑️ 已删除原始音频（--keep-original 可保留）")
    return compressed


# ---------- 单集列表 / 下载 ----------


def resolve_rss_url(src):
    """src 可能是 RSS URL 或 iTunes collectionId。返回 RSS 的 URL。"""
    if src.startswith("http"):
        return src
    # 当作 iTunes collectionId，lookup 拿 feedUrl
    data = http_json(f"{ITUNES_LOOKUP}?id={src}&media=podcast")
    results = data.get("results", [])
    if not results or not results[0].get("feedUrl"):
        sys.exit(f"找不到 collectionId={src} 的 feedUrl")
    return results[0]["feedUrl"]


def list_episodes(src, max_n=20):
    podcast = fetch_rss(resolve_rss_url(src))
    print(f"\n节目：{podcast['meta']['title']}  |  作者：{podcast['meta']['author']}")
    print(
        f"共 {len(podcast['episodes'])} 集，显示前 {min(max_n, len(podcast['episodes']))} 集：\n"
    )
    for i, ep in enumerate(podcast["episodes"][:max_n], 1):
        dur = ep["duration"] or "?"
        print(f"[{i}] {ep['title']}  ({ep['pub_date'][:16]}, {dur})")
    return podcast


def download_episode(src, index, keep_original=False):
    podcast = fetch_rss(resolve_rss_url(src))
    eps = podcast["episodes"]
    if index < 1 or index > len(eps):
        sys.exit(f"index 超出范围（1-{len(eps)}）")
    ep = eps[index - 1]
    if not ep["audio_url"]:
        sys.exit(f"第 {index} 集没有音频链接（可能是 RSS 不提供 enclosure）")

    slug = episode_slug(ep)
    ep_dir = os.path.join(EPISODES_ROOT, slug)
    audio_dir = os.path.join(ep_dir, "audio")
    os.makedirs(audio_dir, exist_ok=True)

    # 查找已下载的音频（支持任意格式：episode.mp3 / episode.m4a / ...）
    audio_path = None
    if os.path.isdir(audio_dir):
        for f in os.listdir(audio_dir):
            if f.startswith("episode."):
                audio_path = os.path.join(audio_dir, f)
                break
    if audio_path is None:
        audio_path = os.path.join(audio_dir, "episode.mp3")

    print(f"下载：{ep['title']}")
    print(f"  音频：{ep['audio_url']}")
    print(f"  保存：{os.path.abspath(audio_path)}")

    if os.path.exists(audio_path) and os.path.getsize(audio_path) > 0:
        # 已存在：校验是否为有效音频；无效则删除重下
        ok, _fmt = validate_audio(audio_path)
        if ok:
            print(
                f"  ⏭️ 音频已存在（{os.path.getsize(audio_path) / 1e6:.1f} MB），跳过下载"
            )
        else:
            print(f"  ⚠️ 已有文件无效（可能是错误页或损坏文件），重新下载")
            os.remove(audio_path)
            http_download_with_resume(ep["audio_url"], audio_path, timeout=300)
            print()
            ok, fmt = validate_audio(audio_path)
            if not ok:
                os.remove(audio_path)
                print(f"❌ 下载的文件无效：{fmt}", file=sys.stderr)
                sys.exit(1)
            print(f"✅ 下载完成，{os.path.getsize(audio_path) / 1e6:.1f} MB（{fmt}）")
    else:
        http_download_with_resume(ep["audio_url"], audio_path, timeout=300)
        print()

        # 校验文件有效性
        ok, fmt = validate_audio(audio_path)
        if not ok:
            os.remove(audio_path)
            print(f"❌ 下载的文件无效：{fmt}", file=sys.stderr)
            print(
                f"   已删除。可能原因：链接失效 / 防盗链 / 需要特定 UA", file=sys.stderr
            )
            sys.exit(1)
        if fmt != "mp3":
            # 保留实际格式后缀（转写脚本会按内容识别；这里仅记录）
            real_path = os.path.join(audio_dir, f"episode.{fmt}")
            os.rename(audio_path, real_path)
            audio_path = real_path
            print(f"  ℹ️ 音频格式为 {fmt}，已存为 episode.{fmt}")
        print(f"✅ 下载完成，{os.path.getsize(audio_path) / 1e6:.1f} MB（{fmt}）")

    # 压缩为 AAC 64k mono（线上播放与转写同源，见 docs/音频存储方案.md）
    audio_path = compress_audio(audio_path, audio_dir, keep_original=keep_original)

    # 保存 meta.json（含节目元数据 + 本集元数据 + 音频路径）
    meta = {
        "podcast": podcast["meta"],
        "episode": ep,
        "audio_path": os.path.relpath(audio_path, ep_dir),
    }
    with open(os.path.join(ep_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"✅ meta.json 已保存：{os.path.join(ep_dir, 'meta.json')}")
    return ep_dir


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--search", help="搜索播客名")
    ap.add_argument("--episodes", help="列单集：RSS URL 或 iTunes collectionId")
    ap.add_argument("--index", type=int, help="下载第几集（从 1 起）")
    ap.add_argument("--keep-original", action="store_true", help="压缩后保留原始音频")
    args = ap.parse_args()

    if args.search:
        results = search_podcasts(args.search)
        if not results:
            print("没搜到，换个关键词试试")
            return
        print(f"\n找到 {len(results)} 个播客：\n")
        for r in results:
            print(f"  id={r.get('collectionId')}  {r.get('collectionName')}")
            print(
                f"      作者：{r.get('artistName')}  类型：{r.get('primaryGenreName')}"
            )
            print(f"      feedUrl：{r.get('feedUrl')}")
            print()
        print(
            "然后用：python3 scripts/fetch_podcast.py --episodes <id 或 feedUrl> 列单集"
        )
    elif args.episodes:
        if args.index:
            ep_dir = download_episode(args.episodes, args.index, keep_original=args.keep_original)
            # 机器可读标记行：run_pipeline.py 解析它定位本期目录（比目录 mtime 猜测可靠）
            print(f"EP_DIR={ep_dir}")
        else:
            list_episodes(args.episodes)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()

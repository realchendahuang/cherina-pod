#!/usr/bin/env python3
"""抓取 Apple Podcasts 热门排行榜 → web/public/charts.json（发现页数据源）。

数据源：Apple Marketing Tools 公开 API（免 key）。
把榜单与本地节目库按播客名匹配，命中的标记 in_library + podcast_key，
前端据此跳内部频道页；未命中的跳 Apple Podcasts 外链。

用法：
  python3 scripts/build_charts.py            # 默认美国榜 Top 50
  python3 scripts/build_charts.py --country cn --limit 30
"""

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def norm(s: str) -> str:
    """标题归一化用于匹配：小写、去标点空白。"""
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", (s or "").lower())


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--country", default="us")
    ap.add_argument("--limit", type=int, default=50)
    args = ap.parse_args()

    # 本地节目库：播客名归一化 → 展示信息
    idx_path = ROOT / "episodes" / "index.json"
    library = {}
    if idx_path.exists():
        idx = json.loads(idx_path.read_text(encoding="utf-8"))
        for it in idx.get("items", []):
            key = norm(it.get("podcast_title", ""))
            if key:
                library[key] = {
                    "podcast_title": it["podcast_title"],
                    "podcast_title_zh": it.get("podcast_title_zh", ""),
                }

    url = f"https://rss.applemarketingtools.com/api/v2/{args.country}/podcasts/top/{args.limit}/podcasts.json"
    print(f"抓取榜单：{url}")
    feed = fetch_json(url)["feed"]

    items = []
    hits = 0
    for i, r in enumerate(feed.get("results", []), 1):
        artwork = r.get("artworkUrl100", "").replace("100x100", "300x300")
        lib = library.get(norm(r.get("name", "")))
        if lib:
            hits += 1
        items.append(
            {
                "rank": i,
                "name": r.get("name", ""),
                "artist": r.get("artistName", ""),
                "artwork": artwork,
                "apple_url": r.get("url", ""),
                "genres": [g.get("name", "") for g in r.get("genres", [])],
                "in_library": bool(lib),
                "podcast_key": lib["podcast_title"] if lib else "",
                "title_zh": lib["podcast_title_zh"] if lib else "",
            }
        )

    out = ROOT / "web" / "public" / "charts.json"
    out.write_text(
        json.dumps(
            {
                "title": feed.get("title", "Top Shows"),
                "country": feed.get("country", args.country),
                "updated": feed.get("updated", ""),
                "count": len(items),
                "items": items,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"✅ charts.json 已生成：{out}（{len(items)} 条，命中本地库 {hits} 条）")
    return 0


if __name__ == "__main__":
    sys.exit(main())

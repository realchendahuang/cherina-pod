#!/usr/bin/env python3
"""汇总所有期 → episodes/index.json（节目库页数据源）。

扫描 episodes/ 下所有含 bilingual.json 的目录，按发布日期倒序输出摘要列表。

用法：
  python3 scripts/build_index.py
  输出 episodes/index.json
"""

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EPISODES_ROOT = HERE.parent / "episodes"

sys.path.insert(0, str(HERE))
from common import strip_html  # noqa: E402


def fmt_duration(d) -> str:
    """时长统一为 m:ss / h:mm:ss。RSS 里可能是秒数（"399"）或 "12:55"/"1:02:03"。"""
    if d is None or d == "":
        return ""
    s = str(d).strip()
    if s.isdigit():
        sec = int(s)
    elif re.fullmatch(r"\d+(:\d{1,2}){1,2}", s):
        parts = [int(p) for p in s.split(":")]
        sec = 0
        for p in parts:
            sec = sec * 60 + p
    else:
        return s  # 无法识别就原样展示
    h, m, ss = sec // 3600, (sec % 3600) // 60, sec % 60
    return f"{h}:{m:02d}:{ss:02d}" if h else f"{m}:{ss:02d}"


def load_podcast_meta() -> dict:
    """播客元数据（category/level），key 为播客原名。缺省给中间档并打警告。"""
    meta_path = HERE / "podcast_meta.json"
    if meta_path.exists():
        return json.loads(meta_path.read_text(encoding="utf-8"))
    return {}


def main():
    podcast_meta = load_podcast_meta()
    items = []
    for ep_dir in sorted(EPISODES_ROOT.iterdir()):
        if not ep_dir.is_dir():
            continue
        bj = ep_dir / "bilingual.json"
        if not bj.exists():
            continue
        try:
            data = json.loads(bj.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        podcast_title = data.get("podcast", {}).get("title", "")
        meta = podcast_meta.get(podcast_title)
        if meta is None:
            print(f"⚠️  podcast_meta.json 缺少「{podcast_title}」的 category/level，用默认值")
            meta = {}
        items.append(
            {
                "id": data.get("id", ep_dir.name),
                "podcast_title": podcast_title,
                "podcast_title_zh": data.get("podcast", {}).get("title_zh", ""),
                "podcast_author": data.get("podcast", {}).get("author", ""),
                "category": meta.get("category", "其他"),
                "level": meta.get("level", "intermediate"),
                "episode_title": data.get("episode", {}).get("title", ""),
                "episode_title_zh": data.get("episode", {}).get("title_zh", ""),
                "description": strip_html(data.get("episode", {}).get("description", ""))[:200],
                "image": data.get("episode", {}).get("image", "")
                or data.get("podcast", {}).get("image", ""),
                "pub_date": data.get("episode", {}).get("pub_date", ""),
                "duration": fmt_duration(data.get("episode", {}).get("duration", "")),
                "pairs_count": len(data.get("pairs", [])),
                "generated_at": data.get("generated_at", ""),
            }
        )

    # 按发布日期倒序（无日期排最后）
    items.sort(key=lambda x: x["pub_date"], reverse=True)

    index = {"count": len(items), "items": items}
    out = EPISODES_ROOT / "index.json"
    out.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✅ index.json 已生成：{out}（{len(items)} 期）")

    # sitemap.xml：首页 + 每期（用 ?id= 查询串形态，route() 兼容，可被爬虫索引）
    site = "https://pod.cherina.app"
    urls = [
        {"loc": site + "/", "priority": "1.0"},
    ]
    for it in items:
        urls.append({"loc": f"{site}/?id={it['id']}", "priority": "0.8"})
    smap = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for u in urls:
        smap.append(
            f"  <url><loc>{u['loc']}</loc><changefreq>weekly</changefreq><priority>{u['priority']}</priority></url>"
        )
    smap.append("</urlset>")
    smap_path = HERE.parent / "web" / "public" / "sitemap.xml"
    smap_path.write_text("\n".join(smap) + "\n", encoding="utf-8")
    print(f"✅ sitemap.xml 已生成：{smap_path}（{len(urls)} 条 URL）")
    return 0


if __name__ == "__main__":
    sys.exit(main())

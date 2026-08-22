#!/usr/bin/env python3
"""对齐：合并 meta + transcript + translation → bilingual.json（线上网页数据源）。

用法：
  python3 scripts/align.py <episode_dir>
  输出 <episode_dir>/bilingual.json
"""

import datetime
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import norm_text  # noqa: E402


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    ep_dir = Path(sys.argv[1]).resolve()
    meta_path = ep_dir / "meta.json"
    trans_path = ep_dir / "transcript.json"
    tr_path = ep_dir / "translation.json"
    for p in (meta_path, trans_path, tr_path):
        if not p.exists():
            print(f"找不到 {p}", file=sys.stderr)
            return 2

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    transcript = json.loads(trans_path.read_text(encoding="utf-8"))
    translation = json.loads(tr_path.read_text(encoding="utf-8"))

    # 以 transcript 句子为准（时间戳权威），按文本从翻译结果取译文。
    # 并发翻译/断点续跑会产生冗余条目（旧时间戳、重复文本），以 transcript 为骨架可全部规避。
    # 匹配键去掉全部空白：ASR 偶发缺空格（如 "hegrown up"），LLM 译文会修正，精确匹配会漏。
    zh_by_text = {}
    for t in translation:
        zh_by_text.setdefault(norm_text(t["en"]), t["zh"])

    pairs = []
    missing = 0
    for s in transcript["sentences"]:
        text = s["text"]
        zh = zh_by_text.get(norm_text(text))
        if zh is None:
            missing += 1
            zh = ""
        pairs.append(
            {
                "en": text,
                "zh": zh,
                "start": s["start"],
                "end": s["end"],
            }
        )
    if missing:
        print(f"⚠️ {missing} 句缺译文（请续跑 translate.py 后重新对齐）", file=sys.stderr)

    bilingual = {
        "id": ep_dir.name,  # 目录名作为唯一 id（网页 ?id= 定位）
        "podcast": meta["podcast"],
        "episode": {
            "title": meta["episode"]["title"],
            "title_zh": meta["episode"].get("title_zh", ""),
            "description": meta["episode"]["description"],
            "pub_date": meta["episode"]["pub_date"],
            "duration": meta["episode"]["duration"],
            "image": meta["episode"]["image"],
            "audio_url": meta["episode"]["audio_url"],
        },
        "audio": meta["audio_path"],
        "duration": transcript.get("duration", 0),
        "pairs": pairs,
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
    }

    out = ep_dir / "bilingual.json"
    out.write_text(
        json.dumps(bilingual, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"✅ bilingual.json 已生成：{out}（{len(pairs)} 句）")
    return 0


if __name__ == "__main__":
    sys.exit(main())

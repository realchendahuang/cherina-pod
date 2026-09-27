#!/usr/bin/env python3
"""对齐：合并 meta + transcript + translation → bilingual.json（线上网页数据源）。

输出契约（语言中立）：
  pairs[].source / pairs[].target —— 源文 / 译文
  顶层 source_lang / target_lang
  podcast.title_target / episode.title_target —— 标题译文
读入兼容：旧 translation.json（{en, zh}）与旧 meta.json（title_zh）仍可用。

用法：
  python3 scripts/align.py <episode_dir>
  python3 scripts/align.py <episode_dir> --source-lang zh --target-lang en
"""

import argparse
import datetime
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import norm_text  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="合并 meta + transcript + translation → bilingual.json")
    ap.add_argument("episode_dir")
    ap.add_argument(
        "--allow-missing",
        action="store_true",
        help="有缺译文时仍生成文件并以退出码 0 结束（调试用）",
    )
    ap.add_argument(
        "--source-lang",
        default="auto",
        help="源语言标签，写入 bilingual.json（默认 auto）",
    )
    ap.add_argument(
        "--target-lang",
        default="zh",
        help="目标语言标签，写入 bilingual.json（默认 zh）",
    )
    args = ap.parse_args()
    ep_dir = Path(args.episode_dir).resolve()
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
    tgt_by_text = {}
    for t in translation:
        # 旧 translation.json 是 {en, zh}，这里都认
        src_text = t.get("source", t.get("en", ""))
        tgt_text = t.get("target", t.get("zh", ""))
        tgt_by_text.setdefault(norm_text(src_text), tgt_text)

    pairs = []
    missing = 0
    dup_texts = 0
    seen_texts = set()
    for s in transcript["sentences"]:
        text = s["text"]
        key = norm_text(text)
        if key in seen_texts:
            dup_texts += 1
        seen_texts.add(key)
        tgt = tgt_by_text.get(key)
        if tgt is None:
            missing += 1
            tgt = ""
        pairs.append(
            {
                "source": text,
                "target": tgt,
                "start": s["start"],
                "end": s["end"],
            }
        )
    if missing:
        print(f"⚠️ {missing} 句缺译文（请续跑 translate.py 后重新对齐）", file=sys.stderr)
        if dup_texts:
            print(
                f"   （transcript 含 {dup_texts} 句重复文本，重复句共用第一条译文，"
                f"可能张冠李戴，建议人工抽查）",
                file=sys.stderr,
            )

    pc = meta["podcast"]
    ep = meta["episode"]
    bilingual = {
        "id": ep_dir.name,  # 目录名作为唯一 id（网页 ?id= 定位）
        "source_lang": args.source_lang,
        "target_lang": args.target_lang,
        # podcast 只保留前端/索引用到的字段，不复制 description/feed_url/link 等冗余
        "podcast": {
            "title": pc.get("title", ""),
            "author": pc.get("author", ""),
            "image": pc.get("image", ""),
            "title_target": pc.get("title_target", pc.get("title_zh", "")),
        },
        "episode": {
            "title": ep.get("title", ""),
            "title_target": ep.get("title_target", ep.get("title_zh", "")),
            "description": ep.get("description", ""),
            "pub_date": ep.get("pub_date", ""),
            "duration": ep.get("duration", ""),
            "image": ep.get("image", ""),
            "audio_url": ep.get("audio_url", ""),
        },
        # 音频不是契约必需项：纯样例/手工条目可以没有，走 .get 兜底
        "audio": meta.get("audio_path", ""),
        "duration": transcript.get("duration", 0),
        "pairs": pairs,
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
    }

    out = ep_dir / "bilingual.json"
    out.write_text(
        json.dumps(bilingual, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"✅ bilingual.json 已生成：{out}（{len(pairs)} 句）")
    # 缺译文默认视为失败：空 zh 会被灌进 D1 直接上线，必须显式放行才能通过
    if missing and not args.allow_missing:
        print(f"错误：{missing} 句缺译文，请先补齐翻译（--allow-missing 可强制放行）", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

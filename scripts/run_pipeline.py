#!/usr/bin/env python3
"""一键流水线：下载（可选）→ 转写 → 翻译 → 对齐，产出 bilingual.json。

用法：
  python3 scripts/run_pipeline.py <episode_dir>                    # 已有音频，跑转写→翻译→对齐
  python3 scripts/run_pipeline.py --fetch <rss|id> --index 3       # 先下载第 3 集再跑全流程
  python3 scripts/run_pipeline.py <episode_dir> --skip-transcribe  # 已转写，续跑
  python3 scripts/run_pipeline.py <episode_dir> --skip-translate   # 已翻译，只对齐
"""

import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def run(step_script, *args):
    cmd = [sys.executable, str(HERE / step_script), *map(str, args)]
    print(f"\n$ {' '.join(cmd)}\n")
    return subprocess.call(cmd)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("episode_dir", nargs="?", help="期目录（--fetch 时省略）")
    ap.add_argument("--fetch", help="播客 RSS URL 或 iTunes collectionId")
    ap.add_argument("--index", type=int, help="下载第几集（配合 --fetch，从 1 起）")
    ap.add_argument(
        "--skip-transcribe", action="store_true", help="跳过转写（断点续跑）"
    )
    ap.add_argument("--skip-translate", action="store_true", help="跳过翻译（只对齐）")
    args = ap.parse_args()

    # 1. 可选：下载
    if args.fetch:
        if not args.index:
            print("--fetch 需要配合 --index 指定下载第几集", file=sys.stderr)
            return 2
        if run("fetch_podcast.py", "--episodes", args.fetch, "--index", args.index):
            return 1
        # 从最新生成的 episodes 目录找（fetch 会打印 meta.json 路径）
        ep = None
        from glob import glob

        cands = sorted(
            (HERE.parent / "episodes").glob("*/meta.json"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if cands:
            ep = cands[0].parent
        if ep is None:
            print("下载后找不到期目录", file=sys.stderr)
            return 1
        print(f"\n📁 本期目录：{ep}")
    else:
        if not args.episode_dir:
            ap.print_help()
            return 2
        ep = Path(args.episode_dir).resolve()
        if not ep.exists():
            print(f"目录不存在：{ep}", file=sys.stderr)
            return 2

    # 2. 转写（已有 transcript.json 会自动跳过）
    if not args.skip_transcribe:
        if run("transcribe.py", ep):
            return 1
    # 3. 翻译
    if not args.skip_translate:
        if run("translate.py", ep):
            return 1
    # 3b. 标题中译（幂等：已有 title_zh 的期会跳过）
    run("translate_titles.py")
    # 4. 对齐
    if run("align.py", ep):
        return 1

    print("\n🎉 流水线完成！bilingual.json 已就绪。")
    print("  下一步：python3 scripts/migrate_to_d1.py && python3 scripts/sync_web.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())

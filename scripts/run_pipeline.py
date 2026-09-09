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
        # 捕获输出以解析 fetch 打印的 EP_DIR= 标记行（比"最新 mtime 的目录"可靠）
        proc = subprocess.run(
            [
                sys.executable, str(HERE / "fetch_podcast.py"),
                "--episodes", args.fetch, "--index", str(args.index),
            ],
            capture_output=True, text=True,
        )
        # 回显输出（\r 进度条转成多行）
        sys.stdout.write((proc.stdout or "").replace("\r", "\n"))
        sys.stderr.write(proc.stderr or "")
        if proc.returncode:
            return 1
        ep = None
        for line in reversed((proc.stdout or "").splitlines()):
            if line.startswith("EP_DIR="):
                ep = Path(line.split("=", 1)[1].strip())
                break
        if ep is None or not ep.exists():
            print("下载成功但未解析到期目录（EP_DIR 标记缺失）", file=sys.stderr)
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
    # 3b. 标题中译（幂等：已有 title_zh 的期会跳过）。失败不阻断主流程，
    # 但必须显式提示——静默失败会让线上标题缺中文
    if run("translate_titles.py"):
        print(
            "⚠️ 标题中译失败，本期标题暂为英文（稍后可单独重跑 translate_titles.py 后再对齐）",
            file=sys.stderr,
        )
    # 4. 对齐
    if run("align.py", ep):
        return 1

    print("\n🎉 流水线完成！bilingual.json 已就绪。")
    print("  下一步：python3 scripts/migrate_to_d1.py && python3 scripts/sync_web.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/bin/bash
# 批量新增播客单集：下载 → 转写 → 翻译 → 对齐。
# 用法：bash scripts/batch_add.sh [jobs_file]
# jobs 文件每行：<feedUrl> <index>   （# 开头为注释）
# 流水线自带断点续跑：失败后重跑会跳过已完成步骤/已译句子。

set -u
cd "$(dirname "$0")/.."
JOBS="${1:-scripts/batch_jobs.txt}"

while read -r feed idx rest <&3; do
  [[ -z "${feed:-}" || "${feed:0:1}" == "#" ]] && continue
  echo ""
  echo "==================== $(date '+%H:%M:%S') 开始：$feed 第 $idx 集 ===================="
  for attempt in 1 2 3; do
    if python3 scripts/run_pipeline.py --fetch "$feed" --index "$idx"; then
      echo "✅ 完成：$feed 第 $idx 集"
      break
    fi
    echo "⚠️ 第 $attempt 次失败（$feed 第 $idx 集），$([ $attempt -lt 3 ] && echo '重试…' || echo '放弃，人工检查')"
    sleep 5
  done
done 3< "$JOBS"

echo ""
echo "🎉 批量任务全部结束，运行 migrate_to_d1 + sync_web + build_charts 汇总："
python3 scripts/migrate_to_d1.py && python3 scripts/sync_web.py && python3 scripts/build_charts.py

#!/bin/bash
# 批量新增播客单集：下载 → 转写 → 翻译 → 对齐。
# 用法：bash scripts/batch_add.sh [jobs_file]
# jobs 文件每行：<feedUrl> <index>   （# 开头为注释）
# 流水线自带断点续跑：失败后重跑会跳过已完成步骤/已译句子。

set -u
cd "$(dirname "$0")/.."
JOBS="${1:-scripts/batch_jobs.txt}"

ok=0
fail=0
# `|| [[ -n ... ]]` 处理末行无换行符的 jobs 文件，否则最后一行任务被静默跳过
while read -r feed idx rest <&3 || [[ -n "${feed:-}" ]]; do
  [[ -z "${feed:-}" || "${feed:0:1}" == "#" ]] && continue
  echo ""
  echo "==================== $(date '+%H:%M:%S') 开始：$feed 第 $idx 集 ===================="
  success=0
  for attempt in 1 2 3; do
    if python3 scripts/run_pipeline.py --fetch "$feed" --index "$idx"; then
      echo "✅ 完成：$feed 第 $idx 集"
      success=1
      break
    fi
    echo "⚠️ 第 $attempt 次失败（$feed 第 $idx 集），$([ $attempt -lt 3 ] && echo '重试…' || echo '放弃，人工检查')"
    sleep 5
  done
  if [[ $success -eq 1 ]]; then
    ok=$((ok + 1))
  else
    fail=$((fail + 1))
  fi
done 3< "$JOBS"

echo ""
if [[ $ok -eq 0 ]]; then
  echo "❌ 全部任务失败（成功 $ok，失败 $fail），跳过汇总发布。修好后重跑即可（流水线断点续跑）。"
  exit 1
fi

echo "🎉 批量任务结束：成功 $ok，失败 $fail"
if [[ $fail -gt 0 ]]; then
  echo "⚠️ 有失败任务：先发布已完成的部分，失败的修好后重跑本脚本会断点续跑。"
fi
echo "运行 migrate_to_d1 + sync_web 汇总："
python3 scripts/migrate_to_d1.py && python3 scripts/sync_web.py

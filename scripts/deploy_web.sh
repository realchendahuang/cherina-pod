#!/bin/bash
# 一键发布：汇总节目库 → 同步网页数据 → 部署到 Cloudflare。
# 用法：bash scripts/deploy_web.sh
set -e
cd "$(dirname "$0")/.."

python3 scripts/build_index.py
python3 scripts/sync_web.py
python3 scripts/build_charts.py

cd web
npx wrangler deploy
echo "🚀 已发布：https://pod.cherina.app"

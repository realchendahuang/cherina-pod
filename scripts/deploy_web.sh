#!/bin/bash
# 一键发布：迁移 D1（节目数据 + sitemap）→ 同步音频 → 部署到 Cloudflare。
# 用法：bash scripts/deploy_web.sh
set -e
cd "$(dirname "$0")/.."

python3 scripts/migrate_to_d1.py
python3 scripts/sync_web.py

cd web
# 拼接全部迁移为单个文件、单次 import：逐文件循环会 spawn 100+ 个 wrangler 进程，
# 每个进程各自做 OAuth 刷新/握手，慢且在网络抖动/token 轮换下偶发 Authentication error。
# 失败重试安全——0001_init.sql 每次先 DROP 重建，重跑即从零再来。
cat migrations/*.sql > migrations/_all.sql
d1_ok=0
for attempt in 1 2 3; do
  if npx wrangler d1 execute cherina-pod-db --remote --file=migrations/_all.sql >/dev/null; then
    d1_ok=1
    break
  fi
  echo "⚠️ D1 导入第 $attempt 次失败，10s 后重试（迁移自带 DROP 重建，重跑安全）"
  sleep 10
done
rm -f migrations/_all.sql
if [[ $d1_ok -ne 1 ]]; then
  echo "❌ D1 导入连续 3 次失败，中止部署（直接重跑本脚本即可）" >&2
  exit 1
fi

# 构建前端（app.ts → public/app.js，sw.ts → public/sw.js）
npm run build

npx wrangler deploy
echo "🚀 已发布：https://pod.cherina.app"

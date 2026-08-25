#!/bin/bash
# 一键发布：迁移 D1（节目数据 + sitemap）→ 同步音频 → 部署到 Cloudflare。
# 用法：bash scripts/deploy_web.sh
set -e
cd "$(dirname "$0")/.."

python3 scripts/migrate_to_d1.py
python3 scripts/sync_web.py

cd web
for f in migrations/*.sql; do
  wrangler d1 execute cherina-pod-db --remote --file="$f" >/dev/null
done

# 构建前端（app.ts → public/app.js，sw.ts → public/sw.js）
npm run build

npx wrangler deploy
echo "🚀 已发布：https://pod.cherina.app"

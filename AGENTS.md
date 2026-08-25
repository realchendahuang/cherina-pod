# cherina-pod 项目规则（真源）

## 技术栈
- 本地流水线：Python 3.12（转写/翻译/对齐脚本）
- 线上网页：Cloudflare Worker（静态展示页 + D1 数据 API）
- 翻译模型：DeepSeek V4 Flash（ollama-cloud / opencode-go 双供应商负载均衡）

## 核心约定
- **转写必须保留词级时间戳**，这是逐句对齐的基础，任何环节不得丢弃
- 翻译遵循信达雅原则，逐句输出 JSON `{en, zh}`，与时间戳一一对应（时间戳在 align.py 以 transcript 为准）
- 线上展示页 + D1 数据 API，不做转写/翻译；所有 AI 处理都在本地
- 密钥只放 `.env`（gitignore），绝不上传仓库

## 目录
- `scripts/`：本地流水线脚本
- `skills/`：流水线 skill 说明
- `episodes/`：每期一目录（音频 gitignore；`bilingual.json` 是 D1 灌库原料）
- `web/`：Cloudflare Worker 展示网页 + D1 API
- `docs/`：方案与文档

## 常用命令
```bash
python3 scripts/fetch_podcast.py --search "播客名"   # 搜索播客
python3 scripts/run_pipeline.py <episode_dir>        # 跑通一期全流程
bash scripts/batch_add.sh                            # 批量新增（jobs 列表见 scripts/batch_jobs.txt）
python3 scripts/translate.py <episode_dir> --batch-size 12 --workers 3  # 并发翻译，可断点续跑
python3 scripts/translate_titles.py              # 播客名/单集标题中译（幂等，run_pipeline 已内置）
python3 scripts/migrate_to_d1.py                 # 生成 D1 迁移 SQL + sitemap（读 bilingual.json）
python3 scripts/sync_web.py                      # 音频传 RustFS（节目数据走 D1，不再同步 web/public）
cd web && npm run build                          # 构建前端（app.ts→public/app.js，sw.ts→public/sw.js）
cd web && npm run typecheck                      # TS 类型检查（app / worker / sw 三份 tsconfig）
cd web && npx wrangler dev                       # 本地预览网页
cd web && npx wrangler deploy                    # 部署到 Cloudflare（deploy_web.sh 已内置 npm run build）
```

## 音频架构（详见 docs/音频存储方案.md）
- 下载后一律压缩为 **AAC-LC 64k mono（MP4 容器，`audio/episode.mp4`）**，转写/播放都以它为准
- 音频**不进 Cloudflare 静态资产**（25MiB 上限），存 ht 服务器 RustFS，经 Cloudflare Tunnel 分发：`https://pod-audio.cherina.app/<episode_id>.mp4`
- 播放器音源优先级：自建源 → RSS 外链兜底（外链可能被动态插广告，仅兜底）
- `sync_web.py` 上传走 tailnet 内网端点（`.env` 的 `RUSTFS_*`），stdlib SigV4，无第三方依赖

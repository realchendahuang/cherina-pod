# cherina-pod 项目规则（真源）

## 产品定位（2026-09-27 定盘，动手前先读）
- **这是"底座"不是"网站"**：核心资产是**流水线 + 纯 JSON 数据契约**，网站/插件/skill 都只是它的界面。用户自己部署、自己持有数据。
- **底座四条契约**（README 首页同款，不可违反）：无需注册 / 数据即纯 JSON 无私有格式 / 处理在本地完成 / **语言无关**（语言对是配置项）
- **语言无关化是已知改造项，动手前先读 `docs/定位与商业化.md` 的硬编码清单**：目前整链仍是英文→中文（转写模型、`translate.py` prompt、`bilingual.json` 键名 `en`/`zh`、D1 `pairs` 表 en/zh 列与 FTS 触发器、`app.ts` 读取 `.en`/`.zh`）。改这些点会影响 21 期存量数据与线上网页，改前先确认迁移方案
- **扩展点已预留**：同步（只同步学习数据，转写正文留本地）与身份（独立 auth 层，不侵入本地链路）——为付费层留楔口，不要提前实现
- **商业化**：开核（open-core）——基础能力永久免费完整可用，付费卖增量（跨端同步、机构能力、内容授权），**不做阉割式免费版**
- **pod.cherina.app 的定位已变**：从"主产品"降为"现成实例 + 官网门面"，新增大媒体版权内容前先想清楚（见下）
- 完整战略与商业化路线见 `docs/定位与商业化.md`

## 版权三条件（红线，任何功能设计都不得破坏）
1. **永远不碰音频**：不缓存、不代理、不下载他人音频，只播放出版方自己的地址
2. **永不存在中央内容库**：不持久化、不共享用户提交的转写与译文
3. **仓库不携带第三方示例内容**：他人播客的完整转写/译文不得进公开仓库（`episodes/*/bilingual.json` 属于此列，清理前不要把新内容继续提交）

## 技术栈
- 本地流水线：Python 3.12（转写/翻译/对齐脚本）
- 线上网页：Cloudflare Worker（静态展示页 + D1 数据 API）
- 翻译模型：DeepSeek V4 Flash（ollama-cloud / opencode-go 双供应商负载均衡）

## 核心约定
- **转写必须保留词级时间戳**，这是逐句对齐的基础，任何环节不得丢弃
- **跑出来的内容不入库**：`episodes/*/` 下的 `transcript.json` / `translation.json` / `bilingual.json` / `meta.json` 全部 gitignore（第三方播客内容 + 你花钱跑出来的数据）。仓库只保留合成样例 `episodes/_sample-intro/`。
  - ⚠️ 代价：词级时间戳的唯一持久层变成**你的本机工作区**，丢了要重新烧钱转写 —— 请自行做私有备份
- 翻译遵循信达雅原则，逐句输出 JSON `{source, target}`，与时间戳一一对应（时间戳在 align.py 以 transcript 为准；translation.json 的 source 必须回填 transcript 原文，保证续跑/对齐键稳定）
- **语言对是配置项**：`--source-lang`（默认 auto）/ `--target-lang`（默认 zh）贯穿 translate → align → D1；键名一律 `source`/`target`，不要在任何层新增语言名硬编码。读入兼容旧格式（`en`/`zh`/`title_zh`）
- 线上展示页 + D1 数据 API，不做转写/翻译；所有 AI 处理都在本地
- 密钥只放 `.env`（gitignore），绝不上传仓库

## 目录
- `scripts/`：本地流水线脚本
- `skills/`：流水线 skill 说明
- `episodes/`：每期一目录。**内容全部 gitignore**（音频、transcript、translation、bilingual、meta）；仓库只跟踪合成样例 `_sample-intro/`
- `private/`：内部运维与发布物料，已 gitignore，不属于开源仓库
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

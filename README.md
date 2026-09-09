# cherina-pod

英文播客学习网页。输入英文播客 → 本地语音转文字 + 双语翻译 → 线上展示双语逐句对照。

## 架构

**重本地、轻线上**：

- **本地**（Mac）：播客获取 → 阿里云 Paraformer 转写（词级时间戳）→ DeepSeek V4 Flash 信达雅逐句翻译（双供应商负载均衡）→ 生成 `bilingual.json`
- **线上**（Cloudflare Worker）：纯展示网页，读 `bilingual.json` 渲染双语逐句对照 + 播放器

## 环境

- Python ≥ 3.9（流水线基本零第三方依赖，仅翻译可选装繁→简转换：`pip install -r requirements.txt`）
- ffmpeg / ffprobe（音频压缩与文件校验）
- Node ≥ 20（web/ 构建与部署，wrangler 走 npm）

## 数据约定

- `episodes/<id>/transcript.json` **提交进仓库**：它是词级时间戳（项目红线）的唯一持久层，含 `words` 与 provider/model 元信息
- `episodes/<id>/translation.json` 为原始 LLM 产物（gitignore）；`bilingual.json` 是 D1 灌库原料，提交进仓库

## 快速开始

```bash
# 1. 准备密钥
cp .env.example .env   # 填入 DASHSCOPE_API_KEY / OLLAMA_API_KEY / OPENCODE_API_KEY

# 2. 获取播客（搜索 → 选集 → 下载音频）
python3 scripts/fetch_podcast.py --search "Lex Fridman"        # 搜索播客
python3 scripts/fetch_podcast.py --episodes <id|rss_url>       # 列单集
python3 scripts/fetch_podcast.py --episodes <id|rss_url> --index 3   # 下载第 3 集

# 3. 一键流水线：下载 → 转写 → 翻译 → 对齐
python3 scripts/run_pipeline.py --fetch <id|rss_url> --index 3   # 从下载开始一站式
python3 scripts/run_pipeline.py <episode_dir>                    # 已有音频/转写，续跑

# 3b. 批量新增多集（断点续跑，失败自动重试 3 次）
#     在 scripts/batch_jobs.txt 里每行写 <feedUrl> <index>，然后：
bash scripts/batch_add.sh

# 4. 标题中译（播客名 + 单集标题，补全缺失的）
python3 scripts/translate_titles.py
# 然后对相关期重跑 align.py 使 title_zh 进入 bilingual.json

# 5. 迁移到 D1（节目数据 + sitemap）+ 同步音频
python3 scripts/migrate_to_d1.py
python3 scripts/sync_web.py

# 6. 本地预览 / 部署网页
cd web && npx wrangler dev
cd web && npx wrangler deploy
```

## 播客处理优化

- **断点续传**：下载中断后重跑会从已下载字节续传（HTTP Range），不重头再来
- **文件校验**：下载后检查音频魔数，防盗链 HTML 错误页自动识别并重下
- **格式兼容**：m4a / wav / flac / ogg 自动识别并按实际格式保存
- **进度条**：下载显示实时进度（MB + 百分比）
- **转写缓存**：已有 `transcript.json`（含词级时间戳）自动跳过（避免重复烧钱），`--force` 强制重转写；转写任务 task_id 落盘，轮询中断后重跑只续查结果、不重新上传
- **并发翻译**：`translate.py --batch-size 12 --workers 3` 多线程逐批翻译，按批序落盘，崩溃/失败可断点续跑；整批失败自动拆半重试；英文回填 transcript 原文，保证续跑与对齐的键稳定
- **批量新增**：`scripts/batch_jobs.txt` 配置 `<feedUrl> <index>` 列表，`bash scripts/batch_add.sh` 串行跑完全部并自动汇总同步

## 文档

- [技术方案](docs/技术方案.md)

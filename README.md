# cherina-pod

[![CI](https://github.com/realchendahuang/cherina-pod/actions/workflows/ci.yml/badge.svg)](https://github.com/realchendahuang/cherina-pod/actions/workflows/ci.yml) [![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

> 中文 · [English](README.en.md)

**一套你自己拥有的多语精听底座。**

输入任意语言、任意播客的 RSS，产出带词级时间戳的转写 + 双语逐句对照（`bilingual.json`）——在你自己的机器上跑，部署在你自己的 Cloudflare 上，服务器不持有你的内容。

语言不是底座的属性：英→中、中→日、西→韩，用的是同一个引擎、同一种数据契约，换的只是语言对。中英那一版只是它的一个实例。

它可以是一个命令行流水线、一个 agent skill，也可以是部署在你账号下的网页。核心不是任何一种形态，而是**那份纯 JSON 数据，和处理它的引擎**。

---

## 底座契约

这四条是对使用者的硬承诺，也是所有信任的根：

1. **无需注册** — 核心功能（采集、转写、翻译、训练）不设账号墙，没有"先登录才能用"。
2. **数据即文件** — 唯一数据契约是纯 JSON（`transcript.json` / `translation.json` / `bilingual.json`）：没有私有格式、没有数据库锁定，任何时候 `cp` 走就是完整备份，迁移到任何工具链都不损失。
3. **本地处理** — 转写与翻译在你自己机器（或你自己部署的 Worker）上完成。本项目不托管、不缓存、不转售你的内容。
4. **语言无关** — 语言对是配置项，不是写死的假设。*现状：整条链路仍是英文 → 简体中文硬编码（转写模型、`translate.py` 的 prompt、JSON 键名 `en`/`zh`、D1 列名），语言无关化是已知改造项，清单见 [定位与商业化](docs/定位与商业化.md)。*

**扩展点**（付费层预留的地基，现在就可以依赖）：

| 扩展点 | 现状 | 约定 |
|---|---|---|
| 同步 | 无 | 学习数据（生词本 / SRS 进度 / 标记）预留跨端同步接口；**转写正文默认只留本地** |
| 身份 | 无账号体系 | 任何需要账户的场景（多端、机构版）走独立 auth 层，不侵入本地处理链路 |

## 它是什么 / 不是什么

**是**：本地流水线 + 纯 JSON 数据契约 + 可自部署的 Cloudflare 展示层 + agent skill 打包。

**不是**：音频分发方、内容库、"翻译 App"。

**版权三条件（红线，不可让步）**：

1. **永远不碰音频** — 不缓存、不代理、不下载，只播放出版方自己的地址。
2. **永不存在中央内容库** — 不持久化、不共享用户提交的转写与译文。
3. **仓库不携带第三方示例内容** — 任何人播客的完整转写与译文不得进公开仓库（样例只用自制或公有领域音频）。

## 三种形态

| 形态 | 是什么 | 给谁 |
|---|---|---|
| **流水线底座** | `scripts/` 全套：fetch → transcribe → translate → align | 想自建、自控的人 |
| **agent skill** | 把流水线打包给 agent 调用（`skills/cherina-pod/SKILL.md`） | agent 用户、批量处理 |
| **现成实例** | [pod.cherina.app](https://pod.cherina.app) —— 本项目自己部署的一份 | 不想折腾的人 |

## 快速开始

### 1. 环境

```bash
git clone <this-repo> && cd cherina-pod
cp .env.example .env        # 填密钥，见下
python3 -m pip install -r requirements.txt   # 可选，仅繁→简转换需要
```

`.env` 需要的密钥（**只放本地，绝不进仓库**）：

| 变量 | 用途 |
|---|---|
| `DASHSCOPE_API_KEY` | 阿里云百炼 Paraformer 转写（词级时间戳） |
| `OLLAMA_API_KEY` / `OPENCODE_API_KEY` | 翻译（OpenAI 兼容端点，双供应商负载均衡，任填其一） |
| `RUSTFS_*` | 自建音频源，可选；不部署自建源时留空，播放器走 RSS 外链 |

外部依赖：Python ≥ 3.9、ffmpeg / ffprobe、Node ≥ 20。

### 2. 跑通一期

```bash
# 搜索播客 → 拿到 RSS
python3 scripts/fetch_podcast.py --search "Hidden Brain"

# 一键流水线：下载 → 转写 → 翻译 → 对齐
python3 scripts/run_pipeline.py --fetch <rss_url> --index 3

# 已有音频 / 已转写，续跑
python3 scripts/run_pipeline.py episodes/<id> --skip-transcribe
```

批量：在 `scripts/batch_jobs.txt` 每行写 `<feedUrl> <index>`，然后 `bash scripts/batch_add.sh`（串行、断点续跑、失败自动重试）。

产物落在 `episodes/<id>/`：`transcript.json`（词级时间戳）→ `translation.json`（原始 LLM 产物，gitignore）→ `bilingual.json`（对齐产物，D1 灌库原料）。

### 3. 部署到你自己的 Cloudflare

```bash
cd web
npm install
npx wrangler d1 create cherina-pod-db      # 建你自己的库，把返回的 database_id 填进 wrangler.toml
python3 ../scripts/migrate_to_d1.py        # 扫描本地 episodes/ 生成 web/migrations/*.sql
cat migrations/*.sql > migrations/_all.sql
npx wrangler d1 execute cherina-pod-db --remote --file=migrations/_all.sql

# 站点配置：构建时用环境变量注入，不必改源码
SITE_URL=https://my-pod.pages.dev \
SITE_NAME="My Pod" \
AUDIO_CDN="" \
  npm run build

npx wrangler deploy
```

自建音频源（可选，避开播客托管商的动态插广告导致的字幕漂移）：见 [音频存储方案](docs/音频存储方案.md)。**不配置 `AUDIO_CDN` 时播放器自动走 RSS 外链**，功能完整可用。

> `scripts/deploy_web.sh` 是本项目自用的一键流（迁 D1 + 同步音频 + 构建 + 部署）；自部署按上面几步即可，音频那步可跳过。

## Fork 须知（改这 6 处就能跑自己的实例）

| # | 位置 | 改什么 |
|---|---|---|
| 1 | `web/wrangler.toml` | `database_id` 填你自己的库 id；`routes` 段默认已注释（走 `*.workers.dev` 即可） |
| 2 | `web/public/index.html` | 头部注释块标出的 5 处 `pod.cherina.app`（canonical / og:url / og:image / twitter:image / JSON-LD） |
| 3 | `web/build.mjs` | 站点名与描述的默认值（或用 `SITE_NAME` / `SITE_DESC` 环境变量覆盖） |
| 4 | `web/src/app.ts` | 无需改动——站点配置已全部走构建期注入 |
| 5 | `.env` | 换成你自己的 ASR / 翻译 key；自建音频源不填留空 |
| 6 | `episodes/` | 换成你自己跑的期数；仓库自带的 `episodes/_sample-intro/` 是合成样例，可留可删 |

## 数据契约

`bilingual.json` —— 唯一需要下游关心的一种：

```json
{
  "id": "how-feelings-make-us-smarter",
  "podcast": { "title": "Hidden Brain", "title_zh": "隐藏的大脑", "author": "..." },
  "episode": { "title": "...", "title_zh": "...", "description": "..." },
  "duration": 1234.5,
  "pairs": [
    { "en": "This is Hidden Brain.", "zh": "这里是《隐藏的大脑》。", "start": 0.0, "end": 1.601 }
  ],
  "generated_at": "2026-08-23T10:00:00Z"
}
```

**红线**：`transcript.json` 里的 `words`（词级时间戳）是逐句对齐的地基，任何环节不得丢弃。它**不再进仓库**——跑出来的转写和译文是你自己的数据，留在你的工作区即可；代价是**你要自己给它做备份**（丢一次就得重新花钱转写）。

仓库里只保留一份合成样例 [`episodes/_sample-intro/`](episodes/_sample-intro)（人工编写，非任何真实播客内容），用来演示三种文件的结构，并让新 clone 的仓库能直接跑通 `migrate_to_d1.py`：

| 文件 | 装什么 | 入库？ |
|---|---|---|
| `transcript.json` | 句级 + **词级**（`words`）时间戳 | ❌ 本地数据，自行备份 |
| `translation.json` | 原始 LLM 产物（中间态） | ❌ |
| `bilingual.json` | 对齐后的下游唯一输入 | ❌ |
| `episodes/_sample-intro/` | 合成样例 | ✅ |

## 文档

- [定位与商业化](docs/定位与商业化.md) —— 产品定位、底座策略、商业化路线
- [技术方案](docs/技术方案.md) —— 最初的流水线设计（历史文档）
- [数据架构演进](docs/数据架构演进.md) —— D1 单一数据源的来龙去脉
- [音频存储方案](docs/音频存储方案.md) —— 为什么音频不进 Cloudflare 静态资产

## 贡献与许可

AGPL-3.0，见 [LICENSE](LICENSE)。你的 fork 同样要开源——这是 AGPL 的要求，也是这个项目选择它的原因。

## 待补

- 语言无关化（`translate.py` 仍为 en→zh 硬编码，改造清单见 [定位与商业化](docs/定位与商业化.md)）
- 本地 Whisper 转写路径（当前 ASR 依赖阿里云百炼，海外用户无国内云账号就跑不了自部署）
- Cloudflare 一键部署按钮（Deploy to Cloudflare）
- 测试与 CI
- 仓库历史中仍含 21 期第三方播客的 `bilingual.json`，公开前需处理（见 [定位与商业化](docs/定位与商业化.md) 的待决项）

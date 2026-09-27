---
name: cherina-pod
description: 播客精听流水线。把任意播客音频转成"双语逐句对照学习材料"：搜索播客/粘贴 RSS → 下载音频 → 阿里云 Paraformer 转写（保留词级时间戳）→ LLM 信达雅逐句翻译（双供应商负载均衡）→ 生成 bilingual.json，可灌进 Cloudflare D1 做展示与全文搜索。触发词："转写这个播客"、"做一期播客学习"、"双语播客"、"podcast 学习"、"精听材料"、"cherina-pod"。
version: 0.2.0
---

# cherina-pod 播客精听流水线

把一期播客变成双语逐句对照的学习材料，全部在本地完成；线上网页只负责展示。

> **语言现状**：底座设计为语言无关，但**当前实现仍是英文 → 简体中文**（转写用 Paraformer 英文模型，翻译 prompt 写死"译成简体中文"，`bilingual.json` 键名为 `en`/`zh`）。处理非英文播客需要先改代码，见仓库 `docs/定位与商业化.md` 第六节的改造清单。

## 核心约定（不可违反）

1. **时间戳必须保留**：转写产出词级时间戳，翻译逐句对齐，任何环节不得丢弃时间戳
2. **翻译遵循信达雅**：译文通顺自然、保留口语风格、不翻译腔
3. **密钥只放 `.env`**：`DASHSCOPE_API_KEY`（转写）、`OLLAMA_API_KEY`/`OPENCODE_API_KEY`（翻译），严禁进仓库

## 工作流

### Step 1：搜索播客
```bash
python3 scripts/fetch_podcast.py --search "Lex Fridman"
```
返回播客 id、作者、feedUrl。

### Step 2：列单集 / 下载
```bash
# 列单集（RSS URL 或 iTunes collectionId）
python3 scripts/fetch_podcast.py --episodes 1434243584

# 下载第 3 集到 episodes/<slug>/
python3 scripts/fetch_podcast.py --episodes 1434243584 --index 3
```
产出：`episodes/<slug>/audio/episode.mp4` + `meta.json`（节目/单集元数据，含封面、作者、音频外链）。

下载特性（fetch_podcast.py 内建）：
- **自动压缩**：下载后用 ffmpeg 压成 AAC-LC 64k mono（MP4 容器），体积减半、全浏览器原生支持；`--keep-original` 可保留原始文件
- **断点续传**：中断后重跑从已下载字节续传（HTTP Range）
- **文件校验**：下载后检查音频魔数，防盗链 HTML 错误页自动识别并重下
- **格式兼容**：m4a / wav / flac / ogg 自动识别
- **进度条**：实时显示 MB + 百分比

### Step 3：一键流水线（转写 → 翻译 → 对齐）
```bash
# 从下载开始一站式（推荐）：先下载第 3 集，再转写→翻译→对齐
python3 scripts/run_pipeline.py --fetch <id|rss_url> --index 3

# 已有音频：直接跑流水线
python3 scripts/run_pipeline.py episodes/<slug>
```
- `transcribe.py`：阿里云 Paraformer 转写 → `transcript.json`（句级 + 词级时间戳，秒）
  - **缓存跳过**：已有 `transcript.json` 自动跳过（避免重复烧钱），`--force` 强制重转写
  - 轮询指数退避（3s → 20s 上限）
- `translate.py`：LLM 信达雅翻译 → `translation.json`（逐句 `{en, zh}`）
- `align.py`：合并元数据 → `bilingual.json`（下游唯一数据源）

断点续跑：
```bash
python3 scripts/run_pipeline.py episodes/<slug> --skip-transcribe  # 已转写
python3 scripts/run_pipeline.py episodes/<slug> --skip-translate   # 已翻译
```

批量：`scripts/batch_jobs.txt` 每行 `<feedUrl> <index>`，然后 `bash scripts/batch_add.sh`（串行、断点续跑、失败自动重试）。

### Step 4：灌库 + 同步音频 + 部署
```bash
python3 scripts/migrate_to_d1.py    # 读各期 bilingual.json → web/migrations/*.sql + sitemap.xml
python3 scripts/sync_web.py         # 音频传自建 S3 源站（RustFS，.env 的 RUSTFS_*）
cd web && npm run build && npx wrangler deploy
# 或一步到位（作者自用的一键流）：
bash scripts/deploy_web.sh
```

数据流是单向的：`bilingual.json`（本地原料）→ `migrate_to_d1.py` → D1。线上没有静态 JSON 副本，详情页走 `/api/episodes/:id`。

### Step 5：标题中译（可选，幂等）
```bash
python3 scripts/translate_titles.py
# 然后对相关期重跑 align.py 让 title_zh 进入 bilingual.json
```

## 供应商与负载均衡

| 供应商 | 端点 | Key | 角色 |
|---|---|---|---|
| ollama-cloud | `https://ollama.com/v1` | `OLLAMA_API_KEY` | 主用（质量稳、简体） |
| opencode-go | `https://opencode.ai/zen/go/v1` | `OPENCODE_API_KEY` | 兜底（失败自动切换） |

模型：`deepseek-v4-flash`。翻译结果自动繁体→简体。并发：`translate.py --batch-size 12 --workers 3`。

## 翻译 Prompt 要点（信达雅）

- **信**：准确忠实，不增删不改义，数字/专有名词必须一致
- **达**：按中文母语者习惯重组句子，长句拆短句，避免翻译腔
- **雅**：保留播客口语风格与语气，措辞得当
- 必须简体中文；逐句完整翻译，不得合并/遗漏
- 术语首次出现括注原文（如：费米实验室（Fermi Lab））

参考：JimLiu/baoyu-skills 的 baoyu-translate（MIT）翻译方法论。

## 已知注意点

- `opencode-go` 端点有 Cloudflare 反爬（error 1010），urllib 请求必须带浏览器 UA（脚本已处理）
- 长播客转写耗时较长，Paraformer 轮询最多 600s
- 音频文件大，gitignore 已排除 `episodes/*/audio/`
- 播放器默认用自建源（`pod-audio.cherina.app`）；未配置自建源时自动回退 RSS 外链，而 RSS 外链可能被托管商动态插广告（DAI），导致时间轴漂移

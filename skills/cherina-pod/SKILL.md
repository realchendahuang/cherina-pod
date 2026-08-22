---
name: cherina-pod
description: 英文播客学习流水线。把英文播客音频转成"双语逐句对照学习材料"：搜索播客/粘贴 RSS → 下载音频 → 阿里云 Paraformer 转写（保留词级时间戳）→ DeepSeek V4 Flash 信达雅逐句翻译（双供应商负载均衡）→ 生成 bilingual.json 供 Cloudflare 网页展示。触发词："转写这个播客"、"做一期播客学习"、"双语播客"、"podcast 学习"、"cherina-pod"。
version: 0.1.0
---

# cherina-pod 播客学习流水线

把一期英文播客变成双语逐句对照的学习材料，全部在本地完成；线上网页只负责展示结果。

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
产出：`episodes/<slug>/audio/episode.mp3` + `meta.json`（节目/单集元数据，含封面、作者、音频外链）。

下载特性（fetch_podcast.py 内建）：
- **断点续传**：中断后重跑从已下载字节续传（HTTP Range）
- **文件校验**：下载后检查音频魔数，防盗链 HTML 错误页自动识别并重下
- **格式兼容**：m4a / wav / flac / ogg 自动识别，按实际格式保存为 `episode.<fmt>`
- **进度条**：实时显示 MB + 百分比

### Step 3：一键流水线（转写 → 翻译 → 对齐）
```bash
# 从下载开始一站式（推荐）：先下载第 3 集，再转写→翻译→对齐
python3 scripts/run_pipeline.py --fetch <id|rss_url> --index 3

# 已有音频：直接跑流水线
python3 scripts/run_pipeline.py episodes/<slug>
```
- `transcribe.py`：阿里云 Paraformer 转写 → `transcript.json`（句级+词级时间戳，秒）
  - **缓存跳过**：已有 `transcript.json` 自动跳过（避免重复烧钱），`--force` 强制重转写
  - 轮询指数退避（3s → 20s 上限）
- `translate.py`：DeepSeek V4 Flash 信达雅翻译 → `translation.json`（逐句 `{en, zh, start, end}`）
- `align.py`：合并元数据 → `bilingual.json`（线上网页数据源）

断点续跑：
```bash
python3 scripts/run_pipeline.py episodes/<slug> --skip-transcribe  # 已转写
python3 scripts/run_pipeline.py episodes/<slug> --skip-translate   # 已翻译
```

### Step 4：汇总节目库 + 同步 + 推送展示
```bash
python3 scripts/build_index.py   # 汇总所有期 → episodes/index.json
python3 scripts/sync_web.py      # 同步 index.json + 各期 bilingual.json → web/public/
git add -A
git commit -m "新增一期：<标题>"
git push
cd web && npx wrangler deploy
```

## 多期管理

- `build_index.py`：扫描所有期 → `episodes/index.json`（按日期倒序）
- `sync_web.py`：同步到 `web/public/`（index.json + episodes/<id>/bilingual.json）
- 网页：节目库页（App Store 风格卡片）+ 单期页（`?id=<目录名>`）

## 供应商与负载均衡

| 供应商 | 端点 | Key | 角色 |
|---|---|---|---|
| ollama-cloud | `https://ollama.com/v1` | `OLLAMA_API_KEY` | 主用（质量稳、简体） |
| opencode-go | `https://opencode.ai/zen/go/v1` | `OPENCODE_API_KEY` | 兜底（失败自动切换） |

模型：`deepseek-v4-flash`。翻译结果自动繁体→简体。

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
- 音频文件大（130MB+ 常见），gitignore 已排除 `episodes/*/audio/`
- 线上网页播放用音频外链（blubrry 等），如失效需重新下载/更换

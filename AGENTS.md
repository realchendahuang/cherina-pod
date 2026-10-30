# cherina-pod 项目规则

## 定位（2026-10-31 重新定盘）
- **一个开源的 agent skill + 本地脚本**：把一期外语播客做成一节精听课（`player.html` 精听网页 + `handout.html` 打印讲义 + `notes.md` 难点表达）。
- 不做网站、托管服务、账号、原生 App、浏览器插件。pod.cherina.app 已关闭。
- 需求与优先级见 `docs/PRD.md`；用户调研在 `private/调研/`。
- 讲义二维码是可选的低优先级功能，需要使用者自己有公开网址。

## 技术栈
- Python 3.9+，只用标准库（`opencc` 可选），外部依赖 `ffmpeg` / `ffprobe`
- 转写：阿里云百炼 Paraformer（`DASHSCOPE_API_KEY`）
- 翻译与难点表达：OpenAI 兼容接口，默认模型 `deepseek-v4.1-flash`；供应商顺序 `LLM_BASE_URL` 自定义 → DashScope 兼容模式 → ollama-cloud → opencode-go
- 精听网页与讲义：单文件 HTML，原生 JS，无构建步骤；模板在 `scripts/templates/`

## 核心约定
- **转写必须保留词级时间戳**，逐句对齐依赖它。
- **生成的内容不入库**：`episodes/*/` 下的音频、`transcript.json`、`translation.json`、`bilingual.json`、`meta.json`、`player.html`、`handout.html`、`notes.*` 全部 gitignore。仓库只跟踪合成样例 `episodes/_sample-intro/`。词级时间戳只存在于本机，请自行备份。
- `player.html` 必须能在 `file://` 下离线运行：数据内联进 HTML，音频用相对路径 `audio/episode.mp4`，不发任何网络请求。
- 语言对是配置项：`--source-lang`（默认 auto）/ `--target-lang`（默认 zh）；数据键名一律 `source` / `target`，读入兼容旧格式 `en` / `zh` / `title_zh`。界面语言跟随译文语言（中文译文 → 中文界面，否则英文界面）。
- 翻译遵循信达雅，逐句输出 `{source, target}`；`translation.json` 的 source 必须回填 transcript 原文。
- 难点表达必须能在原句中原样找到，对不上的条目直接丢弃。
- 密钥只放 `.env`（gitignore），绝不进仓库、不打印。

## 目录
- `scripts/`：流水线脚本；`scripts/templates/` 是精听网页模板
- `skills/cherina-pod/SKILL.md`：agent skill 说明
- `episodes/`：每期一个目录，内容全部 gitignore（样例除外）
- `docs/`：PRD
- `private/`：调研与内部材料，gitignore

## 常用命令
```bash
python3 scripts/fetch_podcast.py --search "播客名"                      # 搜索播客
python3 scripts/fetch_podcast.py --episodes <id|rss>                    # 列单集
python3 scripts/run_pipeline.py --fetch <id|rss> --index 1 --level "四级" # 一键生成精听课
python3 scripts/build_lesson.py episodes/<id>                           # 只重新生成精听课
python3 scripts/build_lesson.py episodes/<id> --no-notes                # 不调用 LLM
bash scripts/batch_add.sh                                               # 批量（scripts/batch_jobs.txt）
```

## 音频
- 下载后一律压缩为 AAC-LC 64k mono（MP4 容器，`audio/episode.mp4`），转写和播放都用这一份，保证字幕和音频对齐。

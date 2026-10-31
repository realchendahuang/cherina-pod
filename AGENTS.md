# cherina-pod 项目规则

## 定位（2026-10-31 重新定盘）
- **一个开源的 agent skill + 本地脚本**：把一期外语播客做成一节精听课（`player.html` 精听网页 + `handout.html` 打印讲义 + `notes.md` 难点表达）。
- 不做网站、托管服务、账号、原生 App、浏览器插件。pod.cherina.app 已关闭。
- 需求与优先级见 `docs/PRD.md`；用户调研在 `private/调研/`。
- 讲义二维码是可选的低优先级功能，需要使用者自己有公开网址。

## 技术栈
- Python 3.10+，只用标准库（`opencc` 可选），外部依赖 `ffmpeg` / `ffprobe`
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
- 广告识别结果缓存在 `ads.json`（原文列表），课里删除这些句子并重新编号；播放时句间空隙 > 0.8 秒自动跳过。宁可漏标，不能误删正文。
- 学习记录存在浏览器 localStorage：`cherina-lesson:<id>`（单课进度）、`cherina-pod:activity`（每日时长与完成段数）、`cherina-pod:saved`（收藏与复习排期）、`cherina-pod:last`（上次练的课）。改键名要同时改 player.html 和 index.html。
- 密钥只放 `.env`（gitignore），绝不进仓库、不打印。查找顺序：当前目录、仓库根目录、`~/.config/cherina-pod/.env`。
- 产物目录默认 `episodes/`，环境变量 `CHERINA_POD_OUT` 可覆盖。
- `lesson.py` 的 RESULT 契约（`ok` / `stage` / `error` / `fix` 及成功字段）是 SKILL.md 依赖的接口，改动要同步 SKILL.md。

## 目录
- `SKILL.md`：agent skill 说明（仓库根目录即 skill 目录，可直接克隆进 agent 的 skills 目录）
- `scripts/lesson.py`：唯一入口，最后一行输出 `RESULT {json}`；其余脚本是它调用的步骤
- `scripts/templates/`：精听网页模板（前端由主代理亲自写，不外包给子代理）
- `episodes/`：每期一个目录，内容全部 gitignore（样例除外）
- `docs/`：PRD
- `private/`：调研与内部材料，gitignore

## 常用命令
```bash
python3 scripts/lesson.py --doctor                          # 检查环境与密钥
python3 scripts/lesson.py "播客名或RSS" --list                # 列单集
python3 scripts/lesson.py "播客名或RSS" --episode 1 --level 四级 # 一键生成精听课
python3 scripts/lesson.py --recommend --level 四级            # 推荐播客（scripts/catalog.json）
python3 scripts/lesson.py --setup                           # 交互式填密钥
python3 scripts/lesson.py --serve                           # 局域网课程库，手机直接练
python3 scripts/build_lesson.py episodes/<id>               # 只重新生成精听课（含课程库 index.html）
python3 scripts/build_lesson.py episodes/<id> --single-file --parts 1-3   # 手机单文件
python3 scripts/build_lesson.py episodes/<id> --no-notes                # 不调用 LLM
bash scripts/batch_add.sh                                               # 批量（scripts/batch_jobs.txt）
```

## 音频
- 下载后一律压缩为 AAC-LC 64k mono（MP4 容器，`audio/episode.mp4`），转写和播放都用这一份，保证字幕和音频对齐。

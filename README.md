# cherina-pod

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

**一句话把任意一期外语播客做成一节精听课。**

给它一期播客，它在你自己的电脑上完成下载、转写、翻译和对齐，然后生成：

- **精听网页 `player.html`**：双击打开、离线可用。逐句播放、单句循环、倍速、盲听，按“盲听 → 精听 → 对照 → 再盲听”四步练，进度存在浏览器里。
- **打印讲义 `handout.html`**：双语逐句对照，留有订正空行；可以切换成听写版，答案放在后面。浏览器打印即可存成 PDF。
- **难点表达 `notes.md`**：本期最值得学的 20 个表达，附原句、时间点和解释，可以直接放进 Obsidian。

默认是英文播客配中文译文，中文播客配英文译文同样支持。可以直接运行脚本，也可以作为 agent skill 交给 Claude Code、WorkBuddy 等 agent 调用。

## 快速开始

```bash
git clone https://github.com/realchendahuang/cherina-pod.git && cd cherina-pod
cp .env.example .env              # 填 DASHSCOPE_API_KEY
python3 -m pip install -r requirements.txt   # 可选，用于繁→简转换
```

依赖：Python ≥ 3.9、`ffmpeg` / `ffprobe`。

```bash
python3 scripts/lesson.py --doctor                       # 检查环境与密钥
python3 scripts/lesson.py "6 Minute English" --level 四级  # 最新一集 → 精听课
open episodes/<id>/player.html
```

`<来源>` 可以是播客名、RSS 地址、Apple Podcasts 链接或本地音频文件。最后一行总是 `RESULT {json}`，里面有产物路径；失败时有 `stage` 和修复建议。

```bash
python3 scripts/lesson.py "6 Minute English" --list               # 列最近 15 集
python3 scripts/lesson.py "6 Minute English" --episode 3          # 第 3 新的一集
python3 scripts/lesson.py "6 Minute English" --episode "gold"     # 标题含 gold 的一集
python3 scripts/lesson.py ~/Downloads/talk.m4a                    # 本地音频
python3 scripts/lesson.py "<中文播客>" --lang zh-en                 # 中文播客 + 英文译文
python3 scripts/build_lesson.py episodes/<id> --seg-seconds 120   # 只重新生成网页和讲义
bash scripts/batch_add.sh                                         # 批量（scripts/batch_jobs.txt）
```

## 密钥

只需要一个阿里云百炼的 `DASHSCOPE_API_KEY`：转写用 Paraformer，翻译和难点表达走百炼的 OpenAI 兼容接口。想换翻译模型时，在 `.env` 里填 `LLM_BASE_URL` + `LLM_API_KEY`（任意 OpenAI 兼容端点），模型名用 `LLM_MODEL` 指定。

## 作为 agent skill 使用

仓库根目录就是一个完整的 skill（`SKILL.md` + `scripts/`）。把整个仓库克隆到 agent 的 skills 目录即可：

```bash
git clone https://github.com/realchendahuang/cherina-pod.git ~/.claude/skills/cherina-pod   # Claude Code
# WorkBuddy、Codex 等：克隆到各自的 skills 目录
```

然后在 `.env` 或 `~/.config/cherina-pod/.env` 里填好 `DASHSCOPE_API_KEY`，对 agent 说一句：

> 把 6 Minute English 最新一期做成精听课，我大概四级水平。

## 流水线

```
lesson.py：解析来源 → fetch_podcast.py → transcribe.py → translate.py → align.py → build_lesson.py
                        下载音频          词级时间戳转写     逐句翻译        对齐            生成精听课
```

`transcript.json` 是转写和后续步骤之间唯一的接口。任何 ASR 只要输出下面这个结构就能接进来，比如 `mlx-whisper`、`faster-whisper`、`whisper.cpp`：

```json
{
  "duration": 21.0,
  "sentences": [ { "text": "一句原文", "start": 0.0, "end": 1.6 } ],
  "words":     [ { "word": "词 ", "start": 0.0, "end": 0.28 } ]
}
```

`episodes/_sample-intro/` 是一份人工编写的合成样例，演示数据结构。

## 内容与版权

生成的转写、译文和讲义来自第三方播客，只供你个人学习使用。它们默认不会被提交到仓库（见 `.gitignore`）。公开分享或出售前，请确认你有相应的内容授权。

## 许可

AGPL-3.0，见 [LICENSE](LICENSE)。

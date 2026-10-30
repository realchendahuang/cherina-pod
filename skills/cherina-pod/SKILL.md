---
name: cherina-pod
description: 把任意一期外语播客做成一节精听课：本地精听网页（逐句播放、单句循环、盲听、四步练习）+ 可打印的双语讲义 + 难点表达笔记。默认英文播客配中文译文，也支持中文播客配英文译文。触发词："把这期播客做成精听课"、"播客精听"、"用播客练听力"、"做一份听力讲义"、"双语播客讲义"、"cherina-pod"。
version: 1.0.0
---

# cherina-pod：播客 → 精听课

一句话把一期播客变成一节精听课，全部在用户自己的电脑上完成。

## 前置条件

- 在仓库根目录运行（`scripts/` 所在目录）。
- Python ≥ 3.9，`ffmpeg` / `ffprobe` 已安装。
- `.env` 至少有 `DASHSCOPE_API_KEY`（转写、翻译、难点表达都用它）。没有 `.env` 时，从 `.env.example` 复制一份，并请用户填写 key。**不要替用户编造或回显 key。**

## 工作流

### 1. 确定是哪一期

用户可能给出：播客名 + 描述、RSS 地址、Apple Podcasts 链接、本地音频。

```bash
python3 scripts/fetch_podcast.py --search "6 Minute English"   # 搜播客 → 拿到 id / feedUrl
python3 scripts/fetch_podcast.py --episodes <id|rss>            # 列单集，按编号选
```

用户说“最新一期”就选第 1 集。拿不准是哪一期时，列出 3–5 个候选让用户挑。

### 2. 一键生成

```bash
python3 scripts/run_pipeline.py --fetch <id|rss> --index <N> --level "<用户水平>"
```

- `--level`：用户提到水平时传入，例如“四级”“雅思 6”。没提就不传，默认按中级处理。
- 中文播客、英文译文：加 `--source-lang zh --target-lang en`。
- 本地音频：放到 `episodes/<id>/audio/episode.mp4`，然后 `python3 scripts/run_pipeline.py episodes/<id>`。
- 已经跑过的期会自动跳过转写，翻译断点续跑。只想重新生成精听课：`python3 scripts/build_lesson.py episodes/<id>`。

一小时的节目通常需要 5–15 分钟，大部分时间花在转写上。

### 3. 交付

产物都在 `episodes/<id>/`：

| 文件 | 用途 |
|---|---|
| `player.html` | 精听网页，双击打开，离线可用。和 `audio/` 文件夹放在一起才能播放 |
| `handout.html` | 打印讲义，有对照版和听写版，浏览器打印即可存成 PDF |
| `notes.md` | 难点表达笔记，可以直接放进 Obsidian |
| `bilingual.json` | 原文、译文、时间戳数据 |

回复用户时保持简短：节目名、句数和段数、耗时，然后给出 `player.html` 和 `handout.html` 的路径，提醒“打开 player.html，从第 1 段的盲听开始”。

## 常见问题

- **转写报错或超时**：检查 `DASHSCOPE_API_KEY`；超长节目（3 小时以上）会更慢。
- **翻译全部失败**：看报错里的供应商名。可以在 `.env` 配置 `LLM_BASE_URL` + `LLM_API_KEY` 换成任意 OpenAI 兼容端点；模型名用 `LLM_MODEL` 覆盖。
- **难点表达没生成**：不影响网页和讲义，修好 key 后运行 `python3 scripts/build_lesson.py episodes/<id> --force-notes`。
- **网页没声音**：`player.html` 必须和 `audio/episode.mp4` 在同一个文件夹里；移动时整个文件夹一起移。

## 约定

- 转写必须保留词级时间戳，逐句对齐依赖它。
- 生成的内容（转写、译文、讲义）属于第三方播客，只供用户个人学习，不提交到仓库。

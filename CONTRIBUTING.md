# 参与贡献

感谢你愿意帮忙！下面是几条约定，读一遍再动手会省很多来回。

## 开发环境

```bash
git clone https://github.com/realchendahuang/cherina-pod.git && cd cherina-pod
cp .env.example .env   # 填 DASHSCOPE_API_KEY
python3 scripts/lesson.py --doctor
```

不需要密钥也能改前端：`python3 scripts/build_lesson.py episodes/_sample-intro --no-notes`，然后打开 `episodes/_sample-intro/player.html`。

## 约定

- **只用 Python 标准库。** 新增第三方依赖需要先开 Issue 讨论。
- **`player.html` 必须离线可用。** 数据内联进 HTML，音频用相对路径，不发任何网络请求，不引入 CDN。
- **词级时间戳不能丢。** 任何环节都要保留 `transcript.json` 里的 `words`。
- **`lesson.py` 的 `RESULT` 行是对外接口。** 改字段名或 `stage` 取值时，同步修改 `SKILL.md`。
- **不提交生成内容。** `episodes/` 下除了 `_sample-intro/` 都在 `.gitignore` 里，PR 里不要出现第三方播客的转写或译文。
- 密钥只放 `.env`，不要写进代码、日志或截图。

## 提交 PR 前

```bash
python3 -m py_compile scripts/*.py
python3 scripts/build_lesson.py episodes/_sample-intro --no-notes
```

改了网页的话，请附手机和桌面各一张截图。

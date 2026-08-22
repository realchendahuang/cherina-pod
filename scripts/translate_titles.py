#!/usr/bin/env python3
"""单集标题中译（DeepSeek V4 Flash，一次调用批量完成）。

扫描 episodes/*/meta.json，把缺失的 episode.title_zh 补上（直译兼顾可读性）。
播客名不翻译，统一用原始英文名。
写回 meta.json 后需重新跑 align.py 才会进入 bilingual.json。

用法：
  python3 scripts/translate_titles.py            # 补全所有缺失标题
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from translate import available_providers, chat_completion_retry, load_env  # noqa: E402

PROMPT = """你是专业的播客单集标题翻译。把下面 JSON 数组里每一项的 episode_title 翻译成中文：
- 直译为主、兼顾中文可读性，人名/品牌名保留英文
- 只输出 JSON 数组，每项 {{"id", "episode_title_zh"}}，不要任何额外文字

输入：
{titles_json}"""


def main():
    load_env()
    provider = available_providers()[0]

    todo = []
    files = {}
    for meta_path in sorted(ROOT.glob("episodes/*/meta.json")):
        data = json.loads(meta_path.read_text(encoding="utf-8"))
        episode = data.get("episode", {})
        if episode.get("title_zh"):
            continue
        ep_id = meta_path.parent.name
        todo.append(
            {
                "id": ep_id,
                "episode_title": episode.get("title", ""),
            }
        )
        files[ep_id] = meta_path

    if not todo:
        print("✅ 所有期已有中文标题，无需处理")
        return 0

    print(f"待译标题 {len(todo)} 期，调用 {provider['name']}…")
    content = chat_completion_retry(
        provider,
        [{"role": "user", "content": PROMPT.format(titles_json=json.dumps(todo, ensure_ascii=False, indent=2))}],
        max_tokens=4000,
    )
    # 提取 JSON 数组（模型可能包 ```json）
    start, end = content.find("["), content.rfind("]")
    if start < 0 or end < 0:
        print(f"错误：响应中未找到 JSON 数组：\n{content[:500]}", file=sys.stderr)
        return 1
    results = json.loads(content[start : end + 1])

    by_id = {r["id"]: r for r in results}
    updated = 0
    for ep_id, meta_path in files.items():
        r = by_id.get(ep_id)
        if not r:
            print(f"⚠️ {ep_id} 未在响应中，跳过")
            continue
        data = json.loads(meta_path.read_text(encoding="utf-8"))
        data.setdefault("episode", {})["title_zh"] = r.get("episode_title_zh", "").strip()
        meta_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        updated += 1
        print(f"  {ep_id}: {data['episode']['title_zh']}")

    print(f"✅ 已更新 {updated} 期中文标题，下一步：重跑 align.py + build_index.py + sync_web.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())

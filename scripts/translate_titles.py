#!/usr/bin/env python3
"""单集标题翻译（DeepSeek V4 Flash，一次调用批量完成）。

扫描 episodes/*/meta.json，把缺失的 episode.title_target 补上（直译兼顾可读性）。
播客名不翻译，统一用原始名。
写回 meta.json 后需重新跑 align.py 才会进入 bilingual.json。
旧 meta.json 的 title_zh 视为已翻译（兼容）。

用法：
  python3 scripts/translate_titles.py                      # 补全所有缺失标题（→ 简体中文）
  python3 scripts/translate_titles.py --target-lang en     # 标题译成英语
"""

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from translate import (  # noqa: E402
    available_providers,
    chat_completion_retry,
    lang_label,
    load_env,
)

PROMPT = """你是专业的播客单集标题翻译。把下面 JSON 数组里每一项的 episode_title 翻译成{tgt}：
- 直译为主、兼顾{tgt}可读性，人名/品牌名保留原文
- 只输出 JSON 数组，每项 {{"id", "episode_title_target"}}，不要任何额外文字

输入：
{titles_json}"""

BATCH_TITLES = 20  # 每次调用翻译的标题数：一次全量塞 max_tokens 会截断


def translate_title_batch(provider_order, batch, target_lang="zh"):
    """翻一批标题：供应商按序尝试，全部失败返回 None，成功返回 {id: result}。"""
    prompt = PROMPT.format(
        tgt=lang_label(target_lang) or "简体中文（简体）",
        titles_json=json.dumps(batch, ensure_ascii=False, indent=2),
    )
    for provider in provider_order:
        try:
            content = chat_completion_retry(
                provider,
                [{"role": "user", "content": prompt}],
                max_tokens=4000,
            )
            # 提取 JSON 数组（模型可能包 ```json）
            start, end = content.find("["), content.rfind("]")
            if start < 0 or end < 0:
                raise ValueError(f"响应中未找到 JSON 数组：{content[:300]}")
            results = json.loads(content[start : end + 1])
            if not isinstance(results, list):
                raise ValueError("响应不是 JSON 数组")
            return {
                str(r.get("id", "")): r for r in results if isinstance(r, dict)
            }
        except (RuntimeError, ValueError, json.JSONDecodeError) as e:
            print(f"  ⚠️ [{provider['name']}] 批次失败，尝试下一家：{e}", file=sys.stderr)
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--target-lang",
        default="zh",
        help="标题翻译的目标语言（默认 zh）；与已有译文语言不同的期请重跑",
    )
    args = ap.parse_args()
    load_env()
    provider_order = available_providers()

    todo = []
    files = {}
    for meta_path in sorted(ROOT.glob("episodes/*/meta.json")):
        data = json.loads(meta_path.read_text(encoding="utf-8"))
        episode = data.get("episode", {})
        # title_zh 是旧键名，已存在即视为已译（不重复花钱）
        if episode.get("title_target") or episode.get("title_zh"):
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
        print("✅ 所有期标题均已有译文，无需处理")
        return 0

    n_batches = -(-len(todo) // BATCH_TITLES)
    tgt_desc = lang_label(args.target_lang) or args.target_lang
    print(
        f"待译标题 {len(todo)} 期（→ {tgt_desc}），"
        f"分 {n_batches} 批调用（{provider_order[0]['name']} 优先）…"
    )

    by_id = {}
    for bi in range(n_batches):
        chunk = todo[bi * BATCH_TITLES : (bi + 1) * BATCH_TITLES]
        got = translate_title_batch(provider_order, chunk, args.target_lang)
        if got is None:
            print(f"错误：批次 {bi + 1}/{n_batches} 全部供应商失败，中止（已完成的批次保留）", file=sys.stderr)
            break
        by_id.update(got)

    updated = 0
    for ep_id, meta_path in files.items():
        r = by_id.get(ep_id)
        if not r:
            print(f"⚠️ {ep_id} 未在响应中，跳过")
            continue
        data = json.loads(meta_path.read_text(encoding="utf-8"))
        title = str(
            r.get("episode_title_target") or r.get("episode_title_zh") or ""
        ).strip()
        data.setdefault("episode", {})["title_target"] = title
        meta_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        updated += 1
        print(f"  {ep_id}: {title}")

    print(
        f"✅ 已更新 {updated} 期标题译文（→ {tgt_desc}），"
        f"下一步：重跑 align.py + migrate_to_d1.py"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

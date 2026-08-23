#!/usr/bin/env python3
"""DeepSeek V4 Flash 逐句翻译（信达雅 prompt，双供应商负载均衡）。

输入：episode_dir/transcript.json（阿里云 Paraformer 输出的句级英文）
输出：episode_dir/translation.json（逐句 {en, zh}）

供应商（OpenAI 兼容 /chat/completions）：
  - ollama-cloud  https://ollama.com/v1          key: OLLAMA_API_KEY
  - opencode-go   https://opencode.ai/zen/go/v1  key: OPENCODE_API_KEY
默认轮询切换，失败自动重试到另一家。

用法：
  python3 scripts/translate.py <episode_dir>
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import UA, load_env, norm_text  # noqa: E402

MODEL = "deepseek-v4-flash"

# preferred=True 主用（ollama-cloud 质量稳定、简体）；preferred=False 仅作 fallback
PROVIDERS = [
    {
        "name": "ollama-cloud",
        "base": "https://ollama.com/v1",
        "key_env": "OLLAMA_API_KEY",
        "preferred": True,
    },
    {
        "name": "opencode-go",
        "base": "https://opencode.ai/zen/go/v1",
        "key_env": "OPENCODE_API_KEY",
        "preferred": False,
    },
]

# 繁→简转换（避免 opencode-go 偶发输出繁体）
try:
    import opencc

    _T2S = opencc.OpenCC("t2s")
except ImportError:
    _T2S = None


def available_providers():
    ok = [p for p in PROVIDERS if os.environ.get(p["key_env"])]
    if not ok:
        print(
            "错误：没有可用的翻译供应商（请检查 .env 的 OLLAMA_API_KEY / OPENCODE_API_KEY）",
            file=sys.stderr,
        )
        sys.exit(2)
    return ok


def chat_completion(provider, messages, max_tokens=3000, timeout=300):
    """调一个供应商的 /chat/completions，返回 content 文本。"""
    url = f"{provider['base']}/chat/completions"
    body = json.dumps(
        {
            "model": MODEL,
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": max_tokens,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {os.environ.get(provider['key_env'])}",
            # Cloudflare 拦截默认 urllib UA（error 1010），需伪装浏览器 UA
            "User-Agent": UA,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        content = data["choices"][0]["message"].get("content") or ""
        if not content.strip():
            # 推理模型偶发把内容全放 reasoning，content 为空 → 重试一次
            raise RuntimeError(f"[{provider['name']}] 空响应（content 为空）")
        return content
    except (
        urllib.error.HTTPError,
        urllib.error.URLError,
        KeyError,
        json.JSONDecodeError,
        OSError,  # RemoteDisconnected / ConnectionReset 等网络中断
    ) as e:
        if isinstance(e, urllib.error.HTTPError):
            detail = e.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"[{provider['name']}] HTTP {e.code}: {detail}") from e
        raise RuntimeError(f"[{provider['name']}] {e}") from e


def chat_completion_retry(provider, messages, max_tokens=3000, timeout=300, retries=2):
    """chat_completion + 空响应/失败自动重试。"""
    last_err = None
    for _ in range(retries):
        try:
            return chat_completion(provider, messages, max_tokens, timeout)
        except RuntimeError as e:
            last_err = e
            time.sleep(1)
    if last_err is None:
        raise RuntimeError(f"[{provider['name']}] 未知错误")
    raise last_err


def _build_batch_messages(batch):
    """构造一个批次的翻译 messages。

    只传文本、只要求输出 {en, zh}：时间戳在 align.py 里以 transcript 为准，
    让 LLM 生成/回填 start/end 是白烧 token，还引入抄错数字的风险。
    """
    texts = [s["text"] for s in batch]
    payload = json.dumps(texts, ensure_ascii=False)
    system = (
        "你是一位专业的中英双语译者，译文遵循信达雅原则。\n"
        "核心要求：\n"
        "1. 信：准确忠实，不增删不改义；事实、数字、专有名词必须与原文一致。\n"
        "2. 达：通顺自然，按中文母语者习惯表达，长句拆短句，避免翻译腔。\n"
        "3. 雅：保留原播客的口语风格与语气（幽默/严肃/平实），措辞得当、可读性高。\n"
        "4. 术语一致：人名、专有名词、缩写保持统一译法，不得前后不一致。\n"
        "5. 必须使用简体中文（不得输出繁体中文）。\n"
        "6. 严格逐句翻译：每句原文必须输出对应的完整译文，不得合并、拆分、遗漏或省略任何一句；"
        "遇到赞助商信息、专有名词密集的句子也要完整翻译，不得只列名词。\n"
        "只输出 JSON 数组，不输出任何其他文字。"
    )
    user = (
        f"下面是一个英文播客转录片段，含 {len(texts)} 句。\n"
        f'请逐句翻译成中文，输出 JSON 数组，每项为 {{"en": 原文, "zh": 中文翻译}}。\n\n'
        f"输入 JSON：\n{payload}"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ], len(texts)


def translate_batch(batch, order):
    """翻译一个批次，按供应商顺序失败切换；整批失败时拆半重试。

    返回 ([{en,zh}], 供应商名)。单句仍失败则抛 RuntimeError。
    """
    messages, expected = _build_batch_messages(batch)
    last_err = None
    for provider in order:
        try:
            raw = chat_completion_retry(provider, messages, max_tokens=6000)
            return parse_translation(raw, expected), provider["name"]
        except RuntimeError as e:
            last_err = str(e)
            print(
                f"  [{provider['name']}] 批次失败，尝试下一家：{last_err[:200]}",
                file=sys.stderr,
            )
    if len(batch) > 1:
        mid = len(batch) // 2
        print(
            f"  ⚠️ 整批失败，拆半重试（{len(batch)} 句 → {mid} + {len(batch) - mid}）",
            file=sys.stderr,
        )
        left, pn1 = translate_batch(batch[:mid], order)
        right, pn2 = translate_batch(batch[mid:], order)
        return left + right, f"{pn1}/{pn2}"
    raise RuntimeError(f"全部供应商失败（单句）。最后错误：{last_err}")


def translate_sentences(
    sentences,
    providers,
    batch_size=12,
    workers=3,
    resume=None,
    out_path=None,
):
    """多线程逐批翻译。返回 [{en, zh}]，resume 为已完成结果列表。"""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    results = list(resume) if resume else []
    done_en = {norm_text(r["en"]) for r in results}
    pending = [s for s in sentences if norm_text(s["text"]) not in done_en]

    # 供应商顺序：preferred 优先，fallback 兜底（不做随机轮询，保质量稳定）
    order = sorted(providers, key=lambda p: 0 if p.get("preferred") else 1)

    batches = [pending[i : i + batch_size] for i in range(0, len(pending), batch_size)]
    print(
        f"共 {len(sentences)} 句，待译 {len(pending)} 句，"
        f"批次 {batch_size} 句 × {len(batches)} 批，并发 {workers}"
    )
    if not batches:
        return results

    def flush_partial():
        if out_path:
            out_path.write_text(
                json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
            )

    failed = None
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {
            ex.submit(translate_batch, b, order): (bi, b)
            for bi, b in enumerate(batches)
        }
        for fut in as_completed(futs):
            bi, b = futs[fut]
            try:
                batch_result, pname = fut.result()
            except RuntimeError as e:
                failed = e
                for f in futs:
                    f.cancel()
                break
            results.extend(batch_result)
            print(
                f"  [批次 {bi + 1}/{len(batches)}] 完成（{pname}），"
                f"已累计 {len(results)}/{len(sentences)}"
            )
            # 每 ~5 批落盘一次，崩溃可断点续跑
            if len(results) % (batch_size * 5) < batch_size:
                flush_partial()

    if failed is not None:
        flush_partial()
        print(f"错误：{failed}", file=sys.stderr)
        print(
            f"  ⚠️ 已保存部分结果 {len(results)}/{len(sentences)}，可断点续跑（会跳过已译句）",
            file=sys.stderr,
        )
        sys.exit(1)
    return results


def parse_translation(raw, expected):
    """解析模型输出为 [{en,zh,start,end}]。容忍 JSON 外的说明文字。"""
    text = raw.strip()
    # 去掉可能的 ```json ... ``` 包裹
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
    # 截取第一个 [ 到最后一个 ]
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1:
        raise RuntimeError(f"无法解析翻译输出：{raw[:300]}")
    arr = json.loads(text[start : end + 1])
    if not isinstance(arr, list) or len(arr) != expected:
        raise RuntimeError(
            f"数量不符：期望 {expected} 句，实际 {len(arr) if isinstance(arr, list) else '非数组'}"
        )
    out = []
    for item in arr:
        zh = str(item.get("zh", "")).strip()
        if _T2S is not None:
            zh = _T2S.convert(zh)  # 繁体转简体
        out.append(
            {
                "en": str(item.get("en", "")).strip(),
                "zh": zh,
            }
        )
    return out


def save_partial(results, total):
    print(
        f"  ⚠️ 已保存部分结果 {len(results)}/{total}，可断点续跑（会跳过已译句）",
        file=sys.stderr,
    )


def main():
    import argparse

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("episode_dir")
    ap.add_argument("--batch-size", type=int, default=12, help="每批句数（默认 12）")
    ap.add_argument("--workers", type=int, default=3, help="并发线程数（默认 3）")
    args = ap.parse_args()
    load_env()
    ep_dir = Path(args.episode_dir).resolve()
    trans_path = ep_dir / "transcript.json"
    if not trans_path.exists():
        print(f"找不到 {trans_path}（请先运行 transcribe.py）", file=sys.stderr)
        return 2
    transcript = json.loads(trans_path.read_text(encoding="utf-8"))
    sentences = transcript["sentences"]
    if not sentences:
        print("transcript.json 没有句子", file=sys.stderr)
        return 2

    providers = available_providers()
    print(f"可用供应商：{', '.join(p['name'] for p in providers)}（轮询负载均衡）")

    # 断点续跑：读已有 translation.json
    resume = None
    out_path = ep_dir / "translation.json"
    if out_path.exists():
        try:
            resume = json.loads(out_path.read_text(encoding="utf-8"))
            print(f"检测到已有翻译 {len(resume)} 句，断点续跑")
        except json.JSONDecodeError:
            pass

    results = translate_sentences(
        sentences,
        providers,
        batch_size=args.batch_size,
        workers=args.workers,
        resume=resume,
        out_path=out_path,
    )
    out_path.write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"✅ translation.json 已生成：{out_path}（{len(results)} 句）")
    return 0


if __name__ == "__main__":
    sys.exit(main())

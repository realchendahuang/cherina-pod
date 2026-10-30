#!/usr/bin/env python3
"""DeepSeek V4 Flash 逐句翻译（信达雅 prompt，双供应商负载均衡）。

输入：episode_dir/transcript.json（ASR 输出的句级文本）
输出：episode_dir/translation.json（逐句 {source, target}）

语言对由 --source-lang / --target-lang 决定，默认 auto → zh（保持旧行为）。
旧格式 {en, zh} 的 translation.json 仍可断点续跑（读时兼容）。

供应商（OpenAI 兼容 /chat/completions）：
  - ollama-cloud  https://ollama.com/v1          key: OLLAMA_API_KEY
  - opencode-go   https://opencode.ai/zen/go/v1  key: OPENCODE_API_KEY
默认轮询切换，失败自动重试到另一家。

用法：
  python3 scripts/translate.py <episode_dir>
  python3 scripts/translate.py <episode_dir> --source-lang en --target-lang ja
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

# 语言代码 → prompt 里的语言名。表里没有的直接用代码本身（模型认得 BCP-47 常见标签）。
LANG_LABEL = {
    "zh": "简体中文（简体）",
    "zh-Hant": "繁体中文",
    "en": "英语",
    "ja": "日语",
    "ko": "韩语",
    "fr": "法语",
    "de": "德语",
    "es": "西班牙语",
    "pt": "葡萄牙语",
    "ru": "俄语",
    "it": "意大利语",
    "ar": "阿拉伯语",
    "th": "泰语",
    "vi": "越南语",
    "id": "印度尼西亚语",
}


def lang_label(code):
    """语言代码转 prompt 用名称；未知代码原样返回。"""
    if not code or code == "auto":
        return ""
    return LANG_LABEL.get(code, code)

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


def chat_completion_retry(provider, messages, max_tokens=3000, timeout=300, attempts=2):
    """chat_completion + 空响应/失败自动重试（共 attempts 次尝试）。"""
    last_err = None
    for _ in range(max(1, attempts)):
        try:
            return chat_completion(provider, messages, max_tokens, timeout)
        except RuntimeError as e:
            last_err = e
            time.sleep(1)
    if last_err is None:
        raise RuntimeError(f"[{provider['name']}] 未知错误")
    raise last_err


def _build_batch_messages(batch, source_lang, target_lang):
    """构造一个批次的翻译 messages。

    只传文本、只要求输出 {source, target}：时间戳在 align.py 里以 transcript
    为准，让 LLM 生成/回填 start/end 是白烧 token，还引入抄错数字的风险。
    """
    texts = [s["text"] for s in batch]
    payload = json.dumps(texts, ensure_ascii=False)
    tgt = lang_label(target_lang) or "简体中文（简体）"
    src_desc = lang_label(source_lang) or "自动识别（可能是任意语言）"
    # 简体约束只对中文目标成立：其他语言写"必须使用 X"即可，别套中文规则
    tgt_rule = (
        "必须使用简体中文（不得输出繁体中文）。"
        if target_lang == "zh"
        else f"只用{tgt}输出，不要混入其他语言。"
    )
    system = (
        f"你是一位专业译者，把播客口语转录译成{tgt}，译文遵循信达雅原则。\n"
        f"源语言：{src_desc}。\n"
        "核心要求：\n"
        "1. 信：准确忠实，不增删不改义；事实、数字、专有名词必须与原文一致。\n"
        f"2. 达：通顺自然，按{tgt}母语者习惯表达，长句拆短句，避免翻译腔。\n"
        "3. 雅：保留原播客的口语风格与语气（幽默/严肃/平实），措辞得当、可读性高。\n"
        "4. 术语一致：人名、专有名词、缩写保持统一译法，不得前后不一致。\n"
        f"5. {tgt_rule}\n"
        "6. 严格逐句翻译：每句原文必须输出对应的完整译文，不得合并、拆分、遗漏或省略任何一句；"
        "遇到赞助商信息、专有名词密集的句子也要完整翻译，不得只列名词。\n"
        "只输出 JSON 数组，不输出任何其他文字。"
    )
    user = (
        f"下面是一个播客转录片段（{src_desc}），含 {len(texts)} 句。\n"
        f'请逐句翻译成{tgt}，输出 JSON 数组，每项为 {{"source": 原文, "target": 译文}}。\n\n'
        f"输入 JSON：\n{payload}"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ], len(texts)


def translate_batch(batch, order, source_lang, target_lang):
    """翻译一个批次，按供应商顺序失败切换；整批失败时拆半重试。

    返回 ([{source,target}], 供应商名)。单句仍失败则抛 RuntimeError。
    """
    messages, expected = _build_batch_messages(batch, source_lang, target_lang)
    last_err = None
    for provider in order:
        try:
            raw = chat_completion_retry(provider, messages, max_tokens=6000)
            parsed = parse_translation(raw, expected, target_lang)
            # source 一律回填 transcript 原文：模型回抄可能微调大小写/空格，
            # 会破坏断点续跑去重与 align 的按文本匹配（同句反复重译、译文对不上）。
            for item, s in zip(parsed, batch):
                item["source"] = s["text"]
            return parsed, provider["name"]
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
        left, pn1 = translate_batch(batch[:mid], order, source_lang, target_lang)
        right, pn2 = translate_batch(batch[mid:], order, source_lang, target_lang)
        return left + right, f"{pn1}/{pn2}"
    raise RuntimeError(f"全部供应商失败（单句）。最后错误：{last_err}")


def translate_sentences(
    sentences,
    providers,
    batch_size=12,
    workers=3,
    resume=None,
    out_path=None,
    source_lang="auto",
    target_lang="zh",
):
    """多线程逐批翻译。返回 [{source, target}]，resume 为已完成结果列表（旧格式自动兼容）。"""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    results = list(resume) if resume else []
    # 旧 translation.json 是 {en, zh}，续跑时统一读成 source/target
    for r in results:
        if "source" not in r and "en" in r:
            r["source"] = r.pop("en")
        if "target" not in r and "zh" in r:
            r["target"] = r.pop("zh")
    done_src = {norm_text(r["source"]) for r in results}
    pending = [s for s in sentences if norm_text(s["text"]) not in done_src]

    # 供应商顺序：preferred 优先，fallback 兜底（不做随机轮询，保质量稳定）
    order = sorted(providers, key=lambda p: 0 if p.get("preferred") else 1)

    batches = [pending[i : i + batch_size] for i in range(0, len(pending), batch_size)]
    print(
        f"共 {len(sentences)} 句，待译 {len(pending)} 句，"
        f"批次 {batch_size} 句 × {len(batches)} 批，并发 {workers}"
    )
    if not batches:
        return results

    # 批次结果按批序号收齐后统一按原序拼接：as_completed 的完成序会把
    # translation.json 写乱，与 transcript 顺序脱钩。
    done = {}

    def flush_partial():
        if out_path:
            ordered = [item for bi in sorted(done) for item in done[bi]]
            out_path.write_text(
                json.dumps(results + ordered, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

    failed = None
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {
            ex.submit(translate_batch, b, order, source_lang, target_lang): (bi, b)
            for bi, b in enumerate(batches)
        }
        try:
            for fut in as_completed(futs):
                bi, b = futs[fut]
                batch_result, pname = fut.result()
                done[bi] = batch_result
                n_done = len(results) + sum(len(v) for v in done.values())
                print(
                    f"  [批次 {bi + 1}/{len(batches)}] 完成（{pname}），"
                    f"已累计 {n_done}/{len(sentences)}"
                )
                # 每 5 批落盘一次，崩溃可断点续跑
                if len(done) % 5 == 0:
                    flush_partial()
        except RuntimeError as e:
            failed = e
            for f in futs:
                f.cancel()
        # 收割已完成但未来得及消费的结果，失败退出时尽量少丢已完成的工作
        for f, (bi, _b) in futs.items():
            if bi in done or f.cancelled() or not f.done():
                continue
            if f.exception() is None:
                done[bi] = f.result()[0]

    if failed is not None:
        flush_partial()
        n_saved = len(results) + sum(len(v) for v in done.values())
        print(f"错误：{failed}", file=sys.stderr)
        print(
            f"  ⚠️ 已保存部分结果 {n_saved}/{len(sentences)}，可断点续跑（会跳过已译句）",
            file=sys.stderr,
        )
        sys.exit(1)

    results.extend(item for bi in sorted(done) for item in done[bi])
    return results


def parse_translation(raw, expected, target_lang="zh"):
    """解析模型输出为 [{source, target}]。容忍 JSON 外的说明文字与旧键名。"""
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
        # 模型偶尔仍按旧指令回 en/zh，这里都认
        tgt = str(item.get("target") or item.get("zh") or "").strip()
        if _T2S is not None and target_lang == "zh":
            tgt = _T2S.convert(tgt)  # 繁体转简体（仅中文目标需要）
        out.append(
            {
                "source": str(item.get("source") or item.get("en") or "").strip(),
                "target": tgt,
            }
        )
    return out


def main():
    import argparse

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("episode_dir")
    ap.add_argument("--batch-size", type=int, default=12, help="每批句数（默认 12）")
    ap.add_argument("--workers", type=int, default=3, help="并发线程数（默认 3）")
    ap.add_argument(
        "--source-lang",
        default="auto",
        help="源语言（BCP-47，如 en/zh/ja；默认 auto = 让模型自己识别）",
    )
    ap.add_argument(
        "--target-lang",
        default="zh",
        help="目标语言（BCP-47，默认 zh = 简体中文）",
    )
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
    print(f"可用供应商：{', '.join(p['name'] for p in providers)}（preferred 优先，失败自动切换）")
    src_desc = lang_label(args.source_lang) or "auto（模型识别）"
    tgt_desc = lang_label(args.target_lang) or args.target_lang
    print(f"语言对：{src_desc} → {tgt_desc}")

    # 断点续跑：读已有 translation.json（旧 {en,zh} 格式在 translate_sentences 内兼容）
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
        source_lang=args.source_lang,
        target_lang=args.target_lang,
    )
    out_path.write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"✅ translation.json 已生成：{out_path}（{len(results)} 句）")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""把一期 bilingual.json 做成一节精听课。

输入：episode_dir/bilingual.json（+ audio/episode.mp4）
输出（写在同一目录）：
  player.html   精听网页：双击打开、离线可用，四步练习（盲听 → 精听 → 对照 → 再盲听）
  handout.html  打印讲义：对照版 / 听写版，浏览器打印即可存 PDF
  notes.md      难点表达（需要翻译 key；结果缓存在 notes.json）

用法：
  python3 scripts/build_lesson.py episodes/<id>
  python3 scripts/build_lesson.py episodes/<id> --level "雅思 6" --notes 20
  python3 scripts/build_lesson.py episodes/<id> --no-notes        # 不调用 LLM
  python3 scripts/build_lesson.py episodes/<id> --seg-seconds 120 # 每段约 2 分钟
"""

import argparse
import html
import json
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import load_env  # noqa: E402

TEMPLATES = HERE / "templates"
CJK = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]")
WORD = re.compile(r"[A-Za-z0-9\u00c0-\u024f']+")


# ---------------------------------------------------------------- 读数据
def load_episode(ep: Path):
    d = json.loads((ep / "bilingual.json").read_text(encoding="utf-8"))
    pairs = d.get("pairs") or []
    sents = []
    for p in pairs:
        src = (p.get("source") or p.get("en") or "").strip()
        tgt = (p.get("target") or p.get("zh") or "").strip()
        if not src:
            continue
        sents.append({"s": src, "t": tgt, "a": float(p["start"]), "b": float(p["end"])})
    for i, s in enumerate(sents):
        s["n"] = i + 1
    attach_word_times(ep, sents)
    pod = d.get("podcast") or {}
    epi = d.get("episode") or {}
    sample = " ".join(s["s"] for s in sents[:50])
    src_lang = d.get("source_lang") or ("zh" if len(CJK.findall(sample)) > len(sample) * 0.3 else "en")
    return {
        "id": d.get("id") or ep.name,
        "podcast": pod.get("title") or "",
        "podcast_target": pod.get("title_target") or pod.get("title_zh") or "",
        "title": epi.get("title") or ep.name,
        "title_target": epi.get("title_target") or epi.get("title_zh") or "",
        "source_lang": src_lang,
        "target_lang": d.get("target_lang") or "zh",
        "duration": float(d.get("duration") or (sents[-1]["b"] if sents else 0)),
        "audio": d.get("audio") or "audio/episode.mp4",
        "sentences": sents,
    }


def attach_word_times(ep: Path, sents):
    """给每句加 w：按空白切出的每个词的开始时间（与网页里的切词规则一致），用于逐词高亮。

    优先用 transcript.json 的词级时间戳；词数对不上时按字符比例估算。
    """
    words = []
    tp = ep / "transcript.json"
    if tp.exists():
        try:
            words = json.loads(tp.read_text(encoding="utf-8")).get("words") or []
        except (json.JSONDecodeError, OSError):
            words = []
    wi = 0
    for s in sents:
        toks = re.findall(r"\S+", s["s"])
        while wi < len(words) and words[wi]["start"] < s["a"] - 0.01:
            wi += 1
        j = wi
        while j < len(words) and words[j]["start"] < s["b"] - 0.005:
            j += 1
        span = words[wi:j]
        wi = j
        if span and len(span) == len(toks):
            s["w"] = [round(float(w["start"]), 2) for w in span]
        else:
            total = sum(len(t) for t in toks) or 1
            acc, out = 0, []
            for t in toks:
                out.append(round(s["a"] + (s["b"] - s["a"]) * acc / total, 2))
                acc += len(t)
            s["w"] = out


# ---------------------------------------------------------------- 分段与语速
def count_units(text, cjk_source):
    return len(CJK.findall(text)) if cjk_source else len(WORD.findall(text))


def segment(sents, target, cjk_source):
    """按句子边界切段：到达目标时长后，在下一个停顿或句末切；最长不超过 1.3 倍目标。"""
    segs, start_i = [], 0
    for i, s in enumerate(sents):
        dur = s["b"] - sents[start_i]["a"]
        last = i == len(sents) - 1
        gap = (sents[i + 1]["a"] - s["b"]) if not last else 0
        ends = s["s"][-1:] in ".?!。？！…\"'"
        if last or (dur >= target and (gap >= 0.35 or ends or dur >= target * 1.3)):
            segs.append((start_i, i + 1))
            start_i = i + 1
    # 末段太短就并入上一段
    if len(segs) >= 2:
        a, b = segs[-1]
        if sents[b - 1]["b"] - sents[a]["a"] < target * 0.35:
            segs[-2] = (segs[-2][0], b)
            segs.pop()
    out = []
    for k, (a, b) in enumerate(segs):
        t0, t1 = sents[a]["a"], sents[b - 1]["b"]
        speech = sum(x["b"] - x["a"] for x in sents[a:b]) or (t1 - t0)
        units = sum(count_units(x["s"], cjk_source) for x in sents[a:b])
        rate = round(units / (speech / 60)) if speech > 0 else 0
        out.append({"n": k + 1, "from": a, "to": b, "start": t0, "end": t1, "rate": rate})
    return out


# ---------------------------------------------------------------- 难点表达（LLM）
def _parse_json_array(raw):
    raw = re.sub(r"```(?:json)?", "", raw)
    i, j = raw.find("["), raw.rfind("]")
    if i < 0 or j <= i:
        raise ValueError("响应里没有 JSON 数组")
    return json.loads(raw[i : j + 1])


def generate_notes(lesson, k, level):
    import translate  # 复用翻译供应商与重试逻辑

    providers = sorted(translate.available_providers(), key=lambda p: 0 if p.get("preferred") else 1)
    sents = lesson["sentences"]
    tgt_name = translate.lang_label(lesson["target_lang"]) or "简体中文（简体）"
    src_name = translate.lang_label(lesson["source_lang"]) or "原文语言"
    chunk = 300
    chunks = [sents[i : i + chunk] for i in range(0, len(sents), chunk)]
    notes = []
    for ci, part in enumerate(chunks):
        want = max(3, math.ceil(k * len(part) / len(sents)))
        listing = "\n".join(f'{s["n"]}: {s["s"]}' for s in part)
        prompt = (
            f"下面是一期{src_name}播客的逐句原文（格式：句号: 原文）。\n"
            f"学习者水平：{level}。\n"
            f"请挑出 {want} 个对这个水平的学习者最值得学、也最容易听不出来的表达："
            "口语习语、短语动词、固定搭配、俚语、文化背景词，或连读弱读明显的片段。"
            "优先选日常会反复用到的，跳过人名、地名和过于简单的词。\n"
            "只输出 JSON 数组，每项为："
            '{"n": 句号, "expr": "表达（必须是该句原文中连续出现的原样文字）", '
            f'"type": "类型（用{tgt_name}写，2-4 个字）", '
            f'"explain": "用{tgt_name}写的解释，说明它在这句里的意思和用法，不超过 60 字"}}\n\n'
            + listing
        )
        msgs = [
            {"role": "system", "content": "你是经验丰富的语言听力老师，只输出合法 JSON。"},
            {"role": "user", "content": prompt},
        ]
        last_err = None
        for p in providers * 2:
            try:
                items = _parse_json_array(translate.chat_completion_retry(p, msgs, max_tokens=6000))
                break
            except (RuntimeError, ValueError, json.JSONDecodeError) as e:
                last_err = e
        else:
            raise RuntimeError(f"难点表达生成失败：{last_err}")
        by_n = {s["n"]: s for s in part}
        for it in items:
            try:
                n = int(it.get("n"))
            except (TypeError, ValueError):
                continue
            expr = str(it.get("expr") or "").strip()
            s = by_n.get(n)
            if not s or not expr or expr.lower() not in s["s"].lower():
                continue  # 丢掉对不上原句的条目，防止模型编造
            notes.append({"n": n, "expr": expr, "type": str(it.get("type") or "").strip(),
                          "explain": str(it.get("explain") or "").strip()})
        print(f"  难点表达：第 {ci + 1}/{len(chunks)} 块，保留 {len(notes)} 条")
    notes.sort(key=lambda x: x["n"])
    return notes


# ---------------------------------------------------------------- 输出
def mmss(t):
    t = max(0, int(t))
    h, m, s = t // 3600, t % 3600 // 60, t % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def write_player(ep, lesson, segs, notes):
    data = {k: v for k, v in lesson.items()}
    data["segments"] = segs
    data["notes"] = notes
    data["rate_unit"] = "cpm" if lesson["source_lang"].startswith(("zh", "ja", "ko")) else "wpm"
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    tpl = (TEMPLATES / "player.html").read_text(encoding="utf-8")
    out = tpl.replace("__TITLE__", html.escape(lesson["title"])).replace("__DATA__", blob)
    (ep / "player.html").write_text(out, encoding="utf-8")


HANDOUT_CSS = """
@page{size:A4;margin:14mm 13mm 16mm}
*{box-sizing:border-box}
body{margin:0;color:#1D1D1F;font:10.5pt/1.5 -apple-system,"SF Pro Text","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;background:#F5F5F7}
.page{max-width:210mm;margin:0 auto;background:#fff;padding:14mm 13mm}
.tool{position:sticky;top:0;background:rgba(29,29,31,.92);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);color:#fff;padding:8px 12px;display:flex;gap:8px;align-items:center;justify-content:center;font-size:14px;z-index:9}
.tool button{font:inherit;padding:6px 14px;border-radius:999px;border:0;background:rgba(255,255,255,.14);color:#fff;cursor:pointer}
.tool button.on{background:#0071E3;border-color:#0071E3}
.tool select{font:inherit;padding:5px 8px;border-radius:8px;background:rgba(255,255,255,.14);color:#fff;border:0}
.tool .sep{width:1px;height:20px;background:#555;margin:0 4px}
.seg.off{display:none}
h1{font-size:17pt;margin:0 0 2mm;line-height:1.25}
.sub{color:#555;margin-bottom:1mm}
.meta{color:#555;font-size:9.5pt;margin:2mm 0 4mm}
.method{background:#F5F5F7;border-radius:3mm;padding:3mm 4mm;margin:0 0 6mm;font-size:9.5pt}
.method b{color:#0071E3}
.method ol{margin:1mm 0 0;padding-left:5mm}
.seg{margin-top:6mm}
.seg h2{font-size:12pt;margin:0 0 2mm;padding-bottom:1mm;border-bottom:1.5pt solid #111;display:flex;justify-content:space-between;align-items:baseline}
.seg h2 span{font-size:9pt;font-weight:400;color:#555}
.row{display:grid;grid-template-columns:8mm 1.15fr 1fr;gap:3mm;padding:1.6mm 0;border-bottom:.4pt solid #ddd;break-inside:avoid}
.no{color:#888;font-size:8.5pt;padding-top:.6mm}
.src{font-size:11pt;font-weight:500}
.tgt{color:#333}
.line{border-bottom:.6pt dotted #aaa;height:6mm}
.src .line{margin-top:.5mm}
.dict-only{display:none}
body.dict .dict-only{display:block}
body.dict .main .src .txt,body.dict .main .tgt{display:none}
body.dict .main .row{grid-template-columns:8mm 1fr}
body.dict .main .src .line{height:7mm}
.answers{break-before:page}
.answers h1{font-size:14pt}
mark{background:rgba(0,113,227,.10);color:inherit;border-radius:1mm;padding:0 .5mm}
table.notes{width:100%;border-collapse:collapse;font-size:9.5pt}
table.notes th,table.notes td{border-bottom:.4pt solid #ddd;padding:1.6mm 1.5mm;text-align:left;vertical-align:top}
table.notes td.e{font-weight:700;white-space:nowrap}
table.notes td.n{color:#888;white-space:nowrap}
.notes-sec{break-before:page}
.foot{margin-top:8mm;color:#999;font-size:8pt;text-align:center}
@media print{body{background:#fff}.tool{display:none}.page{padding:0;max-width:none}}
"""

HANDOUT_TXT = {
    "zh": {
        "print": "打印 / 存为 PDF", "cmp": "对照版", "dict": "听写版",
        "meta": "时长 {dur} · {n} 句 · {segs} 段 · 平均语速 {rate}",
        "use": "配合同一文件夹里的 <b>player.html</b> 使用：在网页里选择对应的段号，句子编号和讲义一致。",
        "steps": ["<b>盲听</b>：不看讲义，把一段完整听一遍，记下听懂了几成。",
                  "<b>精听</b>：逐句听，没听懂就单句循环；听写版在空行里写下听到的内容。",
                  "<b>对照</b>：对照原文和译文订正，划出没听出来的词，留意标色的难点表达。",
                  "<b>再盲听</b>：合上讲义再听一遍，和第一遍比一比。"],
        "range": "打印范围：第", "range2": "段", "seg": "第 {n} 段", "answers": "答案（原文与译文）", "notes": "难点表达",
        "th": ["句", "表达", "类型", "解释"], "wpm": "{r} 词/分", "cpm": "{r} 字/分",
    },
    "en": {
        "print": "Print / Save as PDF", "cmp": "Side by side", "dict": "Dictation",
        "meta": "{dur} · {n} lines · {segs} parts · average {rate}",
        "use": "Use with <b>player.html</b> in the same folder: pick the same part number there; line numbers match.",
        "steps": ["<b>Blind</b>: listen to a whole part without reading and note how much you got.",
                  "<b>Drill</b>: go line by line and loop what you missed. In dictation mode, write what you hear.",
                  "<b>Compare</b>: check against the text and translation; mark what you missed.",
                  "<b>Re-listen</b>: close the handout, listen again and compare."],
        "range": "Parts", "range2": "", "seg": "Part {n}", "answers": "Answer key", "notes": "Key phrases",
        "th": ["Line", "Phrase", "Type", "Meaning"], "wpm": "{r} wpm", "cpm": "{r} chars/min",
    },
}


def _hl(text, items):
    out = html.escape(text)
    for it in items or []:
        e = html.escape(it["expr"])
        i = out.lower().find(e.lower())
        if i >= 0:
            out = out[:i] + "<mark>" + out[i : i + len(e)] + "</mark>" + out[i + len(e):]
    return out


def write_handout(ep, lesson, segs, notes):
    ui = "zh" if lesson["target_lang"].startswith("zh") else "en"
    T = HANDOUT_TXT[ui]
    cjk = lesson["source_lang"].startswith(("zh", "ja", "ko"))
    unit = T["cpm"] if cjk else T["wpm"]
    sents = lesson["sentences"]
    by_n = {}
    for x in notes:
        by_n.setdefault(x["n"], []).append(x)
    speech = sum(s["b"] - s["a"] for s in sents) or 1
    avg = round(sum(count_units(s["s"], cjk) for s in sents) / (speech / 60))
    esc = html.escape

    def rows(seg, mode):
        out = []
        for s in sents[seg["from"]: seg["to"]]:
            src = _hl(s["s"], by_n.get(s["n"]))
            out.append(
                f'<div class="row"><div class="no">{s["n"]}</div>'
                f'<div class="src"><div class="txt">{src}</div>'
                + ('<div class="line"></div>' + ('<div class="line dict-only"></div>' if mode == "main" else "")
                   if mode == "main" else "")
                + "</div>"
                f'<div class="tgt">{esc(s["t"])}</div></div>'
            )
        return "".join(out)

    def seg_blocks(mode):
        return "".join(
            f'<section class="seg" data-n="{g["n"]}"><h2>{T["seg"].format(n=g["n"])}'
            f'<span>{mmss(g["start"])}–{mmss(g["end"])} · {unit.format(r=g["rate"])}</span></h2>'
            f"{rows(g, mode)}</section>"
            for g in segs
        )

    title_t = f'<div class="sub">{esc(lesson["title_target"])}</div>' if lesson["title_target"] else ""
    pod = esc(lesson["podcast"] + (f' · {lesson["podcast_target"]}' if lesson["podcast_target"] else ""))
    notes_html = ""
    if notes:
        trs = "".join(
            f'<tr><td class="n">{x["n"]}</td><td class="e">{esc(x["expr"])}</td>'
            f'<td>{esc(x["type"])}</td><td>{esc(x["explain"])}</td></tr>'
            for x in notes
        )
        th = "".join(f"<th>{h}</th>" for h in T["th"])
        notes_html = f'<section class="notes-sec"><h1>{T["notes"]}</h1><table class="notes"><tr>{th}</tr>{trs}</table></section>'

    doc = f"""<!doctype html><html lang="{ui}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>{esc(lesson["title"])}</title><style>{HANDOUT_CSS}</style></head><body>
<div class="tool"><button id="bc" class="on">{T["cmp"]}</button><button id="bd">{T["dict"]}</button>
<span class="sep"></span>{T["range"]} <select id="r0"></select> – <select id="r1"></select>{T["range2"]}
<span class="sep"></span><button onclick="print()">{T["print"]}</button></div>
<div class="page">
<div class="sub">{pod}</div><h1>{esc(lesson["title"])}</h1>{title_t}
<div class="meta">{T["meta"].format(dur=mmss(lesson["duration"]), n=len(sents), segs=len(segs), rate=unit.format(r=avg))}</div>
<div class="method">{T["use"]}<ol>{"".join(f"<li>{x}</li>" for x in T["steps"])}</ol></div>
<div class="main">{seg_blocks("main")}</div>
<div class="answers dict-only"><h1>{T["answers"]}</h1>{seg_blocks("ans")}</div>
{notes_html}
</div>
<script>
var bc=document.getElementById("bc"),bd=document.getElementById("bd");
function m(d){{document.body.classList.toggle("dict",d);bc.classList.toggle("on",!d);bd.classList.toggle("on",d);}}
bc.onclick=function(){{m(false)}};bd.onclick=function(){{m(true)}};
var N={len(segs)},r0=document.getElementById("r0"),r1=document.getElementById("r1");
for(var i=1;i<=N;i++){{r0.add(new Option(i,i));r1.add(new Option(i,i));}}
r1.value=Math.min(N,2);
function rg(){{var a=+r0.value,b=+r1.value;if(b<a){{r1.value=a;b=a;}}
document.querySelectorAll(".seg").forEach(function(s){{var n=+s.dataset.n;s.classList.toggle("off",n<a||n>b);}});}}
r0.onchange=rg;r1.onchange=rg;rg();
</script></body></html>"""
    (ep / "handout.html").write_text(doc, encoding="utf-8")


def write_notes_md(ep, lesson, notes):
    sents = {s["n"]: s for s in lesson["sentences"]}
    zh = lesson["target_lang"].startswith("zh")
    lines = [f'# {lesson["title"]}' + (f' · {lesson["title_target"]}' if lesson["title_target"] else ""), ""]
    lines.append(f'> {lesson["podcast"]} · ' + ("难点表达" if zh else "Key phrases") + f" {len(notes)} " + ("条" if zh else ""))
    lines.append("")
    for x in notes:
        s = sents[x["n"]]
        lines += [
            f'## {x["expr"]}' + (f'  `{x["type"]}`' if x["type"] else ""),
            "",
            f'- {x["explain"]}',
            f'- #{x["n"]} [{mmss(s["a"])}] {s["s"]}',
        ]
        if s["t"]:
            lines.append(f'- {s["t"]}')
        lines.append("")
    (ep / "notes.md").write_text("\n".join(lines), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("episode_dir")
    ap.add_argument("--seg-seconds", type=float, default=150, help="每段目标时长（秒），默认 150")
    ap.add_argument("--notes", type=int, default=20, help="难点表达条数，默认 20")
    ap.add_argument("--level", default="中级（四六级 / 雅思 6 左右）", help="学习者水平，影响难点挑选")
    ap.add_argument("--no-notes", action="store_true", help="不生成难点表达（不调用 LLM）")
    ap.add_argument("--force-notes", action="store_true", help="忽略 notes.json 缓存重新生成")
    args = ap.parse_args()

    ep = Path(args.episode_dir).resolve()
    if not (ep / "bilingual.json").exists():
        print(f"找不到 {ep / 'bilingual.json'}，请先跑 lesson.py", file=sys.stderr)
        return 2
    lesson = load_episode(ep)
    if not lesson["sentences"]:
        print("bilingual.json 里没有句子", file=sys.stderr)
        return 2
    cjk = lesson["source_lang"].startswith(("zh", "ja", "ko"))
    segs = segment(lesson["sentences"], args.seg_seconds, cjk)

    notes = []
    cache = ep / "notes.json"
    if not args.no_notes:
        if cache.exists() and not args.force_notes:
            notes = json.loads(cache.read_text(encoding="utf-8"))
        else:
            load_env()
            try:
                notes = generate_notes(lesson, args.notes, args.level)
                cache.write_text(json.dumps(notes, ensure_ascii=False, indent=1), encoding="utf-8")
            except (RuntimeError, SystemExit) as e:
                print(f"⚠ 难点表达未生成：{e}（讲义和网页照常输出）", file=sys.stderr)
                notes = []

    write_player(ep, lesson, segs, notes)
    write_handout(ep, lesson, segs, notes)
    if notes:
        write_notes_md(ep, lesson, notes)
    if not (ep / lesson["audio"]).exists():
        print(f"⚠ 没找到音频 {lesson['audio']}，player.html 将无法播放", file=sys.stderr)
    print(f"✅ {lesson['title']}：{len(lesson['sentences'])} 句，{len(segs)} 段，难点 {len(notes)} 条")
    print(f"  精听网页：{ep / 'player.html'}")
    print(f"  打印讲义：{ep / 'handout.html'}")
    if notes:
        print(f"  难点笔记：{ep / 'notes.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

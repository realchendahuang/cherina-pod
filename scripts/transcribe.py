#!/usr/bin/env python3
"""阿里云百炼 Paraformer 录音文件识别（英文，词级时间戳）。

流程：
  1. getPolicy 获取临时上传凭证（model=paraformer-v2）
  2. 本地音频上传到临时 OSS → oss:// URL
  3. 提交转写任务（X-DashScope-Async）→ task_id
  4. 轮询任务状态 → transcription_url
  5. 下载识别结果 → 输出 transcript.json（句级 + 词级时间戳，秒）

用法：
  python3 scripts/transcribe.py <episode_dir>
  # 从 <episode_dir>/meta.json 读 audio_path，输出 <episode_dir>/transcript.json

断点续跑：提交任务后 task_id 落盘到 <episode_dir>/transcribe_task.json，
轮询中断/超时后重跑本脚本只续查结果，不必重新上传音频（最贵的一步）。

环境变量：
  DASHSCOPE_API_KEY  必需。阿里云百炼 API Key。
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://dashscope.aliyuncs.com"
MODEL = "paraformer-v2"

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from common import load_env  # noqa: E402


def api_key() -> str:
    k = os.environ.get("DASHSCOPE_API_KEY")
    if not k:
        print("错误：缺少 DASHSCOPE_API_KEY（请检查 .env）", file=sys.stderr)
        sys.exit(2)
    return k


def http_json(url, data=None, headers=None, method=None, timeout=180):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}：{body[:300]}") from e
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as e:
        raise RuntimeError(f"{e}") from e


def get_policy(key: str) -> dict:
    url = f"{BASE}/api/v1/uploads?action=getPolicy&model={MODEL}"
    return http_json(url, headers={"Authorization": f"Bearer {key}"})


def upload_audio(key: str, policy: dict, audio_path: str) -> str:
    """multipart 上传到临时 OSS，返回 oss:// URL"""
    import uuid

    host = policy["data"]["upload_host"]
    upload_dir = policy["data"]["upload_dir"]
    policy_str = policy["data"]["policy"]
    signature = policy["data"]["signature"]
    access_key = policy["data"]["oss_access_key_id"]
    suffix = Path(audio_path).suffix.lstrip(".") or "mp3"
    filename = f"{uuid.uuid4().hex}.{suffix}"
    content_type = {
        "mp3": "audio/mpeg",
        "mp4": "audio/mp4",
        "m4a": "audio/mp4",
        "aac": "audio/aac",
        "wav": "audio/wav",
    }.get(suffix.lower(), "application/octet-stream")

    boundary = "----WebKitFormBoundary" + uuid.uuid4().hex
    parts = []
    fields = [
        ("OSSAccessKeyId", access_key),
        ("Signature", signature),
        ("policy", policy_str),
        ("x-oss-object-acl", policy["data"].get("x_oss_object_acl", "private")),
        (
            "x-oss-forbid-overwrite",
            policy["data"].get("x_oss_forbid_overwrite", "true"),
        ),
        ("key", f"{upload_dir}/{filename}"),
        ("success_action_status", "200"),
    ]
    for k, v in fields:
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
        )
    with open(audio_path, "rb") as f:
        audio_data = f.read()
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: {content_type}\r\n\r\n'.encode()
    )
    parts.append(audio_data)
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    body = b"".join(parts)

    req = urllib.request.Request(
        host,
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(
            f"上传失败 HTTP {e.code}：{e.read().decode('utf-8', errors='replace')[:300]}"
        ) from e
    except (urllib.error.URLError, OSError) as e:
        raise RuntimeError(f"上传失败：{e}") from e
    return f"oss://{upload_dir}/{filename}"


def submit_task(key: str, oss_url: str) -> str:
    url = f"{BASE}/api/v1/services/audio/asr/transcription"
    body = json.dumps(
        {
            "model": MODEL,
            "input": {"file_urls": [oss_url]},
            # 英文播客：language_hints 只保留 en；若含混合语言可改 ["en", "zh"]
            "parameters": {"language_hints": ["en"]},
        }
    ).encode("utf-8")
    resp = http_json(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
            "X-DashScope-OssResourceResolve": "enable",
        },
    )
    return resp["output"]["task_id"]


def poll_task(key: str, task_id: str, max_wait=600):
    """轮询任务直到 SUCCEEDED，返回响应；FAILED/超时返回 None（由调用方决定是否重提）。

    轮询期间容忍少量瞬时网络错误（429/5xx/断连），连续多次才放弃——
    一次抖动就报废整个任务太浪费（上传是最贵的一步）。
    """
    url = f"{BASE}/api/v1/tasks/{task_id}"
    start = time.time()
    wait = 3  # 初始 3s，指数退避到最大 20s
    transient = 0
    while time.time() - start < max_wait:
        try:
            resp = http_json(url, headers={"Authorization": f"Bearer {key}"})
        except RuntimeError as e:
            transient += 1
            if transient > 5:
                print(f"连续网络错误，放弃轮询：{e}", file=sys.stderr)
                return None
            print(f"  ⚠️ 网络错误（{transient}/5），稍后重试：{e}", file=sys.stderr)
            time.sleep(wait)
            wait = min(wait * 2, 20)
            continue
        transient = 0
        status = (resp.get("output") or {}).get("task_status")
        if status == "SUCCEEDED":
            return resp
        if status == "FAILED":
            print(f"任务失败：{json.dumps(resp, ensure_ascii=False)}", file=sys.stderr)
            return None
        if status is None:
            print(f"  ⚠️ 响应异常，稍后重试：{json.dumps(resp, ensure_ascii=False)[:200]}",
                  file=sys.stderr)
        time.sleep(wait)
        wait = min(wait * 2, 20)
    print("轮询超时", file=sys.stderr)
    return None


def download_result(key: str, task_resp: dict) -> dict:
    for r in task_resp.get("output", {}).get("results", []):
        if r.get("subtask_status") == "SUCCEEDED" and r.get("transcription_url"):
            return http_json(
                r["transcription_url"], headers={"Authorization": f"Bearer {key}"}
            )
    raise RuntimeError("无成功子任务结果")


def to_transcript(result: dict, audio_rel: str) -> dict:
    """把 ASR 原始结果转成 transcript.json（句级 + 词级时间戳，秒）。"""
    sentences, words = [], []
    for tr in result.get("transcripts", []):
        for sent in tr.get("sentences", []):
            sentences.append(
                {
                    "text": sent.get("text", "").strip(),
                    "start": float(sent["begin_time"]) / 1000.0,
                    "end": float(sent["end_time"]) / 1000.0,
                }
            )
            for w in sent.get("words", []):
                words.append(
                    {
                        "word": w.get("text", ""),
                        "start": float(w["begin_time"]) / 1000.0,
                        "end": float(w["end_time"]) / 1000.0,
                    }
                )
    duration = max((w["end"] for w in words), default=0.0)
    return {
        "duration": duration,
        "sentences": sentences,  # 句级时间戳：翻译对齐的基础
        "words": words,  # 词级时间戳：保留不丢
        "audio": audio_rel,
        "provider": "aliyun-dashscope",
        "model": MODEL,
    }


def run_transcription(key: str, ep_dir: Path, meta: dict, audio_path: Path) -> dict:
    """完整流程：上传 → 提交 → 轮询 → 下载，返回 transcript dict。"""
    print("1/5 获取临时上传凭证…")
    policy = get_policy(key)
    print("2/5 上传音频到临时 OSS…")
    oss_url = upload_audio(key, policy, str(audio_path))
    print(f"     oss://{oss_url.split('://')[1]}")
    print("3/5 提交转写任务…")
    task_id = submit_task(key, oss_url)
    print(f"     task_id={task_id}")
    # task_id 落盘：轮询中断/超时后重跑只需续查结果，不必重新上传（最贵的一步）
    (ep_dir / "transcribe_task.json").write_text(
        json.dumps({"task_id": task_id, "oss_url": oss_url}, ensure_ascii=False),
        encoding="utf-8",
    )
    print("4/5 轮询任务结果…")
    task_resp = poll_task(key, task_id)
    if task_resp is None:
        (ep_dir / "transcribe_task.json").unlink(missing_ok=True)
        raise RuntimeError("转写任务失败或轮询超时（重跑本脚本会重新提交任务）")
    print("5/5 下载识别结果…")
    result = download_result(key, task_resp)
    return to_transcript(result, meta["audio_path"])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("episode_dir")
    ap.add_argument("--force", action="store_true", help="忽略已有 transcript.json，强制重新转写")
    args = ap.parse_args()
    load_env()
    ep_dir = Path(args.episode_dir).resolve()
    meta_path = ep_dir / "meta.json"
    if not meta_path.exists():
        print(f"找不到 {meta_path}", file=sys.stderr)
        return 2
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    audio_path = ep_dir / meta["audio_path"]
    if not audio_path.exists():
        print(f"音频不存在：{audio_path}", file=sys.stderr)
        return 2

    # 缓存跳过：句级 + 词级时间戳都在才算有效缓存（避免重复烧钱）。
    # 只查 sentences 会把 words 缺失的坏缓存永久复用，词级时间戳就再也补不回来了。
    out = ep_dir / "transcript.json"
    if out.exists() and not args.force:
        cached = json.loads(out.read_text(encoding="utf-8"))
        if cached.get("sentences") and cached.get("words"):
            print(
                f"⏭️ 已有 transcript.json（{len(cached['sentences'])} 句 / "
                f"{len(cached['words'])} 词），跳过转写"
            )
            print("   如需强制重新转写，加 --force 参数")
            return 0
        print("⚠️ 已有 transcript.json 缺少词级时间戳，重新转写补全", file=sys.stderr)

    key = api_key()
    task_path = ep_dir / "transcribe_task.json"
    try:
        task_resp = None
        # 断点续查：上次提交过任务但没等到结果，直接续查 task_id
        if not args.force and task_path.exists():
            try:
                task_id = json.loads(task_path.read_text(encoding="utf-8")).get("task_id")
            except json.JSONDecodeError:
                task_id = None
            if task_id:
                print(f"发现未完成的转写任务 task_id={task_id}，续查结果…")
                task_resp = poll_task(key, task_id, max_wait=300)
                if task_resp is None:
                    print("  ⚠️ 该任务已失败/超时，重新上传提交", file=sys.stderr)
        if task_resp is not None:
            print("5/5 下载识别结果…")
            transcript = to_transcript(
                download_result(key, task_resp), meta["audio_path"]
            )
        else:
            transcript = run_transcription(key, ep_dir, meta, audio_path)

        out.write_text(
            json.dumps(transcript, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        task_path.unlink(missing_ok=True)
        print(f"✅ transcript.json 已生成：{out}")
        print(
            f"   共 {len(transcript['sentences'])} 句，{len(transcript['words'])} 词，"
            f"时长 {transcript['duration']:.1f}s"
        )
        return 0
    except RuntimeError as e:
        print(f"错误：{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

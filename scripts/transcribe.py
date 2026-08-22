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

环境变量：
  DASHSCOPE_API_KEY  必需。阿里云百炼 API Key。
"""

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
        print(f"HTTP {e.code}：{body}", file=sys.stderr)
        sys.exit(1)


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
        print(
            f"上传失败 HTTP {e.code}：{e.read().decode('utf-8', errors='replace')}",
            file=sys.stderr,
        )
        sys.exit(1)
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


def poll_task(key: str, task_id: str, max_wait=600) -> dict:
    url = f"{BASE}/api/v1/tasks/{task_id}"
    start = time.time()
    wait = 3  # 初始 3s，指数退避到最大 20s
    while time.time() - start < max_wait:
        resp = http_json(url, headers={"Authorization": f"Bearer {key}"})
        status = resp["output"]["task_status"]
        if status == "SUCCEEDED":
            return resp
        if status == "FAILED":
            print(f"任务失败：{json.dumps(resp, ensure_ascii=False)}", file=sys.stderr)
            sys.exit(1)
        time.sleep(wait)
        wait = min(wait * 2, 20)
    print("轮询超时", file=sys.stderr)
    sys.exit(1)


def download_result(key: str, task_resp: dict) -> dict:
    for r in task_resp["output"]["results"]:
        if r.get("subtask_status") == "SUCCEEDED" and r.get("transcription_url"):
            return http_json(
                r["transcription_url"], headers={"Authorization": f"Bearer {key}"}
            )
    print("无成功子任务结果", file=sys.stderr)
    sys.exit(1)


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


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    force = "--force" in sys.argv
    load_env()
    ep_dir = Path(sys.argv[1]).resolve()
    meta_path = ep_dir / "meta.json"
    if not meta_path.exists():
        print(f"找不到 {meta_path}", file=sys.stderr)
        return 2
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    audio_path = ep_dir / meta["audio_path"]
    if not audio_path.exists():
        print(f"音频不存在：{audio_path}", file=sys.stderr)
        return 2

    # 缓存跳过：已有 transcript.json 且未强制，直接复用（避免重复烧钱）
    out = ep_dir / "transcript.json"
    if out.exists() and not force:
        cached = json.loads(out.read_text(encoding="utf-8"))
        if cached.get("sentences"):
            print(f"⏭️ 已有 transcript.json（{len(cached['sentences'])} 句），跳过转写")
            print(f"   如需强制重新转写，加 --force 参数")
            return 0

    key = api_key()
    print("1/5 获取临时上传凭证…")
    policy = get_policy(key)
    print("2/5 上传音频到临时 OSS…")
    oss_url = upload_audio(key, policy, str(audio_path))
    print(f"     oss://{oss_url.split('://')[1]}")
    print("3/5 提交转写任务…")
    task_id = submit_task(key, oss_url)
    print(f"     task_id={task_id}")
    print("4/5 轮询任务结果…")
    task_resp = poll_task(key, task_id)
    print("5/5 下载识别结果…")
    result = download_result(key, task_resp)
    transcript = to_transcript(result, meta["audio_path"])
    out.write_text(
        json.dumps(transcript, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"✅ transcript.json 已生成：{out}")
    print(
        f"   共 {len(transcript['sentences'])} 句，{len(transcript['words'])} 词，时长 {transcript['duration']:.1f}s"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

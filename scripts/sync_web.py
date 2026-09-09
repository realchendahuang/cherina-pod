#!/usr/bin/env python3
"""压缩音频 → 自建 RustFS（线上播放音源）。

节目数据（发现页/详情页/搜索）已全部走 D1，不再同步到 web/public。
本地 episodes/<id>/bilingual.json 只作为 migrate_to_d1.py 的灌库原料。

- episodes/<id>/audio/episode.mp4 → S3 PUT 到 RustFS bucket（幂等，已存在跳过）

音频不走 Cloudflare 静态资产（25MiB 上限），走自建源 pod-audio.cherina.app，
方案见 docs/音频存储方案.md。为保持流水线零第三方依赖，S3 PUT 用 stdlib 实现 SigV4。

用法：
  python3 scripts/sync_web.py

环境变量（.env）：
  RUSTFS_ENDPOINT    如 http://<TAILNET_IP>:9100（tailnet 内网地址）
  RUSTFS_ACCESS_KEY / RUSTFS_SECRET_KEY
  RUSTFS_BUCKET      如 cherina-pod-audio
"""

import hashlib
import hmac
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
EPISODES = ROOT / "episodes"

sys.path.insert(0, str(HERE))
from common import UA, load_env  # noqa: E402


# ---------- 极简 S3 客户端（SigV4，仅 HEAD/PUT，够上传用） ----------

# 走公网（CF 边缘）时必须带浏览器 UA：urllib 默认 Python-urllib/x.y 会被
# Cloudflare Bot Fight Mode 直接拦（HTTP 403 error code 1010）
class S3Client:
    def __init__(self, endpoint, access_key, secret_key, bucket, region="us-east-1", fallbacks=()):
        self.endpoints = [endpoint.rstrip("/")] + [e.rstrip("/") for e in fallbacks if e]
        self.ak = access_key
        self.sk = secret_key
        self.bucket = bucket
        self.region = region
        self._dead = set()  # 已失败的端点（连接失败/网关 5xx），下次请求跳过

    def _mark_dead(self, ep):
        self._dead.add(ep)

    def _sign(self, method, path, payload_hash, headers, now):
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")
        headers = dict(headers)
        headers["x-amz-date"] = amz_date
        headers["x-amz-content-sha256"] = payload_hash
        signed_names = sorted(headers)
        canonical_headers = "".join(f"{k}:{headers[k].strip()}\n" for k in signed_names)
        signed_headers = ";".join(signed_names)
        canonical_request = (
            f"{method}\n{urllib.parse.quote(path, safe='/~')}\n\n"
            f"{canonical_headers}\n{signed_headers}\n{payload_hash}"
        )
        scope = f"{date_stamp}/{self.region}/s3/aws4_request"
        string_to_sign = (
            f"AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n"
            f"{hashlib.sha256(canonical_request.encode()).hexdigest()}"
        )

        def hm(key, msg):
            return hmac.new(key, msg.encode(), hashlib.sha256).digest()

        k_date = hm(f"AWS4{self.sk}".encode(), date_stamp)
        k_region = hm(k_date, self.region)
        k_service = hm(k_region, "s3")
        k_signing = hm(k_service, "aws4_request")
        signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()
        headers["Authorization"] = (
            f"AWS4-HMAC-SHA256 Credential={self.ak}/{scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        )
        return headers

    def _request(self, method, key, body=b"", extra_headers=None):
        # 端点可能：公网 https://pod-audio.cherina.app/s3（主）或 tailnet 内网（兜底）
        path = f"/{self.bucket}/{key}"
        payload_hash = hashlib.sha256(body).hexdigest()
        # 只签 host + x-amz-* 三个头（与 mc 行为一致；RustFS beta 对签入业务头的请求校验有问题）
        for ep in list(self.endpoints):
            if ep in self._dead:
                continue  # 该端点已失败，直接跳过
            parsed = urllib.parse.urlparse(ep)
            headers = self._sign(method, path, payload_hash, {"host": parsed.netloc}, datetime.now(timezone.utc))
            headers["User-Agent"] = UA
            if extra_headers:
                headers.update(extra_headers)
            req = urllib.request.Request(
                f"{ep}{path}", data=(body if method == "PUT" else None),
                headers=headers, method=method,
            )
            # 禁用系统代理（macOS 上 urllib 会自动读系统代理）：
            # tailnet 内网地址必须直连；公网端点走 CF 边缘也不该经本地代理
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            try:
                with opener.open(req, timeout=600) as resp:
                    return resp.status
            except urllib.error.HTTPError as e:
                if e.code in (502, 503, 504, 521, 522, 523, 524):
                    self._mark_dead(ep)  # 源站/网关不可用，换下一个端点
                    continue
                return e.code
            except Exception:
                self._mark_dead(ep)  # 连接失败（如 tailnet 未开），换下一个端点
                continue
        return 599  # 所有端点都不可用

    def exists(self, key):
        return self._request("HEAD", key) == 200

    def put(self, key, file_path, content_type):
        body = Path(file_path).read_bytes()
        status = self._request(
            "PUT", key, body,
            {"Content-Type": content_type, "Cache-Control": "public, max-age=31536000, immutable"},
        )
        return status in (200, 201)


def s3_client_from_env():
    # 主端点走公网（不依赖本机 Tailscale），兜底走 tailnet 内网
    endpoints = [
        os.environ.get("RUSTFS_ENDPOINT", ""),
        os.environ.get("RUSTFS_ENDPOINT_FALLBACK", ""),
    ]
    endpoints = [e for e in endpoints if e]
    ak = os.environ.get("RUSTFS_ACCESS_KEY", "")
    sk = os.environ.get("RUSTFS_SECRET_KEY", "")
    bucket = os.environ.get("RUSTFS_BUCKET", "cherina-pod-audio")
    if not (endpoints and ak and sk):
        print("⚠️ .env 缺 RUSTFS_ENDPOINT/RUSTFS_ACCESS_KEY/RUSTFS_SECRET_KEY，跳过音频上传", file=sys.stderr)
        return None
    return S3Client(endpoints[0], ak, sk, bucket, fallbacks=endpoints[1:])


def upload_all(s3):
    """并发上传所有未同步的压缩音频。返回 (成功数, 跳过数, 失败列表)。"""
    from concurrent.futures import ThreadPoolExecutor

    jobs = []
    for ep_dir in sorted(EPISODES.iterdir()):
        if not ep_dir.is_dir():
            continue
        src = ep_dir / "audio" / "episode.mp4"
        if src.exists():
            jobs.append((f"{ep_dir.name}.mp4", src))
    if not jobs:
        print("✅ 没有需要上传的音频")
        return 0, 0, []

    def work(job):
        key, src = job
        if s3.exists(key):
            return "skip", key
        print(f"  上传 {key}（{src.stat().st_size / 1e6:.1f} MB）…")
        return ("ok" if s3.put(key, src, "audio/mp4") else "fail"), key

    up, skip, failed = 0, 0, []
    with ThreadPoolExecutor(max_workers=4) as ex:
        for status, key in ex.map(work, jobs):
            if status == "ok":
                up += 1
            elif status == "skip":
                skip += 1
            else:
                failed.append(key)
                print(f"  ❌ 上传失败：{key}", file=sys.stderr)
    print(f"✅ 音频上传完成：新传 {up} 个，已存在跳过 {skip} 个，失败 {len(failed)} 个")
    return up, skip, failed


def main():
    load_env()

    # 节目数据不再同步到 web/public：发现页/详情页/搜索全部走 D1 API，
    # 本地 bilingual.json 只作为 migrate_to_d1.py 的灌库原料（见 docs/数据架构演进.md）。

    # 压缩音频（audio/episode.mp4，AAC 64k mono）→ RustFS，对象键 <episode_id>.mp4
    s3 = s3_client_from_env()
    if s3:
        _, _, failed = upload_all(s3)
        if failed:
            # 上传失败必须让部署感知：deploy_web.sh 有 set -e，静默返回 0 会把
            # 缺音频的版本直接发布上线
            print(
                f"错误：{len(failed)} 个音频上传失败（{', '.join(failed)}），中止部署。"
                f"重跑本脚本可续传",
                file=sys.stderr,
            )
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

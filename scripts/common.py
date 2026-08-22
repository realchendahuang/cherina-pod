#!/usr/bin/env python3
"""流水线共享工具：.env 读取、浏览器 UA、HTTP、HTML 清洗、文本归一化。

各脚本 `from common import ...` 复用，避免同一段逻辑在多处漂移。
"""

import html
import json
import os
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 浏览器 UA：Cloudflare 会拦默认 urllib UA（HTTP 403 error 1010），需伪装成浏览器
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 cherina-pod"
)


def load_env():
    """读取 .env 到环境变量（不覆盖已有值）。"""
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())


def http_get(url, timeout=60):
    """GET 一个 URL，返回 bytes。"""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def http_json(url, timeout=60):
    """GET 一个 JSON 端点，返回解析后的对象。"""
    return json.loads(http_get(url, timeout=timeout).decode("utf-8"))


def strip_html(s):
    """去 HTML 标签 + 反转义所有实体，压缩空白，返回纯文本。"""
    if not s:
        return ""
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def norm_text(s):
    """去掉全部空白，用于文本匹配（ASR 偶发缺空格，如 "hegrown up"）。"""
    return re.sub(r"\s+", "", s or "")

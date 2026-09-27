#!/usr/bin/env python3
"""生成本地数据 → Cloudflare D1 的分片迁移 SQL。

以 episodes/<id>/bilingual.json 为唯一数据源（完整字段），
category/level 从 podcast_meta.json 按播客名补齐。

- 0001_init.sql：建表 + FTS5 全文索引（幂等：DROP 后重建）
- 0002_episodes.sql：元数据 INSERT
- 0003_pairs_*.sql：逐句分片 INSERT（100 句/批，规避 D1 单语句 SQLITE_TOOBIG 限制）

用法：
  python3 scripts/migrate_to_d1.py

说明：线上只保留 D1 这一份节目数据源；本地 bilingual.json 是流水线产物/灌库原料，
单向流动（bilingual.json → D1），不构成线上平行数据源。
"""

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
EPISODES = ROOT / "episodes"
MIGRATIONS = ROOT / "web" / "migrations"

BATCH = 100  # 每批句子数：D1 单语句限制远小于标准 SQLite 1MB，100 句/批约 32KB 安全


def esc(s: str) -> str:
    """SQL 字符串字面量转义（单引号翻倍）。"""
    return (s or "").replace("'", "''")


def build_schema_sql() -> str:
    return """\
-- cherina-pod D1 迁移：建表 + 全文索引（幂等，DROP 后重建）
DROP TABLE IF EXISTS pairs_fts;
DROP TABLE IF EXISTS pairs;
DROP TABLE IF EXISTS episodes;

CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  podcast TEXT,
  podcast_title_target TEXT,
  author TEXT,
  category TEXT,
  level TEXT,
  episode_title TEXT,
  episode_title_target TEXT,
  description TEXT,
  image TEXT,
  podcast_image TEXT,
  pub_date TEXT,
  duration TEXT,
  pairs_count INTEGER,
  audio_url TEXT,
  source_lang TEXT,
  target_lang TEXT
);

CREATE TABLE pairs (
  episode_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  start REAL,
  end REAL,
  source TEXT,
  target TEXT,
  PRIMARY KEY (episode_id, idx)
);

-- source 走 unicode61 分词（有空格的语言：英语、西语、日语…）；
-- target 对中文这类无空格语言分词无效，Worker 层用 LIKE 兜底
-- （2 万句级毫秒，规模大了再升级 trigram）。
-- content='pairs' 外部内容表：正文只存 pairs 一份，FTS 只存倒排索引。
-- 必须配触发器同步，否则直接 INSERT INTO pairs 不会填充 FTS 索引。
CREATE VIRTUAL TABLE pairs_fts USING fts5(
  source, target,
  content='pairs', content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER pairs_ai AFTER INSERT ON pairs BEGIN
  INSERT INTO pairs_fts(rowid, source, target) VALUES (new.rowid, new.source, new.target);
END;
CREATE TRIGGER pairs_ad AFTER DELETE ON pairs BEGIN
  INSERT INTO pairs_fts(pairs_fts, rowid, source, target) VALUES ('delete', old.rowid, old.source, old.target);
END;
CREATE TRIGGER pairs_au AFTER UPDATE ON pairs BEGIN
  INSERT INTO pairs_fts(pairs_fts, rowid, source, target) VALUES ('delete', old.rowid, old.source, old.target);
  INSERT INTO pairs_fts(rowid, source, target) VALUES (new.rowid, new.source, new.target);
END;
"""


def main() -> int:
    # category/level 元数据（按播客英文名）
    pm_path = HERE / "podcast_meta.json"
    podcast_meta = json.loads(pm_path.read_text(encoding="utf-8")) if pm_path.exists() else {}
    podcast_meta.pop("_comment", None)

    MIGRATIONS.mkdir(parents=True, exist_ok=True)
    # 先清掉上次生成的迁移文件：分片数随数据量变化，残留旧分片会在部署时与新数据
    # 重复插入，触发 (episode_id, idx) 主键冲突，wrangler 中途报错后 D1 停在半灌状态。
    for old in MIGRATIONS.glob("*.sql"):
        old.unlink()

    (MIGRATIONS / "0001_init.sql").write_text(build_schema_sql(), encoding="utf-8")
    print("✅ 0001_init.sql（建表 + FTS5）")

    ep_rows = []
    ep_ids = []
    n_pairs = 0
    part = 1
    pairs_batch = []
    pairs_out = MIGRATIONS / f"0003_pairs_part{part:03d}.sql"
    pairs_header = "INSERT INTO pairs (episode_id, idx, start, end, source, target) VALUES\n"

    def flush_pairs():
        nonlocal pairs_batch, part, pairs_out
        if not pairs_batch:
            return
        pairs_out.write_text(pairs_header + ",\n".join(pairs_batch) + ";", encoding="utf-8")
        part += 1
        pairs_batch = []
        pairs_out = MIGRATIONS / f"0003_pairs_part{part:03d}.sql"

    for ep_dir in sorted(EPISODES.iterdir()):
        bj = ep_dir / "bilingual.json"
        if not bj.exists():
            continue
        data = json.loads(bj.read_text(encoding="utf-8"))
        ep_id = data.get("id", ep_dir.name)
        ep_ids.append(ep_id)
        pc = data.get("podcast", {})
        ep = data.get("episode", {})
        pairs = data.get("pairs", [])

        podcast_name = pc.get("title", "")
        pm = podcast_meta.get(podcast_name, {})
        category = pm.get("category", "其他")
        level = pm.get("level", "intermediate")

        image = ep.get("image") or pc.get("image", "")
        # 旧 bilingual.json 用 title_zh / en / zh，这里都兼容读
        pc_title_t = pc.get("title_target", pc.get("title_zh", ""))
        ep_title_t = ep.get("title_target", ep.get("title_zh", ""))
        # 语言对：旧文件没有这两个字段，按历史默认（英→中）补
        src_lang = data.get("source_lang") or "auto"
        tgt_lang = data.get("target_lang") or "zh"
        ep_rows.append(
            "("
            + ", ".join(
                f"'{esc(v)}'"
                for v in (
                    ep_id,
                    podcast_name,
                    pc_title_t,
                    pc.get("author", ""),
                    category,
                    level,
                    ep.get("title", ""),
                    ep_title_t,
                    ep.get("description", ""),
                    image,
                    pc.get("image", ""),
                    ep.get("pub_date", ""),
                    ep.get("duration", ""),
                )
            )
            + f", {len(pairs)}, '{esc(ep.get('audio_url', ''))}'"
            + f", '{esc(src_lang)}', '{esc(tgt_lang)}'"
            + ")"
        )

        for i, p in enumerate(pairs):
            pairs_batch.append(
                f"('{esc(ep_id)}', {i}, {float(p.get('start', 0))!r}, "
                f"{float(p.get('end', 0))!r}, "
                f"'{esc(p.get('source', p.get('en', '')))}', "
                f"'{esc(p.get('target', p.get('zh', '')))}')"
            )
            n_pairs += 1
            if len(pairs_batch) >= BATCH:
                flush_pairs()
    flush_pairs()

    if ep_rows:
        episodes_sql = (
            "INSERT INTO episodes ("
            "id, podcast, podcast_title_target, author, category, level, "
            "episode_title, episode_title_target, description, image, podcast_image, pub_date, "
            "duration, pairs_count, audio_url, source_lang, target_lang"
            ") VALUES\n" + ",\n".join(ep_rows) + ";"
        )
    else:
        episodes_sql = "-- episodes 为空：占位注释，避免生成非法的空 INSERT"
    (MIGRATIONS / "0002_episodes.sql").write_text(episodes_sql, encoding="utf-8")
    print(f"✅ 0002_episodes.sql（{len(ep_rows)} 期元数据，完整字段）")
    print(f"✅ pairs 分片：{part - 1} 个文件，共 {n_pairs} 句")

    # sitemap.xml：首页 + 每期（?id= 查询串形态，route() 兼容，可被爬虫索引）
    # 站点地址可用环境变量 SITE_URL 覆盖（与 web/build.mjs 同一套配置，fork 后填自己的）
    site = os.environ.get("SITE_URL") or "https://pod.cherina.app"
    urls = ['  <url><loc>' + site + '/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>']
    for eid in sorted(ep_ids):
        urls.append(
            f'  <url><loc>{site}/?id={eid}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>'
        )
    smap = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls) + "\n</urlset>\n"
    )
    smap_path = ROOT / "web" / "public" / "sitemap.xml"
    smap_path.write_text(smap, encoding="utf-8")
    print(f"✅ sitemap.xml 已生成：{smap_path}（{len(urls)} 条 URL）")

    print("\n下一步（远程执行）：")
    print("  cd web && for f in migrations/*.sql; do wrangler d1 execute cherina-pod-db --remote --file=$f; done")
    return 0


if __name__ == "__main__":
    sys.exit(main())

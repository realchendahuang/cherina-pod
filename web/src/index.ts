// cherina-pod：D1 数据 API + 静态资产透传。
// - 节目数据（发现页 /api/episodes、详情页 /api/episodes/:id、搜索 /api/search）全部走 D1
// - 静态资产：index.html / 字体 / 图片 / sitemap.xml 由 ASSETS 分发
// - 音频走 RustFS（前端拼 https://pod-audio.cherina.app/<id>.mp4，不在本 Worker 范围）
import type { D1Database, Fetcher } from '@cloudflare/workers-types';

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // API 响应显式 no-store：防代理/浏览器启发式缓存住旧数据（搜索、节目列表都要即时）
      'Cache-Control': 'no-store',
      ...CORS,
    },
  });
}

// FTS5 只对"有空格分词"的语言有效（英语、西语、日语…）；中文这类无空格语言走 LIKE 兜底。
// 判断依据是查询串本身而不是站点语言：ASCII + 含空格 → 试 FTS，否则 LIKE。
function isSpatiallyTokenized(q: string): boolean {
  return /^[\x20-\x7E]+$/i.test(q) && /\s/.test(q.trim());
}

interface SearchRow {
  episode_id: string;
  idx: number;
  start: number;
  end: number;
  source: string;
  target: string;
  episode_title: string;
  episode_title_target: string;
  podcast: string;
  image: string;
}

async function handleSearch(env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return json({ count: 0, items: [], query: '' });
  if (q.length > 200) return json({ error: '查询过长' }, 400);

  if (!isSpatiallyTokenized(q)) return fallbackLike(env, q);

  try {
    const { results } = await env.DB.prepare(`
      SELECT p.episode_id, p.idx, p.start, p.end, p.source, p.target,
             e.episode_title, e.episode_title_target, e.podcast, e.image
      FROM pairs_fts
      JOIN pairs p ON p.rowid = pairs_fts.rowid
      JOIN episodes e ON e.id = p.episode_id
      WHERE pairs_fts MATCH ?
      ORDER BY rank
      LIMIT 50
    `).bind(q).all<SearchRow>();
    return json({ count: results.length, items: results, query: q });
  } catch {
    // FTS5 语法错误（撇号、非法操作符等）降级为 LIKE
    return fallbackLike(env, q);
  }
}

async function fallbackLike(env: Env, q: string): Promise<Response> {
  const like = `%${q}%`;
  const { results } = await env.DB.prepare(`
    SELECT p.episode_id, p.idx, p.start, p.end, p.source, p.target,
           e.episode_title, e.episode_title_target, e.podcast, e.image
    FROM pairs p
    JOIN episodes e ON e.id = p.episode_id
    WHERE p.target LIKE ?1 OR p.source LIKE ?1
    LIMIT 50
  `).bind(like).all<SearchRow>();
  return json({ count: results.length, items: results, query: q });
}

interface EpisodeRow {
  id: string;
  podcast: string;
  podcast_title_target: string;
  author: string;
  category: string;
  level: string;
  episode_title: string;
  episode_title_target: string;
  description: string;
  image: string;
  pub_date: string;
  duration: string;
  pairs_count: number;
}

// 发现页 / 频道页：返回 index.json 兼容结构
async function handleEpisodes(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(`
    SELECT id, podcast, podcast_title_target, author, category, level,
           episode_title, episode_title_target, description, image,
           pub_date, duration, pairs_count
    FROM episodes ORDER BY pub_date DESC
  `).all<EpisodeRow>();
  const items = results.map(r => ({
    id: r.id,
    podcast_title: r.podcast,
    podcast_title_target: r.podcast_title_target,
    podcast_author: r.author,
    category: r.category,
    level: r.level,
    episode_title: r.episode_title,
    episode_title_target: r.episode_title_target,
    description: r.description,
    image: r.image,
    pub_date: r.pub_date,
    duration: r.duration,
    pairs_count: r.pairs_count,
  }));
  return json({ count: items.length, items });
}

interface EpisodeDetailRow {
  id: string;
  podcast: string;
  author: string;
  image: string;
  podcast_title_target: string;
  podcast_image: string;
  episode_title: string;
  episode_title_target: string;
  description: string;
  pub_date: string;
  duration: string;
  audio_url: string;
  source_lang: string;
  target_lang: string;
}

interface PairRow {
  start: number;
  end: number;
  source: string;
  target: string;
}

// 详情页：返回 bilingual.json 结构（source / target）
async function handleEpisodeDetail(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT * FROM episodes WHERE id = ?').bind(id).first<EpisodeDetailRow>();
  if (!row) return json({ error: 'not found' }, 404);

  const { results: pairs } = await env.DB.prepare(
    'SELECT start, end, source, target FROM pairs WHERE episode_id = ? ORDER BY idx'
  ).bind(id).all<PairRow>();

  const duration = pairs.length ? Math.max(...pairs.map(p => p.end)) : 0;

  return json({
    id: row.id,
    source_lang: row.source_lang || 'auto',
    target_lang: row.target_lang || 'zh',
    podcast: {
      title: row.podcast,
      author: row.author,
      image: row.podcast_image,
      title_target: row.podcast_title_target,
    },
    episode: {
      title: row.episode_title,
      title_target: row.episode_title_target,
      description: row.description,
      pub_date: row.pub_date,
      duration: row.duration,
      image: row.image,
      audio_url: row.audio_url,
    },
    duration,
    pairs: pairs.map(p => ({ source: p.source, target: p.target, start: p.start, end: p.end })),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (url.pathname === '/api/search') return handleSearch(env, url);
      if (url.pathname === '/api/episodes') return handleEpisodes(env);
      const m = url.pathname.match(/^\/api\/episodes\/(.+)$/);
      if (m) return handleEpisodeDetail(env, decodeURIComponent(m[1]));
      return json({ error: 'not found' }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};

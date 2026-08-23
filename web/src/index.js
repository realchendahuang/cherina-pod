// cherina-pod：D1 数据 API + 静态资产透传。
// - 节目数据（发现页 /api/episodes、详情页 /api/episodes/:id、搜索 /api/search）全部走 D1
// - 静态资产：index.html / 字体 / 图片 / charts.json / sitemap.xml 由 ASSETS 分发
// - 音频走 RustFS（前端拼 https://pod-audio.cherina.app/<id>.mp4，不在本 Worker 范围）

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

function isEnglishLike(q) {
  return /^[\x20-\x7E]+$/.test(q) && /\s/.test(q.trim());
}

async function handleSearch(env, url) {
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return json({ count: 0, items: [], query: '' });
  if (q.length > 200) return json({ error: '查询过长' }, 400);

  if (!isEnglishLike(q)) return fallbackLike(env, q);

  try {
    const { results } = await env.DB.prepare(`
      SELECT p.episode_id, p.idx, p.start, p.end, p.en, p.zh,
             e.episode_title, e.episode_title_zh, e.podcast, e.image
      FROM pairs_fts
      JOIN pairs p ON p.rowid = pairs_fts.rowid
      JOIN episodes e ON e.id = p.episode_id
      WHERE pairs_fts MATCH ?
      ORDER BY rank
      LIMIT 50
    `).bind(q).all();
    return json({ count: results.length, items: results, query: q });
  } catch (e) {
    // FTS5 语法错误（撇号、非法操作符等）降级为 LIKE
    return fallbackLike(env, q);
  }
}

async function fallbackLike(env, q) {
  const like = `%${q}%`;
  const { results } = await env.DB.prepare(`
    SELECT p.episode_id, p.idx, p.start, p.end, p.en, p.zh,
           e.episode_title, e.episode_title_zh, e.podcast, e.image
    FROM pairs p
    JOIN episodes e ON e.id = p.episode_id
    WHERE p.zh LIKE ?1 OR p.en LIKE ?1
    LIMIT 50
  `).bind(like).all();
  return json({ count: results.length, items: results, query: q });
}

// 发现页 / 频道页：返回 index.json 兼容结构
async function handleEpisodes(env) {
  const { results } = await env.DB.prepare(`
    SELECT id, podcast, podcast_title_zh, author, category, level,
           episode_title, episode_title_zh, description, image,
           pub_date, duration, pairs_count
    FROM episodes ORDER BY pub_date DESC
  `).all();
  const items = results.map(r => ({
    id: r.id,
    podcast_title: r.podcast,
    podcast_title_zh: r.podcast_title_zh,
    podcast_author: r.author,
    category: r.category,
    level: r.level,
    episode_title: r.episode_title,
    episode_title_zh: r.episode_title_zh,
    description: r.description,
    image: r.image,
    pub_date: r.pub_date,
    duration: r.duration,
    pairs_count: r.pairs_count,
  }));
  return json({ count: items.length, items });
}

// 详情页：返回 bilingual.json 兼容结构
async function handleEpisodeDetail(env, id) {
  const row = await env.DB.prepare('SELECT * FROM episodes WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'not found' }, 404);

  const { results: pairs } = await env.DB.prepare(
    'SELECT start, end, en, zh FROM pairs WHERE episode_id = ? ORDER BY idx'
  ).bind(id).all();

  const duration = pairs.length ? Math.max(...pairs.map(p => p.end)) : 0;

  return json({
    id: row.id,
    podcast: {
      title: row.podcast,
      author: row.author,
      image: row.podcast_image,
      title_zh: row.podcast_title_zh,
    },
    episode: {
      title: row.episode_title,
      title_zh: row.episode_title_zh,
      description: row.description,
      pub_date: row.pub_date,
      duration: row.duration,
      image: row.image,
      audio_url: row.audio_url,
    },
    duration,
    pairs: pairs.map(p => ({ en: p.en, zh: p.zh, start: p.start, end: p.end })),
  });
}

export default {
  async fetch(request, env, ctx) {
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

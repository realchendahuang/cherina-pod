// Cherina Pod 前端逻辑（原 index.html 内联脚本，TS 化后由 esbuild 打包为 public/app.js）。
// 数据接口与 D1 API 返回结构对应（见 src/index.ts）。

/* beforeinstallprompt 事件类型（TS 标准库未收录，Chrome/Edge 私有） */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/* ================= 数据接口 ================= */
interface EpisodeItem {
  id: string;
  podcast_title?: string;
  podcast_title_target?: string;
  podcast_author?: string;
  category?: string;
  level?: string;
  episode_title?: string;
  episode_title_target?: string;
  description?: string;
  image?: string;
  pub_date?: string;
  duration?: string;
  pairs_count?: number;
  generated_at?: string;
}

interface Channel {
  key: string;
  name: string;
  tgtAlt: string;
  author: string;
  image: string;
  episodes: EpisodeItem[];
  pairs: number;
}

interface Pair {
  start: number;
  end?: number;
  source: string;
  target: string;
}

interface EpisodeDetail {
  id: string;
  podcast: { title?: string; author?: string; image?: string; title_target?: string };
  episode: {
    title?: string;
    title_target?: string;
    description?: string;
    pub_date?: string;
    duration?: string;
    image?: string;
    audio_url?: string;
  };
  duration: number;
  pairs: Pair[];
}

interface SearchResult {
  episode_id: string;
  start: number;
  source: string;
  target: string;
  podcast?: string;
  episode_title?: string;
  episode_title_target?: string;
}

interface EpPrefs {
  t: number;
  rate: number;
  mode: string;
  font: number;
  follow: boolean;
  ts: number;
}

/* ================= 工具 ================= */
const $ = (sel: string, root?: ParentNode): HTMLElement | null =>
  (root || document).querySelector(sel);

// 静态 DOM 元素（index.html 中必然存在）：找不到即抛错，避免静默 ! 断言掩盖 HTML 结构变更。
function mustGet(sel: string): HTMLElement {
  const el = $(sel);
  if (!el) throw new Error('缺少必需元素：' + sel);
  return el;
}

const app = mustGet('#app');
const container = mustGet('#container');
const toastEl = mustGet('#toast');
const MASCOT = './brand/cherina-mascot-companion.png';

function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtTime(s: number): string {
  s = Math.max(0, s || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ss = String(sec).padStart(2, '0');
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + ss;
  return m + ':' + ss;
}

/* "32:02" / "1:02:33" → 秒 */
function parseDuration(s: string | number | null | undefined): number {
  if (!s) return 0;
  const parts = String(s).split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + p;
  return sec;
}

/* RSS 原始时长统一格式化：纯数字秒 → "6:39"；"m:ss"/"h:mm:ss" → 规范化去前导零；其它原样 */
function fmtDuration(d: string | number | null | undefined): string {
  if (d == null || d === '') return '';
  const s = String(d).trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return fmtTime(Number(s));
  if (/^\d+:\d{1,2}(:\d{1,2})?$/.test(s)) return fmtTime(parseDuration(s));
  return s;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  if (toastTimer != null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1400);
}

function copyText(t: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(t).catch(() => fallbackCopy(t));
  }
  return Promise.resolve(fallbackCopy(t));
}
function fallbackCopy(t: string): void {
  const ta = document.createElement('textarea');
  ta.value = t;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch { /* 忽略 */ }
  ta.remove();
}

const CHEV_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
const BACK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
const LOOP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/></svg>';

/* 精细指针（鼠标/触控板）才展示键盘快捷键相关入口 */
const FINE_POINTER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/* ================= 主题（默认亮色，localStorage 记忆） ================= */
const THEME_KEY = 'cherina:theme';
const VOLUME_KEY = 'cherina:volume'; // 全局音量（跨集记忆，不进单集 prefs）
function applyTheme(t: string): void {
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = t === 'dark' ? '#141211' : '#f7f6f3'; // 与 --app-page-bg 同步
}
function initTheme(): void {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === 'dark' ? 'dark' : 'light'); // 纸白是标志性风格，默认亮
}
mustGet('#themeBtn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
});
initTheme();

/* ================= SEO：路由级 title / meta / OG / JSON-LD ================= */
/* 站点配置由构建时注入（见 build.mjs）：fork 自己的实例时用环境变量覆盖
   SITE_URL / SITE_NAME / SITE_DESC / AUDIO_CDN，无需改本文件 */
declare const __SITE_URL__: string;
declare const __SITE_NAME__: string;
declare const __SITE_DESC__: string;
declare const __AUDIO_CDN__: string;

const SITE_URL = __SITE_URL__;
const SITE_NAME = __SITE_NAME__;
const SITE_DESC = __SITE_DESC__;

function setMeta(attr: string, key: string, content: string): void {
  let el = document.head.querySelector('meta[' + attr + '="' + key + '"]');
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setLdJson(obj: unknown): void {
  let el = document.getElementById('ldJson') as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = 'ldJson';
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(obj);
}

/* 统一更新 title / description / OG / Twitter / canonical */
function seoBase(title: string, desc: string, url: string, image?: string): void {
  document.title = title;
  setMeta('name', 'description', desc);
  setMeta('property', 'og:title', title);
  setMeta('property', 'og:description', desc);
  setMeta('property', 'og:url', url);
  if (image) setMeta('property', 'og:image', image);
  setMeta('name', 'twitter:title', title);
  setMeta('name', 'twitter:description', desc);
  if (image) setMeta('name', 'twitter:image', image);
  const canon = document.querySelector('link[rel="canonical"]');
  if (canon) canon.setAttribute('href', url);
}

function isoDuration(d: string | number | null | undefined): string {
  const sec = parseDuration(d);
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return 'PT' + (h ? h + 'H' : '') + (m ? m + 'M' : '') + s + 'S';
}

/* ================= 数据加载 ================= */
let indexCache: { count: number; items: EpisodeItem[] } | null = null;

async function loadIndex(): Promise<{ count: number; items: EpisodeItem[] }> {
  if (indexCache) return indexCache;
  const resp = await fetch('/api/episodes', { cache: 'no-store' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const data: { count: number; items: EpisodeItem[] } = await resp.json();
  indexCache = data;
  return data;
}

/* 播客分组（以原名做稳定 key；播客名全站只展示原名，title_target 仅留作搜索兜底） */
function groupChannels(items: EpisodeItem[]): Channel[] {
  const map = new Map<string, Channel>();
  for (const it of items) {
    const key = it.podcast_title || it.podcast_title_target || '未命名播客';
    if (!map.has(key)) {
      map.set(key, {
        key,
        name: it.podcast_title || it.podcast_title_target || '未命名播客',
        tgtAlt: it.podcast_title_target || '',
        author: it.podcast_author || '',
        image: it.image || '',
        episodes: [],
        pairs: 0,
      });
    }
    const g = map.get(key);
    if (!g) continue;
    g.episodes.push(it);
    g.pairs += it.pairs_count || 0;
    if (!g.image && it.image) g.image = it.image;
  }
  return Array.from(map.values());
}

/* ================= 路由（hash + ?id= 兼容） ================= */
// currentView: { name: 'discover' | 'podcast' | 'episode', param }
const currentView: { name: 'discover' | 'podcast' | 'episode'; param: string | null } = { name: 'discover', param: null };

// 渲染代数：快速连续切换页面时，旧 render 里 await 返回后据此识别自己已过期，
// 不再覆盖新页面 DOM（也不会再创建播放器/定时器——那是 saveTimer 泄漏的根源）
let renderSeq = 0;

// 应用内导航栈：记录用户实际进入上一页的 hash，返回按钮据此"回到来源页"
// 而非硬编码的逻辑父级。仅在站内点击跳转时压栈；深链直达时不压栈。
const navStack: string[] = [];

// 返回目标解析：优先回到来源页，栈空（深链直达）才退回逻辑父级。
function backTarget(): string {
  const prev = navStack.pop();
  if (prev) return prev;
  if (currentView.name === 'episode') {
    const pc = (ep.data && ep.data.podcast) || {};
    const key = pc.title || pc.title_target || '';
    return key ? '#/podcast/' + encodeURIComponent(key) : '#/';
  }
  return '#/'; // podcast / discover
}

function route(): void {
  // 兼容旧的 ?id=xxx / ?podcast=xxx 形式（也是 sitemap 收录的 URL 形态）
  const q = new URLSearchParams(location.search);
  const qid = q.get('id');
  if (qid) {
    history.replaceState({}, '', location.pathname + '#/ep/' + encodeURIComponent(qid));
  } else {
    const qp = q.get('podcast');
    if (qp) {
      history.replaceState({}, '', location.pathname + '#/podcast/' + encodeURIComponent(qp));
    }
  }
  const h = location.hash || '#/';
  let m;
  if ((m = h.match(/^#\/ep\/(.+)$/))) {
    renderEpisode(decodeURIComponent(m[1]));
  } else if ((m = h.match(/^#\/podcast\/(.+)$/))) {
    renderPodcast(decodeURIComponent(m[1]));
  } else {
    renderDiscover();
  }
}
// 只监听 hashchange：Chrome 对 location.hash 赋值会同时触发 popstate + hashchange，
// 双监听会让 route() 每次跳转跑两遍（双 fetch、双渲染，还会冲掉句子定位高亮）；
// hash 路由下前进/后退同样会触发 hashchange，popstate 监听是多余的。
window.addEventListener('hashchange', route);

/* 通用可点元素绑定：data-go="ep:<encId>" | "podcast:<encKey>" | "ext:<url>"
   ep 目标可带 data-seek="<秒>"（句子搜索命中）：记录跳转后定位目标句 */
function bindNav(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-go]').forEach(el => {
    const open = () => {
      const v = el.dataset.go;
      if (!v) return;
      const i = v.indexOf(':');
      const type = v.slice(0, i);
      const payload = v.slice(i + 1);
      if (type === 'ext') {
        window.open(payload, '_blank', 'noopener');
        return;
      }
      const seek = el.dataset.seek;
      if (type === 'ep' && seek != null) {
        pendingSeek = { id: decodeURIComponent(payload), t: +seek };
      }
      // 去重 + 上限：重复导航同一目标时不去重会让返回链堆积冗余项
      const cur = location.hash || '#/';
      if (navStack[navStack.length - 1] !== cur) navStack.push(cur);
      while (navStack.length > 32) navStack.shift();
      location.hash = '#/' + type + '/' + payload;
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });
}

/* 封面图（onerror 隐藏，露出墨色首字兜底；no-referrer 绕过源站防盗链） */
function coverHtml(url: string | undefined, cls: string, phText: string | undefined): string {
  const ph = '<span class="cover-ph">' + escapeHtml((phText || '·').trim().charAt(0) || '·') + '</span>';
  const img = url
    ? '<img class="' + cls + '" src="' + escapeHtml(url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">'
    : '';
  return ph + img;
}

/* ================= 状态模板（加载中 / 加载失败 / 找不到，全站统一） ================= */
const LOADING_HTML = '<div class="empty">加载中…</div>';

function mascotHtml(): string {
  return '<img class="mascot" src="' + MASCOT + '" alt="">';
}

function loadFailHtml(e: unknown): string {
  return (
    '<div class="empty">' + mascotHtml() +
      '节目库加载失败，请稍后重试' +
      '<span class="empty-detail">' + escapeHtml((e as Error).message) + '</span>' +
    '</div>'
  );
}

function notFoundHtml(msg: string, detail?: string): string {
  return (
    '<div class="empty">' + mascotHtml() + escapeHtml(msg) +
      (detail ? '<span class="empty-detail">' + escapeHtml(detail) + '</span>' : '') +
      '<br><br><a class="tool-btn" href="#/">返回发现首页</a>' +
    '</div>'
  );
}

/* 路由渲染后把焦点移到页首标题：innerHTML 全量替换会让键盘用户焦点掉回 body，每次导航都得从头 Tab */
function focusHeading(): void {
  const h = app.querySelector<HTMLElement>('h1');
  if (!h) return;
  h.setAttribute('tabindex', '-1');
  h.style.outline = 'none';
  h.focus({ preventScroll: true });
}

/* ================= 页面 1：发现首页 ================= */
async function renderDiscover(): Promise<void> {
  cleanupEpisode();
  currentView.name = 'discover';
  currentView.param = null;
  const mySeq = ++renderSeq;
  seoBase('Cherina Pod · 双语播客精听', SITE_DESC, SITE_URL + '/', SITE_URL + '/brand/web-logo-small.svg');
  container.className = 'container';
  app.className = '';
  app.innerHTML = LOADING_HTML;

  let data;
  try {
    data = await loadIndex();
  } catch (e) {
    if (mySeq !== renderSeq) return;
    app.innerHTML = loadFailHtml(e);
    return;
  }
  if (mySeq !== renderSeq) return; // await 期间用户已切到别的页面
  const items = data.items || [];
  if (!items.length) {
    app.innerHTML =
      '<div class="empty">' + mascotHtml() +
        '还没有节目，稍后再来看看' +
      '</div>';
    return;
  }

  const channels = groupChannels(items);

  // SEO：最新单集 ItemList 结构化数据
  setLdJson({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Cherina Pod 最新单集',
    itemListElement: items.slice(0, 20).map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: SITE_URL + '/?id=' + encodeURIComponent(it.id),
      name: it.episode_title_target || it.episode_title || '',
    })),
  });

  // 内容型首页组织：继续听 → 内容主题 → 最新 → 全部频道
  const catBuckets: Record<string, EpisodeItem[]> = {};
  for (const it of items) {
    const cat = it.category || '其他';
    (catBuckets[cat] || (catBuckets[cat] = [])).push(it);
  }

  // 内容主题（兴趣导向），固定顺序只渲染非空桶；区块标题只出中文，不中英并排
  const CAT_ORDER = ['英语学习', '商业财经', '科技认知', '新闻纪实'];

  const ts = (s: string | undefined): number => { const n = Date.parse(s || ''); return isNaN(n) ? 0 : n; };
  const latest = items.slice().sort((a, b) => {
    return ts(b.generated_at || b.pub_date) - ts(a.generated_at || a.pub_date);
  }).slice(0, 14);

  function railSection(title: string, sub: string, list: EpisodeItem[]): string {
    if (!list || !list.length) return '';
    return (
      '<section class="section">' +
        '<div class="section-head"><h2>' + escapeHtml(title) + '</h2>' +
          (sub ? '<span class="sub">' + escapeHtml(sub) + '</span>' : '') + '</div>' +
        '<div class="rail-scroll">' + list.map(miniCardHtml).join('') + '</div>' +
      '</section>'
    );
  }

  let catHtml = '';
  for (const cat of CAT_ORDER) {
    if (catBuckets[cat] && catBuckets[cat].length) {
      catHtml += railSection(cat, '', catBuckets[cat]);
    }
  }

  // 继续听：读 localStorage 里各期收听进度，按最近收听排序，取前 4
  const continuing = items
    .map(it => ({ it, prefs: loadEpPrefsCached(it.id) }))
    .filter((x): x is { it: EpisodeItem; prefs: EpPrefs } =>
      x.prefs != null && typeof x.prefs.t === 'number' && x.prefs.t > 0)
    .sort((a, b) => (b.prefs.ts || 0) - (a.prefs.ts || 0))
    .slice(0, 4);
  let continueHtml = '';
  if (continuing.length) {
    continueHtml =
      '<section class="section">' +
        '<div class="section-head"><h2>继续听</h2><span class="sub">上次听到这</span></div>' +
        '<div class="rail-scroll">' + continuing.map(x => continueCardHtml(x.it, x.prefs)).join('') + '</div>' +
      '</section>';
  }

  app.innerHTML =
    '<div class="search-wrap">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input class="search-input" id="searchInput" type="search" placeholder="搜索节目、播客或句子…" autocomplete="off">' +
    '</div>' +

    '<div id="discoverMain">' +
      continueHtml +
      catHtml +

      '<section class="section">' +
        '<div class="section-head"><h2>最新更新</h2></div>' +
        '<div class="rail-scroll">' + latest.map(miniCardHtml).join('') + '</div>' +
      '</section>' +

      '<section class="section">' +
        '<div class="section-head"><h2>全部频道</h2></div>' +
        '<div class="chan-grid">' + channels.map(chanCardHtml).join('') + '</div>' +
      '</section>' +
    '</div>' +

    '<div id="searchResults" hidden></div>';

  bindNav(app);
  // 标题搜索防抖：每个键击都对全量 items 过滤 + 重建 innerHTML 太浪费
  let discoverSearchTimer: ReturnType<typeof setTimeout> | null = null;
  mustGet('#searchInput').addEventListener('input', e => {
    const raw = (e.target as HTMLInputElement).value.trim();
    if (discoverSearchTimer != null) clearTimeout(discoverSearchTimer);
    discoverSearchTimer = setTimeout(() => drawDiscoverSearch(raw.toLowerCase(), channels, items), 120);
    scheduleSentenceSearch(raw);
  });
}

/* 频道卡片 */
function chanCardHtml(g: Channel): string {
  return (
    '<div class="chan-card" data-go="podcast:' + encodeURIComponent(g.key) + '" tabindex="0" role="link">' +
      '<div class="cover-wrap">' +
        coverHtml(g.image, 'cover', g.name) +
      '</div>' +
      '<div class="body">' +
        '<div class="name-zh" title="' + escapeHtml(g.name) + '">' + escapeHtml(g.name) + '</div>' +
      '</div>' +
    '</div>'
  );
}

/* 发现页 rail 单集小卡 */
function miniCardHtml(it: EpisodeItem): string {
  // 标题只出一种语言：优先译文，缺译文回退原文，不并排混排
  const main = it.episode_title_target || it.episode_title || '';
  const levelLabel = { beginner: '入门', intermediate: '进阶', advanced: '高级' }[it.level || ''] || '';
  // 一句话简介：用 D1 已存的完整 description，去 HTML 后截断
  const desc = (it.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const metaParts = [it.podcast_title || it.podcast_title_target || ''];
  if (it.duration) metaParts.push(fmtDuration(it.duration));
  if (levelLabel) metaParts.push(levelLabel);
  return (
    '<div class="mini-card" data-go="ep:' + encodeURIComponent(it.id) + '" tabindex="0" role="link">' +
      '<div class="cover-wrap">' + coverHtml(it.image, 'cover', it.podcast_title) + '</div>' +
      '<div class="body">' +
        '<div class="t-tgt" title="' + escapeHtml(main) + '">' + escapeHtml(main) + '</div>' +
        '<div class="meta">' + metaParts.map(escapeHtml).join(' · ') + '</div>' +
        (desc ? '<div class="desc">' + escapeHtml(desc) + '</div>' : '') +
      '</div>' +
    '</div>'
  );
}

/* 继续听卡片：带进度条 + 上次听到时间 */
function continueCardHtml(it: EpisodeItem, prefs: EpPrefs): string {
  const total = parseDuration(it.duration);
  const pct = total > 0 ? Math.min(100, Math.round((prefs.t / total) * 100)) : 0;
  return (
    '<div class="mini-card cont-card" data-go="ep:' + encodeURIComponent(it.id) + '" tabindex="0" role="link">' +
      '<div class="cover-wrap">' + coverHtml(it.image, 'cover', it.podcast_title) +
        (pct > 0 ? '<div class="cont-badge">' + pct + '%</div>' : '') +
      '</div>' +
      '<div class="body">' +
        '<div class="t-tgt">' + escapeHtml(it.episode_title_target || it.episode_title || '') + '</div>' +
        '<div class="meta">' + escapeHtml(it.podcast_title || it.podcast_title_target || '') + '</div>' +
        '<div class="cont-bar"><div class="cont-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="cont-note">听到 ' + escapeHtml(fmtTime(prefs.t)) + ' · 继续</div>' +
      '</div>' +
    '</div>'
  );
}

/* 句子搜索结果行 */
function sentenceRowHtml(r: SearchResult): string {
  const main = r.episode_title_target || r.episode_title || '';
  return (
    '<div class="ep-row" data-go="ep:' + encodeURIComponent(r.episode_id) + '" data-seek="' + (r.start || 0) + '" tabindex="0" role="link">' +
      '<span class="num">' + escapeHtml(fmtTime(r.start)) + '</span>' +
      '<div class="info">' +
        '<div class="t-tgt">' + escapeHtml(r.target || '') + '</div>' +
        '<div class="t-src">' + escapeHtml(r.source || '') + '</div>' +
        '<div class="meta">' + escapeHtml(r.podcast || '') + (main ? ' · ' + escapeHtml(main) : '') + '</div>' +
      '</div>' +
      '<span class="chev">' + CHEV_SVG + '</span>' +
    '</div>'
  );
}

/* 句子命中区块：追加进搜索结果 */
let sentenceQuery = '';
function renderSentenceHits(query: string, rows: SearchResult[] | null | undefined): void {
  sentenceQuery = query;
  const results = $('#searchResults');
  if (!results) return;
  const prev = results.querySelector('.sent-hits');
  if (prev) prev.remove();
  // 标题无命中时的「正在检索」占位：句子结果回来后清掉
  const empty = results.querySelector('.empty');
  if (!rows || !rows.length) {
    if (empty && !results.querySelector('.section')) {
      empty.innerHTML = mascotHtml() + '没有匹配「' + escapeHtml(query) + '」的内容';
    }
    return;
  }
  if (empty) empty.remove();
  const sec = document.createElement('section');
  sec.className = 'section sent-hits';
  sec.innerHTML =
    '<div class="section-head"><h2>句子命中</h2><span class="count">' + rows.length + '</span></div>' +
    '<div class="ep-rows">' + rows.map(sentenceRowHtml).join('') + '</div>';
  results.prepend(sec);
  bindNav(sec); // data-seek 由 bindNav 统一处理
}

/* 句子搜索：有空格分词的语言走 FTS5，无空格语言走 LIKE，D1 不可用时静默降级 */
let sentenceSearchTimer: ReturnType<typeof setTimeout> | null = null;
let sentenceSearchSeq = 0;
function scheduleSentenceSearch(raw: string): void {
  if (sentenceSearchTimer != null) clearTimeout(sentenceSearchTimer);
  if (!raw) { renderSentenceHits('', []); return; }
  if (raw.length < 2) { renderSentenceHits('', []); return; }
  sentenceSearchTimer = setTimeout(() => runSentenceSearch(raw), 250);
}
async function runSentenceSearch(raw: string): Promise<void> {
  const mySeq = ++sentenceSearchSeq;
  try {
    const resp = await fetch('/api/search?q=' + encodeURIComponent(raw));
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (mySeq !== sentenceSearchSeq) return; // 过期响应丢弃
    if (currentView.name !== 'discover') return;
    renderSentenceHits(raw, data.items || []);
  } catch {
    // D1 未就绪/网络失败：别让「正在检索双语逐句…」占位永远挂着，就地改成明确提示
    if (mySeq !== sentenceSearchSeq || currentView.name !== 'discover') return;
    const detail = $('#searchResults .empty .empty-detail');
    if (detail) detail.textContent = '句子检索暂不可用，已退回仅标题搜索';
  }
}

/* 发现页搜索：频道 / 单集 两组 */
function drawDiscoverSearch(query: string, channels: Channel[], items: EpisodeItem[]): void {
  const main = $('#discoverMain');
  const results = $('#searchResults');
  if (!main || !results) return;
  if (!query) {
    main.hidden = false;
    results.hidden = true;
    results.innerHTML = '';
    return;
  }
  main.hidden = true;
  results.hidden = false;

  const chanHits = channels.filter(g =>
    g.name.toLowerCase().includes(query) ||
    g.tgtAlt.toLowerCase().includes(query) ||
    (g.author || '').toLowerCase().includes(query));
  const epHits = items.filter(it =>
    (it.episode_title || '').toLowerCase().includes(query) ||
    (it.episode_title_target || '').toLowerCase().includes(query) ||
    (it.podcast_title || '').toLowerCase().includes(query) ||
    (it.podcast_title_target || '').toLowerCase().includes(query) ||
    (it.podcast_author || '').toLowerCase().includes(query));

  if (!chanHits.length && !epHits.length) {
    results.innerHTML =
      '<div class="empty">' + mascotHtml() +
        '标题没有匹配「' + escapeHtml(query) + '」' +
        '<span class="empty-detail">正在检索双语逐句…</span>' +
      '</div>';
    return;
  }

  let html = '';
  if (chanHits.length) {
    html +=
      '<section class="section">' +
        '<div class="section-head"><h2>频道</h2><span class="count">' + chanHits.length + '</span></div>' +
        '<div class="chan-grid">' + chanHits.map(chanCardHtml).join('') + '</div>' +
      '</section>';
  }
  if (epHits.length) {
    html +=
      '<section class="section">' +
        '<div class="section-head"><h2>单集</h2><span class="count">' + epHits.length + '</span></div>' +
        '<div class="ep-rows">' + epHits.map((it, i) => epRowHtml(it, i + 1, true)).join('') + '</div>' +
      '</section>';
  }
  results.innerHTML = html;
  bindNav(results);
}

/* ================= 页面 2：频道页 ================= */
async function renderPodcast(key: string): Promise<void> {
  cleanupEpisode();
  currentView.name = 'podcast';
  currentView.param = key;
  const mySeq = ++renderSeq;
  document.title = key + ' · Cherina Pod';
  container.className = 'container';
  app.className = '';
  app.innerHTML = LOADING_HTML;

  let data;
  try {
    data = await loadIndex();
  } catch (e) {
    if (mySeq !== renderSeq) return;
    app.innerHTML = loadFailHtml(e);
    return;
  }
  if (mySeq !== renderSeq) return; // await 期间用户已切到别的页面
  const eps = (data.items || [])
    .filter(it => (it.podcast_title || it.podcast_title_target || '未命名播客') === key)
    .sort((a, b) => String(b.pub_date || '').localeCompare(String(a.pub_date || '')));

  if (!eps.length) {
    app.innerHTML =
      '<a class="back-link" href="#/" title="返回发现" aria-label="返回发现">' + BACK_SVG + '</a>' +
      notFoundHtml('没有找到这个频道');
    return;
  }

  const g = groupChannels(eps)[0];
  // SEO：频道级描述 + PodcastSeries 结构化数据
  const chanDesc = g.name + ' 双语播客精听：共 ' + eps.length + ' 集，中英对照逐句学习。';
  seoBase(
    g.name + ' · Cherina Pod',
    chanDesc,
    SITE_URL + '/?podcast=' + encodeURIComponent(key),
    g.image || SITE_URL + '/brand/web-logo-small.svg'
  );
  setLdJson({
    '@context': 'https://schema.org',
    '@type': 'PodcastSeries',
    name: g.name,
    url: SITE_URL + '/?podcast=' + encodeURIComponent(key),
    description: chanDesc,
    ...(g.image ? { image: g.image } : {}),
  });

  app.innerHTML =
    '<a class="back-link" href="#/" title="返回发现" aria-label="返回发现">' + BACK_SVG + '</a>' +

    '<div class="pod-hero">' +
      '<div class="pod-cover-wrap">' + coverHtml(g.image, '', g.name) + '</div>' +
      '<div class="pod-info">' +
        '<h1>' + escapeHtml(g.name) + '</h1>' +
        (g.author && g.author !== g.name && g.author !== g.tgtAlt ? '<div class="author">' + escapeHtml(g.author) + '</div>' : '') +
        '<div class="pod-stats">' + eps.length + ' 集 · ' + g.pairs + ' 句</div>' +
      '</div>' +
    '</div>' +

    '<div class="ep-rows">' +
      eps.map((it, i) => epRowHtml(it, i + 1, false)).join('') +
    '</div>';

  bindNav(app);
  focusHeading();
}

/* 单集行（频道页 / 搜索结果共用） */
function epRowHtml(it: EpisodeItem, num: number, showPodcast: boolean): string {
  // 标题只出一种语言（与发现页卡片一致）
  const main = it.episode_title_target || it.episode_title || '';
  const metaParts: string[] = [];
  if (showPodcast) metaParts.push(it.podcast_title || it.podcast_title_target || '');
  if (it.pub_date) metaParts.push(it.pub_date);
  if (it.duration) metaParts.push(fmtDuration(it.duration)); // RSS 原始时长格式不一（秒 / 00:mm:ss），统一格式化
  if (it.pairs_count) metaParts.push(it.pairs_count + ' 句');

  // 收听进度（localStorage 记忆）
  let heardHtml = '';
  const prefs = loadEpPrefsCached(it.id);
  if (prefs && typeof prefs.t === 'number' && prefs.t >= 5) {
    const total = parseDuration(it.duration);
    const pct = total > 0 ? Math.min(100, Math.round((prefs.t / total) * 100)) : 0;
    heardHtml =
      '<div class="heard">' +
        (pct > 0 ? '<span class="mini-progress"><span style="width:' + pct + '%"></span></span>' : '') +
        '<span class="heard-text">已听至 ' + fmtTime(prefs.t) + '</span>' +
      '</div>';
  }

  return (
    '<div class="ep-row" data-go="ep:' + encodeURIComponent(it.id) + '" tabindex="0" role="link">' +
      '<span class="num">' + num + '</span>' +
      '<div class="thumb-wrap">' + coverHtml(it.image, 'thumb', main) + '</div>' +
      '<div class="info">' +
        '<div class="t-tgt">' + escapeHtml(main) + '</div>' +
        '<div class="meta">' + metaParts.map(escapeHtml).join(' · ') + '</div>' +
        heardHtml +
      '</div>' +
      '<span class="chev">' + CHEV_SVG + '</span>' +
    '</div>'
  );
}

/* ================= 页面 3：详情页（精听学习） ================= */
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const MODE_ORDER = ['both', 'src', 'tgt'];

/* 字幕分段控件按钮（初始 on 态按恢复的偏好渲染） */
function segBtnHtml(m: string, label: string): string {
  const on = ep.mode === m;
  return '<button class="seg-btn' + (on ? ' on' : '') + '" data-mode="' + m + '" aria-pressed="' + on + '">' + label + '</button>';
}

// 当前单期会话状态（离开页面即弃）。
// 播放器/工具条在 setupPlayer / setupToolbar 中回填这些回调；初始为 no-op，
// 保证键盘快捷键等路径无需判空即可安全调用。
interface EpisodeSession {
  id: string | null;
  data: EpisodeDetail | null;
  pairs: Pair[];
  audio: HTMLAudioElement | null;
  activeIdx: number;
  follow: boolean;
  loop: boolean;
  mode: string;      // both | en | zh
  fontScale: number;
  rate: number;
  seeking: boolean;
  saveTimer: ReturnType<typeof setInterval> | null;
  pairEls: HTMLElement[];
  rafId: number;
  togglePlay: () => void;
  setVolume: (v: number) => void;
  setLoop: (on: boolean) => void;
  gotoSentence: (i: number, autoplay: boolean) => void;
  closeSettings: () => void;
  closeSpeed: () => void;
}

const ep: EpisodeSession = {
  id: null,
  data: null,
  pairs: [],
  audio: null,
  activeIdx: -1,
  follow: true,
  loop: false,
  mode: 'both',
  fontScale: 1,
  rate: 1,
  seeking: false,
  saveTimer: null,
  pairEls: [],
  rafId: 0,
  togglePlay: () => {},
  setVolume: () => {},
  setLoop: () => {},
  gotoSentence: () => {},
  closeSettings: () => {},
  closeSpeed: () => {},
};

// 跨期句子搜索命中后跳详情页自动定位到该句（id + 起始秒）
let pendingSeek: { id: string; t: number } | null = null;

function epStoreKey(id: string): string { return 'cherina:ep:' + id; }

function loadEpPrefs(id: string): EpPrefs | null {
  try {
    const raw = localStorage.getItem(epStoreKey(id));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

/* 带内存缓存的读取：列表渲染逐行 loadEpPrefs 的同步 IO（getItem + JSON.parse）收敛为首次一次 */
const epPrefsCache = new Map<string, EpPrefs | null>();
function loadEpPrefsCached(id: string): EpPrefs | null {
  if (epPrefsCache.has(id)) return epPrefsCache.get(id) || null;
  const v = loadEpPrefs(id);
  epPrefsCache.set(id, v);
  return v;
}

function saveEpPrefs(): void {
  if (!ep.id || !ep.audio) return;
  const prefs: EpPrefs = {
    t: Math.floor(ep.audio.currentTime || 0),
    rate: ep.rate,
    mode: ep.mode,
    font: ep.fontScale,
    follow: ep.follow,
    ts: Date.now(),
  };
  try {
    localStorage.setItem(epStoreKey(ep.id), JSON.stringify(prefs));
    epPrefsCache.set(ep.id, prefs); // 同步内存缓存
  } catch { /* 忽略 */ }
}

function cleanupEpisode(): void {
  if (ep.saveTimer) { clearInterval(ep.saveTimer); ep.saveTimer = null; }
  if (ep.audio) {
    saveEpPrefs();
    ep.audio.pause();
    ep.audio.src = '';
  }
  if (ep.rafId) cancelAnimationFrame(ep.rafId);
  ep.id = null;
  ep.data = null;
  ep.pairs = [];
  ep.audio = null;
  ep.activeIdx = -1;
  ep.loop = false;
  ep.closeSettings = () => {};
  ep.closeSpeed = () => {};
  ep.pairEls = [];
}

async function renderEpisode(id: string): Promise<void> {
  cleanupEpisode();
  currentView.name = 'episode';
  currentView.param = id;
  const mySeq = ++renderSeq;
  document.title = '加载中… · Cherina Pod';
  container.className = 'container has-playbar';
  app.className = '';
  app.innerHTML = LOADING_HTML;
  let data: EpisodeDetail;
  try {
    const resp = await fetch('/api/episodes/' + encodeURIComponent(id), { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    data = await resp.json();
  } catch (e) {
    if (mySeq !== renderSeq) return;
    app.innerHTML = notFoundHtml('找不到这期节目', (e as Error).message);
    return;
  }
  if (mySeq !== renderSeq) return; // await 期间用户已切到别的页面

  const info = data.episode || {};
  const pc = data.podcast || {};
  // 标题只出一种语言（与列表卡片一致）
  const mainTitle = info.title_target || info.title || '单期';
  // SEO：单集页描述 + 结构化数据（音频 URL 在下方 cdnSrc 定义后补全）
  seoBase(
    mainTitle + ' · Cherina Pod',
    ((info.description || '').slice(0, 150)) + ' — 中英对照逐句精听。',
    SITE_URL + '/?id=' + encodeURIComponent(id),
    info.image || pc.image || SITE_URL + '/brand/web-logo-small.svg'
  );

  ep.id = id;
  ep.data = data;
  ep.pairs = (data.pairs || []).filter(p => p && typeof p.start === 'number');
  ep.activeIdx = -1;
  ep.loop = false;

  // 恢复偏好
  const prefs: Partial<EpPrefs> = loadEpPrefsCached(id) || {};
  const rate = prefs.rate;
  ep.rate = typeof rate === 'number' && SPEEDS.includes(rate) ? rate : 1;
  const mode = prefs.mode;
  ep.mode = typeof mode === 'string' && MODE_ORDER.includes(mode) ? mode : 'both';
  ep.fontScale = (typeof prefs.font === 'number' && prefs.font >= 0.8 && prefs.font <= 1.35) ? prefs.font : 1;
  ep.follow = prefs.follow !== false;

  // 音频：自建源（与转写同一份文件，音文对齐的保证）优先，报错回退 RSS 外链（仅一次）
  // 注意：RSS 外链可能被托管商动态插广告（DAI），只作兜底；http:// 外链在 https 页必被拦，直接不用
  // AAC-LC 64k mono / MP4 容器 / .mp4；前缀由构建时注入（AUDIO_CDN），未配置时留空 → 直接走 RSS 外链
  const cdnSrc = __AUDIO_CDN__ ? __AUDIO_CDN__ + encodeURIComponent(id) + '.mp4' : '';
  // SEO：PodcastEpisode 结构化数据（含音频直链，供 Google 播客富结果）
  setLdJson({
    '@context': 'https://schema.org',
    '@type': 'PodcastEpisode',
    name: mainTitle,
    url: SITE_URL + '/?id=' + encodeURIComponent(id),
    description: (info.description || '').slice(0, 300),
    datePublished: info.pub_date || '',
    ...(info.duration ? { duration: isoDuration(info.duration) } : {}),
    ...(info.image || pc.image ? { image: info.image || pc.image } : {}),
    ...(pc.title ? { partOfSeries: { '@type': 'PodcastSeries', name: pc.title } } : {}),
    ...(pc.title ? { podcastSeries: { '@type': 'PodcastSeries', name: pc.title } } : {}),
    ...(pc.author ? { author: { '@type': 'Organization', name: pc.author } } : {}),
    ...(cdnSrc ? { audio: { '@type': 'AudioObject', contentUrl: cdnSrc, encodingFormat: 'audio/mp4' } } : {}),
  });
  const remoteSrc = info.audio_url || '';
  const remoteUsable = /^https:\/\//i.test(remoteSrc) || location.protocol !== 'https:';
  // 有自建源就优先它（与转写同一份文件，音文对齐的保证），报错回退 RSS 外链（仅一次）；
  // 未配置自建源时（AUDIO_CDN 为空）直接用 RSS 外链
  const audioSrc = cdnSrc || (remoteUsable ? remoteSrc : '');
  const audioFallback = remoteUsable && remoteSrc ? remoteSrc : '';
  // 播客名全站只展示原名（无原名才退回译文）
  const pcName = pc.title || pc.title_target || '';
  const backHash = '#/podcast/' + encodeURIComponent(pcName);

  const descText = (info.description || '').trim();

  app.innerHTML =
    '<div class="ep-layout">' +
      '<div class="ep-main">' +
        /* Hero：封面 + 播客名 + 单语主标题 + 元信息（与双语列表同列，宽度对齐） */
        '<div class="ep-hero">' +
          '<div class="ep-hero-cover">' + coverHtml(info.image || pc.image, 'cover', pcName) + '</div>' +
          '<div class="ep-head">' +
            '<div class="pc-name">' + escapeHtml(pcName) + '</div>' +
            '<h1>' + escapeHtml(mainTitle) + '</h1>' +
            '<div class="meta">' +
              [info.pub_date, fmtDuration(info.duration)].filter(Boolean).map(escapeHtml).join(' · ') +
            '</div>' +
          '</div>' +
        '</div>' +
        /* 单集简介：主列头部，meta 之下、工具条之上，默认 2 行折叠 */
        (descText
          ? '<div class="ep-desc-wrap">' +
              '<div class="ep-desc clamped">' + escapeHtml(descText) + '</div>' +
              '<button class="desc-toggle">展开</button>' +
            '</div>'
          : '') +
        '<div class="toolbar">' +
          '<a class="back-link" href="' + backHash + '" title="返回" aria-label="返回" id="epBackLink">' +
            BACK_SVG +
          '</a>' +
          /* 字幕分段控件：当前模式直接可见，一键直达（替代原三态循环盲开关） */
          '<div class="seg" role="group" aria-label="字幕显示">' +
            segBtnHtml('both', '双语') +
            segBtnHtml('src', '原文') +
            segBtnHtml('tgt', '译文') +
          '</div>' +
          '<div class="spacer"></div>' +
          '<div class="settings-wrap">' +
            '<button class="tbtn" id="settingsBtn" title="学习设置" aria-label="学习设置" aria-haspopup="true" aria-expanded="false">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h9M18 6h3M3 12h3M12 12h9M3 18h11M20 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg>' +
            '</button>' +
            '<div class="settings-pop" id="settingsPop" hidden>' +
              '<div class="set-row">' +
                '<span class="set-label">跟随当前句</span>' +
                (FINE_POINTER ? '<span class="set-hint">F</span>' : '') +
                '<button class="switch' + (ep.follow ? ' on' : '') + '" id="followBtn" role="switch" aria-checked="' + (ep.follow ? 'true' : 'false') + '" title="跟随当前句' + (FINE_POINTER ? '（F）' : '') + '" aria-label="跟随当前句"></button>' +
              '</div>' +
              '<div class="set-row">' +
                '<span class="set-label">字号</span>' +
                '<div class="set-stepper">' +
                  '<button class="tbtn" id="fontMinus" title="减小字号" aria-label="减小字号">' +
                    '<svg viewBox="0 0 24 24" fill="none"><text x="3" y="17" font-size="14" font-weight="800" fill="currentColor" font-family="inherit">A</text><path d="M14 13h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
                  '</button>' +
                  '<span class="set-val" id="fontVal">' + (+ep.fontScale.toFixed(2)) + '</span>' +
                  '<button class="tbtn" id="fontPlus" title="增大字号" aria-label="增大字号">' +
                    '<svg viewBox="0 0 24 24" fill="none"><text x="3" y="17" font-size="14" font-weight="800" fill="currentColor" font-family="inherit">A</text><path d="M14 13h7M17.5 9.5v7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
                  '</button>' +
                '</div>' +
              '</div>' +
              (FINE_POINTER
                ? '<button class="set-link" id="helpBtn" title="键盘快捷键（?）">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6"/></svg>' +
                    '键盘快捷键<span class="set-hint">?</span>' +
                  '</button>'
                : '') +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="list" id="list">' +
          (ep.pairs.length === 0
            ? '<div class="empty">' + mascotHtml() + '这期还没有句子数据</div>'
            : ep.pairs.map((p, i) =>
                '<div class="pair" data-i="' + i + '">' +
                  '<div class="pair-actions">' +
                    '<button class="pa-btn" data-act="loop" title="循环此句" aria-label="循环此句">' +
                      LOOP_SVG +
                    '</button>' +
                    '<button class="pa-btn" data-act="copy" title="复制原文" aria-label="复制原文">' +
                      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
                    '</button>' +
                  '</div>' +
                  '<span class="time">' + fmtTime(p.start) + '</span>' +
                  '<div class="src">' + escapeHtml(p.source) + '</div>' +
                  '<div class="tgt">' + escapeHtml(p.target) + '</div>' +
                '</div>'
              ).join('')) +
        '</div>' +
      '</div>' +

    '</div>' +

    /* 吸底播放条 */
    '<div class="playbar" id="playbar">' +
      '<div class="pbar-hit" id="pbarHit" title="点击或拖拽跳转">' +
        '<div class="pbar"><div class="pbar-fill" id="pbarFill"></div></div>' +
      '</div>' +
      '<div class="playbar-row">' +
        '<div class="pb-cover-wrap">' + coverHtml(info.image || pc.image, 'pb-cover', pcName) + '</div>' +
        '<div class="pb-now">' +
          '<div class="np-line" id="npLine">' + escapeHtml(mainTitle) + '</div>' +
          '<div class="np-sub">' + escapeHtml(pcName) + '</div>' +
        '</div>' +
        '<button class="p-btn" id="back10" title="后退 10 秒">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 17l-5-5 5-5"/><path d="M18 17l-5-5 5-5"/></svg>' +
        '</button>' +
        '<button class="p-btn main" id="playBtn" title="播放 / 暂停（空格）">' +
          '<svg id="playIcon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>' +
        '</button>' +
        '<button class="p-btn" id="fwd10" title="前进 10 秒">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 17l5-5-5-5"/><path d="M6 17l5-5-5-5"/></svg>' +
        '</button>' +
        '<div class="times"><span class="cur" id="curTime">0:00</span> / <span id="durTime">' + escapeHtml(fmtTime(data.duration || parseDuration(info.duration))) + '</span></div>' +
        '<div class="spacer"></div>' +
        '<button class="p-btn" id="loopBtn" title="单句循环：循环当前句，练跟读（L）">' +
          LOOP_SVG +
        '</button>' +
        '<div class="settings-wrap speed-wrap">' +
          '<button class="speed-btn' + (ep.rate === 1 ? ' is-one' : '') + '" id="speedBtn" title="倍速" aria-haspopup="true" aria-expanded="false">' + ep.rate + '×</button>' +
          '<div class="settings-pop speed-pop" id="speedPop" hidden>' +
            SPEEDS.map(s =>
              '<button class="set-link speed-opt' + (ep.rate === s ? ' on' : '') + '" data-rate="' + s + '">' + s + '×</button>'
            ).join('') +
          '</div>' +
        '</div>' +
        '<div class="vol-wrap">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>' +
          '<input class="vol-range" id="volRange" type="range" min="0" max="1" step="0.05" value="1" title="音量">' +
        '</div>' +
      '</div>' +
    '</div>';

  // 应用显示模式与字号
  if (ep.mode !== 'both') app.classList.add('mode-' + ep.mode);
  document.documentElement.style.setProperty('--pair-scale', String(ep.fontScale));

  // 简介展开/收起（统一绑定）
  app.querySelectorAll<HTMLElement>('.desc-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const desc = btn.previousElementSibling;
      if (!desc) return;
      const clamped = desc.classList.toggle('clamped');
      btn.textContent = clamped ? '展开' : '收起';
    });
  });

  // 返回按钮：回到来源页（替代原内联 onclick="backTarget()"）
  const backLink = $('#epBackLink');
  if (backLink) {
    backLink.addEventListener('click', e => {
      e.preventDefault();
      location.hash = backTarget();
    });
  }

  setupPlayer(audioSrc, prefs, audioFallback);
  setupToolbar();
  setupList();

  // 从句子搜索跳入：定位到命中的句子并高亮
  if (pendingSeek && pendingSeek.id === id) {
    const t = pendingSeek.t;
    pendingSeek = null;
    const idx = findPairIndex(t);
    if (idx >= 0) {
      if (ep.audio && ep.audio.src) ep.audio.currentTime = t + 0.01;
      setActive(idx, true);
    }
  }

  focusHeading();
}

/* ---------- 播放器 ---------- */
function setupPlayer(audioSrc: string, prefs: Partial<EpPrefs>, fallbackSrc: string): void {
  const audio = new Audio();
  audio.preload = 'metadata';
  if (audioSrc) audio.src = audioSrc;
  ep.audio = audio;
  // 远程源失败时回退本地文件（每次进详情页只回退一次，切期自然重置）
  let triedFallback = false;
  let usedFallback = false; // 切到兜底源后置 true，原 loadedmetadata 的进度恢复让位

  const playBtn = mustGet('#playBtn');
  const playIcon = mustGet('#playIcon');
  const curTimeEl = mustGet('#curTime');
  const durTimeEl = mustGet('#durTime');
  const pbarHit = mustGet('#pbarHit');
  const pbarFill = mustGet('#pbarFill');
  const speedBtn = mustGet('#speedBtn');
  const volRange = mustGet('#volRange') as HTMLInputElement;

  audio.playbackRate = ep.rate;

  const ICON_PLAY = '<path d="M8 5.5v13l11-6.5z"/>';
  const ICON_PAUSE = '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>';

  function refreshPlayIcon(): void {
    playIcon.innerHTML = audio.paused ? ICON_PLAY : ICON_PAUSE;
  }

  function duration(): number {
    if (isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    const data = ep.data;
    if (!data) return 0;
    return data.duration || parseDuration((data.episode || {}).duration) || 0;
  }

  function updateProgressUI(t: number): void {
    const d = duration();
    const pct = d > 0 ? Math.min(100, (t / d) * 100) : 0;
    pbarFill.style.width = pct + '%';
    curTimeEl.textContent = fmtTime(t);
  }

  playBtn.addEventListener('click', togglePlay);
  mustGet('#back10').addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
  mustGet('#fwd10').addEventListener('click', () => { audio.currentTime = Math.min(duration(), audio.currentTime + 10); });

  function togglePlay(): void {
    if (!audioSrc) { toast('这期没有音频'); return; }
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }
  ep.togglePlay = togglePlay;

  audio.addEventListener('play', () => { refreshPlayIcon(); startRaf(); });
  audio.addEventListener('pause', () => { refreshPlayIcon(); saveEpPrefs(); });
  audio.addEventListener('loadedmetadata', () => {
    durTimeEl.textContent = fmtTime(duration());
    if (usedFallback) return; // 兜底源的定位/续播由 error 处理器自己负责
    if (prefs && typeof prefs.t === 'number' && prefs.t > 0 && prefs.t < duration() - 5) {
      audio.currentTime = prefs.t;
      updateProgressUI(prefs.t);
      const idx = findPairIndex(prefs.t);
      if (idx >= 0) setActive(idx, false);
      if (prefs.t > 10) toast('已从上次进度 ' + fmtTime(prefs.t) + ' 继续');
    }
  });
  audio.addEventListener('error', () => {
    if (!audio.src) return;
    if (!triedFallback && fallbackSrc && audioSrc !== fallbackSrc) {
      triedFallback = true;
      usedFallback = true;
      // 用实时播放位置续播（不是进页时的 prefs 快照），并尽量恢复播放状态
      const resumeAt = audio.currentTime || (typeof prefs.t === 'number' ? prefs.t : 0);
      const wasPlaying = !audio.paused;
      audio.src = fallbackSrc;
      audio.load();
      const onMeta = () => {
        audio.removeEventListener('loadedmetadata', onMeta);
        if (resumeAt > 0 && (!isFinite(audio.duration) || resumeAt < audio.duration - 5)) {
          audio.currentTime = resumeAt;
        }
        if (wasPlaying) audio.play().catch(() => {});
        toast('自建源不可用，已切换备用音源');
      };
      audio.addEventListener('loadedmetadata', onMeta);
      return;
    }
    toast('音频加载失败，可仅阅读文本');
  });
  audio.addEventListener('ended', () => { setLoop(false); });

  // 进度更新：timeupdate + rAF 双保险，保证拖拽顺滑。
  // 暂停时 rAF 停转（play 事件重启），不再 60fps 空转
  function startRaf(): void {
    if (ep.rafId) return;
    ep.rafId = requestAnimationFrame(rafLoop);
  }
  function rafLoop(): void {
    if (audio.paused) { ep.rafId = 0; return; }
    if (!ep.seeking) updateProgressUI(audio.currentTime);
    ep.rafId = requestAnimationFrame(rafLoop);
  }

  // 播放进度记忆（每 5 秒）
  ep.saveTimer = setInterval(() => { if (!audio.paused) saveEpPrefs(); }, 5000);

  // 进度条拖拽（吸底条顶边细线）
  function posToTime(clientX: number): number {
    const r = pbarHit.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return ratio * duration();
  }
  pbarHit.addEventListener('pointerdown', e => {
    ep.seeking = true;
    pbarHit.classList.add('seeking');
    pbarHit.setPointerCapture(e.pointerId);
    updateProgressUI(posToTime(e.clientX));
  });
  pbarHit.addEventListener('pointermove', e => {
    if (ep.seeking) updateProgressUI(posToTime(e.clientX));
  });
  pbarHit.addEventListener('pointerup', e => {
    if (!ep.seeking) return;
    ep.seeking = false;
    pbarHit.classList.remove('seeking');
    audio.currentTime = posToTime(e.clientX);
    // 拖动即视为重新定位：退出单句循环，否则新位置立刻被拉回旧句句首
    if (ep.loop) setLoop(false);
    handlePosition(audio.currentTime);
  });

  // 倍速档位菜单：弹出选择（替代原 6 档循环键），当前档高亮
  const speedPop = mustGet('#speedPop');
  const setSpeedPop = (open: boolean): void => {
    speedPop.hidden = !open;
    speedBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  speedBtn.addEventListener('click', e => {
    e.stopPropagation();
    const opening = speedPop.hidden;
    if (opening) ep.closeSettings(); // 弹层互斥
    setSpeedPop(opening);
  });
  speedPop.addEventListener('click', e => e.stopPropagation());
  const speedOpts = Array.from(speedPop.querySelectorAll<HTMLElement>('.speed-opt'));
  speedOpts.forEach(btn => {
    btn.addEventListener('click', () => {
      setRate(parseFloat(btn.dataset.rate || '1'));
      setSpeedPop(false);
    });
  });
  ep.closeSpeed = () => setSpeedPop(false);

  function setRate(r: number): void {
    ep.rate = r;
    audio.playbackRate = r;
    speedBtn.textContent = r + '×';
    speedBtn.classList.toggle('is-one', r === 1);
    speedOpts.forEach(b => b.classList.toggle('on', parseFloat(b.dataset.rate || '1') === r));
    saveEpPrefs();
  }

  // 音量：全局记忆（localStorage），不跟单集 prefs
  const savedVol = parseFloat(localStorage.getItem(VOLUME_KEY) || '');
  ep.setVolume = v => {
    audio.volume = Math.min(1, Math.max(0, v));
    volRange.value = String(audio.volume);
    try { localStorage.setItem(VOLUME_KEY, String(audio.volume)); } catch { /* 忽略 */ }
  };
  if (!isNaN(savedVol)) ep.setVolume(savedVol);
  volRange.addEventListener('input', () => ep.setVolume(parseFloat(volRange.value)));
}

/* ---------- 句子定位 / 高亮 / 循环 ---------- */
function findPairIndex(t: number): number {
  const pairs = ep.pairs;
  let lo = 0, hi = pairs.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pairs[mid].start <= t) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (ans >= 0) {
    const p = pairs[ans];
    if (t < (p.end != null ? p.end : Infinity)) return ans;
    if (t >= p.start) return ans;
  }
  return -1;
}

/* 丝滑跟读定位：手写 easeOutCubic 滚动，新目标到达即接力，用户手动滚动立即让位 */
let followAnim = 0;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function smoothCenterEl(el: HTMLElement): void {
  if (REDUCED_MOTION) { el.scrollIntoView({ block: 'center' }); return; }
  cancelAnimationFrame(followAnim);
  const r = el.getBoundingClientRect();
  const target = window.scrollY + r.top + r.height / 2 - window.innerHeight / 2;
  const start = window.scrollY;
  const delta = target - start;
  if (Math.abs(delta) < 4) return;
  const dur = 300;
  const t0 = performance.now();
  const step = (now: number): void => {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    window.scrollTo(0, start + delta * e);
    if (p < 1) followAnim = requestAnimationFrame(step);
    else followAnim = 0;
  };
  followAnim = requestAnimationFrame(step);
}
// 用户手动滚动时取消跟随动画，不与手抢滚动条
['wheel', 'touchmove'].forEach(evt =>
  window.addEventListener(evt, () => {
    if (followAnim) { cancelAnimationFrame(followAnim); followAnim = 0; }
  }, { passive: true }));

function setActive(i: number, scroll: boolean): void {
  if (i === ep.activeIdx) return;
  const prev = ep.activeIdx;
  ep.activeIdx = i;
  if (prev >= 0 && ep.pairEls[prev]) ep.pairEls[prev].classList.remove('active');
  if (i >= 0 && ep.pairEls[i]) {
    ep.pairEls[i].classList.add('active');
    if (ep.loop) syncLoopBadge();
    if (scroll && ep.follow) {
      smoothCenterEl(ep.pairEls[i]);
    }
  }
  // 吸底条正在播放：当前句原文，未定位时回退单集名
  const np = $('#npLine');
  if (np && ep.data) {
    const info = ep.data.episode || {};
    np.textContent = i >= 0 && ep.pairs[i]
      ? (ep.pairs[i].source || '')
      : (info.title_target || info.title || '');
  }
}

function handlePosition(t: number): void {
  // 单句循环：到达句尾就跳回句首（拖动进度条期间不回跳，否则永远拖不出句外）
  if (ep.loop && !ep.seeking && ep.activeIdx >= 0 && ep.pairs[ep.activeIdx]) {
    const p = ep.pairs[ep.activeIdx];
    const end = p.end != null ? p.end : Infinity;
    if (t >= end - 0.06 || t < p.start - 0.5) {
      if (ep.audio) ep.audio.currentTime = p.start;
      return;
    }
  }
  const idx = findPairIndex(t);
  if (idx >= 0) setActive(idx, true);
}

/* 循环徽标只切换上一处与当前处：600 句的列表全表 toggle + 逐个 querySelector 很贵 */
let loopedEl: HTMLElement | null = null;
function syncLoopBadge(): void {
  if (loopedEl) {
    loopedEl.classList.remove('looping');
    const prevBtn = loopedEl.querySelector<HTMLElement>('.pa-btn[data-act="loop"]');
    if (prevBtn) prevBtn.classList.remove('on');
    loopedEl = null;
  }
  if (ep.loop && ep.activeIdx >= 0) {
    const el = ep.pairEls[ep.activeIdx];
    if (el) {
      el.classList.add('looping');
      const btn = el.querySelector<HTMLElement>('.pa-btn[data-act="loop"]');
      if (btn) btn.classList.add('on');
      loopedEl = el;
    }
  }
}

function setLoop(on: boolean): void {
  ep.loop = on;
  const btn = $('#loopBtn');
  if (btn) btn.classList.toggle('on', on);
  syncLoopBadge();
  if (on) toast('单句循环已开启，再按一次退出');
  saveEpPrefs();
}
ep.setLoop = setLoop;

function gotoSentence(i: number, autoplay: boolean): void {
  if (i < 0 || i >= ep.pairs.length) return;
  if (ep.loop) setLoop(false); // 切句退出循环
  const p = ep.pairs[i];
  if (ep.audio && ep.audio.src) {
    ep.audio.currentTime = p.start + 0.01;
    if (autoplay) ep.audio.play().catch(() => {});
  }
  setActive(i, true);
}
ep.gotoSentence = gotoSentence;

/* hover 操作：循环此句（再点一次取消） */
function loopThisSentence(i: number): void {
  if (ep.loop && ep.activeIdx === i) { setLoop(false); return; }
  gotoSentence(i, true);
  setLoop(true);
}

/* ---------- 学习工具条 ---------- */
function setupToolbar(): void {
  // 字幕分段控件：状态可见、一键直达
  const segBtns = Array.from(app.querySelectorAll<HTMLElement>('.seg-btn'));
  const applyMode = () => {
    app.classList.remove('mode-src', 'mode-tgt');
    if (ep.mode !== 'both') app.classList.add('mode-' + ep.mode);
    segBtns.forEach(b => {
      const on = b.dataset.mode === ep.mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  };
  segBtns.forEach(b => b.addEventListener('click', () => {
    const m = b.dataset.mode;
    if (!m || m === ep.mode) return;
    ep.mode = m;
    applyMode();
    saveEpPrefs();
  }));

  // 设置 popover：开合 + aria
  const settingsBtn = mustGet('#settingsBtn');
  const settingsPop = mustGet('#settingsPop');
  const setPop = (open: boolean) => {
    settingsPop.hidden = !open;
    settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    settingsBtn.classList.toggle('on', open);
  };
  settingsBtn.addEventListener('click', e => {
    e.stopPropagation();
    const opening = settingsPop.hidden;
    if (opening) ep.closeSpeed(); // 弹层互斥
    setPop(opening);
  });
  settingsPop.addEventListener('click', e => e.stopPropagation());
  ep.closeSettings = () => setPop(false);

  // 跟随滚动
  const followBtn = mustGet('#followBtn');
  followBtn.addEventListener('click', () => {
    ep.follow = !ep.follow;
    followBtn.classList.toggle('on', ep.follow);
    followBtn.setAttribute('aria-checked', ep.follow ? 'true' : 'false');
    toast(ep.follow ? '跟随滚动已开启' : '跟随滚动已关闭');
    saveEpPrefs();
  });

  // 单句循环（吸底条）
  mustGet('#loopBtn').addEventListener('click', () => setLoop(!ep.loop));

  // 字号
  const applyFont = () => {
    document.documentElement.style.setProperty('--pair-scale', String(ep.fontScale));
    const val = $('#fontVal');
    if (val) val.textContent = String(+ep.fontScale.toFixed(2));
    saveEpPrefs();
  };
  mustGet('#fontMinus').addEventListener('click', () => {
    ep.fontScale = Math.max(0.8, +(ep.fontScale - 0.07).toFixed(2));
    applyFont();
  });
  mustGet('#fontPlus').addEventListener('click', () => {
    ep.fontScale = Math.min(1.35, +(ep.fontScale + 0.07).toFixed(2));
    applyFont();
  });

  // 快捷键说明（仅精细指针设备渲染该入口）
  const helpBtn = $('#helpBtn');
  if (helpBtn) {
    helpBtn.addEventListener('click', () => {
      setPop(false);
      mustGet('#shortcutModal').classList.add('open');
    });
  }
}

/* ---------- 句子列表 ---------- */
/* 事件委托：一条监听器管全部句子的点击（原来每句挂 3 个监听器，600 句 ≈ 1800 个） */
function setupList(): void {
  ep.pairEls = Array.from(document.querySelectorAll<HTMLElement>('.pair'));
  loopedEl = null;
  const list = $('#list');
  if (!list) return;
  list.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const pairEl = target.closest<HTMLElement>('.pair');
    if (!pairEl) return;
    const idx = Number(pairEl.dataset.i);
    if (Number.isNaN(idx)) return;
    const btn = target.closest<HTMLElement>('.pa-btn');
    if (btn) {
      if (btn.dataset.act === 'loop') loopThisSentence(idx);
      else if (btn.dataset.act === 'copy') {
        copyText((ep.pairs[idx] || { source: '' }).source).then(() => toast('已复制原文'));
      }
      return;
    }
    gotoSentence(idx, true);
  });
}

/* ================= 快捷键弹层 ================= */
const modal = mustGet('#shortcutModal');
mustGet('#modalClose').addEventListener('click', () => modal.classList.remove('open'));
modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

/* ================= 键盘快捷键 ================= */
document.addEventListener('keydown', e => {
  const target = e.target as HTMLElement;
  const tag = (target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
  // 焦点在按钮/链接等可激活元素上时，空格/回车是它自身的激活键，不劫持成播放/暂停
  if (
    (e.key === ' ' || e.key === 'Enter') &&
    (tag === 'button' || tag === 'a' || tag === 'select' ||
      target.getAttribute('role') === 'link' || target.getAttribute('role') === 'button')
  ) return;

  if (e.key === 'Escape') {
    if (modal.classList.contains('open')) { modal.classList.remove('open'); return; }
    const speedPop = $('#speedPop');
    if (speedPop && !speedPop.hidden) { ep.closeSpeed(); return; }
    const pop = $('#settingsPop');
    if (pop && !pop.hidden) { ep.closeSettings(); return; }
    if (currentView.name === 'episode' && ep.data) {
      location.hash = backTarget();
      return;
    }
    if (currentView.name === 'podcast') { location.hash = '#/'; return; }
    return;
  }
  if (e.key === '?' || (e.shiftKey && e.key === '/')) {
    modal.classList.toggle('open');
    return;
  }
  if (!ep.id || !ep.audio) return; // 以下仅详情页

  switch (e.key) {
    case ' ':
      e.preventDefault();
      ep.togglePlay();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      gotoSentence(ep.activeIdx > 0 ? ep.activeIdx - 1 : 0, false);
      break;
    case 'ArrowRight':
      e.preventDefault();
      gotoSentence(ep.activeIdx < ep.pairs.length - 1 ? ep.activeIdx + 1 : ep.activeIdx, false);
      break;
    case 'ArrowUp':
      e.preventDefault();
      ep.setVolume(ep.audio.volume + 0.1);
      toast('音量 ' + Math.round(ep.audio.volume * 100) + '%');
      break;
    case 'ArrowDown':
      e.preventDefault();
      ep.setVolume(ep.audio.volume - 0.1);
      toast('音量 ' + Math.round(ep.audio.volume * 100) + '%');
      break;
    case 'l': case 'L':
      if (ep.activeIdx < 0 && ep.pairs.length) gotoSentence(0, false);
      setLoop(!ep.loop);
      break;
    case 'f': case 'F': {
      const btn = $('#followBtn');
      if (btn) btn.click();
      break;
    }
  }
});

/* ================= 启动 ================= */
// 点击 popover 外部时收起（全局只注册一次）
document.addEventListener('click', () => {
  const pop = $('#settingsPop');
  if (pop && !pop.hidden) ep.closeSettings();
  const speedPop = $('#speedPop');
  if (speedPop && !speedPop.hidden) ep.closeSpeed();
});
window.addEventListener('beforeunload', saveEpPrefs);
// PWA：注册 Service Worker（离线缓存 app shell 与已浏览节目）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}
// PWA：安装引导（仅桌面/Android 支持 beforeinstallprompt 时显示）
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const installBtn = mustGet('#installBtn');
window.addEventListener('beforeinstallprompt', ((e: BeforeInstallPromptEvent) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
}) as EventListener);
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice; // 接受后会触发 appinstalled，toast 在那里统一弹
  deferredPrompt = null;
  installBtn.hidden = true;
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  installBtn.hidden = true;
  toast('已安装到主屏幕');
});
route();

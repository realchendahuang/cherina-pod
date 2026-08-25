// Cherina Pod Service Worker（原 public/sw.js，TS 化后由 esbuild 打包回 public/sw.js）。
// 策略概览：
//   app shell（HTML/字体/图标/manifest）  → cache-first（离线可开站）
//   charts.json                           → stale-while-revalidate
//   /api/episodes（列表+详情）            → network-first，失败落缓存（断网可读已浏览节目）
//   /api/search 与音频外链等其他请求      → 不缓存
//
// 版本约定：发布新版本时递增 CACHE_VERSION 即可，旧缓存会在 activate 阶段自动清理。
// 注：Service Worker 类型在 @cloudflare/workers-types 中不完整，此处用宽松类型标注，
//     由 esbuild 打包（不做类型检查），运行时行为与浏览器 SW API 一致。
const CACHE_VERSION = 'cherina-v1';
const PRECACHE_URLS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './fonts/nunito/Nunito-latin.woff2',
  './brand/favicon.svg',
  './brand/web-logo.svg',
  './brand/web-logo-small.svg',
  './brand/icon-192.png',
  './brand/icon-512.png',
  './brand/icon-maskable-512.png',
  './brand/apple-touch-icon.png',
];

(self as any).addEventListener('install', (event: any) => {
  event.waitUntil(
    (caches as any).open(CACHE_VERSION)
      .then((cache: any) => cache.addAll(PRECACHE_URLS))
      .then(() => (self as any).skipWaiting())
  );
});

(self as any).addEventListener('activate', (event: any) => {
  event.waitUntil(
    (caches as any).keys()
      .then((keys: string[]) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => (caches as any).delete(k))))
      .then(() => (self as any).clients.claim())
  );
});

// 网络优先、失败落缓存：列表与详情 API 断网时可读上次数据
async function networkFirst(request: Request): Promise<Response> {
  const cache: any = await (caches as any).open(CACHE_VERSION);
  try {
    const resp = await fetch(request);
    if (resp.ok) cache.put(request, resp.clone());
    return resp;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return Response.json({ error: 'offline' }, { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}

// 缓存优先：app shell 静态资源
async function cacheFirst(request: Request): Promise<Response> {
  const cached = await (caches as any).match(request);
  if (cached) return cached;
  return fetch(request);
}

// 后台更新：直接返回缓存，同时拉新版本回填
async function staleWhileRevalidate(request: Request): Promise<Response> {
  const cache: any = await (caches as any).open(CACHE_VERSION);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((resp) => { if (resp.ok) cache.put(request, resp.clone()); return resp; })
    .catch(() => null);
  if (cached) return cached;
  const fresh = await refresh;
  if (fresh) return fresh;
  return Response.json({ error: 'offline' }, { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

(self as any).addEventListener('fetch', (event: any) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== (self as any).location.origin) return; // 音频外链（RustFS）不缓存

  const path = url.pathname;

  if (path === '/' || path === '/index.html' ||
      path.startsWith('/brand/') || path.startsWith('/fonts/') ||
      path === '/manifest.webmanifest') {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (path === '/charts.json') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (path === '/api/episodes' || path.startsWith('/api/episodes/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // /api/search 及其他：走网络
});

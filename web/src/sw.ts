// Cherina Pod Service Worker（原 public/sw.js，TS 化后由 esbuild 打包回 public/sw.js）。
// 策略概览：
//   HTML 与 /app.js                     → network-first，失败落缓存（线上即时更新，断网可开站）
//   字体/图标/manifest                   → cache-first（不可变资源）
//   /api/episodes（列表+详情）            → network-first，失败落缓存（断网可读已浏览节目）
//   /api/search 与音频外链等其他请求      → 不缓存
//
// 版本约定：发布新版本时递增 CACHE_VERSION 即可，旧缓存会在 activate 阶段自动清理。
// （HTML/app.js 走 network-first 后，忘了 bump 也只是浪费一次预缓存，不会再新旧混搭。）
// 类型说明：Service Worker 运行在 ServiceWorkerGlobalScope 下，TS 的 lib.webworker 已收录
// 完整类型（self / caches / FetchEvent / ExtendableEvent 等），此处显式收窄 self 即可。

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_VERSION = 'cherina-v5';
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

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => sw.skipWaiting())
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => sw.clients.claim())
  );
});

// 网络优先、失败落缓存：列表与详情 API 断网时可读上次数据
async function networkFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const resp = await fetch(request);
    if (resp.ok) cache.put(request, resp.clone());
    return resp;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return Response.json({ error: 'offline' }, { status: 503 });
  }
}

// 缓存优先：不可变的 app shell 静态资源（字体/图标/manifest）
async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;
  return fetch(request);
}

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return; // 音频外链（RustFS）不缓存

  const path = url.pathname;

  // HTML 与 app.js 走 network-first：线上即时更新，断网回落缓存（离线可开站）。
  // 注意 /app.js 必须进 respondWith 分支——它虽然在 install 时预缓存过，
  // 但不接管的话离线时 HTML 能从缓存出来而 JS 直接挂掉，PWA 离线承诺形同虚设。
  if (path === '/' || path === '/index.html' || path === '/app.js') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (
    path.startsWith('/brand/') ||
    path.startsWith('/fonts/') ||
    path === '/manifest.webmanifest'
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (path === '/api/episodes' || path.startsWith('/api/episodes/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // /api/search 及其他：走网络
});

"use strict";
(() => {
  // src/sw.ts
  var sw = self;
  var CACHE_VERSION = "cherina-v3";
  var PRECACHE_URLS = [
    "./",
    "./index.html",
    "./app.js",
    "./manifest.webmanifest",
    "./fonts/nunito/Nunito-latin.woff2",
    "./brand/favicon.svg",
    "./brand/web-logo.svg",
    "./brand/web-logo-small.svg",
    "./brand/icon-192.png",
    "./brand/icon-512.png",
    "./brand/icon-maskable-512.png",
    "./brand/apple-touch-icon.png"
  ];
  sw.addEventListener("install", (event) => {
    event.waitUntil(
      caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => sw.skipWaiting())
    );
  });
  sw.addEventListener("activate", (event) => {
    event.waitUntil(
      caches.keys().then(
        (keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      ).then(() => sw.clients.claim())
    );
  });
  async function networkFirst(request) {
    const cache = await caches.open(CACHE_VERSION);
    try {
      const resp = await fetch(request);
      if (resp.ok) cache.put(request, resp.clone());
      return resp;
    } catch {
      const cached = await cache.match(request);
      if (cached) return cached;
      return Response.json({ error: "offline" }, { status: 503 });
    }
  }
  async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return fetch(request);
  }
  sw.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin !== sw.location.origin) return;
    const path = url.pathname;
    if (path === "/" || path === "/index.html" || path.startsWith("/brand/") || path.startsWith("/fonts/") || path === "/manifest.webmanifest") {
      event.respondWith(cacheFirst(request));
      return;
    }
    if (path === "/api/episodes" || path.startsWith("/api/episodes/")) {
      event.respondWith(networkFirst(request));
      return;
    }
  });
})();

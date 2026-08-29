"use strict";
(() => {
  // src/app.ts
  var $ = (sel, root) => (root || document).querySelector(sel);
  function mustGet(sel) {
    const el = $(sel);
    if (!el) throw new Error("\u7F3A\u5C11\u5FC5\u9700\u5143\u7D20\uFF1A" + sel);
    return el;
  }
  var app = mustGet("#app");
  var container = mustGet("#container");
  var toastEl = mustGet("#toast");
  var MASCOT = "./brand/cherina-mascot-companion.png";
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtTime(s) {
    s = Math.max(0, s || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor(s % 3600 / 60);
    const sec = Math.floor(s % 60);
    const ss = String(sec).padStart(2, "0");
    if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + ss;
    return m + ":" + ss;
  }
  function parseDuration(s) {
    if (!s) return 0;
    const parts = String(s).split(":").map(Number);
    if (parts.some(isNaN)) return 0;
    let sec = 0;
    for (const p of parts) sec = sec * 60 + p;
    return sec;
  }
  function fmtDuration(d) {
    if (d == null || d === "") return "";
    const s = String(d).trim();
    if (!s) return "";
    if (/^\d+$/.test(s)) return fmtTime(Number(s));
    if (/^\d+:\d{1,2}(:\d{1,2})?$/.test(s)) return fmtTime(parseDuration(s));
    return s;
  }
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    if (toastTimer != null) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1400);
  }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t).catch(() => fallbackCopy(t));
    }
    return Promise.resolve(fallbackCopy(t));
  }
  function fallbackCopy(t) {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch {
    }
    ta.remove();
  }
  var CHEV_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  var BACK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  var LOOP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/></svg>';
  var FINE_POINTER = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var THEME_KEY = "cherina:theme";
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === "dark" ? "#141211" : "#f7f6f3";
  }
  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    applyTheme(saved === "dark" ? "dark" : "light");
  }
  mustGet("#themeBtn").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  });
  initTheme();
  var SITE_URL = "https://pod.cherina.app";
  var SITE_DESC = "Cherina Pod \u53CC\u8BED\u64AD\u5BA2\u7CBE\u542C\uFF1A\u4E2D\u82F1\u5BF9\u7167\u9010\u53E5\u5B66\u4E60\uFF0C\u8DDF\u8BFB\u5FAA\u73AF\u3001\u500D\u901F\u64AD\u653E\uFF0C\u4ECE BBC\u3001TED\u3001Hidden Brain\u300199% Invisible \u7B49\u4F18\u8D28\u82F1\u6587\u64AD\u5BA2\u4E2D\u63D0\u5347\u542C\u529B\u4E0E\u53E3\u8BED\u3002";
  function setMeta(attr, key, content) {
    let el = document.head.querySelector("meta[" + attr + '="' + key + '"]');
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  }
  function setLdJson(obj) {
    let el = document.getElementById("ldJson");
    if (!el) {
      el = document.createElement("script");
      el.type = "application/ld+json";
      el.id = "ldJson";
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(obj);
  }
  function seoBase(title, desc, url, image) {
    document.title = title;
    setMeta("name", "description", desc);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", desc);
    setMeta("property", "og:url", url);
    if (image) setMeta("property", "og:image", image);
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", desc);
    if (image) setMeta("name", "twitter:image", image);
    const canon = document.querySelector('link[rel="canonical"]');
    if (canon) canon.setAttribute("href", url);
  }
  function isoDuration(d) {
    const sec = parseDuration(d);
    if (!sec) return "";
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return "PT" + (h ? h + "H" : "") + (m ? m + "M" : "") + s + "S";
  }
  var indexCache = null;
  async function loadIndex() {
    if (indexCache) return indexCache;
    const resp = await fetch("/api/episodes", { cache: "no-store" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    indexCache = data;
    return data;
  }
  function groupChannels(items) {
    const map = /* @__PURE__ */ new Map();
    for (const it of items) {
      const key = it.podcast_title || it.podcast_title_zh || "\u672A\u547D\u540D\u64AD\u5BA2";
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: it.podcast_title || it.podcast_title_zh || "\u672A\u547D\u540D\u64AD\u5BA2",
          zhAlt: it.podcast_title_zh || "",
          author: it.podcast_author || "",
          image: it.image || "",
          episodes: [],
          pairs: 0
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
  var currentView = { name: "discover", param: null };
  var navStack = [];
  function backTarget() {
    const prev = navStack.pop();
    if (prev) return prev;
    if (currentView.name === "episode") {
      const pc = ep.data && ep.data.podcast || {};
      const key = pc.title || pc.title_zh || "";
      return key ? "#/podcast/" + encodeURIComponent(key) : "#/";
    }
    return "#/";
  }
  function route() {
    const q = new URLSearchParams(location.search);
    const qid = q.get("id");
    if (qid) {
      history.replaceState({}, "", location.pathname + "#/ep/" + encodeURIComponent(qid));
    } else {
      const qp = q.get("podcast");
      if (qp) {
        history.replaceState({}, "", location.pathname + "#/podcast/" + encodeURIComponent(qp));
      }
    }
    const h = location.hash || "#/";
    let m;
    if (m = h.match(/^#\/ep\/(.+)$/)) {
      renderEpisode(decodeURIComponent(m[1]));
    } else if (m = h.match(/^#\/podcast\/(.+)$/)) {
      renderPodcast(decodeURIComponent(m[1]));
    } else {
      renderDiscover();
    }
  }
  window.addEventListener("hashchange", route);
  function bindNav(root) {
    root.querySelectorAll("[data-go]").forEach((el) => {
      const open = () => {
        const v = el.dataset.go;
        if (!v) return;
        const i = v.indexOf(":");
        const type = v.slice(0, i);
        const payload = v.slice(i + 1);
        if (type === "ext") {
          window.open(payload, "_blank", "noopener");
          return;
        }
        const seek = el.dataset.seek;
        if (type === "ep" && seek != null) {
          pendingSeek = { id: decodeURIComponent(payload), t: +seek };
        }
        navStack.push(location.hash || "#/");
        location.hash = "#/" + type + "/" + payload;
      };
      el.addEventListener("click", open);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    });
  }
  function coverHtml(url, cls, phText) {
    const ph = '<span class="cover-ph">' + escapeHtml((phText || "\xB7").trim().charAt(0) || "\xB7") + "</span>";
    const img = url ? '<img class="' + cls + '" src="' + escapeHtml(url) + `" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : "";
    return ph + img;
  }
  var LOADING_HTML = '<div class="empty">\u52A0\u8F7D\u4E2D\u2026</div>';
  function mascotHtml() {
    return '<img class="mascot" src="' + MASCOT + '" alt="">';
  }
  function loadFailHtml(e) {
    return '<div class="empty">' + mascotHtml() + '\u8282\u76EE\u5E93\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5<span class="empty-detail">' + escapeHtml(e.message) + "</span></div>";
  }
  function notFoundHtml(msg, detail) {
    return '<div class="empty">' + mascotHtml() + escapeHtml(msg) + (detail ? '<span class="empty-detail">' + escapeHtml(detail) + "</span>" : "") + '<br><br><a class="tool-btn" href="#/">\u8FD4\u56DE\u53D1\u73B0\u9996\u9875</a></div>';
  }
  async function renderDiscover() {
    cleanupEpisode();
    currentView.name = "discover";
    currentView.param = null;
    seoBase("Cherina Pod \xB7 \u53CC\u8BED\u64AD\u5BA2\u7CBE\u542C", SITE_DESC, SITE_URL + "/", SITE_URL + "/brand/web-logo-small.svg");
    container.className = "container";
    app.className = "";
    app.innerHTML = LOADING_HTML;
    let data;
    try {
      data = await loadIndex();
    } catch (e) {
      app.innerHTML = loadFailHtml(e);
      return;
    }
    const items = data.items || [];
    if (!items.length) {
      app.innerHTML = '<div class="empty">' + mascotHtml() + "\u8FD8\u6CA1\u6709\u8282\u76EE\uFF0C\u7A0D\u540E\u518D\u6765\u770B\u770B</div>";
      return;
    }
    const channels = groupChannels(items);
    setLdJson({
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Cherina Pod \u6700\u65B0\u5355\u96C6",
      itemListElement: items.slice(0, 20).map((it, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: SITE_URL + "/?id=" + encodeURIComponent(it.id),
        name: it.episode_title_zh || it.episode_title || ""
      }))
    });
    const catBuckets = {};
    for (const it of items) {
      const cat = it.category || "\u5176\u4ED6";
      (catBuckets[cat] || (catBuckets[cat] = [])).push(it);
    }
    const CAT_ORDER = ["\u82F1\u8BED\u5B66\u4E60", "\u5546\u4E1A\u8D22\u7ECF", "\u79D1\u6280\u8BA4\u77E5", "\u65B0\u95FB\u7EAA\u5B9E"];
    const ts = (s) => {
      const n = Date.parse(s || "");
      return isNaN(n) ? 0 : n;
    };
    const latest = items.slice().sort((a, b) => {
      return ts(b.generated_at || b.pub_date) - ts(a.generated_at || a.pub_date);
    }).slice(0, 14);
    function railSection(title, sub, list) {
      if (!list || !list.length) return "";
      return '<section class="section"><div class="section-head"><h2>' + escapeHtml(title) + "</h2>" + (sub ? '<span class="sub">' + escapeHtml(sub) + "</span>" : "") + '</div><div class="rail-scroll">' + list.map(miniCardHtml).join("") + "</div></section>";
    }
    let catHtml = "";
    for (const cat of CAT_ORDER) {
      if (catBuckets[cat] && catBuckets[cat].length) {
        catHtml += railSection(cat, "", catBuckets[cat]);
      }
    }
    const continuing = items.map((it) => ({ it, prefs: loadEpPrefs(it.id) })).filter((x) => x.prefs != null && typeof x.prefs.t === "number" && x.prefs.t > 0).sort((a, b) => (b.prefs.ts || 0) - (a.prefs.ts || 0)).slice(0, 4);
    let continueHtml = "";
    if (continuing.length) {
      continueHtml = '<section class="section"><div class="section-head"><h2>\u7EE7\u7EED\u542C</h2><span class="sub">\u4E0A\u6B21\u542C\u5230\u8FD9</span></div><div class="rail-scroll">' + continuing.map((x) => continueCardHtml(x.it, x.prefs)).join("") + "</div></section>";
    }
    app.innerHTML = '<div class="search-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input class="search-input" id="searchInput" type="search" placeholder="\u641C\u7D22\u8282\u76EE\u3001\u64AD\u5BA2\u6216\u53E5\u5B50\u2026" autocomplete="off"></div><div id="discoverMain">' + continueHtml + catHtml + '<section class="section"><div class="section-head"><h2>\u6700\u65B0\u66F4\u65B0</h2></div><div class="rail-scroll">' + latest.map(miniCardHtml).join("") + '</div></section><section class="section"><div class="section-head"><h2>\u5168\u90E8\u9891\u9053</h2></div><div class="chan-grid">' + channels.map(chanCardHtml).join("") + '</div></section></div><div id="searchResults" hidden></div>';
    bindNav(app);
    mustGet("#searchInput").addEventListener("input", (e) => {
      const raw = e.target.value.trim();
      drawDiscoverSearch(raw.toLowerCase(), channels, items);
      scheduleSentenceSearch(raw);
    });
  }
  function chanCardHtml(g) {
    return '<div class="chan-card" data-go="podcast:' + encodeURIComponent(g.key) + '" tabindex="0" role="link"><div class="cover-wrap">' + coverHtml(g.image, "cover", g.name) + '</div><div class="body"><div class="name-zh" title="' + escapeHtml(g.name) + '">' + escapeHtml(g.name) + "</div></div></div>";
  }
  function miniCardHtml(it) {
    const main = it.episode_title_zh || it.episode_title || "";
    const levelLabel = { beginner: "\u5165\u95E8", intermediate: "\u8FDB\u9636", advanced: "\u9AD8\u7EA7" }[it.level || ""] || "";
    const desc = (it.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const metaParts = [it.podcast_title || it.podcast_title_zh || ""];
    if (it.duration) metaParts.push(fmtDuration(it.duration));
    if (levelLabel) metaParts.push(levelLabel);
    return '<div class="mini-card" data-go="ep:' + encodeURIComponent(it.id) + '" tabindex="0" role="link"><div class="cover-wrap">' + coverHtml(it.image, "cover", it.podcast_title) + '</div><div class="body"><div class="t-zh" title="' + escapeHtml(main) + '">' + escapeHtml(main) + '</div><div class="meta">' + metaParts.map(escapeHtml).join(" \xB7 ") + "</div>" + (desc ? '<div class="desc">' + escapeHtml(desc) + "</div>" : "") + "</div></div>";
  }
  function continueCardHtml(it, prefs) {
    const total = parseDuration(it.duration);
    const pct = total > 0 ? Math.min(100, Math.round(prefs.t / total * 100)) : 0;
    return '<div class="mini-card cont-card" data-go="ep:' + encodeURIComponent(it.id) + '" tabindex="0" role="link"><div class="cover-wrap">' + coverHtml(it.image, "cover", it.podcast_title) + (pct > 0 ? '<div class="cont-badge">' + pct + "%</div>" : "") + '</div><div class="body"><div class="t-zh">' + escapeHtml(it.episode_title_zh || it.episode_title || "") + '</div><div class="meta">' + escapeHtml(it.podcast_title || it.podcast_title_zh || "") + '</div><div class="cont-bar"><div class="cont-fill" style="width:' + pct + '%"></div></div><div class="cont-note">\u542C\u5230 ' + escapeHtml(fmtTime(prefs.t)) + " \xB7 \u7EE7\u7EED</div></div></div>";
  }
  function sentenceRowHtml(r) {
    const main = r.episode_title_zh || r.episode_title || "";
    return '<div class="ep-row" data-go="ep:' + encodeURIComponent(r.episode_id) + '" data-seek="' + (r.start || 0) + '" tabindex="0" role="link"><span class="num">' + escapeHtml(fmtTime(r.start)) + '</span><div class="info"><div class="t-zh">' + escapeHtml(r.zh || "") + '</div><div class="t-en">' + escapeHtml(r.en || "") + '</div><div class="meta">' + escapeHtml(r.podcast || "") + (main ? " \xB7 " + escapeHtml(main) : "") + '</div></div><span class="chev">' + CHEV_SVG + "</span></div>";
  }
  var sentenceQuery = "";
  function renderSentenceHits(query, rows) {
    sentenceQuery = query;
    const results = $("#searchResults");
    if (!results) return;
    const prev = results.querySelector(".sent-hits");
    if (prev) prev.remove();
    const empty = results.querySelector(".empty");
    if (!rows || !rows.length) {
      if (empty && !results.querySelector(".section")) {
        empty.innerHTML = mascotHtml() + "\u6CA1\u6709\u5339\u914D\u300C" + escapeHtml(query) + "\u300D\u7684\u5185\u5BB9";
      }
      return;
    }
    if (empty) empty.remove();
    const sec = document.createElement("section");
    sec.className = "section sent-hits";
    sec.innerHTML = '<div class="section-head"><h2>\u53E5\u5B50\u547D\u4E2D</h2><span class="count">' + rows.length + '</span></div><div class="ep-rows">' + rows.map(sentenceRowHtml).join("") + "</div>";
    results.prepend(sec);
    bindNav(sec);
  }
  var sentenceSearchTimer = null;
  var sentenceSearchSeq = 0;
  function scheduleSentenceSearch(raw) {
    if (sentenceSearchTimer != null) clearTimeout(sentenceSearchTimer);
    if (!raw) {
      renderSentenceHits("", []);
      return;
    }
    if (raw.length < 2) {
      renderSentenceHits("", []);
      return;
    }
    sentenceSearchTimer = setTimeout(() => runSentenceSearch(raw), 250);
  }
  async function runSentenceSearch(raw) {
    const mySeq = ++sentenceSearchSeq;
    try {
      const resp = await fetch("/api/search?q=" + encodeURIComponent(raw));
      if (!resp.ok) return;
      const data = await resp.json();
      if (mySeq !== sentenceSearchSeq) return;
      if (currentView.name !== "discover") return;
      renderSentenceHits(raw, data.items || []);
    } catch {
    }
  }
  function drawDiscoverSearch(query, channels, items) {
    const main = $("#discoverMain");
    const results = $("#searchResults");
    if (!main || !results) return;
    if (!query) {
      main.hidden = false;
      results.hidden = true;
      results.innerHTML = "";
      return;
    }
    main.hidden = true;
    results.hidden = false;
    const chanHits = channels.filter((g) => g.name.toLowerCase().includes(query) || g.zhAlt.toLowerCase().includes(query) || (g.author || "").toLowerCase().includes(query));
    const epHits = items.filter((it) => (it.episode_title || "").toLowerCase().includes(query) || (it.episode_title_zh || "").toLowerCase().includes(query) || (it.podcast_title || "").toLowerCase().includes(query) || (it.podcast_title_zh || "").toLowerCase().includes(query) || (it.podcast_author || "").toLowerCase().includes(query));
    if (!chanHits.length && !epHits.length) {
      results.innerHTML = '<div class="empty">' + mascotHtml() + "\u6807\u9898\u6CA1\u6709\u5339\u914D\u300C" + escapeHtml(query) + '\u300D<span class="empty-detail">\u6B63\u5728\u68C0\u7D22\u53CC\u8BED\u9010\u53E5\u2026</span></div>';
      return;
    }
    let html = "";
    if (chanHits.length) {
      html += '<section class="section"><div class="section-head"><h2>\u9891\u9053</h2><span class="count">' + chanHits.length + '</span></div><div class="chan-grid">' + chanHits.map(chanCardHtml).join("") + "</div></section>";
    }
    if (epHits.length) {
      html += '<section class="section"><div class="section-head"><h2>\u5355\u96C6</h2><span class="count">' + epHits.length + '</span></div><div class="ep-rows">' + epHits.map((it, i) => epRowHtml(it, i + 1, true)).join("") + "</div></section>";
    }
    results.innerHTML = html;
    bindNav(results);
  }
  async function renderPodcast(key) {
    cleanupEpisode();
    currentView.name = "podcast";
    currentView.param = key;
    document.title = key + " \xB7 Cherina Pod";
    container.className = "container";
    app.className = "";
    app.innerHTML = LOADING_HTML;
    let data;
    try {
      data = await loadIndex();
    } catch (e) {
      app.innerHTML = loadFailHtml(e);
      return;
    }
    const eps = (data.items || []).filter((it) => (it.podcast_title || it.podcast_title_zh || "\u672A\u547D\u540D\u64AD\u5BA2") === key).sort((a, b) => String(b.pub_date || "").localeCompare(String(a.pub_date || "")));
    if (!eps.length) {
      app.innerHTML = '<a class="back-link" href="#/" title="\u8FD4\u56DE\u53D1\u73B0" aria-label="\u8FD4\u56DE\u53D1\u73B0">' + BACK_SVG + "</a>" + notFoundHtml("\u6CA1\u6709\u627E\u5230\u8FD9\u4E2A\u9891\u9053");
      return;
    }
    const g = groupChannels(eps)[0];
    const chanDesc = g.name + " \u53CC\u8BED\u64AD\u5BA2\u7CBE\u542C\uFF1A\u5171 " + eps.length + " \u96C6\uFF0C\u4E2D\u82F1\u5BF9\u7167\u9010\u53E5\u5B66\u4E60\u3002";
    seoBase(
      g.name + " \xB7 Cherina Pod",
      chanDesc,
      SITE_URL + "/?podcast=" + encodeURIComponent(key),
      g.image || SITE_URL + "/brand/web-logo-small.svg"
    );
    setLdJson({
      "@context": "https://schema.org",
      "@type": "PodcastSeries",
      name: g.name,
      url: SITE_URL + "/?podcast=" + encodeURIComponent(key),
      description: chanDesc,
      ...g.image ? { image: g.image } : {}
    });
    app.innerHTML = '<a class="back-link" href="#/" title="\u8FD4\u56DE\u53D1\u73B0" aria-label="\u8FD4\u56DE\u53D1\u73B0">' + BACK_SVG + '</a><div class="pod-hero"><div class="pod-cover-wrap">' + coverHtml(g.image, "", g.name) + '</div><div class="pod-info"><h1>' + escapeHtml(g.name) + "</h1>" + (g.author && g.author !== g.name && g.author !== g.zhAlt ? '<div class="author">' + escapeHtml(g.author) + "</div>" : "") + '<div class="pod-stats">' + eps.length + " \u96C6 \xB7 " + g.pairs + ' \u53E5</div></div></div><div class="ep-rows">' + eps.map((it, i) => epRowHtml(it, i + 1, false)).join("") + "</div>";
    bindNav(app);
  }
  function epRowHtml(it, num, showPodcast) {
    const main = it.episode_title_zh || it.episode_title || "";
    const metaParts = [];
    if (showPodcast) metaParts.push(it.podcast_title || it.podcast_title_zh || "");
    if (it.pub_date) metaParts.push(it.pub_date);
    if (it.duration) metaParts.push(fmtDuration(it.duration));
    if (it.pairs_count) metaParts.push(it.pairs_count + " \u53E5");
    let heardHtml = "";
    const prefs = loadEpPrefs(it.id);
    if (prefs && typeof prefs.t === "number" && prefs.t >= 5) {
      const total = parseDuration(it.duration);
      const pct = total > 0 ? Math.min(100, Math.round(prefs.t / total * 100)) : 0;
      heardHtml = '<div class="heard">' + (pct > 0 ? '<span class="mini-progress"><span style="width:' + pct + '%"></span></span>' : "") + '<span class="heard-text">\u5DF2\u542C\u81F3 ' + fmtTime(prefs.t) + "</span></div>";
    }
    return '<div class="ep-row" data-go="ep:' + encodeURIComponent(it.id) + '" tabindex="0" role="link"><span class="num">' + num + '</span><div class="thumb-wrap">' + coverHtml(it.image, "thumb", main) + '</div><div class="info"><div class="t-zh">' + escapeHtml(main) + '</div><div class="meta">' + metaParts.map(escapeHtml).join(" \xB7 ") + "</div>" + heardHtml + '</div><span class="chev">' + CHEV_SVG + "</span></div>";
  }
  var SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  var MODE_ORDER = ["both", "en", "zh"];
  function segBtnHtml(m, label) {
    const on = ep.mode === m;
    return '<button class="seg-btn' + (on ? " on" : "") + '" data-mode="' + m + '" aria-pressed="' + on + '">' + label + "</button>";
  }
  var ep = {
    id: null,
    data: null,
    pairs: [],
    audio: null,
    activeIdx: -1,
    follow: true,
    loop: false,
    mode: "both",
    fontScale: 1,
    rate: 1,
    seeking: false,
    saveTimer: null,
    pairEls: [],
    rafId: 0,
    togglePlay: () => {
    },
    setVolume: () => {
    },
    setLoop: () => {
    },
    gotoSentence: () => {
    },
    closeSettings: () => {
    },
    closeSpeed: () => {
    }
  };
  var pendingSeek = null;
  function epStoreKey(id) {
    return "cherina:ep:" + id;
  }
  function loadEpPrefs(id) {
    try {
      const raw = localStorage.getItem(epStoreKey(id));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  function saveEpPrefs() {
    if (!ep.id || !ep.audio) return;
    const prefs = {
      t: Math.floor(ep.audio.currentTime || 0),
      rate: ep.rate,
      mode: ep.mode,
      font: ep.fontScale,
      follow: ep.follow,
      ts: Date.now()
    };
    try {
      localStorage.setItem(epStoreKey(ep.id), JSON.stringify(prefs));
    } catch {
    }
  }
  function cleanupEpisode() {
    if (ep.saveTimer) {
      clearInterval(ep.saveTimer);
      ep.saveTimer = null;
    }
    if (ep.audio) {
      saveEpPrefs();
      ep.audio.pause();
      ep.audio.src = "";
    }
    if (ep.rafId) cancelAnimationFrame(ep.rafId);
    ep.id = null;
    ep.data = null;
    ep.pairs = [];
    ep.audio = null;
    ep.activeIdx = -1;
    ep.loop = false;
    ep.closeSettings = () => {
    };
    ep.closeSpeed = () => {
    };
    ep.pairEls = [];
  }
  async function renderEpisode(id) {
    cleanupEpisode();
    currentView.name = "episode";
    currentView.param = id;
    document.title = "\u52A0\u8F7D\u4E2D\u2026 \xB7 Cherina Pod";
    container.className = "container has-playbar";
    app.className = "";
    app.innerHTML = LOADING_HTML;
    let data;
    try {
      const resp = await fetch("/api/episodes/" + encodeURIComponent(id), { cache: "no-store" });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      data = await resp.json();
    } catch (e) {
      app.innerHTML = notFoundHtml("\u627E\u4E0D\u5230\u8FD9\u671F\u8282\u76EE", e.message);
      return;
    }
    const info = data.episode || {};
    const pc = data.podcast || {};
    const mainTitle = info.title_zh || info.title || "\u5355\u671F";
    seoBase(
      mainTitle + " \xB7 Cherina Pod",
      (info.description || "").slice(0, 150) + " \u2014 \u4E2D\u82F1\u5BF9\u7167\u9010\u53E5\u7CBE\u542C\u3002",
      SITE_URL + "/?id=" + encodeURIComponent(id),
      info.image || pc.image || SITE_URL + "/brand/web-logo-small.svg"
    );
    ep.id = id;
    ep.data = data;
    ep.pairs = (data.pairs || []).filter((p) => p && typeof p.start === "number");
    ep.activeIdx = -1;
    ep.loop = false;
    const prefs = loadEpPrefs(id) || {};
    const rate = prefs.rate;
    ep.rate = typeof rate === "number" && SPEEDS.includes(rate) ? rate : 1;
    const mode = prefs.mode;
    ep.mode = typeof mode === "string" && MODE_ORDER.includes(mode) ? mode : "both";
    ep.fontScale = typeof prefs.font === "number" && prefs.font >= 0.8 && prefs.font <= 1.35 ? prefs.font : 1;
    ep.follow = prefs.follow !== false;
    const cdnSrc = "https://pod-audio.cherina.app/" + encodeURIComponent(id) + ".mp4";
    setLdJson({
      "@context": "https://schema.org",
      "@type": "PodcastEpisode",
      name: mainTitle,
      url: SITE_URL + "/?id=" + encodeURIComponent(id),
      description: (info.description || "").slice(0, 300),
      datePublished: info.pub_date || "",
      ...info.duration ? { duration: isoDuration(info.duration) } : {},
      ...info.image || pc.image ? { image: info.image || pc.image } : {},
      ...pc.title ? { partOfSeries: { "@type": "PodcastSeries", name: pc.title } } : {},
      ...pc.title ? { podcastSeries: { "@type": "PodcastSeries", name: pc.title } } : {},
      ...pc.author ? { author: { "@type": "Organization", name: pc.author } } : {},
      ...cdnSrc ? { audio: { "@type": "AudioObject", contentUrl: cdnSrc, encodingFormat: "audio/mp4" } } : {}
    });
    const remoteSrc = info.audio_url || "";
    const remoteUsable = /^https:\/\//i.test(remoteSrc) || location.protocol !== "https:";
    const audioSrc = cdnSrc;
    const audioFallback = remoteUsable && remoteSrc ? remoteSrc : "";
    const pcName = pc.title || pc.title_zh || "";
    const backHash = "#/podcast/" + encodeURIComponent(pcName);
    const descText = (info.description || "").trim();
    app.innerHTML = '<div class="ep-layout"><div class="ep-main"><div class="ep-hero"><div class="ep-hero-cover">' + coverHtml(info.image || pc.image, "cover", pcName) + '</div><div class="ep-head"><div class="pc-name">' + escapeHtml(pcName) + "</div><h1>" + escapeHtml(mainTitle) + '</h1><div class="meta">' + [info.pub_date, fmtDuration(info.duration)].filter(Boolean).map(escapeHtml).join(" \xB7 ") + "</div></div></div>" + /* 单集简介：主列头部，meta 之下、工具条之上，默认 2 行折叠 */
    (descText ? '<div class="ep-desc-wrap"><div class="ep-desc clamped">' + escapeHtml(descText) + '</div><button class="desc-toggle">\u5C55\u5F00</button></div>' : "") + '<div class="toolbar"><a class="back-link" href="' + backHash + '" title="\u8FD4\u56DE" aria-label="\u8FD4\u56DE" id="epBackLink">' + BACK_SVG + '</a><div class="seg" role="group" aria-label="\u5B57\u5E55\u663E\u793A">' + segBtnHtml("both", "\u53CC\u8BED") + segBtnHtml("en", "\u82F1") + segBtnHtml("zh", "\u4E2D") + '</div><div class="spacer"></div><div class="settings-wrap"><button class="tbtn" id="settingsBtn" title="\u5B66\u4E60\u8BBE\u7F6E" aria-label="\u5B66\u4E60\u8BBE\u7F6E" aria-haspopup="true" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h9M18 6h3M3 12h3M12 12h9M3 18h11M20 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg></button><div class="settings-pop" id="settingsPop" hidden><div class="set-row"><span class="set-label">\u8DDF\u968F\u5F53\u524D\u53E5</span>' + (FINE_POINTER ? '<span class="set-hint">F</span>' : "") + '<button class="switch' + (ep.follow ? " on" : "") + '" id="followBtn" role="switch" aria-checked="' + (ep.follow ? "true" : "false") + '" title="\u8DDF\u968F\u5F53\u524D\u53E5' + (FINE_POINTER ? "\uFF08F\uFF09" : "") + '" aria-label="\u8DDF\u968F\u5F53\u524D\u53E5"></button></div><div class="set-row"><span class="set-label">\u5B57\u53F7</span><div class="set-stepper"><button class="tbtn" id="fontMinus" title="\u51CF\u5C0F\u5B57\u53F7" aria-label="\u51CF\u5C0F\u5B57\u53F7"><svg viewBox="0 0 24 24" fill="none"><text x="3" y="17" font-size="14" font-weight="800" fill="currentColor" font-family="inherit">A</text><path d="M14 13h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button><span class="set-val" id="fontVal">' + +ep.fontScale.toFixed(2) + '</span><button class="tbtn" id="fontPlus" title="\u589E\u5927\u5B57\u53F7" aria-label="\u589E\u5927\u5B57\u53F7"><svg viewBox="0 0 24 24" fill="none"><text x="3" y="17" font-size="14" font-weight="800" fill="currentColor" font-family="inherit">A</text><path d="M14 13h7M17.5 9.5v7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div></div>' + (FINE_POINTER ? '<button class="set-link" id="helpBtn" title="\u952E\u76D8\u5FEB\u6377\u952E\uFF08?\uFF09"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6"/></svg>\u952E\u76D8\u5FEB\u6377\u952E<span class="set-hint">?</span></button>' : "") + '</div></div></div><div class="list" id="list">' + (ep.pairs.length === 0 ? '<div class="empty">' + mascotHtml() + "\u8FD9\u671F\u8FD8\u6CA1\u6709\u53E5\u5B50\u6570\u636E</div>" : ep.pairs.map(
      (p, i) => '<div class="pair" data-i="' + i + '"><div class="pair-actions"><button class="pa-btn" data-act="loop" title="\u5FAA\u73AF\u6B64\u53E5" aria-label="\u5FAA\u73AF\u6B64\u53E5">' + LOOP_SVG + '</button><button class="pa-btn" data-act="copy" title="\u590D\u5236\u82F1\u6587" aria-label="\u590D\u5236\u82F1\u6587"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></div><span class="time">' + fmtTime(p.start) + '</span><div class="en">' + escapeHtml(p.en) + '</div><div class="zh">' + escapeHtml(p.zh) + "</div></div>"
    ).join("")) + '</div></div></div><div class="playbar" id="playbar"><div class="pbar-hit" id="pbarHit" title="\u70B9\u51FB\u6216\u62D6\u62FD\u8DF3\u8F6C"><div class="pbar"><div class="pbar-fill" id="pbarFill"></div></div></div><div class="playbar-row"><div class="pb-cover-wrap">' + coverHtml(info.image || pc.image, "pb-cover", pcName) + '</div><div class="pb-now"><div class="np-line" id="npLine">' + escapeHtml(mainTitle) + '</div><div class="np-sub">' + escapeHtml(pcName) + '</div></div><button class="p-btn" id="back10" title="\u540E\u9000 10 \u79D2"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 17l-5-5 5-5"/><path d="M18 17l-5-5 5-5"/></svg></button><button class="p-btn main" id="playBtn" title="\u64AD\u653E / \u6682\u505C\uFF08\u7A7A\u683C\uFF09"><svg id="playIcon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></button><button class="p-btn" id="fwd10" title="\u524D\u8FDB 10 \u79D2"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 17l5-5-5-5"/><path d="M6 17l5-5-5-5"/></svg></button><div class="times"><span class="cur" id="curTime">0:00</span> / <span id="durTime">' + escapeHtml(fmtTime(data.duration || parseDuration(info.duration))) + '</span></div><div class="spacer"></div><button class="p-btn" id="loopBtn" title="\u5355\u53E5\u5FAA\u73AF\uFF1A\u5FAA\u73AF\u5F53\u524D\u53E5\uFF0C\u7EC3\u8DDF\u8BFB\uFF08L\uFF09">' + LOOP_SVG + '</button><div class="settings-wrap speed-wrap"><button class="speed-btn' + (ep.rate === 1 ? " is-one" : "") + '" id="speedBtn" title="\u500D\u901F" aria-haspopup="true" aria-expanded="false">' + ep.rate + '\xD7</button><div class="settings-pop speed-pop" id="speedPop" hidden>' + SPEEDS.map(
      (s) => '<button class="set-link speed-opt' + (ep.rate === s ? " on" : "") + '" data-rate="' + s + '">' + s + "\xD7</button>"
    ).join("") + '</div></div><div class="vol-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg><input class="vol-range" id="volRange" type="range" min="0" max="1" step="0.05" value="1" title="\u97F3\u91CF"></div></div></div>';
    if (ep.mode !== "both") app.classList.add("mode-" + ep.mode);
    document.documentElement.style.setProperty("--pair-scale", String(ep.fontScale));
    app.querySelectorAll(".desc-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const desc = btn.previousElementSibling;
        if (!desc) return;
        const clamped = desc.classList.toggle("clamped");
        btn.textContent = clamped ? "\u5C55\u5F00" : "\u6536\u8D77";
      });
    });
    const backLink = $("#epBackLink");
    if (backLink) {
      backLink.addEventListener("click", (e) => {
        e.preventDefault();
        location.hash = backTarget();
      });
    }
    setupPlayer(audioSrc, prefs, audioFallback);
    setupToolbar();
    setupList();
    if (pendingSeek && pendingSeek.id === id) {
      const t = pendingSeek.t;
      pendingSeek = null;
      const idx = findPairIndex(t);
      if (idx >= 0) {
        if (ep.audio && ep.audio.src) ep.audio.currentTime = t + 0.01;
        setActive(idx, true);
      }
    }
  }
  function setupPlayer(audioSrc, prefs, fallbackSrc) {
    const audio = new Audio();
    audio.preload = "metadata";
    if (audioSrc) audio.src = audioSrc;
    ep.audio = audio;
    let triedFallback = false;
    const playBtn = mustGet("#playBtn");
    const playIcon = mustGet("#playIcon");
    const curTimeEl = mustGet("#curTime");
    const durTimeEl = mustGet("#durTime");
    const pbarHit = mustGet("#pbarHit");
    const pbarFill = mustGet("#pbarFill");
    const speedBtn = mustGet("#speedBtn");
    const volRange = mustGet("#volRange");
    audio.playbackRate = ep.rate;
    const ICON_PLAY = '<path d="M8 5.5v13l11-6.5z"/>';
    const ICON_PAUSE = '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>';
    function refreshPlayIcon() {
      playIcon.innerHTML = audio.paused ? ICON_PLAY : ICON_PAUSE;
    }
    function duration() {
      if (isFinite(audio.duration) && audio.duration > 0) return audio.duration;
      const data = ep.data;
      if (!data) return 0;
      return data.duration || parseDuration((data.episode || {}).duration) || 0;
    }
    function updateProgressUI(t) {
      const d = duration();
      const pct = d > 0 ? Math.min(100, t / d * 100) : 0;
      pbarFill.style.width = pct + "%";
      curTimeEl.textContent = fmtTime(t);
    }
    playBtn.addEventListener("click", togglePlay);
    mustGet("#back10").addEventListener("click", () => {
      audio.currentTime = Math.max(0, audio.currentTime - 10);
    });
    mustGet("#fwd10").addEventListener("click", () => {
      audio.currentTime = Math.min(duration(), audio.currentTime + 10);
    });
    function togglePlay() {
      if (!audioSrc) {
        toast("\u8FD9\u671F\u6CA1\u6709\u97F3\u9891");
        return;
      }
      if (audio.paused) audio.play().catch(() => {
      });
      else audio.pause();
    }
    ep.togglePlay = togglePlay;
    audio.addEventListener("play", refreshPlayIcon);
    audio.addEventListener("pause", () => {
      refreshPlayIcon();
      saveEpPrefs();
    });
    audio.addEventListener("loadedmetadata", () => {
      durTimeEl.textContent = fmtTime(duration());
      if (prefs && typeof prefs.t === "number" && prefs.t > 0 && prefs.t < duration() - 5) {
        audio.currentTime = prefs.t;
        updateProgressUI(prefs.t);
        const idx = findPairIndex(prefs.t);
        if (idx >= 0) setActive(idx, false);
        if (prefs.t > 10) toast("\u5DF2\u4ECE\u4E0A\u6B21\u8FDB\u5EA6 " + fmtTime(prefs.t) + " \u7EE7\u7EED");
      }
    });
    audio.addEventListener("error", () => {
      if (!audio.src) return;
      if (!triedFallback && fallbackSrc && audioSrc !== fallbackSrc) {
        triedFallback = true;
        audio.src = fallbackSrc;
        audio.load();
        return;
      }
      toast("\u97F3\u9891\u52A0\u8F7D\u5931\u8D25\uFF0C\u53EF\u4EC5\u9605\u8BFB\u6587\u672C");
    });
    audio.addEventListener("ended", () => {
      setLoop(false);
    });
    function onTick() {
      if (!ep.seeking) updateProgressUI(audio.currentTime);
      handlePosition(audio.currentTime);
    }
    audio.addEventListener("timeupdate", onTick);
    function rafLoop() {
      if (!audio.paused && !ep.seeking) updateProgressUI(audio.currentTime);
      ep.rafId = requestAnimationFrame(rafLoop);
    }
    ep.rafId = requestAnimationFrame(rafLoop);
    ep.saveTimer = setInterval(() => {
      if (!audio.paused) saveEpPrefs();
    }, 5e3);
    function posToTime(clientX) {
      const r = pbarHit.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      return ratio * duration();
    }
    pbarHit.addEventListener("pointerdown", (e) => {
      ep.seeking = true;
      pbarHit.classList.add("seeking");
      pbarHit.setPointerCapture(e.pointerId);
      updateProgressUI(posToTime(e.clientX));
    });
    pbarHit.addEventListener("pointermove", (e) => {
      if (ep.seeking) updateProgressUI(posToTime(e.clientX));
    });
    pbarHit.addEventListener("pointerup", (e) => {
      if (!ep.seeking) return;
      ep.seeking = false;
      pbarHit.classList.remove("seeking");
      audio.currentTime = posToTime(e.clientX);
      handlePosition(audio.currentTime);
    });
    const speedPop = mustGet("#speedPop");
    const setSpeedPop = (open) => {
      speedPop.hidden = !open;
      speedBtn.setAttribute("aria-expanded", open ? "true" : "false");
    };
    speedBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const opening = speedPop.hidden;
      if (opening) ep.closeSettings();
      setSpeedPop(opening);
    });
    speedPop.addEventListener("click", (e) => e.stopPropagation());
    const speedOpts = Array.from(speedPop.querySelectorAll(".speed-opt"));
    speedOpts.forEach((btn) => {
      btn.addEventListener("click", () => {
        setRate(parseFloat(btn.dataset.rate || "1"));
        setSpeedPop(false);
      });
    });
    ep.closeSpeed = () => setSpeedPop(false);
    function setRate(r) {
      ep.rate = r;
      audio.playbackRate = r;
      speedBtn.textContent = r + "\xD7";
      speedBtn.classList.toggle("is-one", r === 1);
      speedOpts.forEach((b) => b.classList.toggle("on", parseFloat(b.dataset.rate || "1") === r));
      saveEpPrefs();
    }
    volRange.addEventListener("input", () => {
      audio.volume = parseFloat(volRange.value);
    });
    ep.setVolume = (v) => {
      audio.volume = Math.min(1, Math.max(0, v));
      volRange.value = String(audio.volume);
    };
  }
  function findPairIndex(t) {
    const pairs = ep.pairs;
    let lo = 0, hi = pairs.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = lo + hi >> 1;
      if (pairs[mid].start <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (ans >= 0) {
      const p = pairs[ans];
      if (t < (p.end != null ? p.end : Infinity)) return ans;
      if (t >= p.start) return ans;
    }
    return -1;
  }
  var followAnim = 0;
  var REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function smoothCenterEl(el) {
    if (REDUCED_MOTION) {
      el.scrollIntoView({ block: "center" });
      return;
    }
    cancelAnimationFrame(followAnim);
    const r = el.getBoundingClientRect();
    const target = window.scrollY + r.top + r.height / 2 - window.innerHeight / 2;
    const start = window.scrollY;
    const delta = target - start;
    if (Math.abs(delta) < 4) return;
    const dur = 300;
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      window.scrollTo(0, start + delta * e);
      if (p < 1) followAnim = requestAnimationFrame(step);
      else followAnim = 0;
    };
    followAnim = requestAnimationFrame(step);
  }
  ["wheel", "touchmove"].forEach((evt) => window.addEventListener(evt, () => {
    if (followAnim) {
      cancelAnimationFrame(followAnim);
      followAnim = 0;
    }
  }, { passive: true }));
  function setActive(i, scroll) {
    if (i === ep.activeIdx) return;
    const prev = ep.activeIdx;
    ep.activeIdx = i;
    if (prev >= 0 && ep.pairEls[prev]) ep.pairEls[prev].classList.remove("active");
    if (i >= 0 && ep.pairEls[i]) {
      ep.pairEls[i].classList.add("active");
      if (ep.loop) syncLoopBadge();
      if (scroll && ep.follow) {
        smoothCenterEl(ep.pairEls[i]);
      }
    }
    const np = $("#npLine");
    if (np && ep.data) {
      const info = ep.data.episode || {};
      np.textContent = i >= 0 && ep.pairs[i] ? ep.pairs[i].en || "" : info.title_zh || info.title || "";
    }
  }
  function handlePosition(t) {
    if (ep.loop && ep.activeIdx >= 0 && ep.pairs[ep.activeIdx]) {
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
  function syncLoopBadge() {
    ep.pairEls.forEach((el, k) => {
      el.classList.toggle("looping", ep.loop && k === ep.activeIdx);
      const btn = el.querySelector('.pa-btn[data-act="loop"]');
      if (btn) btn.classList.toggle("on", ep.loop && k === ep.activeIdx);
    });
  }
  function setLoop(on) {
    ep.loop = on;
    const btn = $("#loopBtn");
    if (btn) btn.classList.toggle("on", on);
    syncLoopBadge();
    if (on) toast("\u5355\u53E5\u5FAA\u73AF\u5DF2\u5F00\u542F\uFF0C\u518D\u6309\u4E00\u6B21\u9000\u51FA");
    saveEpPrefs();
  }
  ep.setLoop = setLoop;
  function gotoSentence(i, autoplay) {
    if (i < 0 || i >= ep.pairs.length) return;
    if (ep.loop) setLoop(false);
    const p = ep.pairs[i];
    if (ep.audio && ep.audio.src) {
      ep.audio.currentTime = p.start + 0.01;
      if (autoplay) ep.audio.play().catch(() => {
      });
    }
    setActive(i, true);
  }
  ep.gotoSentence = gotoSentence;
  function loopThisSentence(i) {
    if (ep.loop && ep.activeIdx === i) {
      setLoop(false);
      return;
    }
    gotoSentence(i, true);
    setLoop(true);
  }
  function setupToolbar() {
    const segBtns = Array.from(app.querySelectorAll(".seg-btn"));
    const applyMode = () => {
      app.classList.remove("mode-en", "mode-zh");
      if (ep.mode !== "both") app.classList.add("mode-" + ep.mode);
      segBtns.forEach((b) => {
        const on = b.dataset.mode === ep.mode;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    };
    segBtns.forEach((b) => b.addEventListener("click", () => {
      const m = b.dataset.mode;
      if (!m || m === ep.mode) return;
      ep.mode = m;
      applyMode();
      saveEpPrefs();
    }));
    const settingsBtn = mustGet("#settingsBtn");
    const settingsPop = mustGet("#settingsPop");
    const setPop = (open) => {
      settingsPop.hidden = !open;
      settingsBtn.setAttribute("aria-expanded", open ? "true" : "false");
      settingsBtn.classList.toggle("on", open);
    };
    settingsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const opening = settingsPop.hidden;
      if (opening) ep.closeSpeed();
      setPop(opening);
    });
    settingsPop.addEventListener("click", (e) => e.stopPropagation());
    ep.closeSettings = () => setPop(false);
    const followBtn = mustGet("#followBtn");
    followBtn.addEventListener("click", () => {
      ep.follow = !ep.follow;
      followBtn.classList.toggle("on", ep.follow);
      followBtn.setAttribute("aria-checked", ep.follow ? "true" : "false");
      toast(ep.follow ? "\u8DDF\u968F\u6EDA\u52A8\u5DF2\u5F00\u542F" : "\u8DDF\u968F\u6EDA\u52A8\u5DF2\u5173\u95ED");
      saveEpPrefs();
    });
    mustGet("#loopBtn").addEventListener("click", () => setLoop(!ep.loop));
    const applyFont = () => {
      document.documentElement.style.setProperty("--pair-scale", String(ep.fontScale));
      const val = $("#fontVal");
      if (val) val.textContent = String(+ep.fontScale.toFixed(2));
      saveEpPrefs();
    };
    mustGet("#fontMinus").addEventListener("click", () => {
      ep.fontScale = Math.max(0.8, +(ep.fontScale - 0.07).toFixed(2));
      applyFont();
    });
    mustGet("#fontPlus").addEventListener("click", () => {
      ep.fontScale = Math.min(1.35, +(ep.fontScale + 0.07).toFixed(2));
      applyFont();
    });
    const helpBtn = $("#helpBtn");
    if (helpBtn) {
      helpBtn.addEventListener("click", () => {
        setPop(false);
        mustGet("#shortcutModal").classList.add("open");
      });
    }
  }
  function setupList() {
    ep.pairEls = Array.from(document.querySelectorAll(".pair"));
    ep.pairEls.forEach((el) => {
      el.addEventListener("click", () => {
        const idx = Number(el.dataset.i);
        if (Number.isNaN(idx)) return;
        gotoSentence(idx, true);
      });
      el.querySelectorAll(".pa-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const idx = Number(el.dataset.i);
          if (Number.isNaN(idx)) return;
          if (btn.dataset.act === "loop") {
            loopThisSentence(idx);
          } else if (btn.dataset.act === "copy") {
            copyText(ep.pairs[idx].en || "").then(() => toast("\u5DF2\u590D\u5236\u82F1\u6587"));
          }
        });
      });
    });
  }
  var modal = mustGet("#shortcutModal");
  mustGet("#modalClose").addEventListener("click", () => modal.classList.remove("open"));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("open");
  });
  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
    if (e.key === "Escape") {
      if (modal.classList.contains("open")) {
        modal.classList.remove("open");
        return;
      }
      const speedPop = $("#speedPop");
      if (speedPop && !speedPop.hidden) {
        ep.closeSpeed();
        return;
      }
      const pop = $("#settingsPop");
      if (pop && !pop.hidden) {
        ep.closeSettings();
        return;
      }
      if (currentView.name === "episode" && ep.data) {
        location.hash = backTarget();
        return;
      }
      if (currentView.name === "podcast") {
        location.hash = "#/";
        return;
      }
      return;
    }
    if (e.key === "?" || e.shiftKey && e.key === "/") {
      modal.classList.toggle("open");
      return;
    }
    if (!ep.id || !ep.audio) return;
    switch (e.key) {
      case " ":
        e.preventDefault();
        ep.togglePlay();
        break;
      case "ArrowLeft":
        e.preventDefault();
        gotoSentence(ep.activeIdx > 0 ? ep.activeIdx - 1 : 0, false);
        break;
      case "ArrowRight":
        e.preventDefault();
        gotoSentence(ep.activeIdx < ep.pairs.length - 1 ? ep.activeIdx + 1 : ep.activeIdx, false);
        break;
      case "ArrowUp":
        e.preventDefault();
        ep.setVolume(ep.audio.volume + 0.1);
        toast("\u97F3\u91CF " + Math.round(ep.audio.volume * 100) + "%");
        break;
      case "ArrowDown":
        e.preventDefault();
        ep.setVolume(ep.audio.volume - 0.1);
        toast("\u97F3\u91CF " + Math.round(ep.audio.volume * 100) + "%");
        break;
      case "l":
      case "L":
        if (ep.activeIdx < 0 && ep.pairs.length) gotoSentence(0, false);
        setLoop(!ep.loop);
        break;
      case "f":
      case "F": {
        const btn = $("#followBtn");
        if (btn) btn.click();
        break;
      }
    }
  });
  document.addEventListener("click", () => {
    const pop = $("#settingsPop");
    if (pop && !pop.hidden) ep.closeSettings();
    const speedPop = $("#speedPop");
    if (speedPop && !speedPop.hidden) ep.closeSpeed();
  });
  window.addEventListener("beforeunload", saveEpPrefs);
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
  }
  var deferredPrompt = null;
  var installBtn = mustGet("#installBtn");
  window.addEventListener("beforeinstallprompt", ((e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  }));
  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installBtn.hidden = true;
    toast("\u5DF2\u5B89\u88C5\u5230\u4E3B\u5C4F\u5E55");
  });
  route();
})();

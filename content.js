const AD_SELECTORS = [
  "iframe[src*='googlesyndication']",
  "iframe[src*='doubleclick']",
  "iframe[src*='googleadservices']",
  "iframe[src*='adservice.google']",
  "iframe[src*='amazon-adsystem']",
  "iframe[src*='ads.yahoo']",
  "iframe[src*='adsystem']",
  "iframe[src*='adnxs']",
  "iframe[src*='adsrvr']",
  "iframe[src*='criteo']",
  "iframe[src*='taboola']",
  "iframe[src*='outbrain']",
  "iframe[src*='mgid']",
  "iframe[src*='adform']",
  "iframe[src*='rubiconproject']",
  "iframe[src*='pubmatic']",
  "iframe[src*='openx']",
  "iframe[src*='moatads']",
  "iframe[src*='ads-twitter']",
  "iframe[src*='facebook.com/tr']",
  "iframe[id*='google_ads']",
  "iframe[id*='ad_iframe']",
  "ins.adsbygoogle",
  "[data-ad-client]",
  "[data-ad-slot]",
  "[data-google-query-id]",
  "#taw",
  "#tvcap",
  ".adsbygoogle",
  ".GoogleActiveViewElement",
  ".commercial-unit-desktop-top",
  ".commercial-unit-desktop-rhs",
  "[id^='div-gpt-ad']",
  "[id^='google_ads_iframe']",
  "[id*='taboola']",
  "[id*='outbrain']",
  "[class*='taboola']",
  "[class*='outbrain']",
  "aside[aria-label='Ads']",
  "[aria-label='Advertisement']",
  "[aria-label='Sponsored']",
  "div[id^='ad-']",
  "div[id$='-ad']",
  "div[class~='ad']",
  "div[class~='ads']",
  "div[class*='ad-slot']",
  "div[class*='adslot']",
  "div[class*='ad-container']",
  "div[class*='adcontainer']",
  "div[class*='sponsored']"
];

const SKIP_RE =
  /^(header|footer|nav|sidebar|content|shadow|padding|loading|breadcrumb|badge|radio|thread)$/i;

const AD_IFRAME_SRC_RE =
  /googleads|doubleclick|googlesyndication|adservice|amazon-adsystem|adnxs|adsrvr|criteo|taboola|outbrain|adform|rubicon|pubmatic|openx|moatads|adsystem/i;

// Whole-word ad markers. A name like "ad-content" contains one, so the skip words
// ("content") don't knock it out, while "main-content" still gets skipped.
const AD_TOKEN_RE =
  /^(ad|ads|advert|adverts|advertisement|adslot|adunit|adcontainer|adsbygoogle|sponsored|promoted|taboola|outbrain|gpt)$/i;

// Split an id/class list into whole words: "ad-container-thread" -> ad, container, thread
function tokens(s) {
  return s.split(/[\s\-_]+/).filter(Boolean);
}

// Signals that are unambiguously ads; the skip-word filter never overrides these.
function hasStrongAdSignal(el) {
  const id = el.id || "";
  if (el.tagName === "IFRAME") {
    const src = el.getAttribute("src") || el.src || "";
    if (AD_IFRAME_SRC_RE.test(src)) return true;
  }
  if (el.tagName === "INS" && el.classList.contains("adsbygoogle")) return true;
  if (el.hasAttribute("data-ad-client") || el.hasAttribute("data-ad-slot")) return true;
  if (/^div-gpt-ad/i.test(id) || /^google_ads_iframe/i.test(id)) return true;
  return false;
}

let enabled = true;
let minArea = 12000;
const seen = new Set();
const observer = new IntersectionObserver(onIntersect, {
  root: null,
  threshold: [0.35],
  rootMargin: "0px"
});
const watched = new WeakSet();

chrome.storage.local.get({ enabled: true, minArea: 12000 }, (cfg) => {
  enabled = cfg.enabled;
  minArea = cfg.minArea;
  scan();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) enabled = changes.enabled.newValue;
  if (changes.minArea) minArea = changes.minArea.newValue;
});

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function isAdNode(el) {
  if (!(el instanceof Element)) return false;
  if (hasStrongAdSignal(el)) return true;
  const id = el.id || "";
  const cls = el.className && typeof el.className === "string" ? el.className : "";
  const words = [...tokens(id), ...tokens(cls)];
  if (words.some((t) => AD_TOKEN_RE.test(t))) return true;
  if (words.some((t) => SKIP_RE.test(t))) return false;
  return true;
}

function fingerprint(el) {
  const src =
    el.getAttribute("src") ||
    el.getAttribute("data-src") ||
    el.querySelector("iframe,img")?.src ||
    "";
  const r = el.getBoundingClientRect();
  return hash(
    [
      location.hostname,
      el.tagName,
      el.id,
      typeof el.className === "string" ? el.className : "",
      src.slice(0, 240),
      Math.round(r.width),
      Math.round(r.height)
    ].join("|")
  );
}

function clipRect(r) {
  const x = Math.max(0, r.left);
  const y = Math.max(0, r.top);
  const right = Math.min(window.innerWidth, r.right);
  const bottom = Math.min(window.innerHeight, r.bottom);
  const width = right - x;
  const height = bottom - y;
  if (width < 40 || height < 40) return null;
  if (width * height < minArea) return null;
  return { x, y, width, height };
}

function collect(el) {
  if (!enabled || document.visibilityState !== "visible") return;
  if (!isAdNode(el)) return;
  const fp = fingerprint(el);
  if (seen.has(fp)) return;
  const rect = clipRect(el.getBoundingClientRect());
  if (!rect) return;
  seen.add(fp);
  const imgs = [...el.querySelectorAll("img")]
    .map((img) => img.currentSrc || img.src)
    .filter(Boolean)
    .slice(0, 8);
  chrome.runtime.sendMessage({
    type: "ad-visible",
    fingerprint: fp,
    pageUrl: location.href,
    pageTitle: document.title,
    rect,
    dpr: window.devicePixelRatio || 1,
    imageSrcs: imgs,
    tag: el.tagName,
    id: el.id || "",
    className: typeof el.className === "string" ? el.className : ""
  });
}

function onIntersect(entries) {
  for (const entry of entries) {
    if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
      collect(entry.target);
    }
  }
}

function watch(el) {
  if (!el || watched.has(el)) return;
  watched.add(el);
  observer.observe(el);
}

function scan() {
  if (!enabled) return;
  try {
    document.querySelectorAll(AD_SELECTORS.join(",")).forEach(watch);
  } catch {
    AD_SELECTORS.forEach((sel) => {
      try {
        document.querySelectorAll(sel).forEach(watch);
      } catch {
        /* invalid selector */
      }
    });
  }
}

const mo = new MutationObserver(() => {
  if (!enabled) return;
  clearTimeout(scan.t);
  scan.t = setTimeout(scan, 400);
});

mo.observe(document.documentElement, { childList: true, subtree: true });
setInterval(scan, 2500);
scan();

if (!globalThis.__swipefilerSnip) {
  globalThis.__swipefilerSnip = true;
  initSnip();
}

function initSnip() {
  const POST_SELECTORS = [
    "shreddit-post",
    "article",
    "[data-testid='tweet']",
    "[data-testid='post-container']",
    "[data-testid='post']",
    "[role='article']",
    ".feed-shared-update-v2",
    "[data-click-id='background']",
    ".thing",
    "[data-ad-preview='message']"
  ];
  let lastTarget = null;
  let host = null;

  document.addEventListener(
    "contextmenu",
    (e) => {
      lastTarget = e.target;
    },
    true
  );

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "start-snip") startOverlay();
    if (msg?.type === "snip-last-target") snipElement(lastTarget);
  });

  function findPost(el) {
    if (!(el instanceof Element)) return null;
    for (const sel of POST_SELECTORS) {
      const hit = el.closest(sel);
      if (hit) return hit;
    }
    let node = el;
    while (node && node !== document.body) {
      const r = node.getBoundingClientRect();
      if (r.width >= 180 && r.height >= 80) return node;
      node = node.parentElement;
    }
    return el;
  }

  function viewportRect(r) {
    const x = Math.max(0, r.left);
    const y = Math.max(0, r.top);
    const right = Math.min(window.innerWidth, r.right);
    const bottom = Math.min(window.innerHeight, r.bottom);
    const width = right - x;
    const height = bottom - y;
    if (width < 24 || height < 24) return null;
    return { x, y, width, height };
  }

  async function sendSnip(rect) {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    chrome.runtime.sendMessage({
      type: "manual-snip",
      rect,
      dpr: window.devicePixelRatio || 1,
      pageUrl: location.href,
      pageTitle: document.title
    });
    toast("Snipped. Review it in swipefiler.");
  }

  function snipElement(el) {
    const post = findPost(el);
    if (!post) {
      startOverlay();
      return;
    }
    const rect = viewportRect(post.getBoundingClientRect());
    if (!rect) {
      startOverlay();
      return;
    }
    sendSnip(rect);
  }

  function startOverlay() {
    if (host) return;
    host = document.createElement("div");
    host.setAttribute("data-swipefiler-snip", "");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .mask {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          cursor: crosshair;
          background: rgba(0, 0, 0, 0.28);
        }
        .hint {
          position: fixed;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          background: #111;
          color: #fff;
          font: 13px/1.3 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;
          padding: 8px 12px;
          border-radius: 8px;
          pointer-events: none;
        }
        .box {
          position: fixed;
          border: 2px solid #fff;
          background: rgba(255, 255, 255, 0.15);
          display: none;
          pointer-events: none;
        }
      </style>
      <div class="mask"></div>
      <div class="hint">Drag to snip. Click a post to grab it. Esc cancels.</div>
      <div class="box"></div>
    `;
    const mask = shadow.querySelector(".mask");
    const box = shadow.querySelector(".box");
    document.documentElement.append(host);

    let dragging = false;
    let x0 = 0;
    let y0 = 0;

    function cancel() {
      host.remove();
      host = null;
      document.removeEventListener("keydown", onKey, true);
    }

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    }

    document.addEventListener("keydown", onKey, true);

    mask.addEventListener("mousedown", (e) => {
      dragging = true;
      x0 = e.clientX;
      y0 = e.clientY;
      box.style.display = "block";
      box.style.left = `${x0}px`;
      box.style.top = `${y0}px`;
      box.style.width = "0px";
      box.style.height = "0px";
      e.preventDefault();
    });

    mask.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const x = Math.min(x0, e.clientX);
      const y = Math.min(y0, e.clientY);
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${Math.abs(e.clientX - x0)}px`;
      box.style.height = `${Math.abs(e.clientY - y0)}px`;
    });

    mask.addEventListener("mouseup", (e) => {
      if (!dragging) return;
      dragging = false;
      const width = Math.abs(e.clientX - x0);
      const height = Math.abs(e.clientY - y0);
      const clickX = e.clientX;
      const clickY = e.clientY;
      cancel();
      if (width < 12 && height < 12) {
        const el = document.elementFromPoint(clickX, clickY);
        snipElement(el);
        return;
      }
      const rect = viewportRect({
        left: Math.min(x0, e.clientX),
        top: Math.min(y0, e.clientY),
        right: Math.max(x0, e.clientX),
        bottom: Math.max(y0, e.clientY)
      });
      if (rect) sendSnip(rect);
    });
  }

  function toast(text) {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText =
      "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#111;color:#fff;font:13px/1.3 -apple-system,sans-serif;padding:8px 12px;border-radius:8px";
    document.documentElement.append(el);
    setTimeout(() => el.remove(), 1600);
  }
}

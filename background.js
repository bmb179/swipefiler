importScripts("db.js");

const MAX_ITEMS = 400;
let saving = Promise.resolve();

function ensureMenu() {
  chrome.contextMenus.create(
    {
      id: "snip-post",
      title: "Snip this post",
      contexts: ["page", "image", "link", "selection", "video"]
    },
    () => void chrome.runtime.lastError
  );
}

ensureMenu();

chrome.runtime.onInstalled.addListener(() => {
  ensureMenu();
  chrome.storage.local.get(
    { enabled: true, minArea: 12000, inbox: [], kept: [], fingerprints: [] },
    (cfg) => {
      chrome.storage.local.set({
        enabled: cfg.enabled !== false,
        minArea: cfg.minArea || 12000,
        inbox: cfg.inbox || [],
        kept: cfg.kept || [],
        fingerprints: cfg.fingerprints || []
      });
    }
  );
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "ad-visible" || msg?.type === "manual-snip") {
    const tabId = sender.tab?.id;
    if (tabId == null) return;
    saving = saving.then(() => handleAd(msg, tabId, msg.type === "manual-snip")).catch(() => {});
    return;
  }
  if (msg?.target === "offscreen") return;
  if (msg?.type === "keep") {
    const job = saving.then(() => keep(msg.id));
    saving = job.catch(() => {});
    job.then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === "discard") {
    const job = saving.then(() => discard(msg.id));
    saving = job.catch(() => {});
    job.then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
});

async function handleAd(msg, tabId, manual) {
  const store = await chrome.storage.local.get({
    enabled: true,
    inbox: [],
    kept: [],
    fingerprints: []
  });
  if (!manual && !store.enabled) return;
  if (!manual && store.fingerprints.includes(msg.fingerprint)) return;

  const tabInfo = await chrome.tabs.get(tabId);
  if (!tabInfo.active || tabInfo.status !== "complete") return;

  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tabInfo.windowId, { format: "png" });
  } catch {
    return;
  }

  const blob = await crop(dataUrl, msg.rect, msg.dpr);
  if (!blob) return;

  const fingerprint = manual ? `snip-${Date.now()}` : msg.fingerprint;
  const id = `${Date.now()}-${fingerprint.slice(0, 8)}`;
  await putImage(id, blob);

  const item = {
    id,
    fingerprint,
    pageUrl: msg.pageUrl,
    pageTitle: msg.pageTitle,
    savedAt: new Date().toISOString(),
    source: manual ? "snip" : "ad",
    text: "",
    textSource: "ocr",
    textStatus: "pending"
  };

  const fingerprints = [fingerprint, ...store.fingerprints].slice(0, MAX_ITEMS);
  const inbox = [item, ...store.inbox].slice(0, MAX_ITEMS);
  await chrome.storage.local.set({ inbox, fingerprints });
  await updateBadge(inbox.length);
  startOcr(id);
}

// ---------- OCR (runs in an offscreen document, filled in after save) ----------
const ocrJobs = new Map();
let ocrQueue = Promise.resolve();
let creatingOffscreen = null;

async function ensureOffscreen() {
  const url = chrome.runtime.getURL("offscreen.html");
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [url]
  });
  if (existing.length) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["WORKERS"],
        justification: "Run on-device OCR (Tesseract) to read the text in captured ads."
      })
      .catch((e) => {
        if (!/single offscreen/i.test(String(e?.message))) throw e;
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

function startOcr(id) {
  const job = (ocrQueue = ocrQueue.then(() => runOcr(id)).catch(() => {}));
  ocrJobs.set(id, job);
  job.finally(() => ocrJobs.delete(id));
  return job;
}

async function runOcr(id) {
  let text = "";
  let status = "done";
  try {
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({ target: "offscreen", type: "ocr", id });
    if (res?.ok) text = res.text || "";
    else status = "failed";
  } catch {
    status = "failed";
  }
  await (saving = saving.then(() => setItemText(id, text, status)).catch(() => {}));
}

async function setItemText(id, text, status) {
  const store = await chrome.storage.local.get({ inbox: [], kept: [] });
  const patch = (a) => (a.id === id ? { ...a, text, textSource: "ocr", textStatus: status } : a);
  const inbox = store.inbox.map(patch);
  const kept = store.kept.map(patch);
  await chrome.storage.local.set({ inbox, kept });
  const keptItem = kept.find((a) => a.id === id);
  // Kept before OCR finished: write the sidecar now.
  if (keptItem && keptItem.txtDownloadId == null) await writeSidecar(keptItem);
}

function sidecarText(item) {
  return [
    `Title: ${item.pageTitle || ""}`,
    `URL: ${item.pageUrl || ""}`,
    `Saved: ${item.savedAt || ""}`,
    "",
    item.text || (item.textStatus === "pending" ? "(text not read yet)" : "(no text found)"),
    ""
  ].join("\n");
}

async function writeSidecar(item) {
  if (!item.filename) return null;
  const filename = item.filename.replace(/\.png$/i, ".txt");
  const url = "data:text/plain;charset=utf-8," + encodeURIComponent(sidecarText(item));
  const txtDownloadId = await chrome.downloads.download({
    url,
    filename,
    saveAs: false,
    conflictAction: "overwrite"
  });
  const store = await chrome.storage.local.get({ kept: [] });
  const kept = store.kept.map((a) => (a.id === item.id ? { ...a, txtDownloadId } : a));
  await chrome.storage.local.set({ kept });
  return txtDownloadId;
}

async function keep(id) {
  const store = await chrome.storage.local.get({ inbox: [], kept: [] });
  const item = store.inbox.find((ad) => ad.id === id);
  if (!item) return { ok: false };
  const blob = await getImage(id);
  if (!blob) return { ok: false };
  const url = await blobToDataUrl(blob);
  const filename = `Swipefiler/${safeName(item.pageTitle || "ad")}-${id}.png`;
  const downloadId = await chrome.downloads.download({
    url,
    filename,
    saveAs: false,
    conflictAction: "uniquify"
  });
  const keptItem = { ...item, filename, downloadId, keptAt: new Date().toISOString() };
  const inbox = store.inbox.filter((ad) => ad.id !== id);
  const kept = [keptItem, ...store.kept.filter((ad) => ad.id !== id)].slice(0, MAX_ITEMS);
  await chrome.storage.local.set({ inbox, kept });
  await updateBadge(inbox.length);
  // Sidecar .txt: write now if OCR is finished, otherwise setItemText writes it when done.
  if (keptItem.textStatus !== "pending" || !ocrJobs.has(id)) {
    try {
      await writeSidecar(keptItem);
    } catch {
      /* ignore */
    }
  }
  return { ok: true };
}

async function discard(id) {
  const store = await chrome.storage.local.get({ inbox: [], kept: [] });
  const keptItem = store.kept.find((ad) => ad.id === id);
  if (keptItem?.downloadId != null) {
    try {
      await chrome.downloads.removeFile(keptItem.downloadId);
    } catch {
      /* file already gone */
    }
  }
  if (keptItem?.txtDownloadId != null) {
    try {
      await chrome.downloads.removeFile(keptItem.txtDownloadId);
    } catch {
      /* file already gone */
    }
  }
  await deleteImage(id);
  const inbox = store.inbox.filter((ad) => ad.id !== id);
  const kept = store.kept.filter((ad) => ad.id !== id);
  await chrome.storage.local.set({ inbox, kept });
  await updateBadge(inbox.length);
  return { ok: true };
}

function safeName(s) {
  return s.replace(/[^\w\-]+/g, "_").slice(0, 40) || "ad";
}

async function crop(dataUrl, rect, dpr) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const sx = Math.max(0, Math.round(rect.x * dpr));
  const sy = Math.max(0, Math.round(rect.y * dpr));
  const sw = Math.min(bmp.width - sx, Math.round(rect.width * dpr));
  const sh = Math.min(bmp.height - sy, Math.round(rect.height * dpr));
  if (sw < 20 || sh < 20) {
    bmp.close();
    return null;
  }
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  bmp.close();
  return canvas.convertToBlob({ type: "image/png" });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function updateBadge(n) {
  await chrome.action.setBadgeBackgroundColor({ color: "#111111" });
  await chrome.action.setBadgeText({ text: n > 0 ? String(Math.min(n, 999)) : "" });
}

chrome.storage.local.get({ inbox: [], kept: [] }, (cfg) => {
  updateBadge((cfg.inbox || []).length);
  // Resume OCR that was interrupted (e.g. the service worker was shut down).
  [...(cfg.inbox || []), ...(cfg.kept || [])]
    .filter((a) => a.textStatus === "pending" && !ocrJobs.has(a.id))
    .forEach((a) => startOcr(a.id));
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "snip-post" || !tab?.id) return;
  await arm(tab.id, { type: "snip-last-target" });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "snip") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/i.test(tab.url || "")) return;
  await arm(tab.id, { type: "start-snip" });
});

async function arm(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tabId, message);
  }
}

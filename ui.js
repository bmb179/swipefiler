const countsEl = document.getElementById("counts");
const enabledEl = document.getElementById("enabled");
const expandEl = document.getElementById("expand");
const tabReview = document.getElementById("tab-review");
const tabFile = document.getElementById("tab-file");
const reviewEl = document.getElementById("review");
const fileEl = document.getElementById("file");
const card = document.getElementById("card");
const cardImg = document.getElementById("card-img");
const cardTitle = document.getElementById("card-title");
const cardUrl = document.getElementById("card-url");
const yesBtn = document.getElementById("yes");
const noBtn = document.getElementById("no");
const grid = document.getElementById("grid");
const postCount = document.getElementById("post-count");
const lightbox = document.getElementById("lightbox");
const lightImg = document.getElementById("light-img");
const lightCap = document.getElementById("light-cap");
const closeLight = document.getElementById("close-light");
const cardText = document.getElementById("card-text");
const lightText = document.getElementById("light-text");
const copyBtn = document.getElementById("copy-text");
let lightItemId = null;

let inbox = [];
let kept = [];
let busy = false;
let cardUrlObject = null;
const gridUrls = [];

chrome.storage.local.get({ enabled: true, inbox: [], kept: [] }, (cfg) => {
  enabledEl.checked = cfg.enabled !== false;
  inbox = cfg.inbox || [];
  kept = cfg.kept || [];
  paint();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) enabledEl.checked = changes.enabled.newValue !== false;
  if (changes.inbox) inbox = changes.inbox.newValue || [];
  if (changes.kept) kept = changes.kept.newValue || [];
  if (changes.inbox || changes.kept) paint();
});

enabledEl.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabledEl.checked });
});

document.getElementById("snip")?.addEventListener("click", () => startSnip());

expandEl?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
  window.close();
});

tabReview.addEventListener("click", () => showTab("review"));
tabFile.addEventListener("click", () => showTab("file"));
yesBtn.addEventListener("click", () => decide("keep"));
noBtn.addEventListener("click", () => decide("discard"));
closeLight.addEventListener("click", () => {
  lightbox.hidden = true;
  lightImg.removeAttribute("src");
  lightItemId = null;
});

copyBtn.addEventListener("click", async () => {
  const item = kept.find((a) => a.id === lightItemId);
  if (!item?.text) return;
  try {
    await navigator.clipboard.writeText(item.text);
    copyBtn.textContent = "Copied";
  } catch {
    copyBtn.textContent = "Copy failed";
  }
  setTimeout(() => (copyBtn.textContent = "Copy text"), 1200);
});

function textLabel(item) {
  if (item.text) return item.text;
  if (item.textStatus === "pending") return "Reading text…";
  if (item.textStatus === "failed") return "Couldn't read text.";
  if (item.textStatus === "done") return "No text found.";
  return "";
}

function paintText(el, item) {
  el.textContent = textLabel(item);
  el.classList.toggle("muted", !item.text);
}

document.addEventListener("keydown", (e) => {
  if (!lightbox.hidden && e.key === "Escape") {
    lightbox.hidden = true;
    return;
  }
  if (reviewEl.hidden || busy) return;
  if (e.key === "ArrowLeft" || e.key === "x" || e.key === "X") decide("discard");
  if (e.key === "ArrowRight" || e.key === "Enter") decide("keep");
});

function showTab(name) {
  const file = name === "file";
  reviewEl.hidden = file;
  fileEl.hidden = !file;
  tabReview.classList.toggle("on", !file);
  tabFile.classList.toggle("on", file);
  if (file) renderGrid();
}

function paint() {
  countsEl.textContent = `${inbox.length} to review · ${kept.length} kept`;
  postCount.textContent = String(kept.length);
  renderCard();
  if (!fileEl.hidden) renderGrid();
  if (!lightbox.hidden && lightItemId) {
    const item = kept.find((a) => a.id === lightItemId);
    if (item) {
      paintText(lightText, item);
      copyBtn.disabled = !item.text;
    }
  }
}

async function renderCard() {
  const item = inbox[0];
  yesBtn.disabled = !item || busy;
  noBtn.disabled = !item || busy;
  if (!item) {
    card.classList.add("empty");
    if (cardUrlObject) URL.revokeObjectURL(cardUrlObject);
    cardImg.removeAttribute("src");
    cardText.textContent = "";
    return;
  }
  card.classList.remove("empty");
  cardTitle.textContent = `${item.source === "snip" ? "Snip · " : ""}${item.pageTitle || "Ad"}`;
  cardUrl.textContent = item.pageUrl || "";
  paintText(cardText, item);
  const blob = await getImage(item.id);
  if (!blob || inbox[0]?.id !== item.id) return;
  if (cardUrlObject) URL.revokeObjectURL(cardUrlObject);
  cardUrlObject = URL.createObjectURL(blob);
  cardImg.src = cardUrlObject;
}

async function decide(type) {
  const item = inbox[0];
  if (!item || busy) return;
  busy = true;
  yesBtn.disabled = true;
  noBtn.disabled = true;
  card.classList.add(type === "keep" ? "fly-right" : "fly-left");
  await new Promise((r) => setTimeout(r, 260));
  await chrome.runtime.sendMessage({ type, id: item.id });
  card.classList.remove("fly-left", "fly-right");
  busy = false;
}

async function renderGrid() {
  gridUrls.forEach((url) => URL.revokeObjectURL(url));
  gridUrls.length = 0;
  grid.innerHTML = "";
  for (const item of kept) {
    const blob = await getImage(item.id);
    if (!blob) continue;
    const url = URL.createObjectURL(blob);
    gridUrls.push(url);
    const btn = document.createElement("button");
    btn.className = "cell";
    btn.type = "button";
    const img = document.createElement("img");
    img.src = url;
    img.alt = item.pageTitle || "kept ad";
    btn.append(img);
    btn.addEventListener("click", () => openPost(item, url));
    grid.append(btn);
  }
}

async function startSnip() {
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  let tab = current;
  if (!tab?.url || !/^https?:/i.test(tab.url)) {
    const all = await chrome.tabs.query({ active: true });
    tab = all.find((t) => /^https?:/i.test(t.url || ""));
  }
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "start-snip" });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: "start-snip" });
  }
  if (document.body.classList.contains("popup")) window.close();
}

function openPost(item, url) {
  lightImg.src = url;
  lightCap.textContent = `${item.pageTitle || "Ad"}\n${item.pageUrl || ""}`;
  lightItemId = item.id;
  paintText(lightText, item);
  copyBtn.disabled = !item.text;
  lightbox.hidden = false;
}
